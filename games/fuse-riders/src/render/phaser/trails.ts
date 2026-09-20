import type { TrailSegment, ViewRules, WorldView } from "../../engine/view.js";

type Rider = WorldView["players"][number];
export interface TrailPoint {
  x: number;
  y: number;
}
export interface TrailStroke {
  color: string;
  alive: boolean;
  paths: readonly (readonly TrailPoint[])[];
}
/** What the fade of a detached trail needs of the rules; a `WorldView`'s `rules` is one. */
export type TrailFadeRules = Pick<ViewRules, "tickHz" | "trailDecayPauseTicks">;

/** Pure snapshot-time styling: detachment fades color over three seconds, never opacity. */
export function trailColor(
  color: string,
  alive: boolean,
  segment: TrailSegment | undefined,
  tick: number,
  rules: TrailFadeRules,
): string {
  const detached = segment?.detached;
  const saturation = detached
    ? Math.max(
        0,
        Math.min(
          1,
          1 -
            (tick - detached.decayStartTick + rules.trailDecayPauseTicks) /
              (3 * rules.tickHz),
        ),
      )
    : alive
      ? 1
      : 0.75;
  if (saturation === 1 || !/^#[0-9a-f]{6}$/i.test(color)) return color;
  const rgb = [1, 3, 5].map((offset) =>
    parseInt(color.slice(offset, offset + 2), 16),
  );
  // The map above always produces exactly the three RGB channels.
  const gray = rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
  return (
    "#" +
    rgb
      .map((channel) =>
        Math.round(gray + (channel - gray) * saturation)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

const samePoint = (
  x: number,
  y: number,
  otherX: number,
  otherY: number,
): boolean => Math.abs(x - otherX) <= 1e-6 && Math.abs(y - otherY) <= 1e-6;

/** Join only consecutive, touching segments. A missing tick is a real hole, even at a crossing. */
export function trailPaths(segments: readonly TrailSegment[]): TrailPoint[][] {
  const paths: TrailPoint[][] = [];
  let previous: TrailSegment | undefined;
  for (const segment of segments) {
    if (
      !previous ||
      segment.detached?.id !== previous.detached?.id ||
      segment.createdTick !== previous.createdTick + 1 ||
      !samePoint(previous.x2, previous.y2, segment.x1, segment.y1)
    ) {
      paths.push([{ x: segment.x1, y: segment.y1 }]);
    }
    paths[paths.length - 1]!.push({ x: segment.x2, y: segment.y2 });
    previous = segment;
  }
  return paths;
}

/** The supplied prediction segment is already the local tip. A remote rider's interpolation needs at most one step. */
export function trailTip(
  player: Rider,
  tick: number,
  phase: WorldView["phase"],
): readonly TrailPoint[] {
  const last = player.trail.at(-1);
  if (!last) return [];
  const points = [
    { x: last.x1, y: last.y1 },
    { x: last.x2, y: last.y2 },
  ];
  const distance = Math.hypot(player.x - last.x2, player.y - last.y2);
  if (
    phase === "playing" &&
    player.alive &&
    !last.detached &&
    last.createdTick === Math.floor(tick) &&
    player.portalCooldownUntilTick <= tick &&
    distance > 1e-6 &&
    // One step at most: the view says how far this rider goes on the next tick, whatever is speeding or slowing it.
    distance <= player.speed + 1e-6
  ) {
    points.push({ x: player.x, y: player.y });
  }
  return points;
}

interface MutableStroke {
  color: string;
  alive: boolean;
  paths: TrailPoint[][];
}
/** One rider's segments, grouped by detachment clock and split into paths. The full-rebuild definition. */
function groupStrokes(
  player: Rider,
  segments: readonly TrailSegment[],
  colorTick: number,
  rules: TrailFadeRules,
): MutableStroke[] {
  const groups: MutableStroke[] = [];
  let start = 0;
  // start <= i - 1; both indexes exist while i < segments.length.
  for (let i = 1; i <= segments.length; i++) {
    if (
      i < segments.length &&
      segments[i]!.detached?.decayStartTick ===
        segments[start]!.detached?.decayStartTick
    )
      continue;
    const section = segments.slice(start, i);
    if (section.length)
      groups.push({
        color: trailColor(
          player.color,
          player.alive,
          section[0],
          colorTick,
          rules,
        ),
        alive: player.alive && !section[0]!.detached,
        paths: trailPaths(section),
      });
    start = i;
  }
  return groups;
}

/** Full visible paths for continuous ribbon lighting, including a validated fractional tip. */
export function completeTrailStrokes(
  players: readonly Rider[],
  tick: number,
  phase: WorldView["phase"],
  rules: TrailFadeRules,
  colorTick = tick,
): TrailStroke[] {
  // Include the moving tip in the same ribbon: no end cap or lighting seam at
  // the boundary between established history and fractional presentation.
  return players.flatMap((player) => {
    const groups = groupStrokes(player, player.trail, colorTick, rules);
    const tip = trailTip(player, tick, phase);
    if (tip.length === 3) groups.at(-1)?.paths.at(-1)?.push(tip[2]!);
    return groups;
  });
}

/**
 * The established trail only — every segment but the volatile last one, and no tip. This is what
 * `TrailHistory.update` reproduces incrementally, and the reference its tests compare against.
 */
export function establishedTrailStrokes(
  players: readonly Rider[],
  tick: number,
  rules: TrailFadeRules,
): TrailStroke[] {
  return players.flatMap((player) =>
    groupStrokes(player, player.trail.slice(0, -1), tick, rules),
  );
}
