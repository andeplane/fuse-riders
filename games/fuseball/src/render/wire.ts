import {
  VIEW_H,
  VIEW_W,
  isCircle,
  type MapDef,
  type MapId,
  type Rect,
} from "../engine/view-kit.js";
import { TEAM, TEAM_LIGHT, WHITE, hexA } from "./palette.js";
import type { Paint } from "./sprites.js";

/**
 * The outline look, and the liquids. The arcade arenas (Quad Core, Bitstream, Memory Leak) are drawn the way the
 * cabinet that inspired them draws its own: thin pale outlines on black, grass along the top of every floor and
 * pad, and a skull in each goal. It is a look only: every line is on the edge of the solid the rules use.
 *
 * Goo and jets are drawn the same way on any arena that has them, in the team colour their `hue` names.
 */
const WIRE: ReadonlySet<MapId> = new Set<MapId>([
  "quadcore",
  "bitstream",
  "memoryleak",
]);
export const isWire = (map: MapDef): boolean => WIRE.has(map.id);

export const WIRE_BACK = "#01020a";
const WIRE_LINE = "#d6c9ff",
  WIRE_BODY = "#03040f",
  TAU = Math.PI * 2;

/** A rect where it is, and again one field back on each wrapping axis it runs past the end of. */
function wrapped(map: Pick<MapDef, "wrapX" | "wrapY">, r: Rect): Rect[] {
  const xs = map.wrapX && r.x + r.w > VIEW_W ? [r.x, r.x - VIEW_W] : [r.x],
    ys = map.wrapY && r.y + r.h > VIEW_H ? [r.y, r.y - VIEW_H] : [r.y];
  return xs.flatMap((x) => ys.map((y) => ({ ...r, x, y })));
}

/** How tall the blade of grass at `x` is: the same every frame, and uneven enough to read as a tuft. */
const blade = (x: number): number => 1 + ((x * 7 + (x >> 2) * 3) % 4);

interface Turf {
  x: number;
  y: number;
  h: number;
}
const TURF = new WeakMap<MapDef, readonly Turf[]>();
/**
 * The grass of an arena: a blade every other pixel along the top of each solid wide enough to stand about on,
 * except under another solid or right under the roof.
 */
function turfOf(map: MapDef): readonly Turf[] {
  const known = TURF.get(map);
  if (known) return known;
  const all = map.solids.flatMap((solid) => wrapped(map, solid)),
    covered = (x: number, y: number) =>
      all.some(
        (s) => x >= s.x && x < s.x + s.w && y >= s.y - 1 && y < s.y + s.h,
      ),
    turf: Turf[] = [];
  for (const s of all) {
    if (s.w < 40 || s.y < 24 || s.y >= VIEW_H) continue;
    for (let x = s.x + 3; x < s.x + s.w - 3; x += 2)
      if (!covered(x, s.y - 3)) turf.push({ x, y: s.y - 1, h: blade(x) });
  }
  TURF.set(map, turf);
  return turf;
}

/** The solids as outlines: every line first, then the bodies over them, so solids that touch read as one shape. */
export function wireSolids(g: Paint, map: MapDef): void {
  const all = map.solids.flatMap((solid) => wrapped(map, solid));
  g.fillStyle = hexA(WIRE_LINE, 0.16);
  for (const s of all) g.fillRect(s.x - 2.5, s.y - 2.5, s.w + 5, s.h + 5);
  g.fillStyle = WIRE_LINE;
  for (const s of all) g.fillRect(s.x - 1, s.y - 1, s.w + 2, s.h + 2);
  g.fillStyle = WIRE_BODY;
  for (const s of all) g.fillRect(s.x, s.y, s.w, s.h);
  g.fillStyle = WIRE_LINE;
  for (const t of turfOf(map)) g.fillRect(t.x, t.y - t.h, 1, t.h);
}

const SKULL = [
  ".#####.",
  "#######",
  "#..#..#",
  "#..#..#",
  "#######",
  ".##.##.",
  ".#####.",
  ".#.#.#.",
];
/** A skull low in every goal slot wide enough for one: what is on the far side of it for the rider who loses. */
export function skulls(g: Paint, map: MapDef): void {
  g.fillStyle = WHITE;
  for (const goal of map.goals) {
    if (isCircle(goal) || goal.w < 9 || goal.h < 40) continue;
    const left = Math.round(goal.x + goal.w / 2 - 3.5),
      top = goal.y + goal.h - 22;
    SKULL.forEach((row, y) => {
      for (let x = 0; x < row.length; x++)
        if (row[x] === "#") g.fillRect(left + x, top + y, 1, 1);
    });
  }
}

/**
 * Goo and jets. A pool has a rippling surface and bubbles rising through it; where it hangs through the roof (the
 * other end of a pool across the seam) it drips. A jet is a column running upwards with a crown of spray on top.
 */
export function liquids(g: Paint, map: MapDef, now: number): void {
  for (const goo of map.goo) {
    const color = TEAM[goo.hue],
      light = TEAM_LIGHT[goo.hue];
    for (const r of wrapped(map, goo)) {
      const top = Math.max(0, r.y),
        bottom = Math.min(VIEW_H, r.y + r.h);
      g.fillStyle = hexA(color, 0.22);
      g.fillRect(r.x, top, r.w, bottom - top);
      if (r.y <= 0) {
        // Hanging from the roof: a ragged lower edge and drops falling from it.
        g.fillStyle = color;
        for (let x = r.x + 1; x < r.x + r.w - 1; x += 2)
          g.fillRect(
            x,
            bottom - 1,
            2,
            1.5 + 1.5 * Math.sin(x * 0.9 + now / 400) + (x % 6 === 0 ? 2 : 0),
          );
        for (let i = 0; i < 3; i++) {
          const fall = (now / 900 + i * 0.37) % 1;
          g.fillStyle = hexA(color, 0.9 * (1 - fall));
          g.fillRect(
            r.x + 6 + ((i * 17) % (r.w - 12)),
            bottom + 2 + fall * fall * 46,
            2,
            3,
          );
        }
        continue;
      }
      g.fillStyle = color;
      for (let x = r.x; x < r.x + r.w; x += 2)
        g.fillRect(x, top + 1.5 * Math.sin(x * 0.45 + now / 260), 2, 1.5);
      g.strokeStyle = hexA(light, 0.8);
      g.lineWidth = 1;
      for (let i = 0; i < 4; i++) {
        const rise = (now / 1600 + i * 0.29) % 1,
          y = bottom - 2 - rise * (bottom - top - 6);
        g.beginPath();
        g.arc(
          r.x + 6 + ((i * 13) % (r.w - 12)) + Math.sin(now / 300 + i),
          y,
          1 + (i % 2),
          0,
          TAU,
        );
        g.stroke();
      }
    }
  }
  for (const stream of map.streams) {
    const color = TEAM[stream.hue],
      light = TEAM_LIGHT[stream.hue];
    for (const r of wrapped(map, stream)) {
      const mid = r.x + r.w / 2;
      g.fillStyle = hexA(color, 0.2);
      g.fillRect(r.x, r.y, r.w, r.h);
      // Both edges waver, and dashes run up the middle.
      g.fillStyle = color;
      for (let y = r.y; y < r.y + r.h; y += 2) {
        const sway = Math.sin(y * 0.5 - now / 90);
        g.fillRect(r.x + sway, y, 1.5, 2);
        g.fillRect(r.x + r.w - 1.5 - sway, y, 1.5, 2);
      }
      g.fillStyle = hexA(light, 0.85);
      const run = (now / 14) % 12;
      for (let y = r.y + r.h - run; y > r.y; y -= 12)
        g.fillRect(mid - 0.5, y, 1, 5);
      // The crown: spray thrown up and out from the top, falling back.
      for (let i = 0; i < 6; i++) {
        const t = (now / 520 + i / 6) % 1,
          side = i % 2 ? 1 : -1;
        g.fillStyle = hexA(color, 1 - t);
        g.fillRect(
          mid + side * (2 + t * (r.w / 2 + 5)) - 1,
          r.y - 7 * Math.sin(t * Math.PI) - 1,
          2,
          2,
        );
      }
    }
  }
}
