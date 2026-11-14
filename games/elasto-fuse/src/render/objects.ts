import {
  GRAVITY_DOWN,
  GRAVITY_LEFT,
  GRAVITY_RIGHT,
  GRAVITY_UP,
  OBJECT_RADIUS,
} from "../engine/view-kit.js";
import { GOLD, PINK, WHITE, hexA } from "./palette.js";

/**
 * The things a level holds, drawn in world units with y up at the radius they collide with: apples, the flower and
 * the killers. Each takes its generated sprite when there is one and is neon line art otherwise. `seconds` is the
 * wall clock: bobbing, spinning and pulsing are the picture's own.
 */
type G = CanvasRenderingContext2D;
const TAU = Math.PI * 2,
  R = OBJECT_RADIUS;

/** The sprites fill this share of their square (`art-brief.md`). */
const APPLE_FILL = 0.85,
  FLOWER_FILL = 0.85,
  KILLER_FILL = 0.9;

function sprite(g: G, image: CanvasImageSource, size: number, angle = 0): void {
  g.save();
  g.rotate(angle);
  g.scale(1, -1);
  g.drawImage(image, -size / 2, -size / 2, size, size);
  g.restore();
}

function halo(g: G, color: string, radius: number, alpha: number): void {
  const glow = g.createRadialGradient(0, 0, radius * 0.3, 0, 0, radius);
  glow.addColorStop(0, hexA(color, alpha));
  glow.addColorStop(1, hexA(color, 0));
  g.fillStyle = glow;
  g.beginPath();
  g.arc(0, 0, radius, 0, TAU);
  g.fill();
}

const ARROWS: Readonly<Record<number, readonly [number, number]>> = {
  [GRAVITY_UP]: [0, 1],
  [GRAVITY_DOWN]: [0, -1],
  [GRAVITY_LEFT]: [-1, 0],
  [GRAVITY_RIGHT]: [1, 0],
};

export function drawApple(
  g: G,
  x: number,
  y: number,
  seconds: number,
  gravity: number,
  image?: CanvasImageSource,
): void {
  g.save();
  g.translate(x, y + Math.sin(seconds * 2.4 + x) * 0.04);
  halo(g, GOLD, R * 1.7, 0.28);
  if (image) sprite(g, image, (R * 2) / APPLE_FILL);
  else {
    const body = g.createRadialGradient(-0.1, 0.12, 0.04, 0, 0, R);
    body.addColorStop(0, "#fff8d6");
    body.addColorStop(0.35, GOLD);
    body.addColorStop(1, PINK);
    g.fillStyle = body;
    g.beginPath();
    // Two lobes and a dimple: an apple, not a ball.
    g.moveTo(0, R * 0.62);
    g.bezierCurveTo(R * 0.55, R * 1.05, R * 1.1, R * 0.5, R * 0.9, -R * 0.2);
    g.bezierCurveTo(R * 0.75, -R * 0.85, R * 0.25, -R * 1.02, 0, -R * 0.82);
    g.bezierCurveTo(
      -R * 0.25,
      -R * 1.02,
      -R * 0.75,
      -R * 0.85,
      -R * 0.9,
      -R * 0.2,
    );
    g.bezierCurveTo(-R * 1.1, R * 0.5, -R * 0.55, R * 1.05, 0, R * 0.62);
    g.fill();
    g.strokeStyle = hexA(WHITE, 0.7);
    g.lineWidth = 0.025;
    g.stroke();
    // Stem and leaf.
    g.beginPath();
    g.moveTo(0, R * 0.6);
    g.lineTo(0.05, R * 1.02);
    g.strokeStyle = "#7a4a2a";
    g.lineWidth = 0.045;
    g.lineCap = "round";
    g.stroke();
    g.beginPath();
    g.ellipse(0.17, R * 0.98, 0.13, 0.06, 0.5, 0, TAU);
    g.fillStyle = "#4dff7c";
    g.fill();
  }
  const arrow = ARROWS[gravity];
  if (arrow) {
    // A gravity apple says which way down will be.
    const [ax, ay] = arrow;
    g.rotate(Math.atan2(ay, ax));
    g.beginPath();
    g.moveTo(-0.17, 0);
    g.lineTo(0.14, 0);
    g.moveTo(0.03, 0.12);
    g.lineTo(0.17, 0);
    g.lineTo(0.03, -0.12);
    g.lineCap = "round";
    g.lineJoin = "round";
    g.strokeStyle = "#071022";
    g.lineWidth = 0.11;
    g.stroke();
    g.strokeStyle = WHITE;
    g.lineWidth = 0.05;
    g.stroke();
  }
  g.restore();
}

export function drawFlower(
  g: G,
  x: number,
  y: number,
  seconds: number,
  ready: boolean,
  image?: CanvasImageSource,
): void {
  g.save();
  g.translate(x, y);
  const pulse = ready ? 1 + Math.sin(seconds * 5) * 0.09 : 0.92;
  if (ready) halo(g, PINK, R * (2.3 + Math.sin(seconds * 5) * 0.3), 0.4);
  g.globalAlpha *= ready ? 1 : 0.38;
  g.scale(pulse, pulse);
  if (image) sprite(g, image, (R * 2) / FLOWER_FILL, ready ? seconds * 0.4 : 0);
  else {
    g.rotate(ready ? seconds * 0.4 : 0);
    for (let petal = 0; petal < 6; petal++) {
      const angle = (petal * TAU) / 6;
      g.beginPath();
      g.ellipse(
        Math.cos(angle) * R * 0.56,
        Math.sin(angle) * R * 0.56,
        R * 0.44,
        R * 0.27,
        angle,
        0,
        TAU,
      );
      g.fillStyle = hexA(PINK, 0.85);
      g.fill();
      g.strokeStyle = "#ffc4e3";
      g.lineWidth = 0.025;
      g.stroke();
    }
    g.beginPath();
    g.arc(0, 0, R * 0.3, 0, TAU);
    g.fillStyle = GOLD;
    g.fill();
    g.strokeStyle = "#fff8d6";
    g.lineWidth = 0.03;
    g.stroke();
  }
  g.restore();
}

export function drawKiller(
  g: G,
  x: number,
  y: number,
  seconds: number,
  image?: CanvasImageSource,
): void {
  g.save();
  g.translate(x, y);
  halo(g, PINK, R * 1.5, 0.22);
  const angle = seconds * 2.2 + x;
  if (image) sprite(g, image, (R * 2) / KILLER_FILL, angle);
  else {
    g.rotate(angle);
    const spikes = 10;
    g.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const radius = i % 2 ? R * 0.58 : R,
        at = (i * TAU) / (spikes * 2);
      const px = Math.cos(at) * radius,
        py = Math.sin(at) * radius;
      if (i) g.lineTo(px, py);
      else g.moveTo(px, py);
    }
    g.closePath();
    g.fillStyle = "#2a0a2c";
    g.fill();
    g.lineJoin = "miter";
    g.strokeStyle = hexA(PINK, 0.3);
    g.lineWidth = 0.1;
    g.stroke();
    g.strokeStyle = PINK;
    g.lineWidth = 0.035;
    g.stroke();
    g.beginPath();
    g.arc(0, 0, R * 0.3, 0, TAU);
    g.fillStyle = WHITE;
    g.fill();
    g.beginPath();
    g.arc(0, 0, R * 0.14, 0, TAU);
    g.fillStyle = PINK;
    g.fill();
  }
  g.restore();
}
