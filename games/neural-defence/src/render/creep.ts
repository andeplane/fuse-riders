import { GROUND } from "./projection.js";
import { seededRandom, smoothClosedPath } from "./neuron-form.js";

/**
 * Living tissue beneath a network, in the spirit of Zerg creep. Each structure
 * contributes a metaball on the ground plane; the iso-contour of their sum is
 * the creep edge. Presentation only.
 */
export interface CreepBlob {
  x: number;
  y: number;
  /** Visible ground radius of this blob on its own. */
  radius: number;
}
type Point = readonly [number, number];

const ISO = 0.25;
/** Radius at which one blob's falloff (1 - d²/R²)² meets ISO. */
const REACH = 1 / Math.sqrt(1 - Math.sqrt(ISO));

/** Smooth value noise in [-1, 1]; its seed fixes a player's creep edge. */
function valueNoise(seed: number, scale: number) {
  const cache = new Map<number, number>();
  const lattice = (i: number, j: number) => {
    const key = i * 73856093 + j;
    let v = cache.get(key);
    if (v === undefined) {
      v =
        seededRandom(
          seed ^ Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1),
        )() *
          2 -
        1;
      cache.set(key, v);
    }
    return v;
  };
  return (x: number, y: number) => {
    const gx = x / scale,
      gy = y / scale;
    const i = Math.floor(gx),
      j = Math.floor(gy);
    const fx = gx - i,
      fy = gy - j;
    const sx = fx * fx * (3 - 2 * fx),
      sy = fy * fy * (3 - 2 * fy);
    const top = lattice(i, j) * (1 - sx) + lattice(i + 1, j) * sx;
    const bottom = lattice(i, j + 1) * (1 - sx) + lattice(i + 1, j + 1) * sx;
    return top * (1 - sy) + bottom * sy;
  };
}

export interface CreepOptions {
  width: number;
  height: number;
  step?: number;
  seed?: number;
  /** Edge irregularity; kept below ISO so noise cannot create detached islands. */
  roughness?: number;
}

export function creepContours(
  blobs: readonly CreepBlob[],
  options: CreepOptions,
): Point[][] {
  const live = blobs.filter((b) => b.radius > 0.5);
  if (!live.length) return [];
  const step = options.step ?? 6;
  // Pad by the widest blob so contours near the board edge still close.
  const pad =
    (Math.ceil(Math.max(...live.map((b) => b.radius * REACH)) / step) + 1) *
    step;
  const origin = -pad;
  const columns = Math.ceil((options.width + 2 * pad) / step) + 1,
    rows = Math.ceil((options.height + 2 * pad) / step) + 1;
  const field = new Float32Array(columns * rows);
  for (const b of live) {
    const r = b.radius * REACH,
      ry = r * GROUND.depth;
    const c0 = Math.max(0, Math.floor((b.x - r - origin) / step)),
      c1 = Math.min(columns - 1, Math.ceil((b.x + r - origin) / step));
    const r0 = Math.max(0, Math.floor((b.y - ry - origin) / step)),
      r1 = Math.min(rows - 1, Math.ceil((b.y + ry - origin) / step));
    for (let j = r0; j <= r1; j++)
      for (let i = c0; i <= c1; i++) {
        const dx = origin + i * step - b.x,
          dy = (origin + j * step - b.y) / GROUND.depth;
        const q = (dx * dx + dy * dy) / (r * r);
        if (q < 1) field[j * columns + i]! += (1 - q) * (1 - q);
      }
  }
  const roughness = Math.min(0.2, options.roughness ?? 0.15);
  if (roughness > 0) {
    // Two octaves: broad lobes plus a finer fringe along the edge.
    const broad = valueNoise(options.seed ?? 1, 36),
      fine = valueNoise((options.seed ?? 1) ^ 0x9e37, 13);
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < columns; i++) {
        const k = j * columns + i;
        if (field[k]! > 0.02) {
          const x = origin + i * step,
            y = origin + j * step;
          field[k]! += (broad(x, y) * 0.7 + fine(x, y) * 0.3) * roughness;
        }
      }
  }
  return marchingSquares(field, columns, rows, step, origin);
}

/** Iso-contour loops of a sampled field, joined edge to edge. */
function marchingSquares(
  field: Float32Array,
  columns: number,
  rows: number,
  step: number,
  origin: number,
): Point[][] {
  const value = (i: number, j: number) => field[j * columns + i]!;
  // Edge ids: horizontal edge (i,j)->(i+1,j) is 2k, vertical (i,j)->(i,j+1) is 2k+1.
  const point = (edge: number): Point => {
    const k = edge >> 1,
      i = k % columns,
      j = Math.floor(k / columns);
    const a = value(i, j);
    const b = edge & 1 ? value(i, j + 1) : value(i + 1, j);
    const t = Math.abs(b - a) < 1e-9 ? 0.5 : (ISO - a) / (b - a);
    return edge & 1
      ? [origin + i * step, origin + (j + t) * step]
      : [origin + (i + t) * step, origin + j * step];
  };
  const next = new Map<number, number>();
  for (let j = 0; j < rows - 1; j++)
    for (let i = 0; i < columns - 1; i++) {
      const tl = value(i, j) > ISO ? 8 : 0,
        tr = value(i + 1, j) > ISO ? 4 : 0,
        br = value(i + 1, j + 1) > ISO ? 2 : 0,
        bl = value(i, j + 1) > ISO ? 1 : 0;
      const code = tl | tr | br | bl;
      if (code === 0 || code === 15) continue;
      const k = j * columns + i;
      const top = 2 * k,
        left = 2 * k + 1,
        bottom = 2 * (k + columns),
        right = 2 * (k + 1) + 1;
      // Segments run with the filled region on the right, so loops orient consistently.
      const segments: Record<number, readonly (readonly [number, number])[]> = {
        1: [[left, bottom]],
        2: [[bottom, right]],
        3: [[left, right]],
        4: [[right, top]],
        5: [
          [left, top],
          [right, bottom],
        ],
        6: [[bottom, top]],
        7: [[left, top]],
        8: [[top, left]],
        9: [[top, bottom]],
        10: [
          [top, right],
          [bottom, left],
        ],
        11: [[top, right]],
        12: [[right, left]],
        13: [[right, bottom]],
        14: [[bottom, left]],
      };
      for (const [from, to] of segments[code]!) next.set(from, to);
    }
  const loops: Point[][] = [];
  const visited = new Set<number>();
  for (const start of next.keys()) {
    if (visited.has(start)) continue;
    const loop: Point[] = [];
    let edge: number | undefined = start;
    while (edge !== undefined && !visited.has(edge)) {
      visited.add(edge);
      loop.push(point(edge));
      edge = next.get(edge);
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

export function contourPath(loops: readonly (readonly Point[])[]): string {
  return loops.map(smoothClosedPath).join("");
}

export const CREEP_RADIUS = Object.freeze({
  brain: 78,
  neuron: 46,
  harvester: 48,
  tower: 52,
  siege: 52,
  relay: 50,
  bastion: 54,
  site: 30,
});

export interface TeamPalette {
  light: string;
  mid: string;
  dark: string;
  glow: string;
  flesh: string;
  fleshDark: string;
}
export const TEAM_PALETTES: readonly TeamPalette[] = [
  {
    light: "#c8ecff",
    mid: "#3d9fe6",
    dark: "#0f2f55",
    glow: "#63cfff",
    flesh: "#212b40",
    fleshDark: "#0e1117",
  },
  {
    light: "#ffd4da",
    mid: "#e24d68",
    dark: "#56131f",
    glow: "#ff8e9d",
    flesh: "#3a2129",
    fleshDark: "#150c0f",
  },
  {
    light: "#dcffd2",
    mid: "#4dbb65",
    dark: "#133d1e",
    glow: "#9ee394",
    flesh: "#213427",
    fleshDark: "#0d130f",
  },
  {
    light: "#fff1c4",
    mid: "#dca436",
    dark: "#50360b",
    glow: "#f7d477",
    flesh: "#383020",
    fleshDark: "#14110b",
  },
];
export const palette = (slot: number): TeamPalette =>
  TEAM_PALETTES[slot] ?? TEAM_PALETTES[0]!;

/** Tissue tile: packed cells with lit centres, so the creep reads as wet flesh. */
export function creepPatternMarkup(slot: number): string {
  const p = palette(slot);
  const random = seededRandom(0xc0ffee + slot);
  const width = 220,
    height = Math.round(220 * GROUND.depth);
  const cells: string[] = [];
  for (let n = 0; n < 70; n++) {
    const x = random() * width,
      y = random() * height;
    const r = 5 + random() * 11;
    // Draw each cell with its wrapped copies so the tile has no seams.
    for (const ox of [-width, 0, width])
      for (const oy of [-height, 0, height]) {
        const cx = x + ox,
          cy = y + oy;
        if (cx + r < 0 || cx - r > width || cy + r < 0 || cy - r > height)
          continue;
        cells.push(
          `<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${r.toFixed(1)}" ry="${(r * GROUND.depth).toFixed(1)}" fill="url(#nd-creep-cell-${slot})"/>`,
        );
      }
  }
  const pores = Array.from({ length: 26 }, () => {
    const x = random() * width,
      y = random() * height;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(0.8 + random() * 1.1).toFixed(1)}" fill="${p.glow}" opacity="${(0.12 + random() * 0.23).toFixed(2)}"/>`;
  });
  return (
    `<radialGradient id="nd-creep-cell-${slot}" fx="0.38" fy="0.32"><stop offset="0" stop-color="${p.mid}" stop-opacity="0.22"/><stop offset="0.55" stop-color="${p.flesh}" stop-opacity="0.4"/><stop offset="1" stop-color="${p.fleshDark}" stop-opacity="0.7"/></radialGradient>` +
    `<pattern id="nd-creep-${slot}" patternUnits="userSpaceOnUse" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="${p.flesh}"/>${cells.join("")}${pores.join("")}</pattern>` +
    `<radialGradient id="nd-creep-sheen-${slot}"><stop offset="0" stop-color="${p.light}" stop-opacity="0.2"/><stop offset="0.5" stop-color="${p.glow}" stop-opacity="0.06"/><stop offset="1" stop-color="${p.glow}" stop-opacity="0"/></radialGradient>`
  );
}

/** Branching veins from a structure out into its creep. */
export function veinMarkup(
  x: number,
  y: number,
  radius: number,
  seed: number,
): string {
  const random = seededRandom(seed);
  const count = 3 + Math.floor(random() * 3);
  const paths: string[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + random() * 0.9;
    let px = x,
      py = y,
      heading = angle,
      d = `M${px.toFixed(1)} ${py.toFixed(1)}`;
    const segments = 3 + Math.floor(random() * 2);
    const length = radius * (0.85 + random() * 0.35);
    for (let s = 0; s < segments; s++) {
      heading += (random() - 0.5) * 0.9;
      const step = length / segments;
      const nx = px + Math.cos(heading) * step,
        ny = py + Math.sin(heading) * step * GROUND.depth;
      const cx = (px + nx) / 2 + (random() - 0.5) * 6,
        cy = (py + ny) / 2 + (random() - 0.5) * 4;
      d += `Q${cx.toFixed(1)} ${cy.toFixed(1)} ${nx.toFixed(1)} ${ny.toFixed(1)}`;
      if (s === 1 && random() < 0.7) {
        const fork = heading + (random() < 0.5 ? -1 : 1) * 0.8;
        paths.push(
          `<path class="creep-vein creep-vein-fine" d="M${nx.toFixed(1)} ${ny.toFixed(1)}q${(Math.cos(fork) * step * 0.4).toFixed(1)} ${(Math.sin(fork) * step * 0.3 * GROUND.depth).toFixed(1)} ${(Math.cos(fork) * step * 0.8).toFixed(1)} ${(Math.sin(fork) * step * 0.8 * GROUND.depth).toFixed(1)}"/>`,
        );
      }
      px = nx;
      py = ny;
    }
    paths.push(`<path class="creep-vein" d="${d}"/>`);
  }
  return paths.join("");
}
