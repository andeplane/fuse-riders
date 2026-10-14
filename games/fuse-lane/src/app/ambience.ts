import { CITY, type City, type MapPoint } from "../game/index.js";
import {
  bounds,
  inside,
  toScreen,
  type BoardView,
  type Camera,
  type Point,
} from "./layout.js";

/**
 * The town's light and life, drawn over the city's picture without touching it: the sun glinting on the bay, cloud
 * shadows drifting over the roofs, the light of the week going golden and then dusky as the hours run out, the way
 * you are walking, and a little burst when someone walks into a place. Looks only: nothing here reads or changes the
 * game, and every effect is a pure function of the time it is given, so a frame can be redrawn at any moment.
 */

const clamp = (value: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, value));

/** A repeatable pseudo-random number in 0..1 for `n`. */
export const noise = (n: number): number => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** A spot where the sun glints on the water: where, its phase and period in seconds, and its length in map px. */
export interface Glint {
  at: MapPoint;
  phase: number;
  period: number;
  size: number;
}

/** Fixed glint spots spread over the city's open water (none on the boats, piers and rocks in it). */
export function glints(city: City = CITY, count = 90): Glint[] {
  const water = city.water;
  if (!water) return [];
  const box = bounds(water.shape),
    found: Glint[] = [];
  for (let k = 0; found.length < count && k < count * 20; k++) {
    const at: MapPoint = [
      box.x + noise(k * 2 + 1) * box.w,
      box.y + noise(k * 2 + 2) * box.h,
    ];
    if (!inside(water.shape, at) || water.holes.some((h) => inside(h, at)))
      continue;
    found.push({
      at,
      phase: noise(k + 0.5) * Math.PI * 2,
      period: 2.2 + noise(k + 7.3) * 2.6,
      size: 5 + noise(k + 3.1) * 8,
    });
  }
  return found;
}

/** How brightly a glint shines at `time`: dark most of the time, a short twinkle once a period. */
export function glintLight(glint: Glint, time: number): number {
  const wave = Math.sin((time / glint.period) * Math.PI * 2 + glint.phase);
  return wave > 0.6 ? ((wave - 0.6) / 0.4) ** 2 : 0;
}

/** The sun on the water: short bright strokes that come and go. */
export function drawGlints(
  c: CanvasRenderingContext2D,
  view: BoardView,
  camera: Camera,
  spots: readonly Glint[],
  time: number,
): void {
  c.save();
  c.lineCap = "round";
  for (const glint of spots) {
    const light = glintLight(glint, time);
    if (light <= 0) continue;
    const at = toScreen(view, camera, glint.at);
    if (
      at.x < -20 ||
      at.y < -20 ||
      at.x > view.width + 20 ||
      at.y > view.height + 20
    )
      continue;
    const half = glint.size * view.scale * (0.4 + 0.35 * light);
    c.strokeStyle = `rgba(255, 255, 255, ${0.75 * light})`;
    c.lineWidth = Math.max(1, 2 * view.scale);
    c.beginPath();
    c.moveTo(at.x - half, at.y);
    c.lineTo(at.x + half, at.y);
    c.stroke();
  }
  c.restore();
}

/** Where a drifting cloud's shadow is at `time`, in map px, and its radius: they cross the town slowly, west to east. */
export function cloudAt(
  index: number,
  time: number,
  city: City = CITY,
): { at: MapPoint; radius: number } {
  const { width, height } = city.map;
  const radius = 230 + 70 * (index % 3),
    speed = 7 + 3 * noise(index + 0.25),
    span = width + radius * 2,
    x = ((time * speed + noise(index + 0.75) * span) % span) - radius,
    y = height * (0.15 + 0.32 * index) + Math.sin(time * 0.03 + index) * 40;
  return { at: [x, y], radius };
}

/** Soft cloud shadows drifting over the town. */
export function drawCloudShadows(
  c: CanvasRenderingContext2D,
  view: BoardView,
  camera: Camera,
  time: number,
  count = 3,
): void {
  c.save();
  for (let k = 0; k < count; k++) {
    const cloud = cloudAt(k, time),
      at = toScreen(view, camera, cloud.at),
      r = cloud.radius * view.scale;
    c.save();
    c.translate(at.x, at.y);
    c.scale(1, 0.62);
    const shade = c.createRadialGradient(0, 0, r * 0.2, 0, 0, r);
    shade.addColorStop(0, "rgba(24, 34, 60, 0.085)");
    shade.addColorStop(1, "rgba(24, 34, 60, 0)");
    c.fillStyle = shade;
    c.beginPath();
    c.arc(0, 0, r, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }
  c.restore();
}

/**
 * How far into the evening the week is, 0..1, from the share of its hours left: plain daylight until 40 % is left,
 * then slowly golden, and dusky over the last hours.
 */
export const evening = (left: number): number =>
  clamp((0.4 - left) / 0.4, 0, 1);

/** The week's light over the board: a golden late afternoon, then a dusky evening with darker edges. */
export function drawDaylight(
  c: CanvasRenderingContext2D,
  view: BoardView,
  left: number,
): void {
  const dusk = evening(left);
  if (dusk <= 0) return;
  c.save();
  c.globalCompositeOperation = "multiply";
  c.fillStyle = `rgba(255, 190, 130, ${0.26 * dusk})`;
  c.fillRect(0, 0, view.width, view.height);
  const night = clamp((dusk - 0.55) / 0.45, 0, 1);
  if (night > 0) {
    c.fillStyle = `rgba(120, 120, 210, ${0.2 * night})`;
    c.fillRect(0, 0, view.width, view.height);
  }
  c.globalCompositeOperation = "source-over";
  const r = Math.hypot(view.width, view.height) / 2,
    edge = c.createRadialGradient(
      view.width / 2,
      view.height / 2,
      r * 0.45,
      view.width / 2,
      view.height / 2,
      r,
    );
  edge.addColorStop(0, "rgba(40, 24, 60, 0)");
  edge.addColorStop(1, `rgba(40, 24, 60, ${0.28 * dusk})`);
  c.fillStyle = edge;
  c.fillRect(0, 0, view.width, view.height);
  c.restore();
}

/**
 * The way you are walking, from where you are to the door: a white-edged dotted line in your colour that marches
 * toward the place, and a ring at the door.
 */
export function drawRoute(
  c: CanvasRenderingContext2D,
  points: readonly Point[],
  color: string,
  scale: number,
  time: number,
  still = false,
): void {
  if (points.length < 2) return;
  const width = Math.max(3, 6 * scale);
  c.save();
  c.lineCap = "round";
  c.lineJoin = "round";
  const path = () => {
    c.beginPath();
    points.forEach((p, k) =>
      k === 0 ? c.moveTo(p.x, p.y) : c.lineTo(p.x, p.y),
    );
  };
  path();
  c.strokeStyle = "rgba(255, 255, 255, 0.55)";
  c.lineWidth = width + 4;
  c.stroke();
  path();
  c.setLineDash([0.1, width * 2.2]);
  c.lineDashOffset = still ? 0 : -time * width * 4;
  c.strokeStyle = color;
  c.lineWidth = width;
  c.stroke();
  c.setLineDash([]);
  const end = points[points.length - 1]!,
    pulse = still ? 0.5 : 0.5 + 0.5 * Math.sin(time * 5),
    rx = (12 + 5 * pulse) * Math.max(0.6, scale * 1.4);
  c.beginPath();
  c.ellipse(end.x, end.y, rx, rx * 0.45, 0, 0, Math.PI * 2);
  c.lineWidth = Math.max(2, 3 * scale);
  c.strokeStyle = "#fff";
  c.stroke();
  c.beginPath();
  c.ellipse(end.x, end.y, rx * 0.7, rx * 0.32, 0, 0, Math.PI * 2);
  c.fillStyle = color;
  c.globalAlpha = 0.85;
  c.fill();
  c.restore();
}

/** How long an arrival's burst lasts, in seconds. */
export const BURST = 0.8;

/** Someone walked into a place: a ring opening from where they stand and a few sparks flying out. */
export function drawBurst(
  c: CanvasRenderingContext2D,
  at: Point,
  age: number,
  color: string,
  scale: number,
): void {
  const t = age / BURST;
  if (t < 0 || t >= 1) return;
  const ease = 1 - (1 - t) ** 3,
    size = Math.max(0.6, scale * 1.4),
    r = (8 + 34 * ease) * size;
  c.save();
  c.globalAlpha = 1 - t;
  c.lineWidth = Math.max(2, 4 * (1 - t) * size);
  c.strokeStyle = color;
  c.beginPath();
  c.ellipse(at.x, at.y, r, r * 0.45, 0, 0, Math.PI * 2);
  c.stroke();
  c.fillStyle = "#fff";
  for (let k = 0; k < 7; k++) {
    const angle = (k / 7) * Math.PI * 2 + 0.4,
      reach = (10 + 30 * ease) * size;
    c.beginPath();
    c.arc(
      at.x + Math.cos(angle) * reach,
      at.y - 14 * size * ease + Math.sin(angle) * reach * 0.5,
      Math.max(1.2, 3 * (1 - t) * size),
      0,
      Math.PI * 2,
    );
    c.fill();
  }
  c.restore();
}
