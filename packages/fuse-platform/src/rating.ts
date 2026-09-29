import { INITIAL_ELO } from "./elo.js";
/**
 * Ratings and what the account pages show of them. Browser-safe (no Node imports), so a game's client imports this
 * module as `fuse-platform/rating` without pulling in the service.
 */
/** The seat a signed-in player's solo round reports as: solo play has no room, so no room token to derive one from. */
export const SOLO_RATING_PLAYER_ID = "0".repeat(24);
/** A rated round seats at most this many humans; a round result with more players is refused. */
export const MAX_RATED_PLAYERS = 5;
export interface RatingPoint {
  match: string;
  at: number;
  before: number;
  after: number;
  round?: number;
  opponents?: number;
}
export interface Rating {
  value: number;
  games: number;
  /** Individual rounds; older whole-game settlements remain only in games. */
  rounds?: number;
  peak: number;
  points: RatingPoint[];
}
export const newRating = (): Rating => ({
  value: INITIAL_ELO,
  games: 0,
  rounds: 0,
  peak: INITIAL_ELO,
  points: [],
});
export function parseRating(raw: unknown): Rating | undefined {
  if (!raw || typeof raw !== "object") return;
  const r = raw as Record<string, unknown>;
  const rating = (n: unknown): n is number =>
    typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 1_000_000;
  if (
    !rating(r.value) ||
    !rating(r.peak) ||
    !Number.isSafeInteger(r.games) ||
    (r.games as number) < 0 ||
    (r.rounds !== undefined &&
      (!Number.isSafeInteger(r.rounds) ||
        (r.rounds as number) < 0 ||
        (r.rounds as number) > (r.games as number))) ||
    !Array.isArray(r.points) ||
    r.points.length > 100
  )
    return;
  const points: RatingPoint[] = [];
  for (const value of r.points) {
    if (!value || typeof value !== "object") return;
    const p = value as Record<string, unknown>;
    if (
      typeof p.match !== "string" ||
      !/^[a-f0-9]{40}$/.test(p.match) ||
      typeof p.at !== "number" ||
      !Number.isFinite(p.at) ||
      p.at < 0 ||
      !rating(p.before) ||
      !rating(p.after) ||
      (p.round !== undefined &&
        (!Number.isSafeInteger(p.round) ||
          (p.round as number) < 1 ||
          (p.round as number) > 1_000_000 ||
          !Number.isSafeInteger(p.opponents) ||
          (p.opponents as number) < 0 ||
          (p.opponents as number) > MAX_RATED_PLAYERS - 1)) ||
      (p.round === undefined && p.opponents !== undefined)
    )
      return;
    points.push({
      match: p.match,
      at: p.at,
      before: p.before,
      after: p.after,
      ...(p.round === undefined
        ? {}
        : { round: p.round as number, opponents: p.opponents as number }),
    });
  }
  if (
    points.some(
      (p, i) =>
        i > 0 &&
        (p.at < points[i - 1]!.at || p.before !== points[i - 1]!.after),
    ) ||
    (points.length && points.at(-1)!.after !== r.value)
  )
    return;
  return {
    value: r.value,
    peak: r.peak,
    games: r.games as number,
    ...(r.rounds === undefined ? {} : { rounds: r.rounds as number }),
    points,
  };
}
export interface LeaderboardEntry {
  rank: number;
  /** The account's public id, for adding the player as a friend (fuse-platform/friends-api). */
  publicId?: string;
  name: string;
  avatarId?: string;
  elo: number;
  games: number;
  rounds?: number;
  you?: boolean;
}
/**
 * One opponent an account has met. `kills` counts how often it got the better of that opponent and `deaths` how often
 * the opponent got the better of it; each game decides what that means (Fuse Riders counts eliminations).
 */
export interface Rival {
  name: string;
  kills: number;
  deaths: number;
  matches: number;
}
export interface Rivalries {
  nemeses: Rival[];
  prey: Rival[];
}
