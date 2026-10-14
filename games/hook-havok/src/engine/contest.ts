import { integer, plain } from "./codec.js";
import type { Tuning } from "./world.js";

export const ROUND_TICKS = 60 * 60;
export const COUNTDOWN_TICKS = 3 * 60;
export interface Entrant {
  id: string;
  slot: number;
  score: number;
  out: boolean;
}
export interface Contest {
  phase: "waiting" | "countdown" | "active" | "over";
  elapsed: number;
  entries: Entrant[];
  winners: string[];
}
export function createContest(rules: Tuning["rules"]): Contest {
  return {
    phase: rules === "free" ? "active" : "waiting",
    elapsed: 0,
    entries: [],
    winners: [],
  };
}
export function leaders(c: Contest, rules: Tuning["rules"]): string[] {
  const eligible = c.entries.filter((e) => !e.out);
  const best = Math.max(...eligible.map((e) => e.score));
  return eligible
    .filter((e) => rules === "elimination" || e.score === best)
    .map((e) => e.id);
}
export function finishContest(c: Contest, rules: Tuning["rules"]): void {
  c.phase = "over";
  c.winners = leaders(c, rules);
}
export function decodeContest(
  raw: unknown,
  rules: Tuning["rules"],
): Contest | undefined {
  if (
    !plain(raw) ||
    Object.keys(raw).length !== 4 ||
    !["waiting", "countdown", "active", "over"].includes(String(raw.phase)) ||
    !integer(raw.elapsed, 0, ROUND_TICKS) ||
    !Array.isArray(raw.entries) ||
    raw.entries.length > 5 ||
    !Array.isArray(raw.winners) ||
    raw.winners.length > 5
  )
    return;
  const c = createContest(rules);
  c.phase = raw.phase as Contest["phase"];
  c.elapsed = raw.elapsed;
  for (const entry of raw.entries) {
    if (
      !plain(entry) ||
      Object.keys(entry).length !== 4 ||
      typeof entry.id !== "string" ||
      !entry.id.length ||
      entry.id.length > 128 ||
      /[\x00-\x1f\x7f]/.test(entry.id) ||
      !integer(entry.slot, 0, 4) ||
      !integer(entry.score, -2 * c.elapsed, c.elapsed) ||
      typeof entry.out !== "boolean" ||
      c.entries.some(
        (e) => e.id === entry.id || e.slot >= (entry.slot as number),
      )
    )
      return;
    c.entries.push({
      id: entry.id,
      slot: entry.slot,
      score: entry.score,
      out: entry.out,
    });
  }
  if (raw.winners.some((id) => typeof id !== "string")) return;
  c.winners = raw.winners as string[];
  if (rules === "free") {
    if (
      c.phase !== "active" ||
      c.elapsed ||
      c.entries.length ||
      c.winners.length
    )
      return;
  } else if (c.phase === "waiting" || c.phase === "countdown") {
    if (
      c.entries.length ||
      c.winners.length ||
      (c.phase === "waiting" ? c.elapsed !== 0 : c.elapsed >= COUNTDOWN_TICKS)
    )
      return;
  } else {
    if (
      c.entries.length < 2 ||
      (c.phase === "active" &&
        (c.winners.length || c.elapsed >= ROUND_TICKS)) ||
      (rules === "elimination" && c.entries.some((e) => e.score !== 0))
    )
      return;
    if (
      c.phase === "over" &&
      JSON.stringify(c.winners) !== JSON.stringify(leaders(c, rules))
    )
      return;
    const survivors = c.entries.filter((e) => !e.out).length;
    if (c.phase === "over" && c.elapsed < ROUND_TICKS && survivors > 1) return;
    if (c.phase === "active" && c.elapsed > 0 && survivors <= 1) return;
  }
  return c;
}
