import type { WorldView } from "../engine/view.js";

/**
 * The world between two frames, `alpha` of the way from `older` to `newer`, for drawing only. Trains and carts are
 * matched by id and wagons by their place in the train; anything new since `older` is drawn where `newer` has it.
 * Frames from different rounds are not blended.
 */
export function blend(
  older: WorldView | null | undefined,
  newer: WorldView,
  alpha: number,
): WorldView {
  if (!older || older.seed !== newer.seed || alpha >= 1) return newer;
  const a = Math.max(0, Math.min(1, alpha)),
    mix = (from: number, to: number) => from + (to - from) * a;
  const before = new Map(older.trains.map((t) => [t.id, t]));
  const carts = new Map(older.carts.map((c) => [c.id, c]));
  return {
    ...newer,
    step: mix(older.step, newer.step),
    played: mix(older.played, newer.played),
    trains: newer.trains.map((train) => {
      const was = before.get(train.id);
      // A bump or a wall can turn a train sharply between two frames: past a quarter turn, it just turns.
      if (!was || was.hx * train.hx + was.hy * train.hy < 0) return train;
      return {
        ...train,
        x: mix(was.x, train.x),
        y: mix(was.y, train.y),
        hx: mix(was.hx, train.hx),
        hy: mix(was.hy, train.hy),
        wagons: train.wagons.map((wagon, index) => {
          const old = was.wagons[index];
          return old
            ? {
                ...wagon,
                x: mix(old.x, wagon.x),
                y: mix(old.y, wagon.y),
                hx: mix(old.hx, wagon.hx),
                hy: mix(old.hy, wagon.hy),
              }
            : wagon;
        }),
      };
    }),
    carts: newer.carts.map((cart) => {
      const was = carts.get(cart.id);
      return was
        ? { ...cart, x: mix(was.x, cart.x), y: mix(was.y, cart.y) }
        : cart;
    }),
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
