import { INITIAL_ELO } from "./elo.js";
export interface RatingPoint {
  match: string;
  at: number;
  before: number;
  after: number;
}
export interface Rating {
  value: number;
  games: number;
  peak: number;
  points: RatingPoint[];
}
export const newRating = (): Rating => ({
  value: INITIAL_ELO,
  games: 0,
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
      !rating(p.after)
    )
      return;
    points.push({ match: p.match, at: p.at, before: p.before, after: p.after });
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
  return { value: r.value, peak: r.peak, games: r.games as number, points };
}
export interface LeaderboardEntry {
  rank: number;
  name: string;
  avatarId?: string;
  elo: number;
  games: number;
  you?: boolean;
}
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
