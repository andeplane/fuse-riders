import {
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";

import { FRIENDS_WINDOW_ID } from "../desktop/startMenuRegistry";
import { FuseGamesContext } from "../fusegames/registry";
import { useAppState } from "../state/useAppState";
import { useDialUpCommands } from "../sounds/dialup/useDialUpCommands";
import { useWindowCommands } from "../windows/useWindowCommands";

import { FriendsDepsContext } from "./friendsDepsContext";
import type {
  Buddy,
  BuddyStatus,
  PresenceService,
  PresenceSnapshot,
} from "./presenceService";
import {
  groupBuddies,
  isPublicId,
  PresenceServiceContext,
} from "./presenceService";

/** The service's current snapshot, re-rendering on every change. */
export function usePresenceSnapshot(
  service: PresenceService,
): PresenceSnapshot {
  return useSyncExternalStore(
    useCallback((listener) => service.subscribe(listener), [service]),
    () => service.snapshot(),
    () => service.snapshot(),
  );
}

/** The game's display name for a buddy's room, or the id when the game is not on this desktop. */
export function useGameName(): (gameId: string) => string {
  const games = useContext(FuseGamesContext);
  return useCallback(
    (gameId: string) => games.find(gameId)?.name ?? gameId,
    [games],
  );
}

/**
 * Open a game window on a friend's room, or bring it to the front when that same room is already open. A game
 * the desktop does not list cannot be joined from here; the message says which.
 */
export function useJoinRoom(): (gameId: string, code: string) => void {
  const games = useContext(FuseGamesContext);
  const { state } = useAppState();
  const commands = useWindowCommands();
  return useCallback(
    (gameId: string, code: string) => {
      if (!games.has(gameId)) {
        commands.showError(
          "Join game",
          `The game "${gameId}" is not installed on this FuseOS, so the room cannot be joined from here.`,
        );
        return;
      }
      const open = state.windows.find(
        (window) =>
          window.kind === "fusegame" &&
          window.gameId === gameId &&
          window.room === code,
      );
      if (open) commands.focus(open.id);
      else commands.open({ kind: "fusegame", gameId, room: code });
    },
    [games, state.windows, commands],
  );
}

/** Open Fuse Messenger, or bring it to the front: one window, always the same id. */
export function useOpenFriends(): () => void {
  // Dials in first when nothing has connected yet this session (Dial-Up Networking).
  const commands = useDialUpCommands();
  return useCallback(
    () => commands.open({ kind: "friends" }, { id: FRIENDS_WINDOW_ID }),
    [commands],
  );
}

/**
 * While a Fuse game window is open, the desktop stops reporting presence: the game reports its own, room
 * included, and a second reporter would wipe that claim (docs/fuseos/friends-design.md). Mounted once, by the tray.
 */
export function useGameWindowSuspension(): void {
  const presence = useContext(PresenceServiceContext);
  const { state } = useAppState();
  const gameOpen = state.windows.some((window) => window.kind === "fusegame");
  useEffect(() => presence.setSuspended(gameOpen), [presence, gameOpen]);
}

export type BuddyGroup = { status: BuddyStatus; buddies: Buddy[] };

export type FriendsViewModel = {
  snapshot: PresenceSnapshot;
  groups: BuddyGroup[];
  onlineCount: number;
  gameName: (gameId: string) => string;
  /** An offline buddy's last-seen time, said relative to now ("3 hours ago"). */
  lastSeen: (at: number) => string;
  /** The last action's failure, cleared by the next action; the sign-in popup closing says nothing. */
  actionError: string | undefined;
  busy: boolean;
  signIn: () => void;
  signOut: () => void;
  refresh: () => void;
  /** Add by public id: `false` (and a message) when the id is not one. */
  addFriend: (publicId: string) => boolean;
  removeFriend: (publicId: string) => void;
  dismissInvite: (id: string) => void;
  joinRoom: (gameId: string, code: string) => void;
  setDemo: (demo: boolean) => void;
  capabilities: PresenceService["capabilities"];
};

const HOUR_MS = 3_600_000;

/** How long ago `at` was, as the buddy list says it; the service rounds last-seen times to the hour. */
export function formatLastSeen(at: number, now: number): string {
  const hours = Math.floor((now - at) / HOUR_MS);
  if (hours < 1) return "within the hour";
  if (hours < 24) return hours === 1 ? "an hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

export function useFriendsViewModel(): FriendsViewModel {
  const presence = useContext(PresenceServiceContext);
  const { now } = useContext(FriendsDepsContext);
  const snapshot = usePresenceSnapshot(presence);
  const gameName = useGameName();
  const joinRoom = useJoinRoom();
  const [actionError, setActionError] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => presence.warmSignIn(), [presence]);

  const run = useCallback((work: () => Promise<void>) => {
    setActionError(undefined);
    setBusy(true);
    void work()
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "";
        if (message) setActionError(message);
      })
      .finally(() => setBusy(false));
  }, []);

  const groups = groupBuddies(snapshot.buddies);
  const onlineCount = snapshot.buddies.filter(
    (buddy) => buddy.status !== "offline",
  ).length;

  return {
    snapshot,
    groups,
    onlineCount,
    gameName,
    lastSeen: (at) => formatLastSeen(at, now()),
    actionError,
    busy,
    signIn: () => run(() => presence.signIn()),
    signOut: () => run(() => presence.signOut()),
    refresh: () => presence.refresh(),
    addFriend: (publicId) => {
      const id = publicId.trim().toLowerCase();
      if (!isPublicId(id)) {
        setActionError(
          "A player id is 20 letters and digits; friends find theirs at the top of their own Fuse Messenger.",
        );
        return false;
      }
      run(() => presence.addFriend(id));
      return true;
    },
    removeFriend: (publicId) => run(() => presence.removeFriend(publicId)),
    dismissInvite: (id) => run(() => presence.dismissInvite(id)),
    joinRoom,
    setDemo: (demo) => presence.setMode(demo ? "demo" : "live"),
    capabilities: presence.capabilities,
  };
}
