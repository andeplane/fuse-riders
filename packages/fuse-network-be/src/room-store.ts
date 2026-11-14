import {
  LEGACY_GAME_ID,
  ROOM_RECONNECT_GRACE_MS,
  validGameId,
  validRoomCode,
  reserveRoomCode,
  generateRoomCode,
} from "fuse-network-protocol";
import { createHash } from "node:crypto";
import {
  LEASE_MS,
  isAuthorityGrant,
  reserveAuthority,
  renewAuthority,
  type AuthorityGrant,
  type GrantIdentity,
} from "fuse-network-protocol";

export interface Member {
  id: string;
  connectionId: string;
  gatewayId: string;
  host: boolean;
  expiresAt: number;
  /**
   * How many times a new socket has taken this connection id over (`RoomStore.admit` with `resume`); absent is zero.
   * A connection id alone no longer names one socket, so the pair of id and count is what a gateway's client is
   * checked against: an older socket of a resumed connection can neither heartbeat for the seat nor free it.
   */
  resumes?: number;
}
/** Whether `member`, as one gateway socket holds it, is the socket the stored seat belongs to. */
export const sameAttachment = (
  stored: Member | undefined,
  member: Member,
): boolean =>
  stored?.connectionId === member.connectionId &&
  (stored.resumes ?? 0) === (member.resumes ?? 0);
export interface RoomRecord {
  version: 2;
  code: string;
  /** The game this room serves. Absent on rooms created before rooms carried a game: those are `LEGACY_GAME_ID`. */
  gameId?: string;
  incarnation: string;
  hostHash: string;
  hostId: string;
  expiresAt: number;
  revision: number;
  members: Record<string, Member>;
  grant?: AuthorityGrant;
}
export interface RoomDatabase {
  read(code: string): Promise<RoomRecord | undefined>;
  transact<T>(
    code: string,
    operation: (current: RoomRecord | undefined) => {
      room?: RoomRecord;
      result: T;
    },
  ): Promise<T>;
  watch(
    code: string,
    listener: (room: RoomRecord | undefined) => void,
    failed: (error: Error) => void,
  ): () => void;
  /** consume=false checks a budget without charging successful admissions. */
  allowance(
    key: string,
    now: number,
    limit: number,
    consume?: boolean,
  ): Promise<boolean>;
}
/** A room seats its creator plus this many other members unless the store is told otherwise. */
export const DEFAULT_MAX_GUESTS = 5;
/** Validate configuration once, keeping admission and stored metadata bounded by the same limit. */
export function roomGuestLimit(maxGuests: number = DEFAULT_MAX_GUESTS): number {
  if (
    !Number.isSafeInteger(maxGuests) ||
    maxGuests < 0 ||
    maxGuests >= Number.MAX_SAFE_INTEGER
  )
    throw new RangeError(
      "maxGuests must be a non-negative safe integer below Number.MAX_SAFE_INTEGER",
    );
  return maxGuests;
}
/** How many members besides the creator a room of `gameId` seats. */
export type GuestLimits = (gameId: string) => number;
/**
 * One limit per game over a default, validated once. A game sizes its room for its own seats, watching list and
 * shared screen; a game with no entry of its own gets `maxGuests`.
 */
export function roomGuestLimits(
  maxGuests?: number,
  gameMaxGuests: Readonly<Record<string, number>> = {},
): GuestLimits {
  const fallback = roomGuestLimit(maxGuests),
    games = new Map<string, number>();
  for (const [gameId, limit] of Object.entries(gameMaxGuests)) {
    if (!validGameId(gameId))
      throw new RangeError("gameMaxGuests must be keyed by valid game ids");
    games.set(gameId, roomGuestLimit(limit));
  }
  return (gameId) => games.get(gameId) ?? fallback;
}
export interface RoomStoreDependencies {
  now: () => number;
  id: () => string;
  /** Members besides the creator, whose seat is always kept. */
  maxGuests?: number;
  /** `maxGuests` for the games that need another size, by game id. */
  gameMaxGuests?: Readonly<Record<string, number>>;
  /** What a member refused for capacity is told. */
  fullMessage?: string;
  /** The games this service hosts; a room for any other is refused. Defaults to `LEGACY_GAME_ID` alone. */
  gameIds?: readonly string[];
}
export const CONNECTION_TTL_MS = 30_000;
/**
 * How long a seat is kept for its page after the page's socket dropped without a goodbye: Cloud Run cuts every
 * socket after an hour and whenever an instance stops, and a phone changes networks. The page reconnects after 1.1
 * to 1.5 s and then 2.3 to 3 s later (`ReconnectBackoff`), so this covers two attempts and their handshakes. Until
 * it runs out the other members are told nothing and keep their links to the page; after it the seat lapses like any
 * lease. It is also how long a page that died with a reset (a crashed browser) goes on looking present, which a
 * round waits out, so it is no longer than those two attempts need: a later attempt is admitted as a new connection.
 */
export const RESUME_GRACE_MS = 8_000;
/** A lapsed seat is pruned this long after its lease ran out, so one instance's clock running ahead cannot end a lease early. */
export const LAPSE_MARGIN_MS = 1_000;
/** Any admitted member renews the room; an empty room has this long to reconnect. */
export const ROOM_TTL_MS = ROOM_RECONNECT_GRACE_MS;
/** Deadline written by an explicit end: before every clock, so no instance's `now` can read the room as live. */
export const ROOM_ENDED_AT = 0;
/**
 * A heartbeat writes only once something it keeps is this close to running out; above these the stored room would
 * change in nothing but timestamps, so the write (and its fan-out to every watching instance) is skipped.
 * docs/design/heartbeat-write-cost.md has the margins each one leaves.
 *
 * The member lease renews with two thirds left: a lapse makes the member leave and rejoin the game, so any silence
 * under 22 s must be safe. The grant renews at half: a lapsed grant is invisible to players.
 */
export const LEASE_RENEW_BELOW_MS = (CONNECTION_TTL_MS * 2) / 3;
export const GRANT_RENEW_BELOW_MS = LEASE_MS / 2;
export const ROOM_RENEW_BELOW_MS = ROOM_TTL_MS / 2;
export const digest = (token: string): string =>
  createHash("sha256").update(token).digest("hex");
export const peerId = (token: string): string => digest(token).slice(0, 24);
export const validToken = (token: string): boolean =>
  /^[a-f0-9]{64}$/.test(token);
export const validCode = validRoomCode;
/** The game a stored room serves; a room from before rooms carried a game is a `LEGACY_GAME_ID` room. */
export const roomGameId = (room: Pick<RoomRecord, "gameId">): string =>
  room.gameId ?? LEGACY_GAME_ID;
/** Validate configuration once: every id well formed, and at least one. */
export function roomGameIds(
  gameIds: readonly string[] = [LEGACY_GAME_ID],
): ReadonlySet<string> {
  if (!gameIds.length || !gameIds.every(validGameId))
    throw new RangeError("gameIds must be one or more valid game ids");
  return new Set(gameIds);
}
export class RoomError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
/**
 * The code and token were fine; the room has no free seat. Not an admission failure: it spends no failure budget,
 * and the socket closes with `CLOSE_ROOM_FULL` so the client stops retrying instead of hammering a full room.
 */
export class RoomFullError extends RoomError {
  constructor(message: string) {
    super(429, message);
  }
}
const clone = (room: RoomRecord): RoomRecord => structuredClone(room);
function live(room: RoomRecord | undefined, now: number): RoomRecord {
  if (!room || room.expiresAt <= now)
    throw new RoomError(404, "Room expired or not found");
  return clone(room);
}
function prune(room: RoomRecord, now: number): void {
  for (const [id, member] of Object.entries(room.members))
    if (member.expiresAt <= now) delete room.members[id];
}
/** The seat `member` holds in `room`, or the error its heartbeat must be refused with. */
function seated(room: RoomRecord, member: Member, now: number): Member {
  const stored = room.members[member.id];
  // Only a seat another connection holds is a replacement (terminal for the browser); a pruned or lapsed one retries.
  if (stored && stored.connectionId !== member.connectionId)
    throw new RoomError(409, "Reconnected elsewhere");
  // The page resumed this connection on a newer socket: this one is stale, and its page has already let it go.
  if (stored && !sameAttachment(stored, member))
    throw new RoomError(410, "Connection resumed on another socket");
  if (!stored || stored.expiresAt <= now)
    throw new RoomError(410, "Connection lease expired");
  return stored;
}
/**
 * Whether a heartbeat from a seated `member` must be written: its connection lease, the room deadline or (creator
 * only) a grant it can still renew is within its renewal margin on this instance's clock.
 */
export function renewalDue(
  room: RoomRecord,
  member: Member,
  renew: GrantIdentity | undefined,
  now: number,
): boolean {
  const lease = room.members[member.id]?.expiresAt ?? now;
  return (
    lease - now <= LEASE_RENEW_BELOW_MS ||
    // Defensive only: every write sets the deadline 60 s beyond the writer's lease, so the lease clause fires first
    // unless instance clocks disagree by more than 35 s or the lifetimes above are changed.
    room.expiresAt - now <= ROOM_RENEW_BELOW_MS ||
    (member.host &&
      !!renew &&
      !!room.grant &&
      room.grant.expiresAt - now <= GRANT_RENEW_BELOW_MS &&
      !!renewAuthority(room.grant, renew, now))
  );
}
export class RoomStore {
  /** Members besides the creator, per game. */
  readonly guestLimit: GuestLimits;
  readonly gameIds: ReadonlySet<string>;
  constructor(
    readonly database: RoomDatabase,
    private dependencies: RoomStoreDependencies,
  ) {
    this.guestLimit = roomGuestLimits(
      dependencies.maxGuests,
      dependencies.gameMaxGuests,
    );
    this.gameIds = roomGameIds(dependencies.gameIds);
  }
  /** A game this service hosts, or the refusal. Absent means `LEGACY_GAME_ID`, as it did before rooms carried a game. */
  hostedGame(gameId: string | undefined): string {
    const game = gameId ?? LEGACY_GAME_ID;
    if (!this.gameIds.has(game)) throw new RoomError(400, "Unknown game");
    return game;
  }
  async createAvailable(
    token: string,
    nextCode: () => string = generateRoomCode,
    gameId?: string,
  ): Promise<string> {
    const game = this.hostedGame(gameId);
    const code = await reserveRoomCode(async (candidate) => {
      try {
        await this.create(candidate, token, game);
        return true;
      } catch (error) {
        if (error instanceof RoomError && error.status === 409) return false;
        throw error;
      }
    }, nextCode);
    if (!code) throw new RoomError(503, "Room codes busy; please try again");
    return code;
  }
  async end(code: string, token: string): Promise<void> {
    if (!validCode(code) || !validToken(token))
      throw new RoomError(401, "Invalid identity");
    await this.database.transact(code, (current) => {
      if (!current) throw new RoomError(404, "Room expired or not found");
      if (current.hostHash !== digest(token))
        throw new RoomError(403, "Only the host can end this room");
      const room = clone(current);
      // Absolute, not "now": another instance whose clock runs behind must not see an ended room as still live.
      room.expiresAt = ROOM_ENDED_AT;
      room.revision++;
      return { room, result: undefined };
    });
  }
  async create(code: string, token: string, gameId?: string): Promise<void> {
    if (!validCode(code) || !validToken(token))
      throw new RoomError(400, "Invalid room identity");
    const game = this.hostedGame(gameId);
    const incarnation = this.dependencies.id();
    await this.database.transact(code, (current) => {
      const now = this.dependencies.now();
      if (current && current.expiresAt > now)
        throw new RoomError(409, "Room exists");
      return {
        room: {
          version: 2,
          code,
          gameId: game,
          incarnation,
          hostHash: digest(token),
          hostId: peerId(token),
          expiresAt: now + ROOM_TTL_MS,
          revision: 1,
          members: {},
        },
        result: undefined,
      };
    });
  }
  /**
   * Seats a member. `gameId` is the game the member's page plays (absent: `LEGACY_GAME_ID`); a room of another game
   * refuses it as not found, so a room code never means two games at once and the page stops retrying.
   *
   * `resume` is the connection id the page held before its socket dropped. While the member's seat still carries
   * that id and its lease has not lapsed, the seat is kept as it is: same connection id, one more `resumes`, this
   * gateway. Nothing a peer acts on changes, so no other member is told and their links to the page stay up. A
   * creator keeps its grant rather than waiting out its own lease. Anything else is the ordinary admission under a
   * new connection id, which every member hears of.
   */
  async admit(
    code: string,
    token: string,
    gatewayId: string,
    gameId?: string,
    resume?: string,
  ): Promise<{ room: RoomRecord; member: Member; resumed: boolean }> {
    if (!validCode(code) || !validToken(token))
      throw new RoomError(401, "Invalid identity");
    const game = gameId ?? LEGACY_GAME_ID;
    const connectionId = this.dependencies.id(),
      grantId = this.dependencies.id(),
      id = peerId(token);
    return this.database.transact(code, (current) => {
      const now = this.dependencies.now(),
        room = live(current, now);
      if (roomGameId(room) !== game)
        throw new RoomError(404, "Room is for another game");
      prune(room, now);
      const host = digest(token) === room.hostHash,
        guests = this.guestLimit(game),
        capacity = host || room.members[room.hostId] ? guests + 1 : guests;
      if (Object.keys(room.members).length >= capacity && !room.members[id])
        throw new RoomFullError(this.dependencies.fullMessage ?? "Room full");
      const held = room.members[id],
        resumed = resume !== undefined && held?.connectionId === resume;
      const member: Member = resumed
        ? {
            ...held,
            gatewayId,
            expiresAt: now + CONNECTION_TTL_MS,
            resumes: (held.resumes ?? 0) + 1,
          }
        : {
            id,
            connectionId,
            gatewayId,
            host,
            expiresAt: now + CONNECTION_TTL_MS,
          };
      room.members[id] = member;
      room.revision++;
      room.expiresAt = now + ROOM_TTL_MS;
      if (host) {
        // The same connection goes on holding the lease it has, current or still to begin; only one that ran out
        // is reserved again, which a lease of its own never makes it wait for.
        const kept =
          resumed &&
          room.grant?.holder === member.connectionId &&
          now < room.grant.expiresAt
            ? room.grant
            : undefined;
        room.grant = kept
          ? (renewAuthority(kept, kept, now) ?? kept)
          : reserveAuthority(
              room.grant,
              room.incarnation,
              member.connectionId,
              grantId,
              now,
            );
      }
      return { room, result: { room: clone(room), member, resumed } };
    });
  }
  /**
   * A member's heartbeat. It renews the member's lease, the room deadline and the creator's grant, but only writes
   * once one of them is due (`renewalDue`): most heartbeats change nothing and commit nothing.
   *
   * `known` is the caller's watched copy of the room. When it shows a live room, this exact connection seated and
   * nothing due, it is returned as it is, without touching the database. It can only be older than the stored room,
   * never newer, so its leases are never longer than the stored ones and a lease cannot lapse by trusting it; a
   * replacement or an end it has not seen yet changes nothing here (nothing is written) and is refused by the
   * transaction of the next due heartbeat at the latest.
   */
  async time(
    code: string,
    member: Member,
    renew: GrantIdentity | undefined,
    known?: RoomRecord,
  ): Promise<RoomRecord> {
    if (known && known.code === code) {
      const now = this.dependencies.now(),
        seat = known.members[member.id];
      if (
        known.expiresAt > now &&
        seat &&
        sameAttachment(seat, member) &&
        seat.expiresAt > now &&
        !renewalDue(known, member, renew, now)
      )
        return known;
    }
    return this.database.transact(code, (current) => {
      const now = this.dependencies.now(),
        room = live(current, now),
        stored = seated(room, member, now);
      // Authoritative recheck: another instance may already have renewed what the caller's copy showed as due.
      if (!renewalDue(room, member, renew, now)) return { result: room };
      if (member.host && renew && room.grant) {
        const updated = renewAuthority(room.grant, renew, now);
        if (updated) room.grant = updated;
      }
      stored.expiresAt = now + CONNECTION_TTL_MS;
      room.expiresAt = now + ROOM_TTL_MS;
      room.revision++;
      return { room, result: clone(room) };
    });
  }
  /**
   * The member's socket dropped without a goodbye. The seat stays, with at most `RESUME_GRACE_MS` left on its lease,
   * for the page to resume (`admit`); nobody is told. A seat another socket has taken since is left alone.
   */
  async detach(code: string, member: Member): Promise<void> {
    await this.database.transact(code, (current) => {
      const stored = current?.members[member.id],
        now = this.dependencies.now();
      if (
        !current ||
        !stored ||
        !sameAttachment(stored, member) ||
        stored.expiresAt <= now + RESUME_GRACE_MS
      )
        return { result: undefined };
      const room = clone(current);
      room.members[member.id]!.expiresAt = now + RESUME_GRACE_MS;
      room.revision++;
      return { room, result: undefined };
    });
  }
  /**
   * Removes every seat whose lease ran out more than `LAPSE_MARGIN_MS` ago and returns the room as it then stands.
   * A seat held for a page that never came back (`detach`), or one whose instance died with it, ends here: the
   * write is what tells the other members. Nothing lapsed, nothing written.
   */
  async prune(code: string): Promise<RoomRecord> {
    return this.database.transact(code, (current) => {
      const now = this.dependencies.now(),
        room = live(current, now);
      prune(room, now - LAPSE_MARGIN_MS);
      if (
        Object.keys(room.members).length ===
        Object.keys(current!.members).length
      )
        return { result: room };
      room.revision++;
      return { room, result: clone(room) };
    });
  }
  async leave(code: string, member: Member): Promise<void> {
    await this.database.transact(code, (current) => {
      const stored = current?.members[member.id];
      if (!current || !stored || !sameAttachment(stored, member))
        return { result: undefined };
      const now = this.dependencies.now(),
        room = clone(current);
      delete room.members[member.id];
      // Only a member that could still heartbeat starts the grace; a lapsed lease already stopped renewing the room.
      if (room.expiresAt > now && stored.expiresAt > now)
        room.expiresAt = now + ROOM_TTL_MS;
      room.revision++;
      return { room, result: undefined };
    });
  }
  async get(code: string): Promise<RoomRecord> {
    return live(await this.database.read(code), this.dependencies.now());
  }
}
/**
 * Runtime boundary: reject incompatible/corrupt stored metadata before authority decisions. `maxGuests` bounds the
 * members: one number for every room, or the limit of the room's own game (`roomGuestLimits`).
 */
export function parseRoomRecord(
  raw: unknown,
  maxGuests: number | GuestLimits = DEFAULT_MAX_GUESTS,
): RoomRecord | undefined {
  const limits =
    typeof maxGuests === "function" ? maxGuests : roomGuestLimits(maxGuests);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
  const r = raw as Record<string, unknown>,
    members = r.members;
  if (
    r.version !== 2 ||
    typeof r.code !== "string" ||
    !validCode(r.code) ||
    (r.gameId !== undefined && !validGameId(r.gameId)) ||
    typeof r.incarnation !== "string" ||
    r.incarnation.length > 128 ||
    typeof r.hostHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(r.hostHash) ||
    typeof r.hostId !== "string" ||
    !/^[a-f0-9]{24}$/.test(r.hostId) ||
    typeof r.expiresAt !== "number" ||
    !Number.isFinite(r.expiresAt) ||
    r.expiresAt < 0 ||
    !Number.isSafeInteger(r.revision) ||
    Number(r.revision) < 1 ||
    !members ||
    typeof members !== "object" ||
    Array.isArray(members) ||
    Object.keys(members).length >
      limits(roomGameId({ gameId: r.gameId as string | undefined })) + 1 ||
    (r.grant !== undefined && !isAuthorityGrant(r.grant))
  )
    return;
  for (const [id, value] of Object.entries(members)) {
    if (!value || typeof value !== "object") return;
    const m = value as Record<string, unknown>;
    if (
      id !== m.id ||
      !/^[a-f0-9]{24}$/.test(id) ||
      !["connectionId", "gatewayId"].every(
        (key) =>
          typeof m[key] === "string" &&
          m[key].length > 0 &&
          m[key].length <= 128,
      ) ||
      typeof m.host !== "boolean" ||
      m.host !== (id === r.hostId) ||
      typeof m.expiresAt !== "number" ||
      !Number.isFinite(m.expiresAt) ||
      m.expiresAt < 0 ||
      (m.resumes !== undefined &&
        !(Number.isSafeInteger(m.resumes) && Number(m.resumes) >= 0))
    )
      return;
  }
  if (
    r.grant !== undefined &&
    (r.grant as AuthorityGrant).incarnation !== r.incarnation
  )
    return;
  return r as unknown as RoomRecord;
}

export function isGrantIdentity(raw: unknown): raw is GrantIdentity {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const v = raw as Record<string, unknown>;
  return (
    ["incarnation", "holder", "grantId"].every(
      (k) => typeof v[k] === "string" && v[k].length > 0 && v[k].length <= 128,
    ) &&
    Number.isSafeInteger(v.epoch) &&
    Number(v.epoch) > 0
  );
}
