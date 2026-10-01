import { GROUND } from "./projection.js";

/**
 * Procedural neuron anatomy. Every neuron gets its own cell type, soma outline
 * and dendrite tree from a stable seed, and grows a dendrite toward each
 * connected neighbour. Pure presentation: nothing here reads or changes
 * simulation state.
 */
export const NEURON_KINDS = [
  "stellate",
  "pyramidal",
  "bipolar",
  "granule",
] as const;
export type NeuronKind = (typeof NEURON_KINDS)[number];

export interface Branch {
  /** Fraction along the parent where this branch leaves it. */
  at: number;
  /** Heading relative to the parent at that point. */
  angle: number;
  length: number;
  width: number;
  bend: number;
  children: readonly Branch[];
}
export interface Dendrite {
  /** Stable per neuron: `d<i>` for free dendrites, `n<cell>` toward a neighbour. */
  key: string;
  /** Direction on the ground plane, radians. */
  angle: number;
  length: number;
  width: number;
  /** Lateral curvature as a fraction of length. */
  bend: number;
  branches: readonly Branch[];
  toward: number | null;
  /** Free dendrites sway in two counter-phased groups; neighbour dendrites stay anchored. */
  side: 0 | 1;
}
export interface NeuronForm {
  kind: NeuronKind;
  /** Colour variant, 0–2. */
  tone: number;
  radius: number;
  /** Soma outline: base radius times this function of angle. */
  lobes: readonly { amplitude: number; frequency: number; phase: number }[];
  /** Elongation of the soma along `axis` (pyramidal teardrop, bipolar spindle). */
  stretch: number;
  axis: number;
  dendrites: readonly Dendrite[];
  nucleus: { dx: number; dy: number; radius: number };
  phase: number;
}
/** A connected neighbour, as its projected screen offset from this neuron. */
export interface Neighbour {
  cell: number;
  dx: number;
  dy: number;
}
type Point = readonly [number, number];
type Random = () => number;
/** Somas are low domes on the tissue, seen from the board's oblique angle. */
const SOMA_SQUASH = 0.7;

export function seededRandom(seed: number): Random {
  let state = seed >>> 0 || 0x9e3779b9;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Anatomy depends on location only; the team decides colour, never shape. */
export function neuronSeed(cell: number): number {
  return (Math.imul(cell + 1, 0x45d9f3b) ^ 0x27d4eb2d) >>> 0;
}

const between = (random: Random, low: number, high: number) =>
  low + random() * (high - low);
const either = (random: Random) => (random() < 0.5 ? -1 : 1);
const angleGap = (a: number, b: number) =>
  Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

/** A branching twig; depth limits recursion so trees stay cheap to draw. */
function twigs(
  random: Random,
  parent: number,
  width: number,
  depth: number,
  count: number,
): Branch[] {
  return Array.from({ length: count }, () => {
    const length = parent * between(random, 0.3, 0.55);
    const w = width * between(random, 0.5, 0.65);
    return {
      at: between(random, 0.35, 0.8),
      angle: either(random) * between(random, 0.4, 1),
      length,
      width: w,
      bend: between(random, -0.3, 0.3),
      children:
        depth > 1 && length > 7
          ? twigs(random, length, w, depth - 1, random() < 0.6 ? 1 : 2)
          : [],
    };
  });
}

/** Terminal tuft: several short twigs fanning from the tip. */
function tuft(random: Random, width: number, count: number): Branch[] {
  return Array.from({ length: count }, (_, i) => ({
    at: 0.9 + random() * 0.1,
    angle: (i - (count - 1) / 2) * between(random, 0.45, 0.7),
    length: between(random, 5, 10),
    width: width * 0.5,
    bend: between(random, -0.3, 0.3),
    children: [],
  }));
}

export function neuronForm(
  seed: number,
  neighbours: readonly Neighbour[] = [],
): NeuronForm {
  const random = seededRandom(seed);
  const kind = NEURON_KINDS[Math.floor(random() * NEURON_KINDS.length)]!;
  const tone = Math.floor(random() * 3);
  const axis = random() * Math.PI * 2;
  const radius =
    kind === "granule"
      ? between(random, 6.5, 8)
      : kind === "bipolar"
        ? between(random, 8, 10)
        : between(random, 9, 12.5);
  const stretch = kind === "pyramidal" ? 0.5 : kind === "bipolar" ? 0.38 : 0;
  const lobes = Array.from({ length: 2 }, (_, i) => ({
    amplitude: between(
      random,
      0.04,
      i ? 0.08 : kind === "stellate" ? 0.18 : 0.1,
    ),
    frequency: 3 + Math.floor(random() * 4),
    phase: random() * Math.PI * 2,
  }));
  const dendrites: Dendrite[] = [];
  // Neighbour dendrites come first and depend only on that neighbour, so a
  // new connection adds a dendrite without reshaping the existing tree.
  for (const n of [...neighbours].sort((a, b) => a.cell - b.cell)) {
    const local = seededRandom(seed ^ Math.imul(n.cell + 3, 0x85ebca6b));
    const reach = Math.hypot(n.dx, n.dy / GROUND.depth);
    const length = Math.min(34, reach * 0.52);
    const width = between(local, 3.8, 4.6);
    dendrites.push({
      key: `n${n.cell}`,
      angle: Math.atan2(n.dy / GROUND.depth, n.dx),
      length,
      width,
      bend: (local() - 0.5) * 0.16,
      branches: twigs(local, length, width, 1, local() < 0.5 ? 1 : 2),
      toward: n.cell,
      side: 0,
    });
  }
  // Each cell type has its own free-dendrite plan: [angle, length, width, extras].
  const plan: {
    angle: number;
    length: number;
    width: number;
    branches: Branch[];
  }[] = [];
  const add = (
    angle: number,
    length: number,
    width: number,
    branches: Branch[],
  ) => plan.push({ angle, length, width, branches });
  if (kind === "pyramidal") {
    const apical = between(random, 30, 40),
      w = between(random, 4.4, 5.2);
    add(axis, apical, w, [
      ...twigs(random, apical, w, 2, 2),
      ...tuft(random, w, 3),
    ]);
    const basal = 3 + Math.floor(random() * 2);
    for (let i = 0; i < basal; i++) {
      const length = between(random, 14, 22),
        width = between(random, 2.6, 3.4);
      add(
        axis + Math.PI + (i - (basal - 1) / 2) * between(random, 0.55, 0.75),
        length,
        width,
        twigs(random, length, width, 2, 1),
      );
    }
  } else if (kind === "bipolar") {
    for (const end of [0, Math.PI]) {
      const length = between(random, 28, 38),
        width = between(random, 3.6, 4.4);
      add(axis + end + between(random, -0.15, 0.15), length, width, [
        ...twigs(random, length, width, 2, 2),
        ...tuft(random, width, 2),
      ]);
    }
    if (random() < 0.6) {
      const length = between(random, 10, 15);
      add(axis + (Math.PI / 2) * either(random), length, 2.2, []);
    }
  } else if (kind === "granule") {
    const count = 3 + Math.floor(random() * 2);
    for (let i = 0; i < count; i++) {
      const length = between(random, 24, 34),
        width = between(random, 2.2, 2.8);
      add(
        axis + (i * Math.PI * 2) / count + between(random, -0.4, 0.4),
        length,
        width,
        [...twigs(random, length, width, 1, 1), ...tuft(random, width, 3)],
      );
    }
  } else {
    const count = 5 + Math.floor(random() * 4);
    for (let i = 0; i < count; i++) {
      const length = between(random, 16, 30),
        width = between(random, 2.9, 4);
      add(
        axis + (i * Math.PI * 2) / count + between(random, -0.3, 0.3),
        length,
        width,
        twigs(random, length, width, 2, random() < 0.4 ? 2 : 1),
      );
    }
  }
  plan.forEach((p, i) => {
    const bend = between(random, -0.3, 0.3);
    // Keep drawing the same random stream so free dendrites stay stable when
    // one is hidden next to a neighbour dendrite.
    if (
      dendrites.some(
        (d) => d.toward !== null && angleGap(d.angle, p.angle) < 0.5,
      )
    )
      return;
    dendrites.push({
      key: `d${i}`,
      angle: p.angle,
      length: p.length,
      width: p.width,
      bend,
      branches: p.branches,
      toward: null,
      side: (i % 2) as 0 | 1,
    });
  });
  return {
    kind,
    tone,
    radius,
    lobes,
    stretch,
    axis,
    dendrites,
    nucleus: {
      dx: Math.cos(axis) * radius * 0.12 + between(random, -1.5, 1.5),
      dy: between(random, -3, 0),
      radius: radius * between(random, 0.34, 0.44),
    },
    phase: random() * Math.PI * 2,
  };
}

/** Ground-plane vector to projected screen offset. */
const ground = (length: number, angle: number): Point => [
  Math.cos(angle) * length,
  Math.sin(angle) * length * GROUND.depth,
];

export function somaRadiusAt(form: NeuronForm, angle: number): number {
  const along = Math.cos(angle - form.axis);
  const shape =
    form.kind === "pyramidal"
      ? 1 + form.stretch * Math.pow(Math.max(0, along), 3) - 0.1 * along * along
      : form.kind === "bipolar"
        ? 1 + form.stretch * along * along - 0.12
        : 1;
  return (
    form.radius *
    shape *
    (1 +
      form.lobes.reduce(
        (sum, l) => sum + l.amplitude * Math.sin(l.frequency * angle + l.phase),
        0,
      ))
  );
}

/** Closed smooth soma outline around (x, y), slightly squashed by the view angle. */
export function somaPath(
  form: NeuronForm,
  x: number,
  y: number,
  grow = 0,
): string {
  const points = Array.from({ length: 20 }, (_, i) => {
    const angle = (i / 20) * Math.PI * 2;
    const r = somaRadiusAt(form, angle) + grow;
    return [
      x + Math.cos(angle) * r,
      y + Math.sin(angle) * r * SOMA_SQUASH,
    ] as Point;
  });
  return smoothClosedPath(points);
}

export interface DendriteGeometry {
  key: string;
  side: 0 | 1;
  anchored: boolean;
  /** Root on the soma rim, used as the growth origin. */
  root: Point;
  /** Centreline samples from root to tip, for signal sparks. */
  spine: readonly Point[];
  /** Tapered outlines of the dendrite and all its branches. */
  outlines: readonly string[];
  tips: readonly Point[];
}

function taper(spine: readonly Point[], width: number): string {
  const left: Point[] = [],
    right: Point[] = [];
  spine.forEach((p, i) => {
    const a = spine[Math.max(0, i - 1)]!,
      b = spine[Math.min(spine.length - 1, i + 1)]!;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = -(b[1] - a[1]) / length,
      ny = (b[0] - a[0]) / length;
    const t = i / (spine.length - 1);
    const w = width * 1.2 * Math.pow(1 - t, 1.35) + 0.4;
    left.push([p[0] + nx * w, p[1] + ny * w]);
    right.push([p[0] - nx * w, p[1] - ny * w]);
  });
  const all = [...left, ...right.reverse()];
  return `M${all.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L")}Z`;
}

function curve(
  start: Point,
  angle: number,
  length: number,
  bend: number,
  samples = 8,
) {
  const [ex, ey] = ground(length, angle);
  const [cx, cy] = ground(length * 0.5, angle);
  const [bx, by] = ground(length * bend, angle + Math.PI / 2);
  const end: Point = [start[0] + ex, start[1] + ey];
  const control: Point = [start[0] + cx + bx, start[1] + cy + by];
  return Array.from({ length: samples + 1 }, (_, i) => {
    const t = i / samples,
      u = 1 - t;
    return [
      u * u * start[0] + 2 * u * t * control[0] + t * t * end[0],
      u * u * start[1] + 2 * u * t * control[1] + t * t * end[1],
    ] as Point;
  });
}

function grow(
  spine: readonly Point[],
  branches: readonly Branch[],
  outlines: string[],
  tips: Point[],
) {
  for (const b of branches) {
    const index = Math.min(
      spine.length - 2,
      Math.round(b.at * (spine.length - 1)),
    );
    const p = spine[index]!,
      q = spine[index + 1]!;
    const heading = Math.atan2((q[1] - p[1]) / GROUND.depth, q[0] - p[0]);
    const twig = curve(p, heading + b.angle, b.length, b.bend, 5);
    outlines.push(taper(twig, b.width));
    if (b.children.length) grow(twig, b.children, outlines, tips);
    else tips.push(twig[twig.length - 1]!);
  }
}

export function dendriteGeometry(
  form: NeuronForm,
  d: Dendrite,
  x: number,
  y: number,
): DendriteGeometry {
  const rim = somaRadiusAt(form, d.angle) * 0.72;
  const root: Point = [
    x + Math.cos(d.angle) * rim,
    y + Math.sin(d.angle) * rim * SOMA_SQUASH,
  ];
  const spine = curve(root, d.angle, d.length, d.bend);
  const outlines = [taper(spine, d.width)];
  const tips: Point[] = [spine[spine.length - 1]!];
  grow(spine, d.branches, outlines, tips);
  return {
    key: d.key,
    side: d.side,
    anchored: d.toward !== null,
    root,
    spine,
    outlines,
    tips,
  };
}

/** Quadratic midpoint smoothing through a closed polygon. */
export function smoothClosedPath(points: readonly Point[]): string {
  if (points.length < 3) return "";
  const mid = (a: Point, b: Point) =>
    `${((a[0] + b[0]) / 2).toFixed(1)} ${((a[1] + b[1]) / 2).toFixed(1)}`;
  let d = `M${mid(points[points.length - 1]!, points[0]!)}`;
  points.forEach((p, i) => {
    d += `Q${p[0].toFixed(1)} ${p[1].toFixed(1)} ${mid(p, points[(i + 1) % points.length]!)}`;
  });
  return `${d}Z`;
}

/**
 * A tapered, branching tendril on the ground plane, used for the roots that
 * anchor buildings into the creep. Returns outlines for the trunk and twigs.
 */
export function tendril(
  start: Point,
  angle: number,
  length: number,
  width: number,
  bend: number,
  seed: number,
): { outlines: string[]; spine: readonly Point[] } {
  const random = seededRandom(seed);
  const spine = curve(start, angle, length, bend);
  const outlines = [taper(spine, width)];
  grow(
    spine,
    twigs(random, length, width, 1, random() < 0.5 ? 1 : 2),
    outlines,
    [],
  );
  return { outlines, spine };
}
