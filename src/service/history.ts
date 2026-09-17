import {
  careerFor,
  gameGroup,
  parseBuckets,
  type CareerBuckets,
  type CareerStats,
  type GameGroup,
} from "../shared/career-stats.js";
import {
  parseRating,
  type Rating,
  type RatingPoint,
  type LeaderboardEntry,
  type Rivalries,
} from "../shared/rating.js";
import type { HistoryMutation } from "./history-settlement.js";
import { parseCombat } from "../shared/combat-stats.js";
import { createHash } from "node:crypto";
import { isAvatarId, type AvatarId } from "../shared/avatars.js";
import { BOT_ID_PREFIX } from "../shared/bot-controller.js";
import type {
  MatchDeathCounts,
  MatchPlayerStats,
} from "../shared/match-stats.js";
import { validRiderName } from "../shared/rider-name.js";
import { validUid } from "./identity.js";
import {
  RoomError,
  digest,
  peerId,
  validCode,
  validToken,
  type RoomStore,
} from "fuse-network-be";

/**
 * Match history. Gameplay is peer-to-peer, so the service never sees a match: every rider's device reports the result
 * it computed and a result is kept once a majority of the riders named in it have reported the same one.
 *
 * A result is identified by its own content, so two devices that disagree create two records rather than competing
 * for one. A forged result can therefore never displace the honest one; without a majority of its own riders it stays
 * pending and expires.
 */

export type StoredPlayer = MatchPlayerStats;
/** Exactly what every device computes identically. Anything a rider can still change on the recap screen stays out, or honest reports would differ. */
export interface MatchResult {
  matchId: string;
  /** Present only for rating receipts; these never credit whole-game career history. */
  round?: number;
  length: number;
  winnerId?: string;
  finishers: string[];
  players: StoredPlayer[];
}
export interface MatchRecord {
  ratingScope?: string;
  ratings?: Record<string, RatingPoint>;
  rivalryPairs?: string[];
  version: 1;
  id: string;
  roomCode: string;
  status: "pending" | "confirmed";
  result: MatchResult;
  /** Peer ids of the riders who reported exactly this result. */
  attesters: string[];
  /** Accounts, by the seat each one proved it held. Only a rider's own verified sign-in can put it here. */
  uidByPlayer: Record<string, string>;
  /** Cosmetic and self-reported, so outside the agreed result: each rider's avatar as that rider's own device last saw it. */
  avatars: Record<string, AvatarId>;
  /** Accounts of a confirmed match, for the history query. Empty until confirmation. */
  participantUids: string[];
  createdAt: number;
  endedAt?: number;
  /** Absent once a confirmed match belongs to an account: that is the history nothing cleans up. */
  expiresAt?: number;
}
export const TOTAL_KEYS = [
  "matches",
  "wins",
  "roundWins",
  "eliminations",
  "bombsPlaced",
  "pickupsCollected",
  "survivalTicks",
  "distanceUnits",
] as const;
export type Totals = Record<(typeof TOTAL_KEYS)[number], number>;
export interface Credit {
  career?: { group: GameGroup; stats: CareerStats };
  uid: string;
  name: string;
  avatarId?: AvatarId;
  at: number;
  totals: Totals;
}
export interface UserProfile {
  career?: CareerBuckets;
  rating?: Rating;
  rank?: number;
  /** The name the account chose; what its rider is called in every room. Absent until chosen. */
  username?: string;
  /** The rider name of the last credited match, from before usernames or from a device that was signed out of one. */
  name?: string;
  avatarId?: AvatarId;
  updatedAt: number;
  totals: Totals;
}
export interface HistoryDatabase {
  /** Like RoomDatabase.transact: the operation is pure and may be retried. Credits commit atomically with the match. */
  transactMatch<T>(
    id: string,
    operation: (current: MatchRecord | undefined) => HistoryMutation<T>,
  ): Promise<T>;
  /** Confirmed matches of an account, newest first. */
  matchesFor(
    uid: string,
    before: number | undefined,
    limit: number,
  ): Promise<MatchRecord[]>;
  profile(uid: string): Promise<UserProfile | undefined>;
  leaderboard(uid?: string): Promise<LeaderboardEntry[]>;
  rank(elo: number): Promise<number>;
  rivals(uid: string): Promise<Rivalries>;
  setUsername(uid: string, username: string, at: number): Promise<void>;
}

export const PENDING_TTL_MS = 24 * 3_600_000;
export const GUEST_MATCH_TTL_MS = 30 * 24 * 3_600_000;
export const HISTORY_PAGE = 20;
const RENAMES_PER_HOUR = 20,
  SUBMISSIONS_PER_HOUR = 40,
  SUBMISSIONS_PER_ADDRESS_PER_HOUR = 240,
  LINKS_PER_HOUR = 30,
  READS_PER_HOUR = 300;
/**
 * Nothing can check a stat against the match that produced it, so these only keep a forged report from being absurd:
 * a rider who reports alone is believed, and what they can inflate is their own totals, by this much per report.
 */
const MAX_TICKS = 2_000_000,
  MAX_DISTANCE = 100_000_000,
  MAX_EVENTS = 20_000,
  MAX_SCORE = 10_000,
  MAX_ROUNDS = 99;
export const MAX_MATCH_PARTICIPANTS = 128; // Matches retain past riders, like the checkpoint history.
const PER_ROUND: ReadonlySet<string> = new Set([
  "roundsPlayed",
  "roundWins",
  "roundsDrawn",
]);
const LIMITS: Partial<Record<string, number>> = {
  slot: 4,
  matchPlacement: MAX_MATCH_PARTICIPANTS,
  matchScoreUnits: MAX_SCORE,
  survivalTicks: MAX_TICKS,
  longestSurvivalTicks: MAX_TICKS,
  invulnerableTicks: MAX_TICKS,
  distanceUnits: MAX_DISTANCE,
};
const COUNTERS = [
  "slot",
  "roundsPlayed",
  "roundWins",
  "matchScoreUnits",
  "roundsDrawn",
  "matchPlacement",
  "survivalTicks",
  "longestSurvivalTicks",
  "distanceUnits",
  "bombsPlaced",
  "bombsExploded",
  "eliminations",
  "pickupsCollected",
  "powerPickups",
  "starPickups",
  "beerPickups",
  "inkPickups",
  "triplePickups",
  "fivePickups",
  "targetPickups",
  "shieldPickups",
  "portalPickups",
  "portalTransits",
  "invulnerableTicks",
  "wallBounces",
  "earlyExits",
] as const satisfies readonly (keyof MatchPlayerStats)[];
const DEATHS = [
  "wall",
  "trail",
  "explosion",
  "rider",
] as const satisfies readonly (keyof MatchDeathCounts)[];
const PLAYER_KEYS = new Set<string>([
  "playerId",
  "name",
  "color",
  "deathsByCause",
  "combat",
  ...COUNTERS,
]);

const counter = (value: unknown, most = MAX_EVENTS): value is number =>
  Number.isSafeInteger(value) &&
  (value as number) >= 0 &&
  (value as number) <= most;
const plain = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isBot = (id: string): boolean => id.startsWith(BOT_ID_PREFIX);
const validPlayerId = (id: unknown): id is string =>
  typeof id === "string" &&
  (/^[a-f0-9]{24}$/.test(id) || /^bot:[0-9]{1,6}$/.test(id));
/**
 * How many riders must agree. A rider who quit mid-match is gone before the recap and can never report, so counting
 * them would leave a two-rider match with one leaver pending forever. Finishers are frozen at the final tick,
 * not inferred from early-exit eliminations or the live recap roster. Past riders can link but cannot supply a deciding vote.
 */
export const attestationsNeeded = (result: MatchResult): number =>
  Math.floor(result.finishers.length / 2) + 1;
export const humansOf = (result: MatchResult): string[] =>
  result.players.map((player) => player.playerId).filter((id) => !isBot(id));
export const emptyTotals = (): Totals =>
  Object.fromEntries(TOTAL_KEYS.map((key) => [key, 0])) as Totals;

/** Storage boundary for career totals; movement distances are continuous, event counts are integers. */
export function parseTotals(raw: unknown): Totals {
  const totals = emptyTotals(),
    stored = plain(raw) ? raw : {};
  for (const key of TOTAL_KEYS) {
    const value = stored[key];
    if (
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= Number.MAX_SAFE_INTEGER &&
      (key === "distanceUnits" || Number.isSafeInteger(value))
    )
      totals[key] = value;
  }
  return totals;
}

function parsePlayer(raw: unknown, rounds: number): StoredPlayer | undefined {
  if (!plain(raw) || !Object.keys(raw).every((key) => PLAYER_KEYS.has(key)))
    return;
  const { playerId, name, color, deathsByCause: deaths } = raw;
  if (!validPlayerId(playerId)) return;
  // The same rule the room applies to a joining name, so a stored name is one the game could have shown.
  if (!validRiderName(name)) return;
  if (typeof color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(color)) return;
  if (
    !plain(deaths) ||
    Object.keys(deaths).length !== DEATHS.length ||
    !DEATHS.every((cause) => counter(deaths[cause]))
  )
    return;
  if (
    !COUNTERS.every((key) =>
      key === "distanceUnits"
        ? typeof raw[key] === "number" &&
          Number.isFinite(raw[key]) &&
          raw[key] >= 0 &&
          raw[key] <= MAX_DISTANCE
        : counter(raw[key], PER_ROUND.has(key) ? rounds : LIMITS[key]),
    )
  )
    return;
  if ((raw.matchPlacement as number) < 1) return;
  // Rebuilt key by key, in one order, so equal results serialize to equal bytes whatever order a client sent them in.
  const player = { playerId, name, color } as StoredPlayer;
  for (const key of COUNTERS) player[key] = raw[key] as number;
  player.deathsByCause = Object.fromEntries(
    DEATHS.map((cause) => [cause, deaths[cause]]),
  ) as unknown as MatchDeathCounts;
  if (raw.combat !== undefined) {
    const combat = parseCombat(raw.combat, MAX_EVENTS);
    if (!combat) return;
    player.combat = combat;
  }
  return player;
}

/** Runtime boundary for a reported result and for a stored one: unknown fields are refused, not ignored. */
export function parseMatchResult(raw: unknown): MatchResult | undefined {
  if (
    !plain(raw) ||
    !Object.keys(raw).every((key) =>
      [
        "matchId",
        "round",
        "length",
        "winnerId",
        "finishers",
        "players",
      ].includes(key),
    )
  )
    return;
  const {
    matchId,
    round,
    length,
    winnerId,
    finishers,
    players: rawPlayers,
  } = raw;
  if (
    round !== undefined &&
    (!Number.isSafeInteger(round) ||
      (round as number) < 1 ||
      (round as number) > 1_000_000 ||
      length !== 1)
  )
    return;
  if (typeof matchId !== "string" || !/^[\x21-\x7e]{1,128}$/.test(matchId))
    return;
  if (
    !Number.isSafeInteger(length) ||
    (length as number) < 1 ||
    (length as number) > MAX_ROUNDS
  )
    return;
  if (
    !Array.isArray(rawPlayers) ||
    rawPlayers.length < 1 ||
    rawPlayers.length > MAX_MATCH_PARTICIPANTS ||
    (round !== undefined && rawPlayers.length > 5)
  )
    return;
  const players: StoredPlayer[] = [];
  for (const entry of rawPlayers) {
    const player = parsePlayer(entry, length as number);
    if (!player) return;
    players.push(player);
  }
  const ids = new Set(players.map((player) => player.playerId));
  if (ids.size !== players.length) return;
  if (
    players.some(
      (p) =>
        p.combat &&
        Object.keys({ ...p.combat.victims, ...p.combat.killers }).some(
          (id) => id === p.playerId || !ids.has(id),
        ),
    )
  )
    return;
  if (players.some((player) => player.matchPlacement > players.length)) return;
  if (
    winnerId !== undefined &&
    (typeof winnerId !== "string" || !ids.has(winnerId))
  )
    return;
  if (
    !Array.isArray(finishers) ||
    finishers.length > 5 ||
    new Set(finishers).size !== finishers.length ||
    !finishers.every(
      (id) => typeof id === "string" && ids.has(id) && !isBot(id),
    )
  )
    return;
  players.sort((a, b) => a.slot - b.slot || (a.playerId < b.playerId ? -1 : 1));
  return {
    matchId,
    ...(round === undefined ? {} : { round: round as number }),
    length: length as number,
    finishers: [...finishers].sort(),
    ...(winnerId === undefined ? {} : { winnerId }),
    players,
  };
}

export function parseMatchRecord(raw: unknown): MatchRecord | undefined {
  if (
    !plain(raw) ||
    raw.version !== 1 ||
    typeof raw.id !== "string" ||
    !/^[a-f0-9]{40}$/.test(raw.id) ||
    typeof raw.roomCode !== "string" ||
    !validCode(raw.roomCode)
  )
    return;
  if (raw.status !== "pending" && raw.status !== "confirmed") return;
  const result = parseMatchResult(raw.result);
  if (
    !result ||
    !counterLike(raw.createdAt) ||
    (raw.endedAt !== undefined && !counterLike(raw.endedAt)) ||
    (raw.expiresAt !== undefined && !counterLike(raw.expiresAt))
  )
    return;
  if ((raw.status === "confirmed") !== (raw.endedAt !== undefined)) return;
  const humans = new Set(humansOf(result));
  if (
    !Array.isArray(raw.attesters) ||
    raw.attesters.length > humans.size ||
    !raw.attesters.every((id) => typeof id === "string" && humans.has(id))
  )
    return;
  if (
    !plain(raw.uidByPlayer) ||
    !Object.entries(raw.uidByPlayer).every(
      ([id, uid]) => humans.has(id) && validUid(uid),
    )
  )
    return;
  if (
    !plain(raw.avatars) ||
    !Object.entries(raw.avatars).every(
      ([id, avatar]) => humans.has(id) && isAvatarId(avatar),
    )
  )
    return;
  if (
    !Array.isArray(raw.participantUids) ||
    raw.participantUids.length > humans.size ||
    !raw.participantUids.every(validUid)
  )
    return;
  if (
    raw.ratingScope !== undefined &&
    (typeof raw.ratingScope !== "string" ||
      !/^[a-f0-9]{40}$/.test(raw.ratingScope))
  )
    return;
  const ratings: Record<string, RatingPoint> = {};
  if (raw.ratings !== undefined) {
    if (!plain(raw.ratings) || Object.keys(raw.ratings).length > humans.size)
      return;
    for (const [id, point] of Object.entries(raw.ratings)) {
      if (!humans.has(id) || !plain(point)) return;
      const parsed = parseRating({
        value: point.after,
        peak: point.after,
        games: 1,
        points: [point],
      });
      if (!parsed || parsed.points[0]!.match !== raw.id) return;
      ratings[id] = parsed.points[0]!;
    }
  }
  if (
    raw.rivalryPairs !== undefined &&
    (!Array.isArray(raw.rivalryPairs) ||
      raw.rivalryPairs.length > 8128 ||
      !raw.rivalryPairs.every(
        (p) => typeof p === "string" && /^[a-f0-9]{24}:[a-f0-9]{24}$/.test(p),
      ))
  )
    return;
  // Rebuilt rather than passed through, so a storage-only field (Firestore's cleanupAt) never rides along into a rewrite.
  return {
    ...(raw.ratingScope ? { ratingScope: raw.ratingScope as string } : {}),
    ...(raw.ratings ? { ratings } : {}),
    ...(raw.rivalryPairs
      ? { rivalryPairs: [...raw.rivalryPairs] as string[] }
      : {}),
    version: 1,
    id: raw.id,
    roomCode: raw.roomCode,
    status: raw.status,
    result,
    attesters: [...raw.attesters] as string[],
    uidByPlayer: { ...raw.uidByPlayer } as Record<string, string>,
    avatars: { ...raw.avatars } as Record<string, AvatarId>,
    participantUids: [...raw.participantUids] as string[],
    createdAt: raw.createdAt,
    ...(raw.endedAt === undefined ? {} : { endedAt: raw.endedAt }),
    ...(raw.expiresAt === undefined ? {} : { expiresAt: raw.expiresAt }),
  };
}
const counterLike = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

/** Where a record lives: the room's incarnation keeps a reused room code apart, the hash keeps differing results apart. */
export function matchRecordId(
  incarnation: string,
  result: MatchResult,
): string {
  return createHash("sha256")
    .update(JSON.stringify([incarnation, result]))
    .digest("hex")
    .slice(0, 40);
}

function creditFor(
  uid: string,
  player: StoredPlayer,
  avatarId: AvatarId | undefined,
  at: number,
  players: StoredPlayer[],
): Credit {
  return {
    career: { group: gameGroup(players), stats: careerFor(player, players) },
    uid,
    name: player.name,
    ...(avatarId === undefined ? {} : { avatarId }),
    at,
    totals: {
      matches: 1,
      wins: player.matchPlacement === 1 ? 1 : 0,
      roundWins: player.roundWins,
      eliminations: player.eliminations,
      bombsPlaced: player.bombsPlaced,
      pickupsCollected: player.pickupsCollected,
      survivalTicks: player.survivalTicks,
      distanceUnits: player.distanceUnits,
    },
  };
}

/** A seat proven by its room token. Only HistoryStore.admit makes one. */
export interface Reporter {
  code: string;
  rider: string;
  incarnation: string;
}
export type SubmitOutcome = {
  status: "pending" | "confirmed";
  attestations: number;
  needed: number;
  linked: boolean;
};
/** What an account may see of a match: every rider's stats, and which seat was its own; never another rider's account. */
export interface HistoryEntry {
  rating?: RatingPoint;
  id: string;
  endedAt: number;
  roomCode: string;
  you?: string;
  attestations: number;
  avatars: Record<string, AvatarId>;
  result: MatchResult;
}

export class HistoryStore {
  constructor(
    private database: HistoryDatabase,
    private rooms: RoomStore,
    private now: () => number,
  ) {}

  /**
   * One rider's report. The room token proves which seat is speaking, because a player id is the digest of it; `uid`
   * is that rider's own verified account, or undefined for a guest. Nothing in the body can name an account.
   */
  /**
   * Who is reporting, decided from the room token alone and before anything costly: the HTTP layer reads the body and
   * verifies a sign-in only for a caller this has accepted. Room tokens are free to mint, so the address is limited too.
   */
  async admit(
    code: string,
    token: string,
    address: string,
    roundReport = false,
  ): Promise<Reporter> {
    if (!validCode(code) || !validToken(token))
      throw new RoomError(401, "Invalid identity");
    const room = await this.rooms.get(code),
      rider = peerId(token),
      member = room.members[rider];
    if (!member || member.expiresAt <= this.now())
      throw new RoomError(403, "Join the room first");
    const allowed =
      (await this.rooms.database.allowance(
        digest(`${roundReport ? "round-results" : "results"}:${code}:${rider}`),
        this.now(),
        roundReport ? 600 : SUBMISSIONS_PER_HOUR,
      )) &&
      (await this.rooms.database.allowance(
        digest(
          `${roundReport ? "round-results" : "results"}-address:${address}`,
        ),
        this.now(),
        roundReport ? 3000 : SUBMISSIONS_PER_ADDRESS_PER_HOUR,
      ));
    if (!allowed) throw new RoomError(429, "Too many results; try later");
    return { code, rider, incarnation: room.incarnation };
  }

  /** One rider's report. `uid` is that rider's own verified account, or undefined for a guest; nothing in the body can name one. */
  async submit(
    reporter: Reporter,
    body: unknown,
    uid: string | undefined,
  ): Promise<SubmitOutcome> {
    const { code, rider } = reporter;
    if (
      !plain(body) ||
      !Object.keys(body).every(
        (key) => key === "result" || key === "avatarId",
      ) ||
      (body.avatarId !== undefined && !isAvatarId(body.avatarId))
    )
      throw new RoomError(400, "Invalid match result");
    const result = parseMatchResult(body.result),
      avatarId = body.avatarId;
    if (!result) throw new RoomError(400, "Invalid match result");
    const needed = attestationsNeeded(result);
    if (!humansOf(result).includes(rider))
      throw new RoomError(403, "Only a rider in the match can report it");
    // Only an account makes a record permanent, and fresh room tokens are free, so the per-rider limit above cannot
    // bound permanent storage. This one can: past it a report still counts, as a guest's, and the record expires.
    const account =
      uid !== undefined &&
      (await this.rooms.database.allowance(
        digest(`${result.round === undefined ? "link" : "round-link"}:${uid}`),
        this.now(),
        result.round === undefined ? LINKS_PER_HOUR : 600,
      ))
        ? uid
        : undefined;
    if (
      result.round !== undefined &&
      uid !== undefined &&
      account === undefined
    )
      throw new RoomError(429, "Too many rated rounds; try later");
    const id = matchRecordId(reporter.incarnation, result),
      player = result.players.find((entry) => entry.playerId === rider)!;
    return this.database.transactMatch(id, (current) => {
      const now = this.now();
      const match: MatchRecord = current
        ? structuredClone(current)
        : {
            version: 1,
            ratingScope: createHash("sha256")
              .update(
                JSON.stringify([
                  reporter.incarnation,
                  result.matchId,
                  result.round ?? "game",
                ]),
              )
              .digest("hex")
              .slice(0, 40),
            id,
            roomCode: code,
            status: "pending",
            result,
            attesters: [],
            uidByPlayer: {},
            avatars: {},
            participantUids: [],
            createdAt: now,
            expiresAt: now + PENDING_TTL_MS,
          };
      const credits: Credit[] = [];
      if (!match.attesters.includes(rider)) match.attesters.push(rider);
      if (avatarId !== undefined) match.avatars[rider] = avatarId;
      // One account per seat and one seat per account: a second device on the same account reports, but is not credited twice.
      const linking =
        account !== undefined &&
        match.uidByPlayer[rider] === undefined &&
        !Object.values(match.uidByPlayer).includes(account);
      if (linking) match.uidByPlayer[rider] = account;
      if (
        match.status === "pending" &&
        match.attesters.filter((id) => result.finishers.includes(id)).length >=
          needed
      ) {
        match.status = "confirmed";
        match.endedAt = now;
        for (const [seat, owner] of Object.entries(match.uidByPlayer))
          credits.push(
            creditFor(
              owner,
              match.result.players.find((entry) => entry.playerId === seat)!,
              match.avatars[seat],
              now,
              match.result.players,
            ),
          );
      } else if (match.status === "confirmed" && linking)
        credits.push(
          creditFor(
            account,
            player,
            match.avatars[rider],
            match.endedAt ?? now,
            match.result.players,
          ),
        );
      if (result.round !== undefined) credits.length = 0;
      if (match.status === "confirmed") {
        match.participantUids = [...new Set(Object.values(match.uidByPlayer))];
        const hasAccounts = match.participantUids.length > 0;
        // Round receipts remain durable and idempotent, but do not appear as career games.
        if (result.round !== undefined) match.participantUids = [];
        if (hasAccounts) delete match.expiresAt;
        else match.expiresAt = (match.endedAt ?? now) + GUEST_MATCH_TTL_MS;
      }
      return {
        match,
        credits,
        result: {
          status: match.status,
          attestations: match.attesters.length,
          needed,
          linked: account !== undefined && match.uidByPlayer[rider] === account,
        },
      };
    });
  }

  async profile(uid: string): Promise<UserProfile | undefined> {
    if (
      !(await this.rooms.database.allowance(
        digest(`history:${uid}`),
        this.now(),
        READS_PER_HOUR,
      ))
    )
      throw new RoomError(429, "Too many requests; try later");
    const profile = await this.database.profile(uid);
    if (profile?.rating?.games)
      profile.rank = await this.database.rank(Math.round(profile.rating.value));
    return profile;
  }

  /** Usernames are not unique and not reserved: they are what friends call a rider, not an identifier. The account is the identifier. */
  async rename(uid: string, body: unknown): Promise<{ username: string }> {
    if (
      !plain(body) ||
      Object.keys(body).length !== 1 ||
      !validRiderName(body.username)
    )
      throw new RoomError(400, "A username is 1 to 18 characters");
    if (
      !(await this.rooms.database.allowance(
        digest(`rename:${uid}`),
        this.now(),
        RENAMES_PER_HOUR,
      ))
    )
      throw new RoomError(429, "Too many changes; try later");
    await this.database.setUsername(uid, body.username, this.now());
    return { username: body.username };
  }

  async leaderboard(
    address: string,
    uid?: string,
  ): Promise<LeaderboardEntry[]> {
    if (
      !(await this.rooms.database.allowance(
        digest(`leaderboard:${address}`),
        this.now(),
        READS_PER_HOUR,
      ))
    )
      throw new RoomError(429, "Too many requests; try later");
    return this.database.leaderboard(uid);
  }

  async history(
    uid: string,
    before: number | undefined,
  ): Promise<{
    profile: UserProfile | undefined;
    matches: HistoryEntry[];
    rivals: Rivalries;
  }> {
    if (
      !(await this.rooms.database.allowance(
        digest(`history:${uid}`),
        this.now(),
        READS_PER_HOUR,
      ))
    )
      throw new RoomError(429, "Too many requests; try later");
    const [profile, records, rivals] = await Promise.all([
      this.profile(uid),
      this.database.matchesFor(uid, before, HISTORY_PAGE),
      this.database.rivals(uid),
    ]);
    return {
      profile,
      rivals,
      matches: records.map((record) => {
        const you = Object.entries(record.uidByPlayer).find(
          ([, account]) => account === uid,
        )?.[0];
        return {
          ...(you && record.ratings?.[you]
            ? { rating: record.ratings[you] }
            : {}),
          id: record.id,
          endedAt: record.endedAt ?? record.createdAt,
          roomCode: record.roomCode,
          ...(you ? { you } : {}),
          attestations: record.attesters.length,
          avatars: record.avatars,
          result: record.result,
        };
      }),
    };
  }
}

/** User storage is validated before it can affect Elo or appear on a page. */
export function parseProfile(data: unknown): UserProfile | undefined {
  if (!plain(data)) return;
  const rating =
    data.rating === undefined ? undefined : parseRating(data.rating);
  const career =
    data.career === undefined ? undefined : parseBuckets(data.career);
  if (
    (data.rating !== undefined && !rating) ||
    (data.career !== undefined && !career)
  )
    throw new Error("Stored player stats are incompatible");
  return {
    ...(validRiderName(data.username) ? { username: data.username } : {}),
    ...(validRiderName(data.name) ? { name: data.name } : {}),
    ...(isAvatarId(data.avatarId) ? { avatarId: data.avatarId } : {}),
    totals: parseTotals(data.totals),
    updatedAt: counterLike(data.updatedAt) ? data.updatedAt : 0,
    ...(rating ? { rating } : {}),
    ...(career ? { career } : {}),
  };
}
