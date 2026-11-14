import {
  BLACKOUT,
  BOOMERANG,
  COLUMNS,
  DOUBLE,
  DRUNK,
  FLIP,
  HIDDEN,
  ITEM_KINDS,
  LAG,
  MINES,
  SHIELD,
  STAR,
  TORNADO,
  TURBO,
  WAVE,
  isAttack,
} from "../engine/view-kit.js";
import {
  CYAN,
  GOLD,
  INK,
  JUDGMENT_COLORS,
  ORANGE,
  PINK,
  QUANT_COLORS,
  RED,
  WHITE,
  hexA,
} from "./palette.js";
import type { CanvasFactory, Pen, SpriteCanvas } from "./pen.js";

/**
 * Everything that glows is drawn once, here, onto small offscreen canvases: an arrow per colour and direction, the
 * targets, the bursts, the mines. A frame then only blits them, so the glow (a blurred shadow, the costly part of a
 * neon look) is paid for when the field's size is set and never while the song plays.
 */
export interface Sprite {
  canvas: SpriteCanvas;
  /** The canvas's side in device pixels, and half of it: a sprite is drawn centred. */
  size: number;
  half: number;
}
export interface SpriteSet {
  /** The column width these were drawn for. */
  cell: number;
  /** Notes, by colour (`QUANT_COLORS`) then column. */
  arrows: Sprite[][];
  /** The targets, by column: at rest, and lit. */
  receptors: Sprite[];
  lit: Sprite[];
  /** The white-hot arrow at the heart of a burst, pointing up; drawn turned to its column. */
  core: Sprite;
  /** The arrow outline a burst throws out, pointing up: by judgment (Marvelous to Boo), then a kept hold's. */
  bursts: Sprite[];
  /** A soft blob of light, by judgment colour. */
  glows: Sprite[];
  /** A mine, in its two blinking frames, and what it leaves when it goes off. */
  mines: Sprite[];
  blast: Sprite;
  /** A note that carries a power-up. */
  capsule: Sprite;
  spark: Sprite;
}

/** How far each column's arrow is turned from pointing up: left, down, up, right. */
export const TURNS = [-Math.PI / 2, Math.PI, 0, Math.PI / 2] as const;
/** The index in `bursts` of a kept hold's. */
export const HELD_BURST = 5;

const names = new WeakMap<SpriteCanvas, string>();
/** What a sprite's canvas shows ("arrow:0:2", "mine", "capsule"…): for tests and debugging. */
export const spriteName = (canvas: SpriteCanvas): string | undefined =>
  names.get(canvas);

function make(
  factory: CanvasFactory,
  size: number,
  name: string,
  draw: (g: Pen) => void,
): Sprite {
  const side = Math.max(2, Math.ceil(size / 2) * 2);
  const canvas = factory(side, side);
  names.set(canvas, name);
  const g = canvas.getContext("2d");
  if (g) {
    g.setTransform(1, 0, 0, 1, side / 2, side / 2);
    g.lineJoin = "round";
    g.lineCap = "round";
    draw(g);
    g.setTransform(1, 0, 0, 1, 0, 0);
  }
  return { canvas, size: side, half: side / 2 };
}

const ARROW: readonly (readonly [number, number])[] = [
  [0, -0.45],
  [0.45, 0],
  [0.31, 0.14],
  [0.12, -0.05],
  [0.12, 0.45],
  [-0.12, 0.45],
  [-0.12, -0.05],
  [-0.31, 0.14],
  [-0.45, 0],
];
/** An arrow pointing up, `s` across, centred on the origin. */
function arrowPath(g: Pen, s: number): void {
  g.beginPath();
  for (const [i, [x, y]] of ARROW.entries())
    if (i === 0) g.moveTo(x * s, y * s);
    else g.lineTo(x * s, y * s);
  g.closePath();
}
function glowStroke(g: Pen, color: string, width: number, blur: number): void {
  g.shadowColor = color;
  g.shadowBlur = blur;
  g.strokeStyle = color;
  g.lineWidth = width;
  g.stroke();
  g.shadowBlur = 0;
}
function line(g: Pen, points: readonly number[]): void {
  g.beginPath();
  for (let i = 0; i < points.length; i += 2)
    if (i === 0) g.moveTo(points[i]!, points[i + 1]!);
    else g.lineTo(points[i]!, points[i + 1]!);
  g.stroke();
}
/** A tiny bitmap, one character per pixel ("#" is ink), centred on (x, y). */
function pixels(
  g: Pen,
  rows: readonly string[],
  pixel: number,
  x: number,
  y: number,
): void {
  const width = rows[0]!.length * pixel,
    height = rows.length * pixel;
  for (const [row, text] of rows.entries())
    for (let column = 0; column < text.length; column++)
      if (text[column] === "#")
        g.fillRect(
          x - width / 2 + column * pixel,
          y - height / 2 + row * pixel,
          pixel,
          pixel,
        );
}

function note(g: Pen, s: number, color: string, turn: number): void {
  g.rotate(turn);
  arrowPath(g, s * 0.92);
  g.fillStyle = INK;
  g.fill();
  g.fillStyle = hexA(color, 0.82);
  g.fill();
  glowStroke(g, color, s * 0.07, s * 0.14);
  g.strokeStyle = hexA(WHITE, 0.9);
  g.lineWidth = Math.max(1, s * 0.022);
  g.stroke();
  // The bright heart of the arrow: a smaller one inside.
  arrowPath(g, s * 0.5);
  g.fillStyle = hexA(WHITE, 0.55);
  g.fill();
}

function receptor(g: Pen, s: number, turn: number, lit: boolean): void {
  g.rotate(turn);
  arrowPath(g, s * 0.92);
  g.fillStyle = lit ? hexA(WHITE, 0.45) : hexA("#0b1933", 0.9);
  g.fill();
  if (lit) glowStroke(g, CYAN, s * 0.08, s * 0.2);
  else glowStroke(g, "#5f7fc4", s * 0.06, s * 0.08);
  g.strokeStyle = lit ? WHITE : hexA("#cfe2ff", 0.75);
  g.lineWidth = Math.max(1, s * 0.025);
  g.stroke();
}

function blob(g: Pen, radius: number, color: string): void {
  g.fillStyle = hexA(color, 0.085);
  for (let ring = 0; ring < 12; ring++) {
    g.beginPath();
    g.arc(0, 0, radius * (1 - ring / 12), 0, Math.PI * 2);
    g.fill();
  }
}

function mine(g: Pen, s: number, frame: number): void {
  g.beginPath();
  g.arc(0, 0, s * 0.3, 0, Math.PI * 2);
  g.fillStyle = "#1c0409";
  g.fill();
  glowStroke(g, RED, s * 0.07, s * 0.16);
  g.strokeStyle = frame ? GOLD : hexA(WHITE, 0.9);
  g.lineWidth = Math.max(1, s * 0.035);
  for (let spoke = 0; spoke < 4; spoke++) {
    const angle = (spoke * Math.PI) / 2 + (frame ? Math.PI / 4 : 0);
    const x = Math.cos(angle),
      y = Math.sin(angle);
    line(g, [x * s * 0.13, y * s * 0.13, x * s * 0.42, y * s * 0.42]);
  }
  g.beginPath();
  g.arc(0, 0, s * 0.1, 0, Math.PI * 2);
  g.fillStyle = frame ? ORANGE : WHITE;
  g.fill();
}

function blast(g: Pen, s: number): void {
  g.beginPath();
  for (let point = 0; point < 20; point++) {
    const radius = s * (point % 2 ? 0.42 : 0.82),
      angle = (point * Math.PI) / 10;
    const x = Math.cos(angle) * radius,
      y = Math.sin(angle) * radius;
    if (point === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
  g.fillStyle = hexA(ORANGE, 0.5);
  g.fill();
  glowStroke(g, RED, s * 0.07, s * 0.25);
  g.strokeStyle = GOLD;
  g.lineWidth = Math.max(1, s * 0.03);
  g.stroke();
  blob(g, s * 0.5, WHITE);
}

const QUESTION = [
  ".###.",
  "#...#",
  "....#",
  "...#.",
  "..#..",
  ".....",
  "..#..",
];
function box(g: Pen, s: number, color: string): void {
  const half = s * 0.3;
  g.beginPath();
  g.moveTo(-half, -half);
  g.lineTo(half, -half);
  g.lineTo(half, half);
  g.lineTo(-half, half);
  g.closePath();
  g.fillStyle = hexA(INK, 0.92);
  g.fill();
  g.fillStyle = hexA(color, 0.22);
  g.fill();
  glowStroke(g, color, s * 0.08, s * 0.16);
  g.strokeStyle = hexA(WHITE, 0.85);
  g.lineWidth = Math.max(1, s * 0.022);
  g.stroke();
}

function spark(g: Pen, s: number): void {
  g.beginPath();
  for (let point = 0; point < 8; point++) {
    const radius = s * (point % 2 ? 0.07 : 0.34),
      angle = (point * Math.PI) / 4;
    const x = Math.cos(angle) * radius,
      y = Math.sin(angle) * radius;
    if (point === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
  g.shadowColor = "#bff6ff";
  g.shadowBlur = s * 0.2;
  g.fillStyle = WHITE;
  g.fill();
  g.shadowBlur = 0;
}

export function createSprites(factory: CanvasFactory, cell: number): SpriteSet {
  const s = Math.max(2, Math.round(cell));
  const columns = Array.from({ length: COLUMNS }, (_, column) => column);
  const burstColors = [...JUDGMENT_COLORS.slice(0, 5), JUDGMENT_COLORS[6]];
  return {
    cell: s,
    arrows: QUANT_COLORS.map((color, quant) =>
      columns.map((column) =>
        make(factory, s * 1.3, `arrow:${quant}:${column}`, (g) =>
          note(g, s, color, TURNS[column]!),
        ),
      ),
    ),
    receptors: columns.map((column) =>
      make(factory, s * 1.3, `receptor:${column}`, (g) =>
        receptor(g, s, TURNS[column]!, false),
      ),
    ),
    lit: columns.map((column) =>
      make(factory, s * 1.4, `lit:${column}`, (g) =>
        receptor(g, s, TURNS[column]!, true),
      ),
    ),
    core: make(factory, s * 1.6, "core", (g) => {
      arrowPath(g, s * 0.92);
      g.shadowColor = WHITE;
      g.shadowBlur = s * 0.28;
      g.fillStyle = WHITE;
      g.fill();
      g.shadowBlur = 0;
    }),
    bursts: burstColors.map((color, judgment) =>
      make(factory, s * 1.8, `burst:${judgment}`, (g) => {
        arrowPath(g, s * 0.92);
        glowStroke(g, color, s * 0.1, s * 0.32);
        glowStroke(g, color, s * 0.06, s * 0.14);
        g.strokeStyle = hexA(WHITE, 0.9);
        g.lineWidth = Math.max(1, s * 0.03);
        g.stroke();
      }),
    ),
    glows: JUDGMENT_COLORS.map((color, judgment) =>
      make(factory, s * 2, `glow:${judgment}`, (g) => blob(g, s, color)),
    ),
    mines: [0, 1].map((frame) =>
      make(factory, s * 1.3, "mine", (g) => mine(g, s, frame)),
    ),
    blast: make(factory, s * 2.2, "blast", (g) => blast(g, s)),
    capsule: make(factory, s * 1.3, "capsule", (g) => {
      box(g, s * 1.15, GOLD);
      g.fillStyle = GOLD;
      pixels(g, QUESTION, Math.max(1, Math.round(s * 0.06)), 0, 0);
    }),
    spark: make(factory, s * 0.5, "spark", (g) => spark(g, s * 0.5)),
  };
}

// ---- power-up icons ----

const X2 = ["....###", "......#", "#.#.###", ".#..#..", "#.#.###"];

/** The colour a power-up is shown in: attacks pink, the shield cyan, the rider's own boosts gold. */
export const itemColor = (kind: number): string =>
  isAttack(kind) ? PINK : kind === SHIELD ? CYAN : GOLD;

function glyph(g: Pen, kind: number, s: number): void {
  g.strokeStyle = WHITE;
  g.fillStyle = WHITE;
  g.lineWidth = Math.max(1, s * 0.07);
  switch (kind) {
    case DRUNK: {
      g.beginPath();
      for (let i = 0; i <= 16; i++) {
        const x = (-0.22 + (0.44 * i) / 16) * s,
          y = Math.sin((i / 16) * Math.PI * 3) * 0.12 * s;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
      break;
    }
    case WAVE:
      for (const y of [-0.2, -0.14, -0.02, 0.14, 0.2])
        line(g, [-0.18 * s, y * s, 0.18 * s, y * s]);
      break;
    case BOOMERANG:
      g.beginPath();
      g.moveTo(-0.12 * s, 0.2 * s);
      g.lineTo(-0.12 * s, -0.08 * s);
      g.arc(0, -0.08 * s, 0.12 * s, Math.PI, 0);
      g.lineTo(0.12 * s, 0.14 * s);
      g.stroke();
      line(g, [0.03 * s, 0.08 * s, 0.12 * s, 0.2 * s, 0.21 * s, 0.08 * s]);
      break;
    case TORNADO:
      for (const [y, half, lean] of [
        [-0.2, 0.22, 0],
        [-0.07, 0.15, 0.04],
        [0.06, 0.09, -0.03],
        [0.19, 0.04, 0.03],
      ] as const)
        line(g, [(lean - half) * s, y * s, (lean + half) * s, y * s]);
      break;
    case HIDDEN:
      g.beginPath();
      g.arc(0, 0, 0.17 * s, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.arc(0, 0, 0.05 * s, 0, Math.PI * 2);
      g.fill();
      line(g, [-0.22 * s, 0.22 * s, 0.22 * s, -0.22 * s]);
      break;
    case FLIP:
      line(g, [-0.2 * s, -0.1 * s, 0.2 * s, -0.1 * s]);
      line(g, [0.1 * s, -0.19 * s, 0.2 * s, -0.1 * s, 0.1 * s, -0.01 * s]);
      line(g, [0.2 * s, 0.1 * s, -0.2 * s, 0.1 * s]);
      line(g, [-0.1 * s, 0.01 * s, -0.2 * s, 0.1 * s, -0.1 * s, 0.19 * s]);
      break;
    case TURBO:
      for (const x of [-0.16, 0.04])
        line(g, [x * s, -0.18 * s, (x + 0.16) * s, 0, x * s, 0.18 * s]);
      break;
    case BLACKOUT:
      g.beginPath();
      g.arc(0, 0, 0.19 * s, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.arc(0, 0, 0.19 * s, Math.PI / 2, (Math.PI * 3) / 2);
      g.fill();
      break;
    case MINES:
      g.beginPath();
      g.arc(0, 0, 0.1 * s, 0, Math.PI * 2);
      g.fill();
      for (let spoke = 0; spoke < 8; spoke++) {
        const x = Math.cos((spoke * Math.PI) / 4),
          y = Math.sin((spoke * Math.PI) / 4);
        line(g, [x * 0.1 * s, y * 0.1 * s, x * 0.22 * s, y * 0.22 * s]);
      }
      break;
    case LAG:
      g.beginPath();
      g.arc(0, 0, 0.2 * s, 0, Math.PI * 2);
      g.stroke();
      line(g, [0, -0.13 * s, 0, 0, 0.1 * s, 0.06 * s]);
      break;
    case DOUBLE:
      pixels(g, X2, Math.max(1, Math.round(s * 0.06)), 0, 0);
      break;
    case STAR: {
      g.beginPath();
      for (let point = 0; point < 10; point++) {
        const radius = s * (point % 2 ? 0.1 : 0.24),
          angle = (point * Math.PI) / 5 - Math.PI / 2;
        const x = Math.cos(angle) * radius,
          y = Math.sin(angle) * radius;
        if (point === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.closePath();
      g.fill();
      break;
    }
    case SHIELD:
      g.beginPath();
      g.moveTo(-0.18 * s, -0.2 * s);
      g.lineTo(0.18 * s, -0.2 * s);
      g.lineTo(0.18 * s, 0.02 * s);
      g.lineTo(0, 0.23 * s);
      g.lineTo(-0.18 * s, 0.02 * s);
      g.closePath();
      g.stroke();
      break;
  }
}

/** A power-up's icon `size` pixels across: a glowing box in its colour with its sign inside. */
export function createIcon(
  factory: CanvasFactory,
  kind: number,
  size: number,
): Sprite {
  const s = Math.max(4, Math.round(size));
  return make(factory, s, `icon:${kind}`, (g) => {
    box(g, s * 1.05, itemColor(kind));
    glyph(g, kind, s);
  });
}

/** Icons by size and kind, made as they are first wanted and kept. */
export interface Icons {
  get(kind: number, size: number): Sprite | undefined;
  clear(): void;
}
export function createIcons(factory: CanvasFactory): Icons {
  const sizes = new Map<number, (Sprite | undefined)[]>();
  return {
    get(kind, size) {
      if (!(kind > 0 && kind < ITEM_KINDS)) return undefined;
      const s = Math.max(4, Math.round(size));
      let icons = sizes.get(s);
      if (!icons) {
        // A resize leaves old sizes behind; a handful is all a layout uses.
        if (sizes.size >= 6) sizes.clear();
        sizes.set(s, (icons = []));
      }
      return (icons[kind] ??= createIcon(factory, kind, s));
    },
    clear() {
      sizes.clear();
    },
  };
}
