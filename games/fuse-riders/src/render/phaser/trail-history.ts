/**
 * Append-only trail history: the one place that keeps mutable per-rider stroke state between frames.
 *
 * A trail is immutable once established — a tick adds one segment at the tail and expiry drops segments off
 * the head — so a frame does not have to re-derive every path. This cache keeps the grouped paths it built
 * last frame, drops what expired off the head, and builds only the segments that arrived since. Anything
 * else (a rollback, a clipped or eroded segment, a burnt hole, a detachment, a new rider, a new round)
 * falls back to a full rebuild for that rider, so the output is always exactly what the pure `trailPaths`
 * and `completeTrailStrokes` would have produced from scratch.
 *
 * What is deliberately *not* incremental:
 *  - The final segment of a trail is volatile: the local rider's speculative tip is rewritten every frame
 *    (`presentWorld`) and a remote rider's newest segment can still be corrected. It is kept out of the
 *    established history and folded back in per frame together with the fractional tip point.
 *  - A detached piece erodes at both ends and desaturates every tick while it fades, so it is rebuilt on
 *    every tick it is visible. Only the frames within one tick reuse it.
 */
import type { TrailSegment, WorldView } from "../../engine/view.js";
import {
  trailColor,
  trailTip,
  type TrailFadeRules,
  type TrailPoint,
  type TrailStroke,
} from "./trails.js";

type Rider = WorldView["players"][number];

/** One maximal run of segments sharing a detachment clock: the unit `trailColor` and `alive` are constant over. */
interface Group {
  count: number;
  /** The colour and liveness of a group come from its first segment, as a full rebuild would compute them. */
  first: TrailSegment;
  /** What an appended segment has to join onto. */
  last: TrailSegment;
  decayStartTick: number | undefined;
  detached: boolean;
  paths: TrailPoint[][];
  /** The stroke handed out; replaced only when the faded colour moves. */
  stroke: TrailStroke;
}

interface RiderHistory {
  id: string;
  color: string;
  alive: boolean;
  /** Every established segment in order: the rider's trail without its volatile final segment. */
  segments: TrailSegment[];
  groups: Group[];
}

/** A rollback and an eroded piece both show up here, so the comparison covers everything that is drawn. */
function sameSegment(a: TrailSegment, b: TrailSegment): boolean {
  return (
    a.x1 === b.x1 &&
    a.y1 === b.y1 &&
    a.x2 === b.x2 &&
    a.y2 === b.y2 &&
    a.createdTick === b.createdTick &&
    a.detached?.id === b.detached?.id &&
    a.detached?.decayStartTick === b.detached?.decayStartTick
  );
}

/** The cache owns its copy: a view handed to the renderer must never change under it. */
const copySegment = (segment: TrailSegment): TrailSegment => ({
  ...segment,
  ...(segment.detached ? { detached: { ...segment.detached } } : {}),
});

/** `trailPaths`' join rule, one segment at a time, so an append splits exactly where a rebuild would. */
const joins = (previous: TrailSegment, segment: TrailSegment): boolean =>
  segment.detached?.id === previous.detached?.id &&
  segment.createdTick === previous.createdTick + 1 &&
  Math.abs(previous.x2 - segment.x1) <= 1e-6 &&
  Math.abs(previous.y2 - segment.y1) <= 1e-6;

const start = (segment: TrailSegment): TrailPoint => ({
  x: segment.x1,
  y: segment.y1,
});
const end = (segment: TrailSegment): TrailPoint => ({
  x: segment.x2,
  y: segment.y2,
});

export interface TrailHistoryFrame {
  /** The established trail: no volatile last segment, no fractional tip. */
  strokes: readonly TrailStroke[];
  /** False when nothing established changed since the previous frame; `strokes` is then the same array. */
  changed: boolean;
  /** Established segments whose geometry this frame had to build. Diagnostics only. */
  built: number;
}

/**
 * Retains one scene's established trails across frames. One instance per scene; `reset()` on a new round,
 * match, scope change or snapshot install.
 */
export class TrailHistory {
  private scope: string | undefined;
  private riders: RiderHistory[] = [];
  private strokes: readonly TrailStroke[] = [];
  private built = 0;
  private changed = false;

  reset(): void {
    this.scope = undefined;
    this.riders = [];
    this.strokes = [];
    this.built = 0;
    this.changed = false;
  }

  /** Established history only: what the Canvas backend strokes into its retained `Graphics`. */
  update(
    players: readonly Rider[],
    scope: string,
    tick: number,
    rules: TrailFadeRules,
  ): TrailHistoryFrame {
    let changed = scope !== this.scope || players.length !== this.riders.length;
    if (scope !== this.scope) {
      this.reset();
      this.scope = scope;
    }
    let built = 0;
    const riders: RiderHistory[] = [];
    for (const [index, player] of players.entries()) {
      const previous = this.riders[index];
      const history = advance(previous, player, tick, rules);
      built += history.built;
      if (history.rider !== previous) changed = true;
      riders.push(history.rider);
    }
    this.riders = riders;
    this.built = built;
    this.changed = changed;
    if (!changed) return { strokes: this.strokes, changed: false, built: 0 };
    this.strokes = riders.flatMap((rider) =>
      rider.groups.map((group) => group.stroke),
    );
    return { strokes: this.strokes, changed: true, built };
  }

  /**
   * Established history plus the volatile tail — the final segment and the validated fractional tip in the
   * same ribbon, so the WebGL backend draws no cap or lighting seam between cached history and what moves.
   */
  complete(
    players: readonly Rider[],
    scope: string,
    tick: number,
    phase: WorldView["phase"],
    rules: TrailFadeRules,
    colorTick = tick,
  ): readonly TrailStroke[] {
    this.update(players, scope, colorTick, rules);
    const strokes: TrailStroke[] = [];
    for (const [index, player] of players.entries()) {
      const history = this.riders[index]!;
      const groups = history.groups.map((group) => group.stroke);
      const last = player.trail.at(-1);
      if (!last) {
        strokes.push(...groups);
        continue;
      }
      const previous = history.segments.at(-1);
      const tail = groups[groups.length - 1];
      const continues =
        tail !== undefined &&
        previous !== undefined &&
        last.detached?.decayStartTick === previous.detached?.decayStartTick;
      const joined = continues && joins(previous, last);
      const trailing: TrailPoint[] = joined
        ? [...tail.paths[tail.paths.length - 1]!, end(last)]
        : [start(last), end(last)];
      // One step at most, and only for a tip the view itself validates.
      const tip = trailTip(player, tick, phase);
      if (tip.length === 3) trailing.push(tip[2]!);
      if (continues)
        groups[groups.length - 1] = {
          color: tail.color,
          alive: tail.alive,
          paths: [...(joined ? tail.paths.slice(0, -1) : tail.paths), trailing],
        };
      else
        groups.push({
          color: trailColor(player.color, player.alive, last, colorTick, rules),
          alive: player.alive && !last.detached,
          paths: [trailing],
        });
      strokes.push(...groups);
    }
    return strokes;
  }

  /** Established segments whose geometry the last `update` built. Diagnostics for the benchmark. */
  builtLastFrame(): number {
    return this.built;
  }

  /** Whether the last `update` (including the one inside `complete`) found anything established changed. */
  changedLastFrame(): boolean {
    return this.changed;
  }
}

function newGroup(segment: TrailSegment): Group {
  const paths: TrailPoint[][] = [[start(segment), end(segment)]];
  return {
    count: 1,
    first: segment,
    last: segment,
    decayStartTick: segment.detached?.decayStartTick,
    detached: segment.detached !== undefined,
    paths,
    // Replaced by `recolor` before the group is ever handed out.
    stroke: { color: "", alive: false, paths },
  };
}

/** Grows a group in place while it is still being built; never called on a group a frame already saw. */
function push(group: Group, segment: TrailSegment): void {
  if (joins(group.last, segment)) group.paths.at(-1)!.push(end(segment));
  else group.paths.push([start(segment), end(segment)]);
  group.last = segment;
  group.count++;
}

/** Segments into groups and paths from scratch: the definition every incremental path has to reproduce. */
function build(segments: readonly TrailSegment[]): Group[] {
  const groups: Group[] = [];
  for (const segment of segments) {
    const tail = groups[groups.length - 1];
    if (tail && segment.detached?.decayStartTick === tail.decayStartTick)
      push(tail, segment);
    else groups.push(newGroup(segment));
  }
  return groups;
}

/**
 * How many established segments expired off the head since the last frame, or -1 when the retained history
 * is not a prefix-aligned window of the new trail and this rider has to be rebuilt. A rewind, an eroded
 * detached piece and a gun-cut hole all land on -1.
 */
function expiredCount(
  segments: readonly TrailSegment[],
  trail: readonly TrailSegment[],
  length: number,
): number {
  const retained = segments.length;
  if (!retained) return 0;
  if (!length) return retained;
  const head = trail[0]!;
  for (let dropped = 0; dropped < retained; dropped++) {
    if (!sameSegment(segments[dropped]!, head)) continue;
    // A segment carries the tick it was made on, so the trail's head appears at most once in the window.
    if (retained - dropped > length) return -1;
    for (let i = 1; i < retained - dropped; i++)
      if (!sameSegment(segments[dropped + i]!, trail[i]!)) return -1;
    return dropped;
  }
  return -1;
}

/** Drops expired segments off the front, rebuilding at most the single group they straddle. */
function dropHead(
  groups: readonly Group[],
  segments: readonly TrailSegment[],
  dropped: number,
): { groups: Group[]; built: number } {
  let remaining = dropped;
  let offset = 0;
  for (const [index, group] of groups.entries()) {
    if (remaining >= group.count) {
      remaining -= group.count;
      offset += group.count;
      continue;
    }
    if (!remaining) return { groups: groups.slice(index), built: 0 };
    const kept = segments.slice(offset + remaining, offset + group.count);
    return {
      groups: [...build(kept), ...groups.slice(index + 1)],
      built: kept.length,
    };
  }
  return { groups: [], built: 0 };
}

/**
 * The append itself: each new segment extends the trailing path, starts a new path in the trailing group,
 * or opens a new group. A missing tick is a real hole even at a crossing, so the split follows the same
 * rule `trailPaths` applies rather than assuming the tail is continuous.
 */
function extend(groups: Group[], appended: readonly TrailSegment[]): void {
  for (const segment of appended) {
    const tail = groups[groups.length - 1];
    if (!tail || segment.detached?.decayStartTick !== tail.decayStartTick) {
      groups.push(newGroup(segment));
      continue;
    }
    // The trailing path array is the one last frame's stroke handed out; copy before extending it.
    const paths = tail.paths.slice();
    if (joins(tail.last, segment))
      paths[paths.length - 1] = [...paths[paths.length - 1]!, end(segment)];
    else paths.push([start(segment), end(segment)]);
    const group: Group = {
      ...tail,
      count: tail.count + 1,
      last: segment,
      paths,
      stroke: { ...tail.stroke, paths },
    };
    groups[groups.length - 1] = group;
  }
}

/** Geometry is untouched; only a fading piece's colour moves, so only its stroke object is replaced. */
function recolor(
  groups: Group[],
  player: Rider,
  tick: number,
  rules: TrailFadeRules,
): boolean {
  let changed = false;
  for (const [index, group] of groups.entries()) {
    const color = trailColor(
      player.color,
      player.alive,
      group.first,
      tick,
      rules,
    );
    const alive = player.alive && !group.detached;
    if (
      group.stroke.color === color &&
      group.stroke.alive === alive &&
      group.stroke.paths === group.paths
    )
      continue;
    changed = true;
    groups[index] = { ...group, stroke: { color, alive, paths: group.paths } };
  }
  return changed;
}

/** One rider, one frame: reuse, extend, or rebuild. Returns the previous history when nothing changed. */
function advance(
  previous: RiderHistory | undefined,
  player: Rider,
  tick: number,
  rules: TrailFadeRules,
): { rider: RiderHistory; built: number } {
  const length = Math.max(0, player.trail.length - 1);
  const reusable =
    previous &&
    previous.id === player.id &&
    previous.color === player.color &&
    previous.alive === player.alive
      ? previous
      : undefined;
  const dropped = reusable
    ? expiredCount(reusable.segments, player.trail, length)
    : -1;
  if (dropped < 0) {
    const segments: TrailSegment[] = [];
    for (let i = 0; i < length; i++)
      segments.push(copySegment(player.trail[i]!));
    const groups = build(segments);
    recolor(groups, player, tick, rules);
    return {
      rider: {
        id: player.id,
        color: player.color,
        alive: player.alive,
        segments,
        groups,
      },
      built: length,
    };
  }
  const kept = reusable!;
  const retained = kept.segments.length - dropped;
  const appended = length - retained;
  if (!dropped && !appended) {
    const groups = kept.groups.slice();
    if (!recolor(groups, player, tick, rules)) return { rider: kept, built: 0 };
    return { rider: { ...kept, groups }, built: 0 };
  }
  const head = dropHead(kept.groups, kept.segments, dropped);
  const segments = kept.segments.slice(dropped);
  for (let i = 0; i < appended; i++)
    segments.push(copySegment(player.trail[retained + i]!));
  extend(head.groups, segments.slice(retained));
  recolor(head.groups, player, tick, rules);
  return {
    rider: {
      id: player.id,
      color: player.color,
      alive: player.alive,
      segments,
      groups: head.groups,
    },
    built: head.built + appended,
  };
}
