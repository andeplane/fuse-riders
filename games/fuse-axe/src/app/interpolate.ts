import type { FrameTiming } from "fuse-netcode";
import type { WorldView } from "../engine/view.js";
import type { View } from "../online/game.js";

/**
 * The world a frame draws. The log advances every 50 ms, so showing its newest tick would move a walking hero in steps
 * of three simulation steps twenty times a second; the runtime instead offers the two newest ticks and a fractional
 * tick between them, and this blends their positions. The picture only: nothing here is simulation, and nothing
 * leaves the screen.
 */

/** How far between `older` and `newer` the presentation clock `tick` is, 0 to 1; 1 when there is nothing to blend. */
export function fraction(
  olderTick: number | undefined,
  newerTick: number,
  tick: number,
): number {
  if (olderTick === undefined || newerTick <= olderTick) return 1;
  return Math.max(0, Math.min(1, (tick - olderTick) / (newerTick - olderTick)));
}

/**
 * The world `alpha` of the way from `older` to `newer`. Figures are matched by id; one that appeared since `older`
 * stays where it is. A figure moves in screen space (`x − camX`) and lands back on a whole pixel, as the view
 * promises, so a hero walking with the camera shares the backdrop's pixel offset instead of shimmering against it.
 * A hero that dropped back in since `older` is placed where it dropped, like one that appeared. Items on the floor
 * blend as figures do, so a pot popping out of a sack rises and falls smoothly. Sparks stand where they struck, and
 * every other value is `newer`'s.
 */
export function blend(
  older: WorldView,
  newer: WorldView,
  alpha: number,
): WorldView {
  if (alpha >= 1) return newer;
  const a = Math.max(0, alpha),
    mix = (from: number, to: number) => Math.round(from + (to - from) * a),
    camX = mix(older.camX, newer.camX);
  const moved = <T extends { id: number; x: number; y: number; z: number }>(
    items: readonly T[],
    before: readonly T[],
    jumped: (prev: T, item: T) => boolean = () => false,
  ): T[] => {
    const was = new Map(before.map((item) => [item.id, item]));
    return items.map((item) => {
      const prev = was.get(item.id);
      return prev && !jumped(prev, item)
        ? {
            ...item,
            x: camX + mix(prev.x - older.camX, item.x - newer.camX),
            y: mix(prev.y, item.y),
            z: mix(prev.z, item.z),
          }
        : item;
    });
  };
  return {
    ...newer,
    camX,
    // A hero dropping back in is placed at its drop point, not carried there from where it fell.
    heroes: moved(
      newer.heroes,
      older.heroes,
      (prev, item) => item.anim === "respawn" && prev.anim !== "respawn",
    ),
    enemies: moved(newer.enemies, older.enemies),
    items: moved(newer.items, older.items),
  };
}

/** What to draw for `timing`: the blend of its two frames, or the newer one alone across a run or stage change. */
export function drawn(
  timing: Pick<FrameTiming<View>, "older" | "newer" | "tick"> | undefined,
): WorldView | null {
  const world = timing?.newer.world;
  if (!timing || !world) return null;
  const { older, newer } = timing;
  if (
    !older?.world ||
    older.matchId !== newer.matchId ||
    older.round !== newer.round
  )
    return world;
  return blend(
    older.world,
    world,
    fraction(older.tick, newer.tick, timing.tick),
  );
}
