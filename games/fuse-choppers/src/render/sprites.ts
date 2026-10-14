import type { PickupKind } from "../engine/view-kit.js";
import { PICKUP_COLORS } from "./palette.js";

/**
 * Pre-painted sprites: every body is drawn once per colour or size into an offscreen canvas at twice its size,
 * glow included, so a frame only blits them. Rotors, flames and lights are drawn live by the scene.
 */
export type Surface = HTMLCanvasElement | OffscreenCanvas;
export type Paint =
  CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type MakeSurface = (width: number, height: number) => Surface;

export const SPRITE_SCALE = 2;

export interface Sprite {
  surface: Surface;
  /** The anchor (the body's centre) in logical pixels from the top-left. */
  ox: number;
  oy: number;
  width: number;
  height: number;
}

function sprite(
  make: MakeSurface,
  width: number,
  height: number,
  ox: number,
  oy: number,
  draw: (g: Paint) => void,
): Sprite {
  const surface = make(width * SPRITE_SCALE, height * SPRITE_SCALE);
  const g = surface.getContext("2d") as Paint;
  g.scale(SPRITE_SCALE, SPRITE_SCALE);
  g.translate(ox, oy);
  draw(g);
  return { surface, ox, oy, width, height };
}

const OUTLINE = "#070914";

/** A chopper facing right, centred on its body, without rotors. */
export function chopperSprite(
  make: MakeSurface,
  color: string,
  shade: string,
): Sprite {
  return sprite(make, 84, 52, 42, 28, (g) => {
    g.lineJoin = "round";
    g.lineCap = "round";
    // Soft neon halo behind everything.
    g.save();
    g.shadowColor = color;
    g.shadowBlur = 10;
    g.fillStyle = color;
    g.globalAlpha = 0.35;
    g.beginPath();
    g.ellipse(0, 1, 18, 11, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();

    // Tail boom and fin.
    g.fillStyle = shade;
    g.strokeStyle = OUTLINE;
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(-8, -4);
    g.lineTo(-32, -3);
    g.lineTo(-33, 1);
    g.lineTo(-8, 4);
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(-28, -2);
    g.lineTo(-35, -12);
    g.lineTo(-30, -12);
    g.lineTo(-24, -2);
    g.closePath();
    g.fill();
    g.stroke();
    // A stripe along the boom.
    g.strokeStyle = color;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(-10, 0);
    g.lineTo(-30, -1);
    g.stroke();

    // Skids.
    g.strokeStyle = "#9aa3bf";
    g.lineWidth = 1.8;
    g.beginPath();
    g.moveTo(-6, 9);
    g.lineTo(-8, 15);
    g.moveTo(8, 9);
    g.lineTo(10, 15);
    g.stroke();
    g.strokeStyle = "#c9d0e6";
    g.lineWidth = 2.2;
    g.beginPath();
    g.moveTo(-16, 15);
    g.lineTo(15, 15);
    g.quadraticCurveTo(19, 15, 20, 12);
    g.stroke();

    // Rotor mast.
    g.fillStyle = "#1b2038";
    g.fillRect(-3, -15, 7, 6);
    g.strokeStyle = OUTLINE;
    g.lineWidth = 1.2;
    g.strokeRect(-3, -15, 7, 6);

    // Body.
    const body = g.createLinearGradient(0, -11, 0, 11);
    body.addColorStop(0, "#ffffff");
    body.addColorStop(0.18, color);
    body.addColorStop(0.75, color);
    body.addColorStop(1, shade);
    g.fillStyle = body;
    g.strokeStyle = OUTLINE;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(-12, -6);
    g.bezierCurveTo(-8, -12, 10, -12, 16, -5);
    g.bezierCurveTo(21, 0, 19, 8, 12, 10);
    g.lineTo(-8, 10);
    g.bezierCurveTo(-14, 9, -15, -2, -12, -6);
    g.closePath();
    g.fill();
    g.stroke();

    // Cockpit glass with the pilot inside.
    const glass = g.createLinearGradient(4, -9, 16, 6);
    glass.addColorStop(0, "#9fe8ff");
    glass.addColorStop(0.35, "#1c4f8c");
    glass.addColorStop(1, "#081630");
    g.fillStyle = glass;
    g.beginPath();
    g.moveTo(3, -8);
    g.bezierCurveTo(10, -10, 17, -6, 18, 1);
    g.lineTo(5, 2);
    g.closePath();
    g.fill();
    g.strokeStyle = OUTLINE;
    g.lineWidth = 1.4;
    g.stroke();
    // Helmet and visor.
    g.fillStyle = shade;
    g.beginPath();
    g.arc(8, -3, 3.6, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#0a0f22";
    g.beginPath();
    g.ellipse(9.8, -3, 1.8, 1.4, 0, 0, Math.PI * 2);
    g.fill();
    // Glint.
    g.strokeStyle = "rgba(255,255,255,0.85)";
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(8, -7.5);
    g.quadraticCurveTo(13, -7.5, 15.5, -4);
    g.stroke();
    // Door line and rivets.
    g.strokeStyle = "rgba(7,9,20,0.45)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(-2, -8);
    g.lineTo(-2, 9);
    g.stroke();
    g.fillStyle = "rgba(255,255,255,0.7)";
    g.fillRect(-9, -3, 1.5, 1.5);
    g.fillRect(-9, 3, 1.5, 1.5);
  });
}

/** The enemy drone: a dark red gunship with one burning eye. */
export function droneSprite(make: MakeSurface): Sprite {
  return sprite(make, 72, 48, 36, 26, (g) => {
    g.lineJoin = "round";
    g.save();
    g.shadowColor = "#ff2040";
    g.shadowBlur = 12;
    g.fillStyle = "rgba(255,32,64,0.3)";
    g.beginPath();
    g.ellipse(0, 0, 20, 12, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
    // Tail boom points right: drones fly toward the players.
    g.fillStyle = "#3a0d18";
    g.strokeStyle = OUTLINE;
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(8, -3);
    g.lineTo(30, -2);
    g.lineTo(30, 2);
    g.lineTo(8, 4);
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = "#6b1224";
    g.beginPath();
    g.moveTo(26, -2);
    g.lineTo(32, -10);
    g.lineTo(28, -10);
    g.lineTo(22, -2);
    g.closePath();
    g.fill();
    g.stroke();
    const body = g.createLinearGradient(0, -10, 0, 10);
    body.addColorStop(0, "#7a2436");
    body.addColorStop(0.5, "#40101c");
    body.addColorStop(1, "#1b060c");
    g.fillStyle = body;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(12, -6);
    g.bezierCurveTo(8, -12, -10, -12, -16, -4);
    g.bezierCurveTo(-20, 2, -16, 9, -10, 10);
    g.lineTo(9, 10);
    g.bezierCurveTo(14, 8, 15, -2, 12, -6);
    g.closePath();
    g.fill();
    g.stroke();
    // Gun barrel.
    g.fillStyle = "#1a1d2c";
    g.fillRect(-24, 3, 10, 3);
    g.strokeRect(-24, 3, 10, 3);
    // Mast and skids.
    g.fillStyle = "#1b2038";
    g.fillRect(-3, -15, 6, 5);
    g.strokeStyle = "#6f7488";
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(-12, 14);
    g.lineTo(10, 14);
    g.moveTo(-6, 10);
    g.lineTo(-7, 14);
    g.moveTo(5, 10);
    g.lineTo(6, 14);
    g.stroke();
  });
}

/** A saw blade of radius `r`: teeth, steel and a dark hub; the red eye is lit live. */
export function sawSprite(make: MakeSurface, r: number): Sprite {
  const size = Math.ceil(r * 2 + 12);
  return sprite(make, size, size, size / 2, size / 2, (g) => {
    const teeth = 14;
    g.beginPath();
    for (let i = 0; i < teeth * 2; i++) {
      const angle = (i / (teeth * 2)) * Math.PI * 2,
        radius = i % 2 === 0 ? r + 4 : r - 3,
        lean = i % 2 === 0 ? 0.12 : 0;
      g.lineTo(
        Math.cos(angle + lean) * radius,
        Math.sin(angle + lean) * radius,
      );
    }
    g.closePath();
    const steel = g.createRadialGradient(-r / 3, -r / 3, 2, 0, 0, r + 4);
    steel.addColorStop(0, "#f2f4fb");
    steel.addColorStop(0.55, "#9aa1b8");
    steel.addColorStop(1, "#4a5068");
    g.fillStyle = steel;
    g.fill();
    g.strokeStyle = OUTLINE;
    g.lineWidth = 1.6;
    g.stroke();
    g.fillStyle = "#23283d";
    g.beginPath();
    g.arc(0, 0, r * 0.55, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "#6c7390";
    g.lineWidth = 2;
    g.stroke();
    // Spokes, so the spin reads.
    g.strokeStyle = "rgba(255,255,255,0.35)";
    g.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2;
      g.beginPath();
      g.moveTo(Math.cos(angle) * r * 0.62, Math.sin(angle) * r * 0.62);
      g.lineTo(Math.cos(angle) * r * 0.9, Math.sin(angle) * r * 0.9);
      g.stroke();
    }
  });
}

/** A power-up crate: a rounded neon square with its icon. */
export function pickupSprite(make: MakeSurface, kind: PickupKind): Sprite {
  const color = PICKUP_COLORS[kind];
  return sprite(make, 48, 48, 24, 24, (g) => {
    g.save();
    g.shadowColor = color;
    g.shadowBlur = 12;
    g.strokeStyle = color;
    g.lineWidth = 2.5;
    g.fillStyle = "rgba(8,12,34,0.85)";
    roundRect(g, -15, -15, 30, 30, 7);
    g.fill();
    g.stroke();
    g.restore();
    g.strokeStyle = color;
    g.fillStyle = color;
    g.lineWidth = 2.4;
    g.lineJoin = "round";
    g.lineCap = "round";
    switch (kind) {
      case "shield":
        g.beginPath();
        g.moveTo(0, -9);
        g.lineTo(8, -6);
        g.lineTo(7, 2);
        g.quadraticCurveTo(4, 7, 0, 9);
        g.quadraticCurveTo(-4, 7, -7, 2);
        g.lineTo(-8, -6);
        g.closePath();
        g.stroke();
        g.globalAlpha = 0.35;
        g.fill();
        break;
      case "triple":
        g.beginPath();
        g.moveTo(3, -10);
        g.lineTo(-5, 1);
        g.lineTo(0, 1);
        g.lineTo(-3, 10);
        g.lineTo(6, -2);
        g.lineTo(1, -2);
        g.closePath();
        g.fill();
        break;
      case "shock":
        for (const radius of [3, 6.5, 10]) {
          g.globalAlpha = radius === 10 ? 0.55 : 1;
          g.beginPath();
          g.arc(0, 0, radius, 0, Math.PI * 2);
          g.stroke();
        }
        break;
      case "turbo":
        for (const x of [-6, 1]) {
          g.beginPath();
          g.moveTo(x, -7);
          g.lineTo(x + 6, 0);
          g.lineTo(x, 7);
          g.stroke();
        }
        break;
      case "scramble":
        g.beginPath();
        g.arc(0, -2, 6, Math.PI * 1.1, Math.PI * 0.35);
        g.stroke();
        g.beginPath();
        g.moveTo(1.5, 3.5);
        g.lineTo(1, 5.5);
        g.stroke();
        g.beginPath();
        g.arc(1, 9, 1.4, 0, Math.PI * 2);
        g.fill();
        break;
    }
  });
}

export function roundRect(
  g: Paint,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}
