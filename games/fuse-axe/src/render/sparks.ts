import { FX_LIFE } from "../engine/view-kit.js";
import type { FxView } from "../engine/view.js";
import { UNLIT } from "./pixel/palette.js";
import { fill, type Pen } from "./pen.js";

/**
 * Hit sparks, drawn per frame from the view's fx by their `age` in steps: a light hit is a small white flash with
 * neon rays, a heavy one a bigger burst with a ring, a knockout a spinning burst of stars. Each is a pure function of
 * the fx and the camera, so every device shows the same spark, and none draws outside its life.
 */
const glow = (key: string) => UNLIT[key]!;
const [WHITE, CYAN, PINK, GOLD, EMBER] = [
  glow("Z"),
  glow("G"),
  glow("P"),
  glow("D"),
  glow("f"),
] as const;
/** The eight directions a burst's rays fly in. */
const RAYS = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
] as const;
/** Steps a light hit's spark lasts; heavy hits and knockouts burst for the whole `FX_LIFE`. */
export const HIT_STEPS = 10;

export function drawSpark<Image>(
  pen: Pen<Image>,
  fx: FxView,
  camX: number,
): void {
  const { age } = fx;
  if (!(age >= 0 && age < FX_LIFE)) return;
  const [cx, cy] = [Math.floor(fx.x - camX), Math.floor(fx.y - fx.z)];
  const dot = (x: number, y: number, color: string, size = 1) => {
    pen.fillStyle = color;
    const half = size >> 1;
    fill(pen, cx + Math.round(x) - half, cy + Math.round(y) - half, size, size);
  };
  /** Each ray's last `length` pixels out to `reach`, diagonals shortened to keep the burst round. */
  const rays = (reach: number, length: number, color: (i: number) => string) =>
    RAYS.forEach(([dx, dy], i) => {
      const k = dx && dy ? 0.7 : 1;
      for (let s = reach - length + 1; s <= reach; s++)
        dot(dx * s * k, dy * s * k, color(i));
    });
  const ring = (radius: number, points: number, color: string, every = 1) => {
    for (let i = 0; i < points; i += every) {
      const a = (i / points) * 2 * Math.PI;
      dot(Math.cos(a) * radius, Math.sin(a) * radius, color);
    }
  };
  switch (fx.kind) {
    case "hit":
      if (age >= HIT_STEPS) return;
      if (age < 3) dot(0, 0, WHITE, age < 2 ? 5 : 3);
      rays(3 + age, 3, (i) => (age < 3 ? WHITE : i % 2 ? PINK : CYAN));
      return;
    case "heavy":
      if (age < 3) dot(0, 0, WHITE, 5);
      if (age < 12)
        rays(3 + Math.floor(age * 0.9), 3, () => (age < 4 ? WHITE : GOLD));
      ring(2 + age * 0.7, 24, age < 8 ? PINK : CYAN, age > 10 ? 2 : 1);
      return;
    case "ko":
      if (age < 2) dot(0, 0, WHITE, 5);
      if (age < 10) ring(age * 1.1, 12, EMBER);
      for (let k = 0; k < 5; k++) {
        if (age > 12 && (k + age) % 2) continue;
        const a = ((-90 + 72 * k + age * 6) * Math.PI) / 180;
        const [x, y] = [
          Math.cos(a) * (3 + age * 0.8),
          Math.sin(a) * (3 + age * 0.8),
        ];
        for (const [dx, dy] of RAYS.filter(([u, v]) => !(u && v)))
          dot(x + dx, y + dy, GOLD);
        dot(x, y, WHITE);
      }
      return;
    default:
      fx.kind satisfies never;
  }
}
