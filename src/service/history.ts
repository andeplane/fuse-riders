import {
  careerFor,
  emptyBuckets,
  gameGroup,
  mergeCareer,
  parseBuckets,
  type CareerBuckets,
  type CareerStats,
  type GameGroup,
} from "../shared/career-stats.js";
import { parseCombat } from "../engine/combat-stats.js";
import { isAvatarId, type AvatarId } from "../shared/avatars.js";
import { BOT_ID_PREFIX } from "../engine/bot-controller.js";
import type {
  MatchDeathCounts,
  MatchPlayerStats,
} from "../engine/match-stats.js";
import { validRiderName } from "../engine/rider-name.js";
import { GAME_ID } from "../shared/game-id.js";
import { diceRegistration } from "dice/platform";
import {
  LEGACY_GAME_ID,
  MAX_MATCH_PARTICIPANTS,
  Platform,
  parseMatchRecord as parsePlatformRecord,
  parseMatchResult as parsePlatformResult,
  parseProfile as parsePlatformProfile,
  type AccountRules,
  type GameRegistration,
  type HistoryEntry as PlatformHistoryEntry,
  type MatchRecord as PlatformMatchRecord,
  type MatchResult as PlatformMatchResult,
  type Profile,
} from "fuse-platform";

/**
 * Fuse Riders' part of the shared backend (`fuse-platform`): what a rider's stats are, what a match adds to an
 * account's totals and career, and rivalries from eliminations. Attestation, settlement, Elo and storage are the
 * platform's. This module also builds the service's `platform`: the account rules every game shares, and every
 * registered game: Fuse Riders and the dice game (`games/dice/src/platform.ts`).
 */

export {
  GUEST_MATCH_TTL_MS,
  HISTORY_PAGE,
  HistoryStore,
  MAX_MATCH_PARTICIPANTS,
  PENDING_TTL_MS,
  matchRecordId,
} from "fuse-platform";

export type StoredPlayer = MatchPlayerStats;
export type MatchResult = PlatformMatchResult<StoredPlayer>;
export type MatchRecord = Omit<PlatformMatchRecord<StoredPlayer>, "avatars"> & {
  avatars: Record<string, AvatarId>;
};
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
/** An account's standing in Fuse Riders beside its rating, stored on the user document as it was before games. */
export interface FuseTotals {
  totals: Totals;
  career?: CareerBuckets;
}
/** What one confirmed match adds to an account. */
export interface FuseCredit {
  totals: Totals;
  career: { group: GameGroup; stats: CareerStats };
}
export type UserProfile = Omit<Profile<FuseTotals>, "avatarId"> & {
  avatarId?: AvatarId;
};
export type HistoryEntry = Omit<
  PlatformHistoryEntry<StoredPlayer>,
  "avatars"
> & {
  avatars: Record<string, AvatarId>;
};

/**
 * Nothing can check a stat against the match that produced it, so these only keep a forged report from being absurd:
 * a rider who reports alone is believed, and what they can inflate is their own totals, by this much per report.
 */
const MAX_TICKS = 2_000_000,
  MAX_DISTANCE = 100_000_000,
  MAX_EVENTS = 20_000,
  MAX_SCORE = 10_000;
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
const BOT_ID = new RegExp(`^${BOT_ID_PREFIX}[0-9]{1,6}$`);

const counter = (value: unknown, most = MAX_EVENTS): value is number =>
  Number.isSafeInteger(value) &&
  (value as number) >= 0 &&
  (value as number) <= most;
const plain = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isBot = (id: string): boolean => BOT_ID.test(id);
const validPlayerId = (id: unknown): id is string =>
  typeof id === "string" && (/^[a-f0-9]{24}$/.test(id) || isBot(id));
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

export const fuseRiders: GameRegistration<
  StoredPlayer,
  FuseTotals,
  FuseCredit
> = {
  id: GAME_ID,
  isBot,
  parseStats: parsePlayer,
  // Kills and deaths may only name other riders of the same match.
  validField: (players) => {
    const ids = new Set(players.map((player) => player.playerId));
    return !players.some(
      (p) =>
        p.combat &&
        Object.keys({ ...p.combat.victims, ...p.combat.killers }).some(
          (id) => id === p.playerId || !ids.has(id),
        ),
    );
  },
  emptyTotals: () => ({ totals: emptyTotals() }),
  credit: (player, players) => ({
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
    career: { group: gameGroup(players), stats: careerFor(player, players) },
  }),
  addTotals(standing, credit) {
    for (const key of TOTAL_KEYS) standing.totals[key] += credit.totals[key];
    standing.career ??= emptyBuckets();
    mergeCareer(standing.career[credit.career.group], credit.career.stats);
  },
  parseTotals(document) {
    const career =
      document.career === undefined ? undefined : parseBuckets(document.career);
    if (document.career !== undefined && !career) return;
    return {
      totals: parseTotals(document.totals),
      ...(career ? { career } : {}),
    };
  },
  // Only a match both riders played with combat detail says who eliminated whom.
  rivals: (player, opponent) =>
    player.combat && opponent.combat
      ? {
          kills: player.combat.victims[opponent.playerId] ?? 0,
          deaths: opponent.combat.victims[player.playerId] ?? 0,
        }
      : undefined,
};

/** One account across every game: named by the rider-name rule, pictured by a Fuse Riders avatar. */
export const ACCOUNT_RULES: AccountRules = {
  validName: validRiderName,
  validAvatar: isAvatarId,
  nameRule: "A username is 1 to 18 characters",
  fallbackName: "Rider",
};

if (GAME_ID !== LEGACY_GAME_ID)
  // Fuse Riders' ratings stay on the user document only while it is the legacy game.
  throw new Error("Fuse Riders must remain the legacy game");

/** Every game this service hosts. The room service is configured with the same ids. */
export const platform = new Platform(ACCOUNT_RULES, [
  fuseRiders,
  diceRegistration,
]);

/** Runtime boundary for a Fuse Riders result, reported or stored: unknown fields are refused, not ignored. */
export const parseMatchResult = (raw: unknown): MatchResult | undefined =>
  parsePlatformResult(fuseRiders, ACCOUNT_RULES, raw);
export const parseMatchRecord = (raw: unknown): MatchRecord | undefined =>
  parsePlatformRecord(platform, raw) as MatchRecord | undefined;
/** The user document, validated before it can affect Elo or appear on a page. */
export const parseProfile = (data: unknown): UserProfile | undefined =>
  parsePlatformProfile(platform, GAME_ID, data) as UserProfile | undefined;
