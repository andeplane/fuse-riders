import type { WorldView } from "../engine/view.js";

/**
 * The world between two frames, `alpha` of the way from `older` to `newer`, for drawing only. Things are matched by
 * id; one that appeared since `older` is placed back along its velocity, so a new bullet does not jump. Frames from
 * different rounds are not blended.
 */
export function blend(
  older: WorldView | null | undefined,
  newer: WorldView,
  alpha: number,
): WorldView {
  if (!older || older.seed !== newer.seed || alpha >= 1) return newer;
  const a = Math.max(0, Math.min(1, alpha)),
    mix = (from: number, to: number) => from + (to - from) * a,
    back = (newer.step - older.step) * (1 - a);
  const moved = <T extends { id: number | string; x: number; y: number }>(
    items: readonly T[],
    before: readonly T[],
    velocity: (item: T) => [number, number],
  ): T[] => {
    const earlier = new Map(before.map((item) => [item.id, item]));
    return items.map((item) => {
      const was = earlier.get(item.id);
      if (was) return { ...item, x: mix(was.x, item.x), y: mix(was.y, item.y) };
      const [vx, vy] = velocity(item);
      return { ...item, x: item.x - vx * back, y: item.y - vy * back };
    });
  };
  const still = (): [number, number] => [0, 0];
  return {
    ...newer,
    step: mix(older.step, newer.step),
    played: mix(older.played, newer.played),
    camX: mix(older.camX, newer.camX),
    crushX: mix(older.crushX, newer.crushX),
    choppers: moved(newer.choppers, older.choppers, (c) => [
      newer.scroll + c.vx,
      c.vy,
    ]),
    bullets: moved(newer.bullets, older.bullets, (b) => [b.vx, b.vy]),
    bolts: moved(newer.bolts, older.bolts, (b) => [b.vx, b.vy]),
    rocks: moved(newer.rocks, older.rocks, (r) => [r.vx, r.vy]),
    drones: moved(newer.drones, older.drones, (d) => [d.vx, d.vy]),
    pickups: moved(newer.pickups, older.pickups, still),
  };
}

/** How far between `older` and `newer` the presentation clock `tick` is, 0–1. */
export function fraction(
  olderTick: number | undefined,
  newerTick: number,
  tick: number,
): number {
  if (olderTick === undefined || newerTick <= olderTick) return 1;
  return Math.max(0, Math.min(1, (tick - olderTick) / (newerTick - olderTick)));
}
