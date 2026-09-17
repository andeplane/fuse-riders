import {
  ROOM_RECONNECT_GRACE_MS,
  validRoomCode,
  reserveRoomCode,
  generateRoomCode,
} from "fuse-network-protocol";
import { createHash } from "node:crypto";
import {
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
}
export interface RoomRecord {
  version: 2;
  code: string;
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
  allowance(key: string, now: number, limit: number): Promise<boolean>;
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
export interface RoomStoreDependencies {
  now: () => number;
  id: () => string;
  /** Members besides the creator, whose seat is always kept. */
  maxGuests?: number;
  /** What a member refused for capacity is told. */
  fullMessage?: string;
}
export const CONNECTION_TTL_MS = 30_000;
export const ROOM_TTL_MS = ROOM_RECONNECT_GRACE_MS;
export const digest = (token: string): string =>
  createHash("sha256").update(token).digest("hex");
export const peerId = (token: string): string => digest(token).slice(0, 24);
export const validToken = (token: string): boolean =>
  /^[a-f0-9]{64}$/.test(token);
export const validCode = validRoomCode;
export class RoomError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
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
export class RoomStore {
  private readonly maxGuests: number;
  constructor(
    readonly database: RoomDatabase,
    private dependencies: RoomStoreDependencies,
  ) {
    this.maxGuests = roomGuestLimit(dependencies.maxGuests);
  }
  async createAvailable(
    token: string,
    nextCode: () => string = generateRoomCode,
  ): Promise<string> {
    const code = await reserveRoomCode(async (candidate) => {
      try {
        await this.create(candidate, token);
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
      room.expiresAt = Math.min(room.expiresAt, this.dependencies.now());
      room.revision++;
      return { room, result: undefined };
    });
  }
  async create(code: string, token: string): Promise<void> {
    if (!validCode(code) || !validToken(token))
      throw new RoomError(400, "Invalid room identity");
    const incarnation = this.dependencies.id();
    await this.database.transact(code, (current) => {
      const now = this.dependencies.now();
      if (current && current.expiresAt > now)
        throw new RoomError(409, "Room exists");
      return {
        room: {
          version: 2,
          code,
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
  async admit(
    code: string,
    token: string,
    gatewayId: string,
  ): Promise<{ room: RoomRecord; member: Member }> {
    if (!validCode(code) || !validToken(token))
      throw new RoomError(401, "Invalid identity");
    const connectionId = this.dependencies.id(),
      grantId = this.dependencies.id(),
      id = peerId(token);
    return this.database.transact(code, (current) => {
      const now = this.dependencies.now(),
        room = live(current, now);
      prune(room, now);
      const host = digest(token) === room.hostHash,
        guests = this.maxGuests,
        capacity = host || room.members[room.hostId] ? guests + 1 : guests;
      if (Object.keys(room.members).length >= capacity && !room.members[id])
        throw new RoomError(429, this.dependencies.fullMessage ?? "Room full");
      const member: Member = {
        id,
        connectionId,
        gatewayId,
        host,
        expiresAt: now + CONNECTION_TTL_MS,
      };
      room.members[id] = member;
      room.revision++;
      if (host) room.expiresAt = now + ROOM_TTL_MS;
      if (host)
        room.grant = reserveAuthority(
          room.grant,
          room.incarnation,
          connectionId,
          grantId,
          now,
        );
      return { room, result: { room: clone(room), member } };
    });
  }
  async time(
    code: string,
    member: Member,
    renew: GrantIdentity | undefined,
  ): Promise<RoomRecord> {
    return this.database.transact(code, (current) => {
      const now = this.dependencies.now(),
        room = live(current, now);
      if (room.members[member.id]?.connectionId !== member.connectionId)
        throw new RoomError(409, "Reconnected elsewhere");
      const stored = room.members[member.id];
      if (stored.expiresAt <= now)
        throw new RoomError(410, "Connection lease expired");
      if (member.host && renew && room.grant) {
        const updated = renewAuthority(room.grant, renew, now);
        if (updated) room.grant = updated;
      }
      stored.expiresAt = now + CONNECTION_TTL_MS;
      if (stored.host) room.expiresAt = now + ROOM_TTL_MS;
      room.revision++;
      return { room, result: clone(room) };
    });
  }
  async leave(code: string, member: Member): Promise<void> {
    await this.database.transact(code, (current) => {
      if (
        !current ||
        current.members[member.id]?.connectionId !== member.connectionId
      )
        return { result: undefined };
      const room = clone(current);
      delete room.members[member.id];
      if (member.host && room.expiresAt > this.dependencies.now())
        room.expiresAt = this.dependencies.now() + ROOM_TTL_MS;
      room.revision++;
      return { room, result: undefined };
    });
  }
  async get(code: string): Promise<RoomRecord> {
    return live(await this.database.read(code), this.dependencies.now());
  }
}
/** Runtime boundary: reject incompatible/corrupt stored metadata before authority decisions. */
export function parseRoomRecord(
  raw: unknown,
  maxGuests: number = DEFAULT_MAX_GUESTS,
): RoomRecord | undefined {
  const capacity = roomGuestLimit(maxGuests) + 1;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
  const r = raw as Record<string, unknown>,
    members = r.members;
  if (
    r.version !== 2 ||
    typeof r.code !== "string" ||
    !validCode(r.code) ||
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
    Object.keys(members).length > capacity ||
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
      m.expiresAt < 0
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
