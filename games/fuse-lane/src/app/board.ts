import { roundRect, shade, type Art } from "./art.js";
import {
  doorPoint,
  lotBox,
  ringBetween,
  streetPoint,
  walkPoint,
  type Geometry,
  type Point,
} from "./layout.js";
import type { BoardPlace, BoardPlayer } from "./presenter.js";

/**
 * The city as a little diorama on a 2D canvas: textured asphalt with lane markings and zebra crossings, raised curbs
 * and sidewalks, a park in the middle, the 13 buildings on their lots around the loop, street props, and every
 * player walking the sidewalk between two frames. Buildings, props and walkers stand up and are drawn back to front
 * with soft shadows cast toward the bottom right. The geometry is `layout.ts`; this file only draws.
 */
export interface BoardFrame {
  places: BoardPlace[];
  players: BoardPlayer[];
  /** Each player's ring position in the frame before, to walk smoothly between log ticks. */
  before: ReadonlyMap<string, number>;
  /** How far from the frame before to this one, 0..1. */
  fraction: number;
  /** Seconds since the page opened: walk cycles and pulses. */
  time: number;
  /** A place to outline (the pointer is over it). */
  hover: number;
}

const INK = "#1d2733";
const FONT = `"Nunito Variable", "Nunito", ui-rounded, system-ui, sans-serif`;

// ---- small deterministic helpers ----------------------------------------------------------------------------------

/** A repeatable pseudo-random number in 0..1 for an integer seed. */
function hash(seed: number): number {
  let x = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
const wrap = (t: number) => ((t % 1) + 1) % 1;
const near = (a: number, b: number, within: number) => {
  const d = Math.abs(wrap(a) - wrap(b));
  return Math.min(d, 1 - d) < within;
};

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  return canvas;
}

// ---- textures -------------------------------------------------------------------------------------------------------

type Texture = "tex-asphalt" | "tex-sidewalk" | "tex-grass" | "tex-paving";
const fallbackTextures = new Map<Texture, HTMLCanvasElement>();

/** A procedural stand-in for a missing texture: a base colour with seeded grain (and slabs or bricks). */
function fallbackTexture(id: Texture): HTMLCanvasElement {
  const known = fallbackTextures.get(id);
  if (known) return known;
  const size = 128,
    canvas = makeCanvas(size, size),
    c = canvas.getContext("2d")!;
  const spec = {
    "tex-asphalt": { base: "#5d6168", dots: ["#6c7078", "#50545b", "#777b82"] },
    "tex-sidewalk": {
      base: "#d9d6cf",
      dots: ["#cfcbc3", "#e3e0da", "#c6c2b9"],
    },
    "tex-grass": { base: "#7dad55", dots: ["#6f9e49", "#8cbc62", "#6a9443"] },
    "tex-paving": { base: "#d8b48f", dots: ["#c9a17a", "#e2c3a1", "#bf9570"] },
  }[id];
  c.fillStyle = spec.base;
  c.fillRect(0, 0, size, size);
  let seed = id.length * 977;
  for (let i = 0; i < 900; i++) {
    const x = hash(seed++) * size,
      y = hash(seed++) * size;
    c.fillStyle = spec.dots[i % spec.dots.length]!;
    if (id === "tex-grass") c.fillRect(x, y, 1, 2 + hash(seed++) * 2);
    else c.fillRect(x, y, 1.4, 1.4);
  }
  c.strokeStyle = id === "tex-sidewalk" ? "#b9b4aa" : "#a9805f";
  c.lineWidth = 1;
  if (id === "tex-sidewalk") {
    for (let k = 0; k <= size; k += 32) {
      c.beginPath();
      c.moveTo(k + 0.5, 0);
      c.lineTo(k + 0.5, size);
      c.moveTo(0, k + 0.5);
      c.lineTo(size, k + 0.5);
      c.stroke();
    }
  } else if (id === "tex-paving") {
    for (let row = 0; row < size / 16; row++) {
      c.beginPath();
      c.moveTo(0, row * 16 + 0.5);
      c.lineTo(size, row * 16 + 0.5);
      for (let col = 0; col < size / 32; col++) {
        const x = col * 32 + (row % 2) * 16 + 0.5;
        c.moveTo(x, row * 16);
        c.lineTo(x, row * 16 + 16);
      }
      c.stroke();
    }
  }
  fallbackTextures.set(id, canvas);
  return canvas;
}

/** A repeating pattern of a texture, `tile` px wide on screen. */
function pattern(
  context: CanvasRenderingContext2D,
  art: Art,
  id: Texture,
  tile: number,
): CanvasPattern | string {
  const image = art.image(id);
  const source =
    (image as unknown as CanvasImageSource | undefined) ?? fallbackTexture(id);
  const width = image ? (art.asset(id)?.width ?? 512) : 128;
  const result = context.createPattern(source, "repeat");
  if (!result) return "#888";
  if (typeof DOMMatrix !== "undefined")
    result.setTransform(new DOMMatrix().scale(tile / width));
  return result;
}

// ---- shadows ---------------------------------------------------------------------------------------------------------

const silhouettes = new WeakMap<object, HTMLCanvasElement>();
/** A small black silhouette of a loaded picture (drawn small and scaled up, so its edges blur for free). */
function silhouette(
  image: CanvasImageSource & object,
  frameWidth: number,
  height: number,
): HTMLCanvasElement {
  const known = silhouettes.get(image);
  if (known) return known;
  const scale = 48 / Math.max(frameWidth, height);
  const canvas = makeCanvas(frameWidth * scale, height * scale),
    c = canvas.getContext("2d")!;
  c.drawImage(
    image,
    0,
    0,
    frameWidth,
    height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  c.globalCompositeOperation = "source-in";
  c.fillStyle = "#000";
  c.fillRect(0, 0, canvas.width, canvas.height);
  silhouettes.set(image, canvas);
  return canvas;
}

/** A cast shadow: the shape laid down on the ground toward the bottom right, from its anchor. */
function castShadow(
  context: CanvasRenderingContext2D,
  art: Art,
  id: string,
  x: number,
  y: number,
  width: number,
  strength = 0.26,
): void {
  const asset = art.asset(id),
    image = art.image(id);
  context.save();
  context.globalAlpha = strength;
  if (asset && image) {
    const frames = asset.frames ?? 1,
      frameWidth = asset.width / frames,
      height = (width * asset.height) / frameWidth;
    const shape = silhouette(
      image as unknown as CanvasImageSource & object,
      frameWidth,
      asset.height,
    );
    context.translate(x, y);
    context.transform(1, 0, -0.75, -0.32, 0, 0);
    context.drawImage(
      shape,
      -asset.anchor[0] * width,
      -asset.anchor[1] * height,
      width,
      height,
    );
  } else {
    // A stand-in: a long soft blob toward the bottom right.
    context.translate(x, y);
    context.transform(1, 0, -0.75, -0.32, 0, 0);
    context.fillStyle = "#000";
    context.beginPath();
    context.ellipse(
      0,
      -width * 0.35,
      width * 0.3,
      width * 0.35,
      0,
      0,
      Math.PI * 2,
    );
    context.fill();
  }
  context.restore();
}

/** A soft dark patch right under something standing on the ground. */
function contactShadow(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  alpha = 0.3,
): void {
  const gradient = context.createRadialGradient(x, y, 0, x, y, rx);
  gradient.addColorStop(0, `rgba(10, 16, 20, ${alpha})`);
  gradient.addColorStop(1, "rgba(10, 16, 20, 0)");
  context.save();
  context.translate(x, y);
  context.scale(1, ry / rx);
  context.translate(-x, -y);
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(x, y, rx, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

// ---- procedural stand-ins for missing sprites -------------------------------------------------------------------

/** A missing building: a little block with a side wall, a roof, windows, a door and an awning in its colour. */
function drawFallbackBuilding(
  context: CanvasRenderingContext2D,
  color: string,
  label: string,
  seed: number,
  x: number,
  y: number,
  s: number,
): void {
  const w = s * 0.6,
    h = s * (0.38 + hash(seed) * 0.26),
    depth = s * 0.2,
    left = x - w / 2 - depth * 0.35,
    base = y - s * 0.08;
  context.save();
  context.lineJoin = "round";
  context.lineWidth = Math.max(1, s * 0.012);
  context.strokeStyle = "rgba(20, 28, 36, 0.55)";
  // Side wall, going back to the upper right.
  context.beginPath();
  context.moveTo(left + w, base);
  context.lineTo(left + w + depth, base - depth * 0.6);
  context.lineTo(left + w + depth, base - depth * 0.6 - h);
  context.lineTo(left + w, base - h);
  context.closePath();
  context.fillStyle = shade(color, -0.28);
  context.fill();
  context.stroke();
  // Roof.
  context.beginPath();
  context.moveTo(left, base - h);
  context.lineTo(left + w, base - h);
  context.lineTo(left + w + depth, base - h - depth * 0.6);
  context.lineTo(left + depth, base - h - depth * 0.6);
  context.closePath();
  context.fillStyle = shade(color, 0.35);
  context.fill();
  context.stroke();
  // Front wall with a light gradient.
  const front = context.createLinearGradient(left, base - h, left + w, base);
  front.addColorStop(0, shade(color, 0.12));
  front.addColorStop(1, shade(color, -0.08));
  context.fillStyle = front;
  context.fillRect(left, base - h, w, h);
  context.strokeRect(left, base - h, w, h);
  // Windows.
  const rows = Math.max(1, Math.floor((h - s * 0.24) / (s * 0.11)));
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < 3; col++) {
      const wx = left + w * (0.12 + col * 0.29),
        wy = base - h + s * 0.06 + row * s * 0.11;
      context.fillStyle =
        hash(seed + row * 7 + col) > 0.7 ? "#ffe9a8" : "#9fc6dd";
      context.fillRect(wx, wy, w * 0.18, s * 0.07);
      context.fillStyle = "rgba(255,255,255,0.45)";
      context.fillRect(wx, wy, w * 0.18, s * 0.015);
    }
  // Awning, sign and door.
  context.fillStyle = shade(color, -0.45);
  context.fillRect(left + w * 0.38, base - s * 0.15, w * 0.24, s * 0.15);
  for (let k = 0; k < 6; k++) {
    context.fillStyle = k % 2 ? "#fff8ec" : shade(color, -0.2);
    context.fillRect(left + (w * k) / 6, base - s * 0.2, w / 6, s * 0.045);
  }
  context.fillStyle = "#fff8ec";
  roundRect(
    context,
    left + w * 0.14,
    base - s * 0.31,
    w * 0.72,
    s * 0.09,
    s * 0.02,
  );
  context.fill();
  context.fillStyle = INK;
  context.font = `800 ${Math.max(7, s * 0.065)}px ${FONT}`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, left + w / 2, base - s * 0.263);
  context.restore();
}

type Prop =
  | "prop-tree-1"
  | "prop-tree-2"
  | "prop-lamp"
  | "prop-bench"
  | "prop-car-1"
  | "prop-car-2"
  | "prop-car-3"
  | "prop-hydrant"
  | "prop-bus-stop"
  | "prop-planter";

/** A missing prop, drawn as simple shaded shapes standing on (x, y), `s` px wide. */
function drawFallbackProp(
  context: CanvasRenderingContext2D,
  id: Prop,
  x: number,
  y: number,
  s: number,
): void {
  context.save();
  context.lineWidth = Math.max(1, s * 0.03);
  context.strokeStyle = "rgba(20, 28, 36, 0.45)";
  const blob = (cx: number, cy: number, r: number, fill: string) => {
    const g = context.createRadialGradient(
      cx - r * 0.35,
      cy - r * 0.4,
      r * 0.1,
      cx,
      cy,
      r,
    );
    g.addColorStop(0, shade(fill, 0.25));
    g.addColorStop(1, shade(fill, -0.25));
    context.fillStyle = g;
    context.beginPath();
    context.arc(cx, cy, r, 0, Math.PI * 2);
    context.fill();
  };
  switch (id) {
    case "prop-tree-1":
    case "prop-tree-2": {
      context.fillStyle = "#6b4a32";
      context.fillRect(x - s * 0.04, y - s * 0.32, s * 0.08, s * 0.32);
      if (id === "prop-tree-2") {
        for (let k = 0; k < 3; k++)
          blob(x, y - s * (0.42 + k * 0.17), s * (0.19 - k * 0.035), "#3f7d3c");
      } else {
        blob(x - s * 0.14, y - s * 0.42, s * 0.2, "#4f8f3f");
        blob(x + s * 0.15, y - s * 0.44, s * 0.2, "#4a8a3c");
        blob(x, y - s * 0.6, s * 0.24, "#5a9a45");
      }
      break;
    }
    case "prop-lamp": {
      context.fillStyle = "#2c3238";
      context.fillRect(x - s * 0.025, y - s * 0.8, s * 0.05, s * 0.8);
      context.fillRect(x - s * 0.07, y - s * 0.04, s * 0.14, s * 0.04);
      const glow = context.createRadialGradient(
        x,
        y - s * 0.82,
        0,
        x,
        y - s * 0.82,
        s * 0.22,
      );
      glow.addColorStop(0, "rgba(255, 228, 150, 0.9)");
      glow.addColorStop(1, "rgba(255, 228, 150, 0)");
      context.fillStyle = glow;
      context.beginPath();
      context.arc(x, y - s * 0.82, s * 0.22, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#fff1c4";
      context.beginPath();
      context.arc(x, y - s * 0.82, s * 0.06, 0, Math.PI * 2);
      context.fill();
      break;
    }
    case "prop-bench":
      context.fillStyle = "#3a3f45";
      context.fillRect(x - s * 0.3, y - s * 0.12, s * 0.04, s * 0.12);
      context.fillRect(x + s * 0.26, y - s * 0.12, s * 0.04, s * 0.12);
      context.fillStyle = "#a0683f";
      context.fillRect(x - s * 0.34, y - s * 0.16, s * 0.68, s * 0.06);
      context.fillRect(x - s * 0.34, y - s * 0.3, s * 0.68, s * 0.06);
      break;
    case "prop-car-1":
    case "prop-car-2":
    case "prop-car-3": {
      const color = {
        "prop-car-1": "#d64545",
        "prop-car-2": "#eef0f2",
        "prop-car-3": "#2fa3a0",
      }[id];
      const van = id === "prop-car-2";
      context.fillStyle = color;
      roundRect(
        context,
        x - s * 0.42,
        y - s * 0.3,
        s * 0.84,
        s * 0.2,
        s * 0.06,
      );
      context.fill();
      context.stroke();
      roundRect(
        context,
        x - s * (van ? 0.4 : 0.26),
        y - s * 0.46,
        s * (van ? 0.62 : 0.48),
        s * 0.2,
        s * 0.07,
      );
      context.fill();
      context.stroke();
      context.fillStyle = "#28465c";
      roundRect(
        context,
        x - s * (van ? 0.36 : 0.22),
        y - s * 0.43,
        s * 0.18,
        s * 0.12,
        s * 0.03,
      );
      context.fill();
      roundRect(context, x, y - s * 0.43, s * 0.18, s * 0.12, s * 0.03);
      context.fill();
      context.fillStyle = "#1c1f22";
      for (const wx of [-0.25, 0.25]) {
        context.beginPath();
        context.arc(x + s * wx, y - s * 0.1, s * 0.08, 0, Math.PI * 2);
        context.fill();
      }
      break;
    }
    case "prop-hydrant":
      context.fillStyle = "#c8352e";
      roundRect(
        context,
        x - s * 0.08,
        y - s * 0.3,
        s * 0.16,
        s * 0.3,
        s * 0.05,
      );
      context.fill();
      context.fillRect(x - s * 0.13, y - s * 0.2, s * 0.26, s * 0.06);
      break;
    case "prop-bus-stop":
      context.fillStyle = "rgba(190, 225, 240, 0.55)";
      context.fillRect(x - s * 0.36, y - s * 0.55, s * 0.72, s * 0.5);
      context.strokeRect(x - s * 0.36, y - s * 0.55, s * 0.72, s * 0.5);
      context.fillStyle = "#2f3a44";
      context.fillRect(x - s * 0.42, y - s * 0.62, s * 0.84, s * 0.08);
      context.fillRect(x - s * 0.3, y - s * 0.2, s * 0.6, s * 0.05);
      break;
    case "prop-planter":
      context.fillStyle = "#8b8f94";
      context.fillRect(x - s * 0.22, y - s * 0.16, s * 0.44, s * 0.16);
      blob(x - s * 0.08, y - s * 0.22, s * 0.12, "#5e9a4a");
      blob(x + s * 0.1, y - s * 0.24, s * 0.12, "#e07a8f");
      break;
  }
  context.restore();
}

// ---- the scene ---------------------------------------------------------------------------------------------------

interface Sprite {
  /** Draw order: the ground line, back to front. */
  y: number;
  shadow(context: CanvasRenderingContext2D): void;
  draw(context: CanvasRenderingContext2D): void;
}

interface PropSpot {
  id: Prop;
  x: number;
  y: number;
  s: number;
  flip: boolean;
}
const sceneryCache = new WeakMap<Geometry, PropSpot[]>();

/** Where the street furniture stands: placed once per layout from the geometry alone, so it never jumps. */
function scenery(g: Geometry): PropSpot[] {
  const known = sceneryCache.get(g);
  if (known) return known;
  const props: PropSpot[] = [];
  const s = g.size;
  const doors = g.placeLot.map((lot) => g.lots[lot]!.t);
  const perimeter =
    2 * (g.right - g.left + g.bottom - g.top) - (8 - 2 * Math.PI) * g.radius;
  const crossing = (s * 0.5) / perimeter;
  // Lamps on the outer sidewalk, street trees on the park's edge, both clear of the crossings.
  const step = (s * 1.25) / perimeter;
  for (let t = step / 2, k = 0; t < 1; t += step, k++) {
    if (!doors.some((door) => near(door, t, crossing * 1.4))) {
      const at = streetPoint(g, t, g.road / 2 + g.walk * 0.8);
      props.push({
        id: "prop-lamp",
        x: at.x,
        y: at.y,
        s: s * 0.32,
        flip: false,
      });
    }
    const tree = wrap(t + step / 2);
    if (!doors.some((door) => near(door, tree, crossing))) {
      const at = streetPoint(g, tree, -(g.road / 2 + g.walk + s * 0.12));
      props.push({
        id: hash(k * 31) > 0.5 ? "prop-tree-1" : "prop-tree-2",
        x: at.x,
        y: at.y,
        s: s * (0.46 + hash(k * 17) * 0.12),
        flip: hash(k * 13) > 0.5,
      });
    }
  }
  // A hydrant beside some doors.
  doors.forEach((t, index) => {
    if (hash(index * 7 + 3) > 0.55) return;
    const at = streetPoint(
      g,
      wrap(t + crossing * 1.1),
      g.road / 2 + g.walk * 0.55,
    );
    props.push({
      id: "prop-hydrant",
      x: at.x,
      y: at.y,
      s: s * 0.18,
      flip: false,
    });
  });
  // Parked cars along the outer lane of the top and bottom straights.
  let car = 0;
  for (let t = 0.01; t < 1; t += step * 0.9) {
    const at = streetPoint(g, t, g.road * 0.22);
    if (Math.abs(at.nx) > 0.01) continue;
    if (doors.some((door) => near(door, t, crossing * 1.8))) continue;
    if (hash(Math.round(t * 997)) > 0.45) continue;
    const id = (["prop-car-1", "prop-car-2", "prop-car-3"] as const)[
      car++ % 3
    ]!;
    props.push({
      id,
      x: at.x,
      y: at.y + g.road * 0.18,
      s: g.road * 1.35,
      flip: at.ny > 0,
    });
  }
  // The lots no place uses are little pocket parks.
  const used = new Set(g.placeLot);
  g.lots.forEach((lot, index) => {
    if (used.has(index)) return;
    const add = (
      id: Prop,
      dx: number,
      dy: number,
      size: number,
      flip = false,
    ) =>
      props.push({
        id,
        x: lot.x + dx * s,
        y: lot.y + dy * s,
        s: size * s,
        flip,
      });
    const kind = index % 3;
    if (kind === 0) {
      add("prop-tree-1", -0.2, 0.05, 0.62);
      add("prop-tree-2", 0.22, -0.05, 0.55);
      add("prop-bench", 0.02, 0.3, 0.36);
    } else if (kind === 1) {
      add("prop-bus-stop", 0, 0.28, 0.5);
      add("prop-tree-1", -0.25, -0.12, 0.58, true);
      add("prop-planter", 0.28, 0, 0.3);
    } else {
      add("prop-tree-2", -0.24, -0.1, 0.56);
      add("prop-tree-1", 0.2, 0.12, 0.64, true);
      add("prop-planter", -0.12, 0.3, 0.28);
    }
  });
  // A few trees in the park's corners.
  const p = g.park,
    inset = Math.min(p.w, p.h) * 0.12;
  if (p.w > s * 0.9 && p.h > s * 0.9)
    [
      [p.x + inset, p.y + inset * 1.6],
      [p.x + p.w - inset, p.y + inset * 1.6],
      [p.x + inset, p.y + p.h - inset * 0.5],
      [p.x + p.w - inset, p.y + p.h - inset * 0.5],
    ].forEach(([x, y], k) =>
      props.push({
        id: k % 2 ? "prop-tree-2" : "prop-tree-1",
        x: x!,
        y: y!,
        s: s * 0.5,
        flip: k > 1,
      }),
    );
  sceneryCache.set(g, props);
  return props;
}

/** The street's rounded rectangle as a path, `offset` px out from its centre line. */
function streetPath(
  context: CanvasRenderingContext2D,
  g: Geometry,
  offset = 0,
): void {
  roundRect(
    context,
    g.left - offset,
    g.top - offset,
    g.right - g.left + 2 * offset,
    g.bottom - g.top + 2 * offset,
    Math.max(0, g.radius + offset),
  );
}

const groundCache = new WeakMap<
  Geometry,
  { canvas: HTMLCanvasElement; key: string }
>();
const GROUND_ART = [
  "tex-asphalt",
  "tex-sidewalk",
  "tex-grass",
  "tex-paving",
  "board-center",
] as const;

/** Everything flat on the ground, drawn once per layout (and again when a texture loads) into an offscreen canvas. */
function ground(g: Geometry, art: Art, ratio: number): HTMLCanvasElement {
  const key = [ratio, ...GROUND_ART.map((id) => (art.image(id) ? 1 : 0))].join(
      "",
    ),
    known = groundCache.get(g);
  if (known && known.key === key) return known.canvas;
  const canvas = makeCanvas(g.width * ratio, g.height * ratio),
    c = canvas.getContext("2d")!;
  c.setTransform(ratio, 0, 0, ratio, 0, 0);
  const s = g.size;
  // Lawn everywhere.
  c.fillStyle = pattern(c, art, "tex-grass", s * 1.6);
  c.fillRect(0, 0, g.width, g.height);
  // A worn patch of ground under every building.
  for (const lot of g.placeLot.map((index) => g.lots[index]!))
    contactShadow(
      c,
      lot.x + s * 0.04,
      lot.y + s * 0.3,
      s * 0.52,
      s * 0.2,
      0.22,
    );
  // Sidewalks either side of the road, with a soft edge on the lawn.
  c.lineJoin = "round";
  streetPath(c, g);
  c.lineWidth = g.road + 2 * g.walk + 4;
  c.strokeStyle = "rgba(20, 30, 20, 0.22)";
  c.stroke();
  streetPath(c, g);
  c.lineWidth = g.road + 2 * g.walk;
  c.strokeStyle = pattern(c, art, "tex-sidewalk", s * 0.7);
  c.stroke();
  // Raised curbs: a light kerb stone with a dark gutter shadow toward the road.
  streetPath(c, g);
  c.lineWidth = g.road + 5;
  c.strokeStyle = "#eceae4";
  c.stroke();
  streetPath(c, g);
  c.lineWidth = g.road + 1.5;
  c.strokeStyle = "rgba(30, 34, 40, 0.6)";
  c.stroke();
  // The asphalt, darker along both gutters.
  streetPath(c, g);
  c.lineWidth = g.road;
  c.strokeStyle = pattern(c, art, "tex-asphalt", s * 1.2);
  c.stroke();
  for (const side of [-1, 1]) {
    streetPath(c, g, side * g.road * 0.42);
    c.lineWidth = g.road * 0.16;
    c.strokeStyle = "rgba(20, 22, 26, 0.18)";
    c.stroke();
  }
  // Lane markings: a dashed centre line and faint edge lines.
  streetPath(c, g);
  c.setLineDash([g.road * 0.55, g.road * 0.55]);
  c.lineWidth = Math.max(1.5, g.road * 0.06);
  c.strokeStyle = "rgba(255, 252, 240, 0.85)";
  c.stroke();
  c.setLineDash([]);
  for (const side of [-1, 1]) {
    streetPath(c, g, side * g.road * 0.36);
    c.lineWidth = Math.max(1, g.road * 0.03);
    c.strokeStyle = "rgba(255, 252, 240, 0.4)";
    c.stroke();
  }
  // Zebra crossings in front of every place.
  for (const lot of g.placeLot) {
    const at = streetPoint(g, g.lots[lot]!.t);
    c.save();
    c.translate(at.x, at.y);
    c.rotate(Math.atan2(at.ny, at.nx));
    const width = s * 0.46,
      stripes = 5,
      stripe = width / (stripes * 2 - 1);
    // Fresh asphalt under the crossing hides the centre line.
    c.fillStyle = pattern(c, art, "tex-asphalt", s * 1.2);
    c.fillRect(
      -g.road * 0.47,
      -width / 2 - stripe,
      g.road * 0.94,
      width + 2 * stripe,
    );
    c.fillStyle = "rgba(250, 248, 240, 0.92)";
    for (let k = 0; k < stripes; k++)
      c.fillRect(
        -g.road * 0.4,
        -width / 2 + k * 2 * stripe,
        g.road * 0.8,
        stripe,
      );
    c.restore();
  }
  // The park: a paved footpath loop and the centre piece.
  const p = g.park,
    path = Math.max(6, g.walk * 1.1),
    inset = Math.min(p.w, p.h) * 0.14;
  if (p.w > path * 6 && p.h > path * 6) {
    roundRect(
      c,
      p.x + inset,
      p.y + inset,
      p.w - 2 * inset,
      p.h - 2 * inset,
      Math.min(p.w, p.h) * 0.2,
    );
    c.lineWidth = path;
    c.strokeStyle = pattern(c, art, "tex-paving", s * 0.8);
    c.stroke();
  }
  const center = art.asset("board-center"),
    centerImage = art.image("board-center");
  if (center && centerImage) {
    const scale = Math.min(
      (p.w * 0.9) / center.width,
      (p.h * 0.9) / center.height,
    );
    const w = center.width * scale,
      h = center.height * scale;
    c.save();
    c.shadowColor = "rgba(20, 30, 20, 0.3)";
    c.shadowBlur = s * 0.12;
    c.shadowOffsetX = s * 0.05;
    c.shadowOffsetY = s * 0.06;
    c.drawImage(
      centerImage as unknown as CanvasImageSource,
      p.x + p.w / 2 - w / 2,
      p.y + p.h / 2 - h / 2,
      w,
      h,
    );
    c.restore();
  } else {
    // A plaza with a pond.
    const cx = p.x + p.w / 2,
      cy = p.y + p.h / 2,
      r = Math.min(p.w * 0.3, p.h * 0.28);
    contactShadow(c, cx + r * 0.12, cy + r * 0.12, r * 1.3, r * 0.95, 0.25);
    c.fillStyle = pattern(c, art, "tex-paving", s * 0.8);
    c.beginPath();
    c.ellipse(cx, cy, r * 1.15, r * 0.85, 0, 0, Math.PI * 2);
    c.fill();
    const water = c.createRadialGradient(
      cx - r * 0.3,
      cy - r * 0.3,
      r * 0.1,
      cx,
      cy,
      r,
    );
    water.addColorStop(0, "#a8dcef");
    water.addColorStop(1, "#3f8fb5");
    c.fillStyle = water;
    c.beginPath();
    c.ellipse(cx, cy, r * 0.92, r * 0.64, 0, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = "rgba(255,255,255,0.6)";
    c.lineWidth = 1.5;
    c.beginPath();
    c.ellipse(cx, cy, r * 0.4, r * 0.25, 0, 0, Math.PI * 2);
    c.stroke();
  }
  groundCache.set(g, { canvas, key });
  return canvas;
}

/** Draws a sprite by id, or its stand-in when the picture is missing. */
function sprite(
  context: CanvasRenderingContext2D,
  art: Art,
  id: string,
  x: number,
  y: number,
  width: number,
  flip = false,
  frame = 0,
): void {
  context.save();
  if (flip) {
    context.translate(x, 0);
    context.scale(-1, 1);
    context.translate(-x, 0);
  }
  if (art.image(id)) art.draw(context, id, x, y, width, frame);
  else if (id.startsWith("prop-"))
    drawFallbackProp(context, id as Prop, x, y, width);
  else if (id.startsWith("building-")) {
    const asset = art.asset(id);
    drawFallbackBuilding(
      context,
      asset?.color ?? "#99aaaa",
      asset?.label ?? "",
      id.length * 13 + id.charCodeAt(9),
      x,
      y,
      width,
    );
  } else art.draw(context, id, x, y, width, frame);
  context.restore();
}

/** One walker: an avatar sprite (or a disc with an initial), a coloured ring at the feet, a marker over yours. */
function drawWalker(
  c: CanvasRenderingContext2D,
  art: Art,
  player: BoardPlayer,
  at: Point,
  size: number,
  walking: boolean,
  left: boolean,
  time: number,
): void {
  const id = `avatar-${player.avatar}-${walking ? "walk" : "idle"}`;
  c.save();
  c.strokeStyle = player.color;
  c.lineWidth = player.you ? 3 : 2;
  c.beginPath();
  c.ellipse(at.x, at.y, size * 0.26, size * 0.09, 0, 0, Math.PI * 2);
  c.stroke();
  if (player.done) c.globalAlpha = 0.6;
  if (art.image(id))
    sprite(c, art, id, at.x, at.y, size, left, Math.floor(time * 6));
  else {
    const r = size * 0.32,
      bob = walking ? Math.abs(Math.sin(time * 10)) * r * 0.25 : 0;
    c.beginPath();
    c.arc(at.x, at.y - r - bob, r, 0, Math.PI * 2);
    c.fillStyle = player.color;
    c.fill();
    c.lineWidth = 2;
    c.strokeStyle = "#fff";
    c.stroke();
    c.fillStyle = INK;
    c.font = `800 ${r}px ${FONT}`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText((player.name[0] ?? "?").toUpperCase(), at.x, at.y - r - bob + 1);
  }
  c.restore();
  if (!player.you) return;
  const y = at.y - size * 1.02 + Math.sin(time * 4) * 2;
  c.save();
  c.beginPath();
  c.moveTo(at.x - 7, y - 9);
  c.lineTo(at.x + 7, y - 9);
  c.lineTo(at.x, y);
  c.closePath();
  c.fillStyle = player.color;
  c.shadowColor = "rgba(0,0,0,0.35)";
  c.shadowBlur = 4;
  c.shadowOffsetY = 2;
  c.fill();
  c.lineWidth = 2;
  c.strokeStyle = "#fff";
  c.stroke();
  c.restore();
}

export function drawBoard(
  context: CanvasRenderingContext2D,
  g: Geometry,
  frame: BoardFrame,
  art: Art,
  ratio = 1,
): void {
  const { width, height } = g;
  const s = g.size;
  context.clearRect(0, 0, width, height);
  context.drawImage(ground(g, art, ratio), 0, 0, width, height);

  const sprites: Sprite[] = [];
  // Buildings.
  for (const place of frame.places) {
    const lot = g.lots[g.placeLot[place.index]!]!,
      id = `building-${place.id}`;
    const ax = lot.x,
      ay = lot.y + s * 0.42;
    sprites.push({
      y: ay,
      shadow: (c) => castShadow(c, art, id, ax, ay - s * 0.06, s * 0.96, 0.2),
      draw: (c) => {
        if (place.here || place.dest || place.index === frame.hover) {
          const pulse = place.dest ? 0.5 + 0.5 * Math.sin(frame.time * 5) : 1;
          const box = lotBox(g, lot);
          c.save();
          roundRect(
            c,
            box.x + s * 0.04,
            lot.y - s * 0.3,
            box.w - s * 0.08,
            s * 0.72,
            s * 0.08,
          );
          c.lineWidth = Math.max(2.5, s * 0.03);
          c.strokeStyle = place.here
            ? "rgba(46, 204, 113, 0.95)"
            : place.dest
              ? `rgba(255, 196, 61, ${0.45 + 0.55 * pulse})`
              : "rgba(255, 255, 255, 0.9)";
          c.shadowColor = c.strokeStyle;
          c.shadowBlur = s * 0.12;
          c.stroke();
          c.restore();
        }
        sprite(c, art, id, ax, ay, s * 0.96);
      },
    });
  }
  // Street furniture.
  for (const prop of scenery(g)) {
    sprites.push({
      y: prop.y,
      shadow: (c) => {
        contactShadow(c, prop.x, prop.y, prop.s * 0.3, prop.s * 0.1, 0.28);
        castShadow(c, art, prop.id, prop.x, prop.y, prop.s, 0.18);
      },
      draw: (c) => sprite(c, art, prop.id, prop.x, prop.y, prop.s, prop.flip),
    });
  }
  // Walkers: on the inner sidewalk, or at the door of the place they are in.
  const avatar = Math.max(26, s * 0.4);
  const inside = new Map<number, number>();
  frame.players.forEach((player, index) => {
    const before = frame.before.get(player.id) ?? player.pos;
    const ring = ringBetween(before, player.pos, frame.fraction);
    const walking = player.dest >= 0 && before !== player.pos;
    let at: Point;
    if (player.inside >= 0) {
      const n = inside.get(player.inside) ?? 0;
      inside.set(player.inside, n + 1);
      const door = doorPoint(g, player.inside),
        spread = (n - 0.5) * avatar * 0.6;
      at = { x: door.x - door.ny * spread, y: door.y + door.nx * spread };
    } else {
      const p = walkPoint(g, ring);
      at = { x: p.x + (index - 1.5) * 2.5, y: p.y + (index - 1.5) * 1.5 };
    }
    const ahead = walkPoint(
      g,
      ringBetween(before, player.pos, Math.min(1, frame.fraction + 0.15)),
    );
    const left = walking && ahead.x < walkPoint(g, ring).x - 0.01;
    sprites.push({
      y: at.y + (player.you ? 0.5 : 0),
      shadow: (c) =>
        contactShadow(c, at.x, at.y, avatar * 0.28, avatar * 0.1, 0.4),
      draw: (c) =>
        drawWalker(c, art, player, at, avatar, walking, left, frame.time),
    });
  });
  sprites.sort((a, b) => a.y - b.y);
  for (const item of sprites) item.shadow(context);
  for (const item of sprites) item.draw(context);

  // Name plates under the buildings.
  const font = Math.max(10, Math.min(15, s * 0.11));
  const plate = `800 ${font}px ${FONT}`;
  context.font = plate;
  context.textAlign = "center";
  context.textBaseline = "middle";
  for (const place of frame.places) {
    const lot = g.lots[g.placeLot[place.index]!]!;
    const tw = context.measureText(place.name).width + font * 1.2,
      th = font * 1.65,
      x = Math.min(width - tw / 2 - 2, Math.max(tw / 2 + 2, lot.x)),
      y = lot.y + s * 0.44;
    context.save();
    context.shadowColor = "rgba(15, 25, 35, 0.35)";
    context.shadowBlur = 6;
    context.shadowOffsetY = 2;
    roundRect(context, x - tw / 2, y - th / 2, tw, th, th / 2);
    context.fillStyle = place.here
      ? "#2ecc71"
      : place.dest
        ? "#ffc43d"
        : "rgba(255, 255, 255, 0.94)";
    context.fill();
    context.restore();
    context.fillStyle = INK;
    context.fillText(place.name, x, y + 0.5);
    if (place.work) {
      const bx = x + tw / 2 - 2,
        by = y - th / 2 - 2;
      context.beginPath();
      context.arc(bx, by, font * 0.72, 0, Math.PI * 2);
      context.fillStyle = "#ffc43d";
      context.fill();
      context.lineWidth = 1.5;
      context.strokeStyle = "#fff";
      context.stroke();
      context.fillStyle = INK;
      context.font = `900 ${font * 0.8}px ${FONT}`;
      context.fillText("W", bx, by + 0.5);
      context.font = plate;
    }
  }

  // Late-afternoon light and a soft vignette.
  const light = context.createLinearGradient(0, 0, width, height);
  light.addColorStop(0, "rgba(255, 214, 150, 0.10)");
  light.addColorStop(1, "rgba(40, 60, 100, 0.10)");
  context.fillStyle = light;
  context.fillRect(0, 0, width, height);
  const vignette = context.createRadialGradient(
    width / 2,
    height / 2,
    Math.min(width, height) * 0.45,
    width / 2,
    height / 2,
    Math.hypot(width, height) * 0.6,
  );
  vignette.addColorStop(0, "rgba(10, 20, 25, 0)");
  vignette.addColorStop(1, "rgba(10, 20, 25, 0.3)");
  context.fillStyle = vignette;
  context.fillRect(0, 0, width, height);
}
