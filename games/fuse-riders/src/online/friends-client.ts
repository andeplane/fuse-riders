import {
  FRIENDS_POLL_MS,
  type FriendInvite,
  type FriendsSyncBody,
  type FriendsView,
} from "fuse-platform/friends-api";

/**
 * The friends panel's model: one poll that reports where this device is and brings back the friend list, plus the
 * actions on it. The service pushes nothing, so the poll is the only way an invite arrives; it runs while a signed-in
 * page is up and stops the moment the account signs out. Every request carries the ID token in a header and nothing
 * else (see account.ts); a failed poll keeps the last view and says so.
 */
export interface FriendsRoom {
  code: string;
  memberId: string;
  gameId: string;
  /** The room token, to prove membership when inviting; never sent anywhere but `POST /api/rooms/:code/invites`. */
  token: string;
}
export interface FriendsClientDependencies {
  fetch: typeof fetch;
  /** A fresh ID token, or undefined for a guest. */
  token: () => Promise<string | undefined>;
  apiUrl: (path: string) => string;
  /** The name and head this device rides under, reported so friends see them. */
  identity: () => { name?: string; avatarId?: string };
  clock?: {
    now: () => number;
    schedule: (callback: () => void, delayMs: number) => () => void;
  };
  pollMs?: number;
}
export interface FriendsState {
  view: FriendsView | undefined;
  /** In flight right now. */
  loading: boolean;
  /** The last poll failed; `view` is whatever the one before brought. */
  error: string | undefined;
}
export interface FriendsClient {
  state(): FriendsState;
  /** Called on every change of state; the returned function stops the calls. */
  watch(listener: (state: FriendsState) => void): () => void;
  /** Invites this device has not seen before, as each poll finds them. */
  onInvite(listener: (invite: FriendInvite) => void): () => void;
  /** Start polling (a signed-in account) or stop and forget the view (signed out). */
  setSignedIn(signedIn: boolean): void;
  setRoom(room: FriendsRoom | undefined): void;
  room(): FriendsRoom | undefined;
  /** Poll soon, coalesced: one request however many callers ask. */
  refresh(): void;
  add(publicId: string): Promise<void>;
  remove(publicId: string): Promise<void>;
  /** Invite friends to the room this device is in; resolves with how many were invited. */
  invite(publicIds: readonly string[]): Promise<number>;
  dismissInvite(id: string): Promise<void>;
  /** Tell the service this device left its room, on a page that is going away. */
  leave(): void;
  dispose(): void;
}

const MIN_GAP_MS = 1500;

export function createFriendsClient(
  dependencies: FriendsClientDependencies,
): FriendsClient {
  const clock = dependencies.clock ?? {
    now: Date.now,
    schedule: (callback: () => void, delayMs: number) => {
      const timer = setTimeout(callback, delayMs);
      return () => clearTimeout(timer);
    },
  };
  const pollMs = dependencies.pollMs ?? FRIENDS_POLL_MS;
  const listeners = new Set<(state: FriendsState) => void>(),
    inviteListeners = new Set<(invite: FriendInvite) => void>();
  let state: FriendsState = {
    view: undefined,
    loading: false,
    error: undefined,
  };
  let signedIn = false,
    room: FriendsRoom | undefined,
    disposed = false,
    cancelPoll: (() => void) | undefined,
    lastPoll = 0,
    inFlight: Promise<void> | undefined,
    // Every invite this page has seen, by id and issue time, so a refreshed invite counts as new and a seen one never twice.
    seen = new Map<string, number>();
  const emit = (next: Partial<FriendsState>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener(state);
  };
  const headers = async (): Promise<Record<string, string> | undefined> => {
    const token = await dependencies.token();
    return token ? { Authorization: `Bearer ${token}` } : undefined;
  };
  const failure = async (response: Response): Promise<string> => {
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body.error === "string" && body.error) return body.error;
    } catch {
      // The status is the message then.
    }
    return response.status === 401
      ? "Sign in first"
      : `Friends unavailable (${response.status})`;
  };
  const call = async (
    method: string,
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<unknown> => {
    const auth = await headers();
    if (!auth) throw new Error("Sign in first");
    const response = await dependencies.fetch(dependencies.apiUrl(path), {
      method,
      headers: {
        ...auth,
        ...extraHeaders,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(await failure(response));
    return response.json();
  };
  const syncBody = (): FriendsSyncBody => {
    const identity = dependencies.identity();
    return {
      ...(identity.name === undefined ? {} : { name: identity.name }),
      ...(identity.avatarId === undefined
        ? {}
        : { avatarId: identity.avatarId }),
      ...(room
        ? {
            room: {
              code: room.code,
              memberId: room.memberId,
              gameId: room.gameId,
            },
          }
        : {}),
    };
  };
  const schedule = (delayMs: number) => {
    cancelPoll?.();
    cancelPoll = clock.schedule(() => {
      cancelPoll = undefined;
      void poll();
    }, delayMs);
  };
  const poll = async (): Promise<void> => {
    if (disposed || !signedIn) return;
    if (inFlight) return inFlight;
    lastPoll = clock.now();
    emit({ loading: true });
    inFlight = (async () => {
      try {
        const view = (await call(
          "POST",
          "/api/friends/sync",
          syncBody(),
        )) as FriendsView;
        if (disposed || !signedIn) return;
        const fresh = view.invites.filter(
          (invite) => seen.get(invite.id) !== invite.at,
        );
        // A page's first poll shows what is already waiting in the panel, but does not announce it as news.
        const announce = state.view !== undefined;
        for (const invite of view.invites) seen.set(invite.id, invite.at);
        emit({ view, loading: false, error: undefined });
        if (announce)
          for (const invite of fresh)
            for (const listener of inviteListeners) listener(invite);
      } catch (error) {
        if (disposed || !signedIn) return;
        emit({
          loading: false,
          error: error instanceof Error ? error.message : "Friends unavailable",
        });
      } finally {
        inFlight = undefined;
        if (signedIn && !disposed) schedule(pollMs);
      }
    })();
    return inFlight;
  };
  const refresh = () => {
    if (!signedIn || disposed || inFlight) return;
    schedule(
      Math.max(0, Math.min(pollMs, MIN_GAP_MS - (clock.now() - lastPoll))),
    );
  };
  /** An action's own request, then a poll to show its effect; the panel shows the error if it failed. */
  const act = async (work: () => Promise<unknown>): Promise<void> => {
    try {
      await work();
    } catch (error) {
      emit({
        error: error instanceof Error ? error.message : "Friends unavailable",
      });
      throw error;
    }
    cancelPoll?.();
    cancelPoll = undefined;
    await poll();
  };
  return {
    state: () => state,
    watch(listener) {
      listeners.add(listener);
      listener(state);
      return () => {
        listeners.delete(listener);
      };
    },
    onInvite(listener) {
      inviteListeners.add(listener);
      return () => {
        inviteListeners.delete(listener);
      };
    },
    setSignedIn(next) {
      if (next === signedIn) return;
      signedIn = next;
      if (signedIn) {
        seen.clear();
        refresh();
      } else {
        cancelPoll?.();
        cancelPoll = undefined;
        emit({ view: undefined, loading: false, error: undefined });
      }
    },
    setRoom(next) {
      const changed = JSON.stringify(next) !== JSON.stringify(room);
      room = next;
      if (changed) refresh();
    },
    room: () => room,
    refresh,
    add: (publicId) => act(() => call("POST", "/api/friends", { publicId })),
    remove: (publicId) => act(() => call("DELETE", `/api/friends/${publicId}`)),
    async invite(publicIds) {
      const where = room;
      if (!where) throw new Error("Join a room first");
      let sent = 0;
      await act(async () => {
        const identity = await dependencies.token();
        if (!identity) throw new Error("Sign in first");
        const response = await dependencies.fetch(
          dependencies.apiUrl(`/api/rooms/${where.code}/invites`),
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${where.token}`,
              "X-Fuse-Identity": identity,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ to: publicIds }),
          },
        );
        if (!response.ok) throw new Error(await failure(response));
        sent = ((await response.json()) as { sent: number }).sent;
      });
      return sent;
    },
    dismissInvite: (id) =>
      act(() => call("DELETE", `/api/friends/invites/${id}`)),
    leave() {
      if (!signedIn || !room) return;
      room = undefined;
      // Best effort on a page that is unloading: the online window would clear the room anyway, this just does it sooner.
      void headers()
        .then((auth) =>
          auth
            ? dependencies.fetch(dependencies.apiUrl("/api/friends/sync"), {
                method: "POST",
                keepalive: true,
                headers: { ...auth, "Content-Type": "application/json" },
                body: JSON.stringify(syncBody()),
              })
            : undefined,
        )
        .catch(() => undefined);
    },
    dispose() {
      disposed = true;
      cancelPoll?.();
      cancelPoll = undefined;
      listeners.clear();
      inviteListeners.clear();
    },
  };
}
