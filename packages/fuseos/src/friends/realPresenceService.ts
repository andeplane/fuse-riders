import * as browserAccount from "fuse-ui/browser-account";
import type {
  FriendsClient,
  FriendsClientDependencies,
  FriendsState,
} from "fuse-ui/friends-client";
import { createFriendsClient } from "fuse-ui/friends-client";

import type {
  AccountStatus,
  Buddy,
  PresenceService,
  PresenceSnapshot,
} from "./presenceService";
import { EMPTY_SNAPSHOT, SnapshotStore } from "./presenceService";

/**
 * The live service: fuse-ui's polling friends client over the browser's Google sign-in, both injected so a test
 * drives them. The desktop reports no name or avatar (it has none; the service keeps what a game last said) and
 * never a room: a game window reports its own room from inside its iframe, and while one is open the desktop
 * pauses (`setSuspended`) so the two do not overwrite each other's claim. See docs/fuseos/friends-design.md.
 */
export type FriendsView = NonNullable<FriendsState["view"]>;

/** The sign-in surface, as `fuse-ui/browser-account` provides it. */
export interface BrowserAccountAuth {
  watch(listener: (account: { name: string } | undefined) => void): () => void;
  token(): Promise<string | undefined>;
  ready(): Promise<void>;
  warm(): void;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  failure(error: unknown): string;
  /** Whether this browser signed in before (restoring is then under way). */
  remembers(): boolean;
}

export const browserAccountAuth: BrowserAccountAuth = {
  watch: browserAccount.watchAccount,
  token: browserAccount.identityToken,
  ready: browserAccount.accountReady,
  warm: browserAccount.warmAccount,
  signIn: browserAccount.signIn,
  signOut: browserAccount.signOut,
  failure: browserAccount.signInFailure,
  remembers: browserAccount.remembersSignIn,
};

export type RealPresenceOptions = {
  fetch: typeof fetch;
  /** `/api/...` to its absolute URL on the room service. */
  apiUrl: (path: string) => string;
  auth?: BrowserAccountAuth;
  clock?: FriendsClientDependencies["clock"];
  pollMs?: number;
  /** Tests hand in a fake client; default fuse-ui's. */
  createClient?: (dependencies: FriendsClientDependencies) => FriendsClient;
};

/**
 * `/api/...` on the configured API origin (`VITE_API_ORIGIN`, the deployed Cloud Run service) or, when none is
 * configured, on the page's own origin (`pnpm dev:online` serves the routes beside the site).
 */
export function apiUrlFor(
  apiOrigin: string | undefined,
  pageOrigin: string,
): (path: string) => string {
  const origin = new URL(apiOrigin || pageOrigin).origin;
  return (path) => {
    if (!path.startsWith("/api/") || path.includes("\\"))
      throw new Error("Invalid API path");
    const url = new URL(path, origin);
    if (url.origin !== origin || !url.pathname.startsWith("/api/"))
      throw new Error("Invalid API path");
    return url.href;
  };
}

/**
 * Whether the service says this friend is away. `away` is one of the presence fields the room service adds
 * beside `online` and `room` (docs/fuseos/friends-design.md); a service without them never sends it, so the
 * field is looked for rather than assumed, and the buddy list works against either.
 */
function reportsAway(friend: object): boolean {
  return "away" in friend && friend.away === true;
}

/** The four desktop states from what the view says: in a room is playing, away only when the service reports it. */
export function buddyFrom(friend: FriendsView["friends"][number]): Buddy {
  const present = friend.room
    ? "playing"
    : reportsAway(friend)
      ? "away"
      : "online";
  return {
    publicId: friend.publicId,
    name: friend.name,
    ...(friend.avatarId ? { avatarId: friend.avatarId } : {}),
    status: friend.online ? present : "offline",
    ...(friend.online && friend.room
      ? { room: { code: friend.room.code, gameId: friend.room.gameId } }
      : {}),
  };
}

export function createRealPresenceService(
  options: RealPresenceOptions,
): PresenceService {
  const auth = options.auth ?? browserAccountAuth;
  const store = new SnapshotStore({
    ...EMPTY_SNAPSHOT,
    account: auth.remembers() ? { kind: "restoring" } : { kind: "signed-out" },
  });
  const client = (options.createClient ?? createFriendsClient)({
    fetch: options.fetch,
    token: auth.token,
    apiUrl: options.apiUrl,
    identity: () => ({}),
    ...(options.clock ? { clock: options.clock } : {}),
    ...(options.pollMs ? { pollMs: options.pollMs } : {}),
  });
  let signedIn = false,
    suspended = false,
    disposed = false;
  const apply = () => {
    if (!disposed) client.setSignedIn(signedIn && !suspended);
  };
  const fromClient = (state: FriendsState): Partial<PresenceSnapshot> => {
    const view = state.view;
    return {
      loading: state.loading,
      ...(state.error === undefined ? {} : { error: state.error }),
      ...(view
        ? {
            loaded: true,
            me: view.me,
            buddies: view.friends.map(buddyFrom),
            incoming: view.incoming,
            outgoing: view.outgoing,
            invites: view.invites,
          }
        : {}),
    };
  };
  const stopClient = client.watch((state) => {
    // Pausing keeps the last list on screen; only a sign-out empties it.
    if (!signedIn) return;
    if (suspended && state.view === undefined) return;
    const { error: _error, ...rest } = store.get();
    store.set({ ...rest, ...fromClient(state) });
  });
  // The watch reports "nobody" at once, before a remembered sign-in has been restored; that is not a sign-out.
  let restoring = store.get().account.kind === "restoring";
  const stopAuth = auth.watch((account) => {
    signedIn = account !== undefined;
    if (account) restoring = false;
    const status: AccountStatus = account
      ? { kind: "signed-in", name: account.name }
      : restoring
        ? { kind: "restoring" }
        : { kind: "signed-out" };
    store.set(
      account
        ? { ...store.get(), account: status }
        : { ...EMPTY_SNAPSHOT, account: status, suspended },
    );
    apply();
  });
  // A remembered sign-in that the SDK could not restore is a signed-out browser, not one forever restoring.
  if (restoring)
    auth.ready().then(
      () => {
        restoring = false;
        if (!disposed && store.get().account.kind === "restoring")
          store.patch({ account: { kind: "signed-out" } });
      },
      () => {
        restoring = false;
        if (!disposed && store.get().account.kind === "restoring")
          store.patch({
            account: { kind: "signed-out" },
            error: "Could not reach the sign-in service.",
          });
      },
    );
  const failing = async (work: () => Promise<unknown>): Promise<void> => {
    try {
      await work();
    } catch (error) {
      store.patch({
        error:
          error instanceof Error && error.message
            ? error.message
            : "Friends unavailable",
      });
      throw error;
    }
  };
  return {
    capabilities: { away: false, demo: false },
    snapshot: () => store.get(),
    subscribe: (listener) => store.subscribe(listener),
    warmSignIn: () => auth.warm(),
    async signIn() {
      try {
        await auth.ready();
        await auth.signIn();
      } catch (error) {
        const message = auth.failure(error);
        // An empty message is the player closing the popup: nothing to say.
        if (message) store.patch({ error: message });
        throw new Error(message);
      }
    },
    async signOut() {
      try {
        await auth.signOut();
      } catch {
        store.patch({ error: "Could not sign out. Try again." });
        throw new Error("Could not sign out. Try again.");
      }
    },
    refresh: () => client.refresh(),
    addFriend: (publicId) => failing(() => client.add(publicId)),
    removeFriend: (publicId) => failing(() => client.remove(publicId)),
    dismissInvite: (id) => failing(() => client.dismissInvite(id)),
    setSuspended(next) {
      if (next === suspended) return;
      suspended = next;
      store.patch({ suspended, loading: false });
      apply();
    },
    setMode: () => undefined,
    dispose() {
      disposed = true;
      stopClient();
      stopAuth();
      client.dispose();
      store.clear();
    },
  };
}
