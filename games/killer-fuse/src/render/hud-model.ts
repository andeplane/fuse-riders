/**
 * What the HUD shows, worked out from a view without drawing anything: how far the snail is toward each goal, which
 * win is one move away, and what a seat's tag reads.
 */
import type { RoundView } from "../engine/index.js";

/** The snail's place between the goals: 0 at team 0's goal, 1 at team 1's, with the start in between. */
export function snailFraction(view: RoundView): number {
  const [a, b] = view.map.snail.goals;
  if (a === b) return 0.5;
  return Math.max(0, Math.min(1, (view.snail.x - a) / (b - a)));
}

/** How close the snail is to `team`'s goal, 0 at the start line and 1 on the goal. */
export function snailThreat(view: RoundView, team: number): number {
  const goal = view.map.snail.goals[team === 1 ? 1 : 0];
  const span = Math.abs(goal - view.map.snail.start);
  if (span === 0) return 0;
  const done =
    (view.snail.x - view.map.snail.start) / (goal - view.map.snail.start);
  return Math.max(0, Math.min(1, done));
}

export interface Danger {
  /** Per team: this team's Queen is on her last egg. */
  readonly lastEgg: readonly [boolean, boolean];
  /** Per team: this team needs one more berry to win. */
  readonly lastBerry: readonly [boolean, boolean];
  /** Per team: the snail is in the last stretch before this team's goal, with someone riding it. */
  readonly snailNear: readonly [boolean, boolean];
  /** Anything at all is on the brink. */
  readonly any: boolean;
}

/** The share of the way to a goal from which the snail counts as about to win. */
export const SNAIL_NEAR = 0.8;

export function dangerOf(view: RoundView): Danger {
  const over = view.winner !== null;
  const egg = (team: number): boolean => !over && (view.eggs[team] ?? 0) <= 1;
  const berry = (team: number): boolean => {
    const holes = view.hives[team]?.length ?? 0;
    return !over && holes > 0 && (view.berries[team] ?? 0) === holes - 1;
  };
  const snail = (team: number): boolean =>
    !over && view.snail.rider >= 0 && snailThreat(view, team) >= SNAIL_NEAR;
  const lastEgg = [egg(0), egg(1)] as const;
  const lastBerry = [berry(0), berry(1)] as const;
  const snailNear = [snail(0), snail(1)] as const;
  return {
    lastEgg,
    lastBerry,
    snailNear,
    any: [...lastEgg, ...lastBerry, ...snailNear].some(Boolean),
  };
}

/** Characters the tag font can draw; anything else in a name is dropped. */
const TAG_CHARS = /[^A-Z0-9 !?.\-_]/g;
export const TAG_LENGTH = 8;

/** The tag over a seat's unit: the player's name in capitals, cut to fit, or BOT for an unnamed bot. */
export function tagOf(name: string | undefined, bot: boolean): string {
  const clean = (name ?? "")
    .toUpperCase()
    .replace(TAG_CHARS, "")
    .trim()
    .slice(0, TAG_LENGTH)
    .trim();
  if (clean) return clean;
  return bot ? "BOT" : "";
}

/** Seconds left of a respawn, rounded up, for the count over a dead unit's spawn. */
export const respawnCount = (respawn: number, totalSeconds: number): number =>
  Math.max(
    1,
    Math.ceil((1 - Math.max(0, Math.min(1, respawn))) * totalSeconds),
  );
