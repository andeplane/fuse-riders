import { COL, COLUMNS, VIEW_H, VIEW_W, terrain } from "../engine/view-kit.js";
import type { MakeSurface, Paint, Surface } from "./sprites.js";

/**
 * The cave behind the play: a deep-blue gradient, two parallax layers painted once per tile (distant rock and
 * waterfalls, then bridges with warm lights), and the cave's own rock drawn from the seed's height map.
 */
const FAR_TILE = 640,
  MID_TILE = 720,
  FAR_RATE = 0.22,
  MID_RATE = 0.5;

/** A small repeatable hash for decoration: presentation only, so it need not be the engine's. */
export function noise(a: number, b = 0, c = 0): number {
  let h =
    Math.imul(a ^ 0x27d4eb2d, 0x165667b1) ^
    Math.imul(b + 0x9e3779b9, 0x85ebca6b);
  h =
    Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) ^
    Math.imul(c + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 13;
  return ((h >>> 0) % 10_000) / 10_000;
}

export function createBackdrop(make: MakeSurface) {
  const far = new Map<number, Surface>(),
    mid = new Map<number, Surface>();
  const tile = (
    cache: Map<number, Surface>,
    k: number,
    width: number,
    paint: (g: Paint, k: number) => void,
  ) => {
    let surface = cache.get(k);
    if (!surface) {
      if (cache.size > 12) cache.delete(cache.keys().next().value!);
      surface = make(width, VIEW_H);
      paint(surface.getContext("2d") as Paint, k);
      cache.set(k, surface);
    }
    return surface;
  };
  const layer = (
    g: Paint,
    offset: number,
    width: number,
    cache: Map<number, Surface>,
    paint: (g: Paint, k: number) => void,
  ) => {
    const first = Math.floor(offset / width);
    for (let k = first; k <= first + Math.ceil(VIEW_W / width); k++)
      g.drawImage(
        tile(cache, k, width, paint),
        Math.round(k * width - offset),
        0,
      );
  };

  function draw(g: Paint, camX: number, time: number): void {
    const sky = g.createLinearGradient(0, 0, 0, VIEW_H);
    sky.addColorStop(0, "#060a22");
    sky.addColorStop(0.45, "#0f1a4d");
    sky.addColorStop(1, "#080d2a");
    g.fillStyle = sky;
    g.fillRect(0, 0, VIEW_W, VIEW_H);
    layer(g, camX * FAR_RATE, FAR_TILE, far, paintFar);
    waterfalls(g, camX, time);
    layer(g, camX * MID_RATE, MID_TILE, mid, paintMid);
  }
  return { draw };
}

function paintFar(g: Paint, k: number): void {
  // A faint glow somewhere deep in the cave.
  const gx = noise(k, 1) * FAR_TILE,
    glow = g.createRadialGradient(gx, 300, 10, gx, 300, 260);
  glow.addColorStop(0, "rgba(60,110,255,0.18)");
  glow.addColorStop(1, "rgba(60,110,255,0)");
  g.fillStyle = glow;
  g.fillRect(0, 0, FAR_TILE, VIEW_H);
  // Distant pillars.
  for (let i = 0; i < 2; i++) {
    if (noise(k, 2, i) < 0.45) continue;
    const x = noise(k, 3, i) * (FAR_TILE - 80) + 40,
      w = 30 + noise(k, 4, i) * 50;
    g.fillStyle = "#0b1335";
    g.beginPath();
    g.moveTo(x - w, 0);
    g.quadraticCurveTo(x - w * 0.2, VIEW_H * 0.5, x - w * 0.9, VIEW_H);
    g.lineTo(x + w * 0.9, VIEW_H);
    g.quadraticCurveTo(x + w * 0.2, VIEW_H * 0.5, x + w, 0);
    g.closePath();
    g.fill();
  }
  // Stalactites and stalagmites in silhouette.
  for (let i = 0; i < 9; i++) {
    const x = (i / 9) * FAR_TILE + noise(k, 5, i) * 50,
      w = 24 + noise(k, 6, i) * 46,
      h = 60 + noise(k, 7, i) * 150,
      down = i % 2 === 0;
    g.fillStyle = down ? "#0d1640" : "#0a1236";
    g.beginPath();
    if (down) {
      g.moveTo(x - w, 0);
      g.lineTo(x - w * 0.3, h * 0.6);
      g.lineTo(x, h);
      g.lineTo(x + w * 0.35, h * 0.55);
      g.lineTo(x + w, 0);
    } else {
      g.moveTo(x - w, VIEW_H);
      g.lineTo(x - w * 0.25, VIEW_H - h * 0.6);
      g.lineTo(x, VIEW_H - h);
      g.lineTo(x + w * 0.3, VIEW_H - h * 0.55);
      g.lineTo(x + w, VIEW_H);
    }
    g.closePath();
    g.fill();
    g.strokeStyle = "rgba(90,130,255,0.18)";
    g.lineWidth = 1.5;
    g.stroke();
  }
}

function waterfalls(g: Paint, camX: number, time: number): void {
  const offset = camX * 0.3,
    width = 560;
  const first = Math.floor(offset / width);
  for (let k = first; k <= first + 2; k++) {
    if (noise(k, 11) < 0.35) continue;
    const x = k * width - offset + 60 + noise(k, 12) * (width - 120),
      w = 12 + noise(k, 13) * 22,
      top = 70 + noise(k, 14) * 90;
    const fall = g.createLinearGradient(0, top, 0, VIEW_H);
    fall.addColorStop(0, "rgba(120,200,255,0.05)");
    fall.addColorStop(0.2, "rgba(120,200,255,0.3)");
    fall.addColorStop(1, "rgba(170,225,255,0.4)");
    g.fillStyle = fall;
    g.fillRect(x, top, w, VIEW_H - top);
    g.strokeStyle = "rgba(220,245,255,0.5)";
    g.lineWidth = 1.5;
    for (let i = 0; i < 5; i++) {
      const lane = x + ((i + 0.5) / 5) * w,
        length = VIEW_H - top,
        y = top + ((time * (150 + i * 23) + i * 57) % length);
      g.beginPath();
      g.moveTo(lane, y);
      g.lineTo(lane, Math.min(VIEW_H, y + 18 + i * 3));
      g.stroke();
    }
    const mist = g.createRadialGradient(
      x + w / 2,
      VIEW_H - 10,
      4,
      x + w / 2,
      VIEW_H - 10,
      w * 2.5,
    );
    mist.addColorStop(0, "rgba(190,230,255,0.35)");
    mist.addColorStop(1, "rgba(190,230,255,0)");
    g.fillStyle = mist;
    g.fillRect(x - w * 2.5, VIEW_H - 10 - w * 2.5, w * 6, w * 5);
  }
}

function paintMid(g: Paint, k: number): void {
  if (noise(k, 21) < 0.72) {
    const y = 150 + noise(k, 22) * 190,
      x0 = 40 + noise(k, 23) * 80,
      x1 = MID_TILE - 40 - noise(k, 24) * 80;
    // Pillars to the floor.
    g.fillStyle = "#121c4d";
    for (const x of [x0 + 20, x1 - 34]) {
      g.fillRect(x, y + 10, 14, VIEW_H - y);
      g.fillStyle = "#18245e";
      g.fillRect(x, y + 10, 4, VIEW_H - y);
      g.fillStyle = "#121c4d";
    }
    // Truss.
    g.strokeStyle = "#22336f";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(x0, y);
    g.lineTo(x1, y);
    g.moveTo(x0, y + 12);
    g.lineTo(x1, y + 12);
    for (let x = x0; x < x1; x += 24) {
      g.moveTo(x, y);
      g.lineTo(x + 12, y + 12);
      g.lineTo(x + 24, y);
    }
    g.stroke();
    g.strokeStyle = "#3a52a8";
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(x0, y - 1);
    g.lineTo(x1, y - 1);
    g.stroke();
    // Railing and warm lamps.
    g.strokeStyle = "#1c2a63";
    g.lineWidth = 1.5;
    g.beginPath();
    for (let x = x0; x <= x1; x += 16) {
      g.moveTo(x, y);
      g.lineTo(x, y - 10);
    }
    g.moveTo(x0, y - 10);
    g.lineTo(x1, y - 10);
    g.stroke();
    for (let x = x0 + 12; x < x1; x += 44) {
      const lamp = g.createRadialGradient(x, y - 12, 0, x, y - 12, 12);
      lamp.addColorStop(0, "rgba(255,190,90,0.9)");
      lamp.addColorStop(0.3, "rgba(255,150,60,0.35)");
      lamp.addColorStop(1, "rgba(255,150,60,0)");
      g.fillStyle = lamp;
      g.fillRect(x - 12, y - 24, 24, 24);
      g.fillStyle = "#ffd28a";
      g.fillRect(x - 1.5, y - 13.5, 3, 3);
    }
    if (k % 4 === 2) sign(g, (x0 + x1) / 2 - 70, y - 64);
  }
  // Crystals growing from the far rock.
  for (let i = 0; i < 3; i++) {
    if (noise(k, 31, i) < 0.55) continue;
    const x = noise(k, 32, i) * MID_TILE,
      ceiling = noise(k, 33, i) < 0.5,
      base = ceiling ? 10 : VIEW_H - 8;
    crystals(g, x, base, ceiling ? 1 : -1, 0.55);
  }
}

function sign(g: Paint, x: number, y: number): void {
  g.save();
  g.shadowColor = "#39b8ff";
  g.shadowBlur = 14;
  g.strokeStyle = "#5fd0ff";
  g.lineWidth = 2.5;
  g.fillStyle = "rgba(6,18,50,0.85)";
  g.beginPath();
  g.rect(x, y, 140, 42);
  g.fill();
  g.stroke();
  g.fillStyle = "#7fe0ff";
  g.font = "bold italic 17px 'Arial Black', Impact, sans-serif";
  g.textBaseline = "middle";
  g.fillText("KEEP GOING", x + 10, y + 21);
  g.restore();
  g.strokeStyle = "#5fd0ff";
  g.lineWidth = 3;
  g.beginPath();
  for (const dx of [0, 10]) {
    g.moveTo(x + 116 + dx, y + 14);
    g.lineTo(x + 124 + dx, y + 21);
    g.lineTo(x + 116 + dx, y + 28);
  }
  g.stroke();
  g.strokeStyle = "#1c2a63";
  g.beginPath();
  g.moveTo(x + 30, y + 42);
  g.lineTo(x + 30, y + 64);
  g.moveTo(x + 110, y + 42);
  g.lineTo(x + 110, y + 64);
  g.stroke();
}

/** A cluster of glowing violet crystals growing from `(x, base)`, upward for `dir` −1, downward for 1. */
export function crystals(
  g: Paint,
  x: number,
  base: number,
  dir: 1 | -1,
  alpha = 1,
): void {
  g.save();
  g.globalAlpha = alpha;
  g.shadowColor = "#b25cff";
  g.shadowBlur = 10;
  for (const [dx, h, lean] of [
    [-7, 16, -0.35],
    [0, 26, 0.05],
    [8, 13, 0.4],
  ] as const) {
    const tipX = x + dx + lean * h,
      tipY = base + dir * h;
    const shine = g.createLinearGradient(x + dx, base, tipX, tipY);
    shine.addColorStop(0, "#5a1aa8");
    shine.addColorStop(1, "#e3a6ff");
    g.fillStyle = shine;
    g.beginPath();
    g.moveTo(x + dx - 4, base);
    g.lineTo(tipX - 1.5, tipY - dir * 4);
    g.lineTo(tipX, tipY);
    g.lineTo(tipX + 1.5, tipY - dir * 4);
    g.lineTo(x + dx + 4, base);
    g.closePath();
    g.fill();
  }
  g.restore();
}

/** The cave's rock for `seed`, from the camera's left edge to its right. */
export function drawCave(g: Paint, seed: number, camX: number): void {
  const { top, bottom } = terrain(seed),
    c0 = Math.max(0, Math.floor(camX / COL) - 1),
    c1 = Math.min(COLUMNS - 1, c0 + Math.ceil(VIEW_W / COL) + 3),
    at = (c: number) => c * COL - camX;
  for (const [edge, sign] of [
    [top, -1],
    [bottom, 1],
  ] as const) {
    const outside = sign < 0 ? -30 : VIEW_H + 30;
    g.beginPath();
    g.moveTo(at(c0), outside);
    for (let c = c0; c <= c1; c++) g.lineTo(at(c), edge[c]!);
    g.lineTo(at(c1), outside);
    g.closePath();
    const rock = g.createLinearGradient(
      0,
      sign < 0 ? 0 : VIEW_H,
      0,
      sign < 0 ? 240 : VIEW_H - 240,
    );
    rock.addColorStop(0, "#020309");
    rock.addColorStop(0.7, "#070a20");
    rock.addColorStop(1, "#0c1030");
    g.fillStyle = rock;
    g.fill();
    // Bands of lit rock along the edge, clipped to the rock, so the cave's shape reads against the far wall.
    g.save();
    g.clip();
    g.beginPath();
    g.moveTo(at(c0), edge[c0]!);
    for (let c = c0 + 1; c <= c1; c++) g.lineTo(at(c), edge[c]!);
    g.lineJoin = "round";
    for (const [width, color] of [
      [52, "#0f1438"],
      [28, "#182057"],
      [12, "#25307a"],
    ] as const) {
      g.strokeStyle = color;
      g.lineWidth = width;
      g.stroke();
    }
    // Facets just inside the edge give the rock its chipped, layered look.
    for (let c = c0; c < c1; c++) {
      const h = noise(c, sign, 7);
      if (h < 0.35) continue;
      const depth = 8 + h * 22,
        x = at(c);
      g.fillStyle = h > 0.8 ? "rgba(70,90,190,0.35)" : "rgba(3,4,16,0.55)";
      g.beginPath();
      g.moveTo(x + 3, edge[c]! + sign * 3);
      g.lineTo(x + COL * (0.3 + h * 0.4), edge[c]! + sign * depth);
      g.lineTo(x + COL - 3, edge[c + 1]! + sign * 3);
      g.closePath();
      g.fill();
    }
    g.restore();
    // Rim light where the rock meets the open cave.
    g.beginPath();
    g.moveTo(at(c0), edge[c0]!);
    for (let c = c0 + 1; c <= c1; c++) g.lineTo(at(c), edge[c]!);
    g.lineJoin = "round";
    g.strokeStyle = "#1f2a6b";
    g.lineWidth = 7;
    g.stroke();
    g.save();
    g.shadowColor = "#4c6dff";
    g.shadowBlur = 10;
    g.strokeStyle = "#6f86ec";
    g.lineWidth = 2;
    g.stroke();
    g.restore();
  }
  // Crystal clusters on the floor and a few under the ceiling.
  for (let c = c0; c <= c1; c++) {
    const h = noise(c, 41);
    if (h < 0.88) continue;
    const floor = noise(c, 42) < 0.7;
    crystals(g, at(c), floor ? bottom[c]! + 3 : top[c]! - 3, floor ? -1 : 1);
  }
}
