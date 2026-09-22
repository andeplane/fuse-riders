import { createHash } from "node:crypto";
import {
  RoomError,
  digest,
  peerId,
  roomGameId,
  validCode,
  validToken,
  type RoomStore,
} from "fuse-network-be";
import { LEGACY_GAME_ID, type Platform } from "./game.js";
import type { Account } from "./settlement.js";
import {
  INVITE_TTL_MS,
  MAX_FRIENDS,
  MAX_PENDING,
  ONLINE_WINDOW_MS,
  PRESENCE_REFRESH_MS,
  PUBLIC_ID_LENGTH,
  validPublicId,
  type Friend,
  type FriendCard,
  type FriendInvite,
  type FriendRelation,
  type FriendsSyncBody,
  type FriendsView,
  type RoomPlayer,
} from "./friends-api.js";
import type { HistoryDatabase } from "./history.js";
import { validUid } from "./identity.js";
import { plain } from "./result.js";

/**
 * Friends, presence and invites for every game's accounts. Gameplay is peer-to-peer and the service pushes nothing,
 * so a client polls: one `sync` reports where it is and answers with everything its friends panel shows. A friend
 * is online while its last sync is recent, in a room while it last said so, and an invite is a short-lived record
 * the invited client finds on its next poll. Nothing here is on the settlement path: presence has its own record.
 */

/** The account's public id: what other players see and address, never the uid itself. */
export const publicIdOf = (uid: string): string =>
  createHash("sha256")
    .update(`public:${uid}`)
    .digest("hex")
    .slice(0, PUBLIC_ID_LENGTH);

export interface PresenceRecord {
  uid: string;
  publicId: string;
  /** When the account last synced. */
  at: number;
  name?: string;
  avatarId?: string;
  room?: { code: string; memberId: string; gameId: string };
}
/** One friendship, requested or accepted; the pair is one record whichever side asked. */
export interface FriendEdge {
  id: string;
  uids: [string, string];
  requestedBy: string;
  status: "pending" | "accepted";
  at: number;
}
export interface InviteRecord {
  id: string;
  from: string;
  to: string;
  code: string;
  gameId: string;
  at: number;
  expiresAt: number;
}

export interface FriendsDatabase {
  presence(uid: string): Promise<PresenceRecord | undefined>;
  presences(uids: readonly string[]): Promise<PresenceRecord[]>;
  setPresence(record: PresenceRecord): Promise<void>;
  /** The account behind a public id, if it has ever synced. */
  resolve(publicId: string): Promise<string | undefined>;
  /** Everyone whose presence names this room, at most `limit`. */
  roomPresences(code: string, limit: number): Promise<PresenceRecord[]>;
  /** Every edge naming the account, at most `limit`. */
  edges(uid: string, limit: number): Promise<FriendEdge[]>;
  /** Like RoomDatabase.transact: pure and retried; `edge: null` deletes. */
  transactEdge<T>(
    id: string,
    operation: (current: FriendEdge | undefined) => {
      edge?: FriendEdge | null;
      result: T;
    },
  ): Promise<T>;
  /** Invites addressed to the account, at most `limit`, expired ones included. */
  invites(uid: string, limit: number): Promise<InviteRecord[]>;
  invite(id: string): Promise<InviteRecord | undefined>;
  setInvite(record: InviteRecord): Promise<void>;
  deleteInvite(id: string): Promise<void>;
}

/** One document per pair, whoever asked. */
export const edgeId = (a: string, b: string): string =>
  a < b ? `${a}|${b}` : `${b}|${a}`;
export const inviteId = (from: string, to: string, code: string): string =>
  digest(`invite:${from}:${to}:${code}`).slice(0, 32);

const SYNCS_PER_HOUR = 400,
  ADDS_PER_HOUR = 30,
  INVITES_PER_HOUR = 60,
  EDGE_LIMIT = 2 * MAX_FRIENDS + 50,
  INVITE_LIMIT = 20,
  ROOM_PRESENCE_LIMIT = 12;

export class FriendsStore {
  constructor(
    private platform: Platform,
    private history: HistoryDatabase,
    private database: FriendsDatabase,
    private rooms: RoomStore,
    private now: () => number,
  ) {}

  private async allow(key: string, limit: number): Promise<void> {
    if (
      !(await this.rooms.database.allowance(
        digest(`friends-${key}`),
        this.now(),
        limit,
      ))
    )
      throw new RoomError(429, "Too many requests; try later");
  }

  /** The name and head other players see: the chosen username first, then the name the player last showed up with. */
  private card(
    uid: string,
    account: Account | undefined,
    presence: PresenceRecord | undefined,
  ): FriendCard {
    const avatarId = account?.avatarId ?? presence?.avatarId;
    return {
      publicId: publicIdOf(uid),
      name:
        account?.username ??
        presence?.name ??
        account?.name ??
        this.platform.account.fallbackName,
      ...(avatarId ? { avatarId } : {}),
    };
  }

  private parseSync(body: unknown): FriendsSyncBody {
    if (
      !plain(body) ||
      !Object.keys(body).every((key) =>
        ["name", "avatarId", "room"].includes(key),
      ) ||
      (body.name !== undefined &&
        !this.platform.account.validName(body.name)) ||
      (body.avatarId !== undefined &&
        !this.platform.account.validAvatar(body.avatarId))
    )
      throw new RoomError(400, "Invalid presence");
    const room = body.room;
    if (room !== undefined) {
      if (
        !plain(room) ||
        !Object.keys(room).every((key) =>
          ["code", "memberId", "gameId"].includes(key),
        ) ||
        typeof room.code !== "string" ||
        !validCode(room.code) ||
        typeof room.memberId !== "string" ||
        !/^[a-f0-9]{24}$/.test(room.memberId) ||
        (room.gameId !== undefined &&
          (typeof room.gameId !== "string" ||
            !this.platform.gameIds.includes(room.gameId)))
      )
        throw new RoomError(400, "Invalid presence");
    }
    return body as FriendsSyncBody;
  }

  /**
   * Record where the caller is and answer with its friends. The presence record is rewritten only when something in
   * it changed or it is about to fall out of the online window, so an idle poll costs reads alone.
   */
  async sync(uid: string, body: unknown): Promise<FriendsView> {
    await this.allow(`sync:${uid}`, SYNCS_PER_HOUR);
    const claim = this.parseSync(body),
      now = this.now();
    const current = await this.database.presence(uid);
    const room = claim.room
      ? {
          code: claim.room.code,
          memberId: claim.room.memberId,
          gameId: claim.room.gameId ?? LEGACY_GAME_ID,
        }
      : undefined;
    // A poll that names nothing keeps the name and head the player last showed up with.
    const name = claim.name ?? current?.name,
      avatarId = claim.avatarId ?? current?.avatarId;
    const next: PresenceRecord = {
      uid,
      publicId: publicIdOf(uid),
      at: now,
      ...(name === undefined ? {} : { name }),
      ...(avatarId === undefined ? {} : { avatarId }),
      ...(room ? { room } : {}),
    };
    const same = (a: unknown, b: unknown) =>
      JSON.stringify(a) === JSON.stringify(b);
    // A room claim is proven once, when it changes: the seat must be a live member of that room, which only a device
    // in the room can know. Otherwise any signed-in account could name a room code and read who is in it.
    if (room && !same(current?.room, room)) {
      const record = await this.rooms.get(room.code).catch(() => undefined),
        seat = record?.members[room.memberId];
      if (!seat || seat.expiresAt <= now)
        throw new RoomError(403, "Join the room first");
    }
    if (
      !current ||
      now - current.at >= PRESENCE_REFRESH_MS ||
      current.name !== next.name ||
      current.avatarId !== next.avatarId ||
      !same(current.room, next.room)
    )
      await this.database.setPresence(next);
    // Three lists, then two batches: one of presence records and one of accounts for everyone they name, so the
    // poll's cost is a handful of requests however many friends there are.
    const [edges, pending, seated] = await Promise.all([
      this.database.edges(uid, EDGE_LIMIT),
      this.database
        .invites(uid, INVITE_LIMIT)
        .then((invites) => invites.filter((i) => i.expiresAt > now)),
      room
        ? this.database.roomPresences(room.code, ROOM_PRESENCE_LIMIT)
        : Promise.resolve([] as PresenceRecord[]),
    ]);
    const others = edges.map((edge) =>
      edge.uids[0] === uid ? edge.uids[1] : edge.uids[0],
    );
    const presences = new Map<string, PresenceRecord>([[uid, next]]);
    for (const p of seated) presences.set(p.uid, p);
    // An invite from someone no longer a friend still names its sender.
    const wanted = [
      ...new Set([...others, ...pending.map((invite) => invite.from)]),
    ].filter((other) => !presences.has(other));
    for (const p of await this.database.presences(wanted))
      presences.set(p.uid, p);
    const accounts = await this.history.accounts([...presences.keys()]);
    const cards = new Map<string, FriendCard>();
    const cardOf = (who: string): FriendCard => {
      let card = cards.get(who);
      if (!card) {
        card = this.card(who, accounts.get(who), presences.get(who));
        cards.set(who, card);
      }
      return card;
    };
    const online = (p: PresenceRecord | undefined): p is PresenceRecord =>
      p !== undefined && now - p.at < ONLINE_WINDOW_MS;
    const friends: Friend[] = [],
      incoming: FriendCard[] = [],
      outgoing: FriendCard[] = [],
      relations = new Map<string, FriendRelation>([[uid, "you"]]);
    for (const [index, edge] of edges.entries()) {
      const other = others[index]!,
        card = cardOf(other);
      if (edge.status === "accepted") {
        const p = presences.get(other);
        friends.push({
          ...card,
          online: online(p),
          ...(online(p) && p.room
            ? { room: { code: p.room.code, gameId: p.room.gameId } }
            : {}),
        });
        relations.set(other, "friend");
      } else if (edge.requestedBy === uid) {
        outgoing.push(card);
        relations.set(other, "outgoing");
      } else {
        incoming.push(card);
        relations.set(other, "incoming");
      }
    }
    const byName = (a: FriendCard, b: FriendCard) =>
      a.name.localeCompare(b.name) || a.publicId.localeCompare(b.publicId);
    friends.sort((a, b) => Number(b.online) - Number(a.online) || byName(a, b));
    incoming.sort(byName);
    outgoing.sort(byName);
    const invites: FriendInvite[] = [];
    for (const invite of pending) {
      invites.push({
        id: invite.id,
        from: cardOf(invite.from),
        code: invite.code,
        gameId: invite.gameId,
        at: invite.at,
      });
    }
    invites.sort((a, b) => b.at - a.at);
    const roomPlayers: RoomPlayer[] = [];
    if (room) {
      for (const p of seated) {
        if (!online(p) || !p.room || p.room.code !== room.code) continue;
        roomPlayers.push({
          memberId: p.room.memberId,
          publicId: p.publicId,
          name: cardOf(p.uid).name,
          relation: relations.get(p.uid) ?? "none",
        });
      }
      roomPlayers.sort((a, b) => a.memberId.localeCompare(b.memberId));
    }
    return {
      me: cardOf(uid),
      friends,
      incoming,
      outgoing,
      invites,
      roomPlayers,
    };
  }

  /** The account behind a public id, refused as not found when none has synced under it. */
  private async resolve(publicId: unknown): Promise<string> {
    if (!validPublicId(publicId)) throw new RoomError(400, "Invalid player id");
    const uid = await this.database.resolve(publicId);
    if (uid === undefined || !validUid(uid))
      throw new RoomError(404, "Player not found");
    return uid;
  }

  /**
   * Ask to be friends, or accept: a request the other side already made becomes a friendship, and asking twice is
   * the same request. Both sides count towards the friend limit, so no one can be handed more friends than they can hold.
   */
  async add(
    uid: string,
    body: unknown,
  ): Promise<{ status: FriendEdge["status"] }> {
    if (!plain(body) || Object.keys(body).length !== 1)
      throw new RoomError(400, "Invalid player id");
    await this.allow(`add:${uid}`, ADDS_PER_HOUR);
    const other = await this.resolve(body.publicId);
    if (other === uid) throw new RoomError(400, "That is you");
    const [mine, theirs] = await Promise.all([
      this.database.edges(uid, EDGE_LIMIT),
      this.database.edges(other, EDGE_LIMIT),
    ]);
    const accepted = (edges: FriendEdge[]) =>
      edges.filter((edge) => edge.status === "accepted").length;
    if (accepted(mine) >= MAX_FRIENDS || accepted(theirs) >= MAX_FRIENDS)
      throw new RoomError(409, "Friend list is full");
    // Pending requests are bounded too, in both directions, so many accounts cannot bury one under requests.
    const pendingFrom = (edges: FriendEdge[], who: string) =>
      edges.filter(
        (edge) => edge.status === "pending" && edge.requestedBy === who,
      ).length;
    const pendingTo = (edges: FriendEdge[], who: string) =>
      edges.filter(
        (edge) => edge.status === "pending" && edge.requestedBy !== who,
      ).length;
    const existing = mine.find((edge) => edge.uids.includes(other));
    if (
      !existing &&
      (pendingFrom(mine, uid) >= MAX_PENDING ||
        pendingTo(theirs, other) >= MAX_PENDING)
    )
      throw new RoomError(409, "Too many pending requests");
    const now = this.now();
    return this.database.transactEdge(edgeId(uid, other), (current) => {
      if (current?.status === "accepted")
        return { result: { status: "accepted" } };
      const status: FriendEdge["status"] =
        current && current.requestedBy !== uid ? "accepted" : "pending";
      return {
        edge: {
          id: edgeId(uid, other),
          uids: uid < other ? [uid, other] : [other, uid],
          requestedBy: current?.requestedBy ?? uid,
          status,
          at: now,
        },
        result: { status },
      };
    });
  }

  /** Unfriend, decline or withdraw: whatever the pair's record is, it goes. */
  async remove(uid: string, publicId: string): Promise<{ removed: boolean }> {
    const other = await this.resolve(publicId);
    return this.database.transactEdge(edgeId(uid, other), (current) => ({
      ...(current ? { edge: null } : {}),
      result: { removed: current !== undefined },
    }));
  }

  /**
   * Invite friends to a room the caller is a live member of, proven by its room token as a result report is. Only
   * accepted friends are invited; anyone else in the list is skipped, not refused, so one stale name cannot block
   * the rest. Inviting the same friend to the same room again refreshes the one invite.
   */
  async invite(
    code: string,
    roomToken: string,
    uid: string,
    body: unknown,
  ): Promise<{ sent: number }> {
    if (!validCode(code) || !validToken(roomToken))
      throw new RoomError(401, "Invalid identity");
    if (
      !plain(body) ||
      Object.keys(body).length !== 1 ||
      !Array.isArray(body.to) ||
      body.to.length > MAX_FRIENDS ||
      !body.to.every(validPublicId)
    )
      throw new RoomError(400, "Invalid invite");
    const room = await this.rooms.get(code),
      member = room.members[peerId(roomToken)];
    if (!member || member.expiresAt <= this.now())
      throw new RoomError(403, "Join the room first");
    await this.allow(`invite:${uid}`, INVITES_PER_HOUR);
    const friends = new Map(
      (await this.database.edges(uid, EDGE_LIMIT))
        .filter((edge) => edge.status === "accepted")
        .map((edge) => {
          const other = edge.uids[0] === uid ? edge.uids[1] : edge.uids[0];
          return [publicIdOf(other), other];
        }),
    );
    const now = this.now(),
      gameId = roomGameId(room);
    let sent = 0;
    for (const publicId of new Set(body.to as string[])) {
      const to = friends.get(publicId);
      if (to === undefined) continue;
      await this.database.setInvite({
        id: inviteId(uid, to, code),
        from: uid,
        to,
        code,
        gameId,
        at: now,
        expiresAt: now + INVITE_TTL_MS,
      });
      sent++;
    }
    return { sent };
  }

  /** Clear an invite from the list; only its addressee can, and one already gone is fine. */
  async dismissInvite(uid: string, id: string): Promise<void> {
    if (!/^[a-f0-9]{32}$/.test(id)) throw new RoomError(400, "Invalid invite");
    const invite = await this.database.invite(id);
    if (invite && invite.to === uid) await this.database.deleteInvite(id);
  }
}

/** Single-process FriendsDatabase with the Firestore adapter's contract; everything is gone when the process exits. */
export class MemoryFriendsDatabase implements FriendsDatabase {
  private presenceByUid = new Map<string, PresenceRecord>();
  private edgesById = new Map<string, FriendEdge>();
  private invitesById = new Map<string, InviteRecord>();
  private chain: Promise<unknown> = Promise.resolve();

  async presence(uid: string): Promise<PresenceRecord | undefined> {
    return structuredClone(this.presenceByUid.get(uid));
  }
  async presences(uids: readonly string[]): Promise<PresenceRecord[]> {
    return uids.flatMap((uid) => {
      const record = this.presenceByUid.get(uid);
      return record ? [structuredClone(record)] : [];
    });
  }
  async setPresence(record: PresenceRecord): Promise<void> {
    this.presenceByUid.set(record.uid, structuredClone(record));
  }
  async resolve(publicId: string): Promise<string | undefined> {
    for (const record of this.presenceByUid.values())
      if (record.publicId === publicId) return record.uid;
    return undefined;
  }
  async roomPresences(code: string, limit: number): Promise<PresenceRecord[]> {
    return [...this.presenceByUid.values()]
      .filter((record) => record.room?.code === code)
      .slice(0, limit)
      .map((record) => structuredClone(record));
  }
  async edges(uid: string, limit: number): Promise<FriendEdge[]> {
    return [...this.edgesById.values()]
      .filter((edge) => edge.uids.includes(uid))
      .slice(0, limit)
      .map((edge) => structuredClone(edge));
  }
  transactEdge<T>(
    id: string,
    operation: (current: FriendEdge | undefined) => {
      edge?: FriendEdge | null;
      result: T;
    },
  ): Promise<T> {
    const work = this.chain.then(() => {
      const next = operation(structuredClone(this.edgesById.get(id)));
      if (next.edge === null) this.edgesById.delete(id);
      else if (next.edge) this.edgesById.set(id, structuredClone(next.edge));
      return next.result;
    });
    this.chain = work.catch(() => undefined);
    return work;
  }
  async invites(uid: string, limit: number): Promise<InviteRecord[]> {
    return [...this.invitesById.values()]
      .filter((invite) => invite.to === uid)
      .slice(0, limit)
      .map((invite) => structuredClone(invite));
  }
  async invite(id: string): Promise<InviteRecord | undefined> {
    return structuredClone(this.invitesById.get(id));
  }
  async setInvite(record: InviteRecord): Promise<void> {
    this.invitesById.set(record.id, structuredClone(record));
  }
  async deleteInvite(id: string): Promise<void> {
    this.invitesById.delete(id);
  }
}
