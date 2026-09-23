import type { WorldView } from "../engine/view.js";

/** Presentation only. Never blend a new trial, a split child or a respawning body. */
export function interpolate(
  older: WorldView | undefined,
  newer: WorldView,
  tick: number,
): WorldView {
  if (
    !older ||
    older.experiment !== newer.experiment ||
    newer.combat.hits < older.combat.hits ||
    newer.deaths !== older.deaths ||
    Math.abs(newer.x - older.x) > 80 ||
    Math.abs(newer.feet - older.feet) > 80
  )
    return newer;
  const t = Math.max(
    0,
    Math.min(1, (tick - older.tick) / Math.max(1, newer.tick - older.tick)),
  );
  const lerp = (a: number, b: number) => a + (b - a) * t;
  const before = older.combat.target,
    after = newer.combat.target;
  const target =
    before &&
    after &&
    !before.respawn &&
    !after.respawn &&
    older.combat.falls === newer.combat.falls &&
    Math.hypot(after.x - before.x, after.feet - before.feet) < 80
      ? {
          ...after,
          x: lerp(before.x, after.x),
          feet: lerp(before.feet, after.feet),
        }
      : after;
  return {
    ...newer,
    keepers: newer.keepers.map((k) => {
      const old = older.keepers.find((p) => p.id === k.id && p.slot === k.slot);
      return { ...k, body: interpolate(old?.body, k.body, tick) };
    }),
    x: lerp(older.x, newer.x),
    feet: lerp(older.feet, newer.feet),
    combat: {
      ...newer.combat,
      target,
      balls: newer.combat.balls.map((b) => {
        const a = older.combat.balls.find((a) => a.id === b.id);
        return a && Math.hypot(b.x - a.x, b.y - a.y) < 80
          ? { ...b, x: lerp(a.x, b.x), y: lerp(a.y, b.y) }
          : b;
      }),
    },
  };
}
