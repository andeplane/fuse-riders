import { createContext } from "react";

/**
 * What Fuse Messenger (the buddy list) depends on: one service that says who the player is, who their friends
 * are and where each one is right now. The desktop never talks to the room service directly; the real
 * implementation (`realPresenceService.ts`) composes fuse-ui's polling client and browser sign-in, the demo
 * one (`demoPresenceService.ts`) plays a script. See docs/fuseos/friends-design.md.
 */

/** ICQ/MSN states. The live service reports "away" once the room service sends it (#665); older ones never do. */
export type BuddyStatus = "online" | "away" | "playing" | "offline";

export interface BuddyRoom {
  code: string;
  gameId: string;
}

/** A player as other players see them: the public id is what you add a friend by, never an account id. */
export interface PlayerCard {
  publicId: string;
  name: string;
  avatarId?: string;
}

export interface Buddy extends PlayerCard {
  status: BuddyStatus;
  /** The room the buddy is in, when playing. */
  room?: BuddyRoom;
  /** The line an online buddy chose to show; plain text, rendered as text. */
  statusLine?: string;
  /** For an offline buddy: when it was last online (ms since the epoch, rounded to the hour by the service). */
  lastSeen?: number;
}

export interface RoomInvite {
  id: string;
  from: PlayerCard;
  code: string;
  gameId: string;
  at: number;
}

export type AccountStatus =
  | { kind: "signed-out" }
  /** The browser remembers a sign-in and the SDK is restoring it. */
  | { kind: "restoring" }
  | { kind: "signed-in"; name: string };

export type PresenceMode = "live" | "demo";

export interface PresenceSnapshot {
  mode: PresenceMode;
  account: AccountStatus;
  /** The player's own card, once a view has arrived; what friends must type to add them. */
  me?: PlayerCard;
  /** A view has arrived at least once since sign-in; before that the lists are empty, not "no friends". */
  loaded: boolean;
  loading: boolean;
  /** Polling is paused because an open game window reports presence for this account. */
  suspended: boolean;
  error?: string;
  buddies: Buddy[];
  /** Requests waiting for the player's answer. */
  incoming: PlayerCard[];
  /** Requests the player sent that wait for an answer. */
  outgoing: PlayerCard[];
  invites: RoomInvite[];
}

export interface PresenceCapabilities {
  /** The service can tell "away" from "online". */
  away: boolean;
  /** `setMode("demo")` does something. */
  demo: boolean;
}

export interface PresenceService {
  readonly capabilities: PresenceCapabilities;
  snapshot(): PresenceSnapshot;
  /** Called on every change; the returned function stops the calls. */
  subscribe(listener: (snapshot: PresenceSnapshot) => void): () => void;
  /** Start loading sign-in before the click that needs it (a popup must open inside the tap). */
  warmSignIn(): void;
  /** Rejects with a message for the player. */
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  refresh(): void;
  addFriend(publicId: string): Promise<void>;
  removeFriend(publicId: string): Promise<void>;
  dismissInvite(id: string): Promise<void>;
  setSuspended(suspended: boolean): void;
  setMode(mode: PresenceMode): void;
  dispose(): void;
}

export const EMPTY_SNAPSHOT: PresenceSnapshot = {
  mode: "live",
  account: { kind: "signed-out" },
  loaded: false,
  loading: false,
  suspended: false,
  buddies: [],
  incoming: [],
  outgoing: [],
  invites: [],
};

/** A public id as the service issues them: 20 lowercase hex characters. */
export const PUBLIC_ID_PATTERN = /^[0-9a-f]{20}$/;
export const isPublicId = (value: string): boolean =>
  PUBLIC_ID_PATTERN.test(value);

/** The order the buddy list shows its groups in. */
export const STATUS_ORDER: readonly BuddyStatus[] = [
  "playing",
  "online",
  "away",
  "offline",
];

export const STATUS_LABEL: Record<BuddyStatus, string> = {
  playing: "Playing",
  online: "Online",
  away: "Away",
  offline: "Offline",
};

/** The list, grouped in `STATUS_ORDER` and sorted by name inside each group. */
export function groupBuddies(
  buddies: readonly Buddy[],
): { status: BuddyStatus; buddies: Buddy[] }[] {
  const byName = (a: Buddy, b: Buddy) =>
    a.name.localeCompare(b.name) || a.publicId.localeCompare(b.publicId);
  return STATUS_ORDER.map((status) => ({
    status,
    buddies: buddies.filter((buddy) => buddy.status === status).sort(byName),
  }));
}

/** A small subscribable snapshot holder shared by the implementations. */
export class SnapshotStore {
  private listeners = new Set<(snapshot: PresenceSnapshot) => void>();
  constructor(private current: PresenceSnapshot) {}
  get(): PresenceSnapshot {
    return this.current;
  }
  set(next: PresenceSnapshot): void {
    this.current = next;
    for (const listener of this.listeners) listener(next);
  }
  patch(patch: Partial<PresenceSnapshot>): void {
    this.set({ ...this.current, ...patch });
  }
  subscribe(listener: (snapshot: PresenceSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  clear(): void {
    this.listeners.clear();
  }
}

/** A service that does nothing: the context default so a component rendered without providers still works. */
export function createNullPresenceService(): PresenceService {
  const store = new SnapshotStore(EMPTY_SNAPSHOT);
  return {
    capabilities: { away: false, demo: false },
    snapshot: () => store.get(),
    subscribe: (listener) => store.subscribe(listener),
    warmSignIn: () => undefined,
    signIn: async () => {
      throw new Error("Sign-in is not available here.");
    },
    signOut: async () => undefined,
    refresh: () => undefined,
    addFriend: async () => undefined,
    removeFriend: async () => undefined,
    dismissInvite: async () => undefined,
    setSuspended: (suspended) => store.patch({ suspended }),
    setMode: () => undefined,
    dispose: () => store.clear(),
  };
}

export const PresenceServiceContext = createContext<PresenceService>(
  createNullPresenceService(),
);
