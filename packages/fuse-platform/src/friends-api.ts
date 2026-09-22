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
  /** The room the friend is in right now, when online and in one. */
  room?: { code: string; gameId: string };
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
export const MAX_FRIENDS = 100;
