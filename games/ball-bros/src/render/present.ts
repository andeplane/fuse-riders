import type { BallView } from "../engine/view.js";
/** Cosmetic interpolation only. Never interpolate across a restart or a held/free transition. */
export function interpolate(
  older: BallView | undefined,
  newer: BallView,
  tick: number,
): BallView {
  if (
    !older?.arena ||
    !newer.arena ||
    older.matchId !== newer.matchId ||
    newer.tick <= older.tick ||
    newer.tick - older.tick > 2
  )
    return newer;
  const t = Math.max(
    0,
    Math.min(1, (tick - older.tick) / (newer.tick - older.tick)),
  );
  const result = structuredClone(newer);
  for (const b of result.arena!.bases) {
    const old = older.arena.bases.find((o) => o.id === b.id);
    if (!old || old.alive !== b.alive) continue;
    const delta =
      ((b.angle - old.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    b.angle = old.angle + delta * t;
    b.radius = old.radius + (b.radius - old.radius) * t;
    b.x = old.x + (b.x - old.x) * t;
    b.y = old.y + (b.y - old.y) * t;
  }
  for (const b of result.arena!.balls) {
    const old = older.arena.balls.find((o) => o.id === b.id);
    if (
      !old ||
      old.held !== b.held ||
      old.owner !== b.owner ||
      Math.hypot(b.x - old.x, b.y - old.y) > 45
    )
      continue;
    b.x = old.x + (b.x - old.x) * t;
    b.y = old.y + (b.y - old.y) * t;
  }
  return result;
}
export const COLORS = [0x35d9ff, 0xff429a, 0xb1ef3c, 0xffa43d, 0xbb79ff];
/** rAF timestamps can precede an event's performance.now() within the same frame. */
export const effectAge = (
  now: number,
  born: number,
  duration: number,
): number => Math.max(0, Math.min(1, (now - born) / duration));
export const colorCss = (slot: number): string =>
  `#${(COLORS[slot] ?? 0xc7d7eb).toString(16).padStart(6, "0")}`;
