/**
 * The friends routes' wire contract, shared by the service and every game's client. Browser-safe: types and
 * constants only.
 *
 * A player is addressed by a *public id*, derived from the account by the service and shown wherever the player is
 * listed (leaderboards, match feeds, the room). It identifies the account to other players without being the account:
 * it opens no route on its own and cannot be turned back into the Firebase uid.
 */
export interface FriendCard {
  publicId: string;
  name: string;
  avatarId?: string;
}
export interface Friend extends FriendCard {
  online: boolean;
  /** Online, but the friend has not touched its page for a while. Absent means not away. */
  away?: true;
  /** The line an online friend chose to show. Plain text: render it as text, never as markup. */
  status?: string;
  /** The room the friend is in right now, when online and in one. */
  room?: { code: string; gameId: string };
  /** For an offline friend: when it last synced, rounded down to the hour so it is not a tracking signal. */
  lastSeen?: number;
}
export interface FriendInvite {
  id: string;
  from: FriendCard;
  code: string;
  gameId: string;
  at: number;
}
/** How a signed-in member of the caller's room relates to the caller. */
export type FriendRelation =
  "you" | "friend" | "incoming" | "outgoing" | "none";
export interface RoomPlayer {
  /** The member's seat in the room, as the roster knows it. */
  memberId: string;
  publicId: string;
  name: string;
  relation: FriendRelation;
}
/** Everything the friends panel shows, in one response to one poll. */
export interface FriendsView {
  me: FriendCard;
  friends: Friend[];
  /** Requests waiting for the caller's answer. */
  incoming: FriendCard[];
  /** Requests the caller sent that wait for an answer. */
  outgoing: FriendCard[];
  invites: FriendInvite[];
  /** The signed-in members of the room the caller reported, the caller included. */
  roomPlayers: RoomPlayer[];
}
/** `POST /api/friends/sync`: the caller's presence, answered with its FriendsView. */
export interface FriendsSyncBody {
  /** What the caller's screen calls it and the head it wears, so friends see it before any match is stored. */
  name?: string;
  avatarId?: string;
  room?: { code: string; memberId: string; gameId?: string };
  /**
   * The poll comes from a page that is not the one in a room (the FuseOS desktop around an embedded game): it keeps
   * the account online and leaves the stored room claim to the page that made it. Cannot be sent with `room`.
   */
  passive?: boolean;
  /** The player has not touched the page for a while. An active poll that leaves it out says "not away". */
  away?: boolean;
  /** A short line for friends, at most MAX_STATUS_LENGTH characters; `""` clears it, leaving it out keeps it. */
  status?: string;
}

export const PUBLIC_ID_LENGTH = 20;
export const validPublicId = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{20}$/.test(value);
/** A friend is online while its last sync is younger than this. */
export const ONLINE_WINDOW_MS = 120_000;
/** A poll that changes nothing is written this often at most (docs/design/heartbeat-write-cost.md). */
export const PRESENCE_REFRESH_MS = 60_000;
/** How long an invite stays deliverable. */
export const INVITE_TTL_MS = 10 * 60_000;
/** How often a client polls; comfortably inside the online window. */
export const FRIENDS_POLL_MS = 20_000;
/** The longest status line, in characters, once the service has tidied it. */
export const MAX_STATUS_LENGTH = 40;
/** The longest status line a request may carry before tidying, in UTF-16 units; longer is refused unread. */
export const MAX_STATUS_INPUT = 160;
/** An offline friend's last sync is shown no finer than this. */
export const LAST_SEEN_ROUNDING_MS = 3_600_000;
export const lastSeenOf = (at: number): number =>
  Math.floor(at / LAST_SEEN_ROUNDING_MS) * LAST_SEEN_ROUNDING_MS;
/**
 * A status line as the service stores it, or undefined when it cannot be one. Whitespace of any kind becomes single
 * spaces, control, format (bidi overrides, zero-width), lone-surrogate, private-use and unassigned characters are
 * dropped, and the ends are trimmed; what is left must fit MAX_STATUS_LENGTH characters. An empty result means "no status".
 */
export function cleanStatus(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > MAX_STATUS_INPUT)
    return undefined;
  const clean = value
    .replace(/\s+/gu, " ")
    .replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}]/gu, "")
    .replace(/ {2,}/g, " ")
    .trim();
  return [...clean].length > MAX_STATUS_LENGTH ? undefined : clean;
}
export const MAX_FRIENDS = 100;
/** Requests an account may have waiting, sent or received. */
export const MAX_PENDING = 50;
