import { CARGO_KINDS } from "../engine/view-kit.js";
import { DEPOT, seatColor, seatShade } from "./palette.js";

/**
 * Pre-painted sprites: every locomotive, wagon and cart is drawn once per colour and cargo into an offscreen canvas at
 * three times its size, so a frame only blits and rotates them. Each is drawn facing right (+x) about its centre.
 */
export type Surface = HTMLCanvasElement | OffscreenCanvas;
export type Paint =
  CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type MakeSurface = (width: number, height: number) => Surface;

export const SPRITE_SCALE = 3;
/** The drawings are made at a 38 × 20 locomotive and a 27 × 18 wagon; the depot shows them this much larger. */
export const LOCO_SIZE = 1.2;
export const WAGON_SIZE = 1.18;

export interface Sprite {
  surface: Surface;
  /** The anchor (the body's centre) in logical pixels from the top-left. */
  ox: number;
  oy: number;
  width: number;
  height: number;
}

const OUTLINE = "#06070d";

function sprite(
  make: MakeSurface,
  width: number,
  height: number,
  draw: (g: Paint) => void,
  size = 1,
): Sprite {
  const surface = make(width * SPRITE_SCALE, height * SPRITE_SCALE);
  const g = surface.getContext("2d") as Paint;
  g.scale(SPRITE_SCALE, SPRITE_SCALE);
  g.translate(width / 2, height / 2);
  g.scale(size, size);
  draw(g);
  return { surface, ox: width / 2, oy: height / 2, width, height };
}

export function roundRect(
  g: Paint,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + radius, y);
  g.arcTo(x + w, y, x + w, y + h, radius);
  g.arcTo(x + w, y + h, x, y + h, radius);
  g.arcTo(x, y + h, x, y, radius);
  g.arcTo(x, y, x + w, y, radius);
  g.closePath();
}

const circle = (g: Paint, x: number, y: number, r: number) => {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
};

/** Lightens (amount > 0) or darkens a hex colour. */
export function tint(hex: string, amount: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const mix = (c: number) =>
    Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount));
  const r = mix((n >> 16) & 255),
    gr = mix((n >> 8) & 255),
    b = mix(n & 255);
  return `#${((1 << 24) | (r << 16) | (gr << 8) | b).toString(16).slice(1)}`;
}

/** A little steam locomotive seen from above: cab at the back, boiler with brass bands, chimney, lamp. */
export function drawLoco(g: Paint, color: string, shade: string): void {
  g.lineJoin = "round";
  // Wheels, peeking out at the sides.
  g.fillStyle = "#0b0d14";
  for (const wx of [-13, -5, 3, 11]) {
    roundRect(g, wx - 3, -11.5, 6, 3.5, 1.2);
    g.fill();
    roundRect(g, wx - 3, 8, 6, 3.5, 1.2);
    g.fill();
  }
  g.fillStyle = OUTLINE;
  roundRect(g, -19.5, -10, 39, 20, 4.5);
  g.fill();
  g.fillStyle = "#2c3140";
  roundRect(g, -18.5, -9, 37, 18, 4);
  g.fill();
  // Cowcatcher.
  g.fillStyle = "#6b7288";
  g.beginPath();
  g.moveTo(15, -7.5);
  g.lineTo(22, 0);
  g.lineTo(15, 7.5);
  g.closePath();
  g.fill();
  g.strokeStyle = OUTLINE;
  g.lineWidth = 0.9;
  g.stroke();
  for (const cy of [-3.5, 0, 3.5]) {
    g.beginPath();
    g.moveTo(15.5, cy);
    g.lineTo(20.5, cy * 0.3);
    g.stroke();
  }
  // Boiler, lit along its top.
  const boiler = g.createLinearGradient(0, -7, 0, 7);
  boiler.addColorStop(0, shade);
  boiler.addColorStop(0.28, color);
  boiler.addColorStop(0.42, tint(color, 0.3));
  boiler.addColorStop(0.6, color);
  boiler.addColorStop(1, shade);
  g.fillStyle = boiler;
  roundRect(g, -6, -7, 22, 14, 7);
  g.fill();
  g.strokeStyle = OUTLINE;
  g.lineWidth = 1;
  g.stroke();
  g.fillStyle = DEPOT.brass;
  for (const bx of [-2, 4.5, 11]) g.fillRect(bx, -7, 1.7, 14);
  g.fillStyle = "#1a1c26";
  roundRect(g, 13.5, -6, 3, 12, 1.5);
  g.fill();
  // Dome and chimney.
  circle(g, 1.5, 0, 3.1);
  g.fillStyle = DEPOT.brass;
  g.fill();
  circle(g, 0.8, -0.8, 1.3);
  g.fillStyle = DEPOT.brassLight;
  g.fill();
  circle(g, 9.5, 0, 4);
  g.fillStyle = DEPOT.brassDark;
  g.fill();
  circle(g, 9.5, 0, 2.8);
  g.fillStyle = "#07080c";
  g.fill();
  // The cab: a roof in the seat colour with a brass rim.
  g.fillStyle = OUTLINE;
  roundRect(g, -19, -9.5, 14.5, 19, 3);
  g.fill();
  g.fillStyle = shade;
  roundRect(g, -18, -8.5, 12.5, 17, 2.5);
  g.fill();
  const roof = g.createLinearGradient(0, -8, 0, 8);
  roof.addColorStop(0, tint(color, 0.35));
  roof.addColorStop(1, color);
  g.fillStyle = roof;
  roundRect(g, -16.8, -7.2, 10, 14.4, 2);
  g.fill();
  g.strokeStyle = DEPOT.brass;
  g.lineWidth = 0.9;
  roundRect(g, -16.8, -7.2, 10, 14.4, 2);
  g.stroke();
  g.strokeStyle = hexShade(color);
  g.beginPath();
  g.moveTo(-11.8, -7);
  g.lineTo(-11.8, 7);
  g.stroke();
  // The lamp.
  circle(g, 17.5, 0, 2.4);
  g.fillStyle = "#fff6c8";
  g.fill();
  g.strokeStyle = DEPOT.brassDark;
  g.lineWidth = 0.8;
  g.stroke();
}
const hexShade = (hex: string) => tint(hex, -0.35);

/** The load a wagon or cart carries, on its bed. */
export function drawCargo(g: Paint, kind: number): void {
  g.lineWidth = 0.9;
  g.strokeStyle = OUTLINE;
  switch (kind) {
    case 0: {
      // A crate.
      g.fillStyle = DEPOT.crate;
      roundRect(g, -7, -5.8, 14, 11.6, 1.4);
      g.fill();
      g.stroke();
      g.strokeStyle = DEPOT.crateDark;
      g.lineWidth = 1.1;
      g.beginPath();
      g.moveTo(-6, -4.8);
      g.lineTo(6, 4.8);
      g.moveTo(-6, 4.8);
      g.lineTo(6, -4.8);
      g.stroke();
      g.strokeStyle = tint(DEPOT.crate, 0.35);
      g.lineWidth = 0.8;
      roundRect(g, -5.8, -4.6, 11.6, 9.2, 1);
      g.stroke();
      break;
    }
    case 1: {
      // Two barrels.
      for (const bx of [-4.3, 4.3]) {
        circle(g, bx, 0, 4.6);
        g.fillStyle = DEPOT.woodLight;
        g.fill();
        g.stroke();
        circle(g, bx, 0, 3.2);
        g.strokeStyle = DEPOT.brassDark;
        g.stroke();
        circle(g, bx - 0.8, -0.8, 1.1);
        g.fillStyle = tint(DEPOT.woodLight, 0.4);
        g.fill();
        g.strokeStyle = OUTLINE;
      }
      break;
    }
    case 2: {
      // A heap of coal.
      const lumps = [
        [-5, -2.5, 3],
        [-1, -3.5, 3.2],
        [3.5, -2, 3],
        [-3, 2, 3.4],
        [1.5, 2.2, 3.3],
        [5.5, 2.5, 2.4],
        [0, -0.4, 2.6],
      ] as const;
      for (const [lx, ly, r] of lumps) {
        circle(g, lx, ly, r);
        g.fillStyle = "#1c1e26";
        g.fill();
      }
      g.fillStyle = "#4a5068";
      for (const [lx, ly] of lumps) {
        circle(g, lx - 0.9, ly - 1, 0.8);
        g.fill();
      }
      break;
    }
    default: {
      // Timber.
      for (let i = 0; i < 3; i++) {
        const ly = -5.6 + i * 3.9;
        g.fillStyle = i === 1 ? DEPOT.wood : tint(DEPOT.wood, 0.12);
        roundRect(g, -9, ly, 18, 3.6, 1.8);
        g.fill();
        g.stroke();
        circle(g, 8, ly + 1.8, 1.5);
        g.fillStyle = DEPOT.woodLight;
        g.fill();
      }
    }
  }
}

/** A wagon or cart: an iron frame, a bed in `body` with `edge` sides, brass corners and couplers, and its load. */
export function drawWagon(
  g: Paint,
  body: string,
  edge: string,
  kind: number,
): void {
  g.fillStyle = "#0b0d14";
  for (const wx of [-8, 8]) {
    roundRect(g, wx - 3, -10.5, 6, 3, 1);
    g.fill();
    roundRect(g, wx - 3, 7.5, 6, 3, 1);
    g.fill();
  }
  g.fillStyle = "#23262f";
  g.fillRect(12.5, -1.5, 3.5, 3);
  g.fillRect(-16, -1.5, 3.5, 3);
  g.fillStyle = OUTLINE;
  roundRect(g, -13.5, -9, 27, 18, 3.2);
  g.fill();
  g.fillStyle = edge;
  roundRect(g, -12.6, -8.1, 25.2, 16.2, 2.6);
  g.fill();
  const bed = g.createLinearGradient(0, -7, 0, 7);
  bed.addColorStop(0, tint(body, 0.3));
  bed.addColorStop(1, body);
  g.fillStyle = bed;
  roundRect(g, -11.2, -6.7, 22.4, 13.4, 2);
  g.fill();
  g.fillStyle = DEPOT.brass;
  for (const [cx, cy] of [
    [-12.6, -8.1],
    [10.2, -8.1],
    [-12.6, 5.7],
    [10.2, 5.7],
  ] as const)
    g.fillRect(cx, cy, 2.4, 2.4);
  drawCargo(g, kind);
}

export interface Sprites {
  loco(slot: number): Sprite;
  wagon(slot: number, kind: number): Sprite;
  /** A loose cart: nobody's, in wood and brass. */
  cart(kind: number): Sprite;
}

export function createSprites(make: MakeSurface): Sprites {
  const cache = new Map<string, Sprite>();
  const cached = (key: string, build: () => Sprite) => {
    let found = cache.get(key);
    if (!found) {
      found = build();
      cache.set(key, found);
    }
    return found;
  };
  const kindOf = (kind: number) =>
    ((kind % CARGO_KINDS) + CARGO_KINDS) % CARGO_KINDS;
  return {
    loco: (slot) =>
      cached(`loco:${slot}`, () =>
        sprite(
          make,
          60,
          38,
          (g) => drawLoco(g, seatColor(slot), seatShade(slot)),
          LOCO_SIZE,
        ),
      ),
    wagon: (slot, kind) =>
      cached(`wagon:${slot}:${kindOf(kind)}`, () =>
        sprite(
          make,
          44,
          32,
          (g) => drawWagon(g, seatColor(slot), seatShade(slot), kindOf(kind)),
          WAGON_SIZE,
        ),
      ),
    cart: (kind) =>
      cached(`cart:${kindOf(kind)}`, () =>
        sprite(
          make,
          44,
          32,
          (g) => drawWagon(g, DEPOT.wood, DEPOT.woodDark, kindOf(kind)),
          WAGON_SIZE,
        ),
      ),
  };
}

/** Draws a sprite centred on `(x, y)`, turned to `angle` radians. */
export function blit(
  g: Paint,
  s: Sprite,
  x: number,
  y: number,
  angle: number,
  alpha = 1,
  size = 1,
): void {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  if (size !== 1) g.scale(size, size);
  g.globalAlpha = alpha;
  g.drawImage(s.surface, -s.ox, -s.oy, s.width, s.height);
  g.restore();
}
