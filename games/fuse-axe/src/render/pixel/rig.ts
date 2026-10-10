import { glows, MASTER, OUTLINE, rampOf, shade } from "./palette.js";
import { CLEAR, cropSprite, type Sprite } from "./sprite.js";

/**
 * The sprite rig. Shapes are painted onto a small canvas with a surface normal per pixel; `bake` lights them from
 * the upper left into each material's three-shade ramp and draws a 1-px edge wherever a shape overlaps one behind
 * it. Hand-placed details (eyes, mouths) are stamped onto the baked painting, which then closes with a dark outline
 * around the silhouette. Everything is plain arithmetic on the inputs, so a pose always paints the same rows.
 */
export type Point = readonly [x: number, y: number];

export interface ShapeOptions {
  /** Each shape is a part of its own, edged where it covers another; shapes in one group form one part. */
  readonly group?: string;
  /** What this shape's border does to the shapes it covers: an `ink` outline, a `shade` of theirs, or `none`. */
  readonly edge?: "ink" | "shade" | "none";
  /** Added to the light: negative for the far side of the body, positive to lift a face. */
  readonly bias?: number;
  /** Scales the normal's slope; below 1 shades flatter. */
  readonly flat?: number;
}

/** A swing's motion arc around `center`, from `from` to `to` degrees (clockwise from pointing right). */
export interface Smear {
  readonly center: Point;
  readonly inner: number;
  readonly outer: number;
  readonly from: number;
  readonly to: number;
}

/** Light from the upper left and toward the viewer. */
const NORM = Math.hypot(0.5, 0.62, 0.6);
const [LX, LY, LZ] = [-0.5 / NORM, -0.62 / NORM, 0.6 / NORM];
const HIGHLIGHT = 0.8;
const SHADOW = 0.32;
const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

interface Shape extends Required<Omit<ShapeOptions, "group" | "flat">> {
  readonly key: string;
  readonly seq: number;
  readonly part: number;
  readonly fixed: boolean;
}
interface Cell {
  readonly shape: Shape;
  readonly light: number;
}
type Box = readonly [left: number, top: number, right: number, bottom: number];
type Normal = readonly [x: number, y: number, z: number];
type Scan = (px: number, py: number, x: number, y: number) => void;

/** The box around `points`, grown by `pad`. */
const around = (points: readonly Point[], pad: number): Box => {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return [
    Math.min(...xs) - pad,
    Math.min(...ys) - pad,
    Math.max(...xs) + pad,
    Math.max(...ys) + pad,
  ];
};
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

export class Rig {
  private readonly cells: (Cell | null)[];
  private readonly groups = new Map<string, number>();
  private shapes = 0;
  private parts = 0;
  private anonymous = 0;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.cells = new Array<Cell | null>(w * h).fill(null);
  }

  /** A group name no other shape uses, for a part built from several shapes. */
  newGroup(): string {
    return `\0${++this.anonymous}`;
  }

  ellipse(c: Point, rx: number, ry: number, key: string, o: ShapeOptions = {}) {
    const s = this.shape(key, o);
    this.scan(around([c], Math.max(rx, ry) + 1), (px, py, x, y) =>
      this.dome(x, y, s, [(px - c[0]) / rx, (py - c[1]) / ry], o.flat),
    );
    return this;
  }

  /** A round-ended tube from `a` (radius `ra`) to `b` (radius `rb`). */
  capsule(
    a: Point,
    b: Point,
    ra: number,
    rb: number,
    key: string,
    o: ShapeOptions = {},
  ) {
    const s = this.shape(key, o);
    const [vx, vy] = [b[0] - a[0], b[1] - a[1]];
    const l2 = vx * vx + vy * vy || 1e-6;
    this.scan(around([a, b], Math.max(ra, rb) + 1), (px, py, x, y) => {
      const t = clamp01(((px - a[0]) * vx + (py - a[1]) * vy) / l2);
      const r = ra + (rb - ra) * t;
      const [dx, dy] = [px - a[0] - vx * t, py - a[1] - vy * t];
      this.dome(x, y, s, [dx / r, dy / r], o.flat);
    });
    return this;
  }

  /** A flat polygon whose rim, `bevel` pixels wide, rounds off toward its edges. */
  poly(
    points: readonly Point[],
    key: string,
    o: ShapeOptions & { readonly bevel?: number } = {},
  ) {
    const s = this.shape(key, o);
    const bevel = o.bevel ?? 1.6;
    const inside = (px: number, py: number) => {
      let odd = false;
      points.forEach(([xi, yi], i) => {
        const [xj, yj] = points.at(i - 1)!;
        if (
          yi > py !== yj > py &&
          px < ((xj - xi) * (py - yi)) / (yj - yi) + xi
        )
          odd = !odd;
      });
      return odd;
    };
    const sides = points.map((a, i) => {
      const b = points[(i + 1) % points.length]!;
      const [ex, ey] = [b[0] - a[0], b[1] - a[1]];
      const l = Math.hypot(ex, ey) || 1;
      const [mx, my] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const out = inside(mx + (0.3 * ey) / l, my - (0.3 * ex) / l) ? -1 : 1;
      return { a, ex, ey, l2: l * l, nx: (out * ey) / l, ny: (-out * ex) / l };
    });
    this.scan(around(points, 0), (px, py, x, y) => {
      if (!inside(px, py)) return;
      const [d, side] = sides
        .map((e) => {
          const t = clamp01(
            ((px - e.a[0]) * e.ex + (py - e.a[1]) * e.ey) / e.l2,
          );
          return [
            Math.hypot(px - e.a[0] - e.ex * t, py - e.a[1] - e.ey * t),
            e,
          ] as const;
        })
        .reduce((best, next) => (next[0] < best[0] ? next : best));
      const t = Math.max(0, 1 - d / bevel);
      this.put(x, y, s, [side.nx * t * 0.85, side.ny * t * 0.85, 1 - t / 2]);
    });
    return this;
  }

  /** A two-tone blade from `from` to its point at `to`: the half facing the light is lit, the other dark. */
  blade(
    from: Point,
    to: Point,
    width: number,
    key: string,
    o: ShapeOptions & { readonly tip?: number } = {},
  ) {
    const s = this.shape(key, o);
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const [ux, uy] = [(to[0] - from[0]) / length, (to[1] - from[1]) / length];
    const lit = ux * LY - uy * LX < 0 ? -1 : 1;
    const [nx, ny] = [-uy * lit, ux * lit];
    const tip = o.tip ?? width * 1.5;
    this.scan(around([from, to], width + 1), (px, py, x, y) => {
      const [dx, dy] = [px - from[0], py - from[1]];
      const along = dx * ux + dy * uy;
      const across = dx * nx + dy * ny;
      const half = (width / 2) * Math.min(1, (length - along) / tip);
      if (along < 0 || along > length || Math.abs(across) > half) return;
      const side = across >= 0 ? 0.75 : -0.75;
      this.put(x, y, s, [nx * side, ny * side, 0.66]);
    });
    return this;
  }

  /** A weapon's motion arc: thin where it starts, full width at the end, white-hot along the outer rim. */
  smear({ center: [cx, cy], inner, outer, from, to }: Smear) {
    const keys = Object.fromEntries(
      ["Z", "F", "f"].map((key) => [key, this.shape(key, {})]),
    );
    this.scan(around([[cx, cy]], outer), (px, py, x, y) => {
      const d = Math.hypot(px - cx, py - cy);
      const t =
        ((Math.atan2(py - cy, px - cx) * 180) / Math.PI - from) / (to - from);
      if (t < 0 || t > 1 || d > outer || d < outer - (outer - inner) * t ** 0.8)
        return;
      const key =
        d > outer - 1.2 ? (t > 0.55 ? "Z" : "F") : t > 0.35 ? "F" : "f";
      this.put(x, y, keys[key]!, [0, 0, 1]);
    });
    return this;
  }

  /** Lights every shape into its ramp and edges the shapes that others overlap. */
  bake(): Painting {
    const { w, h, cells } = this;
    const lit = cells.map((cell) => {
      if (!cell) return null;
      const { key, fixed, bias } = cell.shape;
      const light = cell.light + bias;
      return fixed
        ? key
        : shade(key, light >= HIGHLIGHT ? 0 : light < SHADOW ? 2 : 1);
    });
    const out = lit.slice();
    cells.forEach((cell, i) => {
      if (!cell || cell.shape.fixed) return;
      const [x, y] = [i % w, Math.floor(i / w)];
      for (const [dx, dy] of NEIGHBOURS) {
        if (x + dx < 0 || y + dy < 0 || x + dx >= w || y + dy >= h) continue;
        const j = i + dy * w + dx;
        const front = cells[j]?.shape;
        if (
          !front ||
          front.part === cell.shape.part ||
          front.seq < cell.shape.seq ||
          glows(lit[j]!)
        )
          continue;
        if (front.edge !== "none")
          out[i] = front.edge === "ink" ? OUTLINE : shade(lit[i]!, 2);
      }
    });
    return new Painting(w, h, out);
  }

  private shape(key: string, o: ShapeOptions): Shape {
    let part = o.group === undefined ? undefined : this.groups.get(o.group);
    if (part === undefined) {
      part = ++this.parts;
      if (o.group !== undefined) this.groups.set(o.group, part);
    }
    const [edge, bias, fixed] = [o.edge ?? "ink", o.bias ?? 0, !rampOf(key)];
    return { key, seq: ++this.shapes, part, edge, bias, fixed };
  }

  private scan([left, top, right, bottom]: Box, paint: Scan) {
    const [x0, y0] = [
      Math.max(0, Math.floor(left)),
      Math.max(0, Math.floor(top)),
    ];
    const [x1, y1] = [
      Math.min(this.w - 1, right),
      Math.min(this.h - 1, bottom),
    ];
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) paint(x + 0.5, y + 0.5, x, y);
  }

  /** A pixel of a rounded shape, (dx, dy) from its centre line in units of its radius. */
  private dome(x: number, y: number, s: Shape, [dx, dy]: Point, flat = 1) {
    const d2 = dx * dx + dy * dy;
    if (d2 <= 1) this.put(x, y, s, [dx * flat, dy * flat, Math.sqrt(1 - d2)]);
  }

  private put(x: number, y: number, shape: Shape, [nx, ny, nz]: Normal) {
    this.cells[y * this.w + x] = { shape, light: nx * LX + ny * LY + nz * LZ };
  }
}

/** A baked rig: stamp hand-placed pixels on it, then take the outlined, cropped sprite. */
export class Painting {
  constructor(
    readonly w: number,
    readonly h: number,
    private readonly pixels: (string | null)[],
  ) {}

  /** Stamps rows of keys with their top-left at (x, y): a space leaves a pixel be, `.` clears it. */
  stamp(x: number, y: number, rows: readonly string[]): this {
    rows.forEach((row, j) =>
      [...row].forEach((key, i) => {
        const [px, py] = [x + i, y + j];
        if (key !== " " && px >= 0 && py >= 0 && px < this.w && py < this.h)
          this.pixels[py * this.w + px] = key === CLEAR ? null : key;
      }),
    );
    return this;
  }

  /** The sprite, outlined in ink around its silhouette (glowing pixels excepted) and cropped; `anchor` is its feet. */
  sprite([ax, ay]: Point): Sprite {
    const { w, h, pixels } = this;
    const solid = (x: number, y: number) => {
      const key = x >= 0 && x < w ? pixels[y * w + x] : null;
      return !!key && !glows(key);
    };
    const rows = Array.from({ length: h }, (_, y) =>
      Array.from(
        { length: w },
        (_, x) =>
          pixels[y * w + x] ??
          (NEIGHBOURS.some(([dx, dy]) => solid(x + dx, y + dy))
            ? OUTLINE
            : CLEAR),
      ).join(""),
    );
    const palette: Record<string, string> = {};
    for (const key of [...new Set(rows.join(""))].sort()) {
      if (key === CLEAR) continue;
      const color = MASTER[key];
      if (!color)
        throw new Error(`Sprite key ${key} is not in the master palette`);
      palette[key] = color;
    }
    return cropSprite({ w, h, ax, ay, palette, rows });
  }
}
