// Height-map terrain: generation, queries and crater carving.

import { exp, sin } from "./det-math.js";
import { random, range, type RngHolder } from "./rng.js";
import { ARENA_HEIGHT, ARENA_WIDTH } from "./tuning.js";
import type { Terrain, TerrainView } from "./types.js";

const BEDROCK = ARENA_HEIGHT - 28;
const HIGHEST_SURFACE = 290;

/** Castle x positions spread across the width, left to right. */
export function castlePositions(rng: RngHolder, playerCount: number): number[] {
  const margin = 110;
  const span = ARENA_WIDTH - 2 * margin;
  const xs: number[] = [];
  for (let i = 0; i < playerCount; i++) {
    const base = margin + (span * i) / (playerCount - 1);
    // Edge castles only move inward; middle castles wobble either way.
    let jitter = range(rng, -25, 25);
    if (i === 0) jitter = Math.abs(jitter);
    else if (i === playerCount - 1) jitter = -Math.abs(jitter);
    xs.push(Math.round(base + jitter));
  }
  return xs;
}

function bump(dx: number, sigma: number): number {
  const u = dx / sigma;
  return exp(-u * u);
}

/**
 * Generates the height map for castles standing at `castleXs`. `peakScale` scales every peak and
 * extra hill (1 = full size); `createRound` lowers it for arenas where castles cannot reach each other.
 */
export function generateTerrain(
  rng: RngHolder,
  castleXs: readonly number[],
  peakScale = 1,
): Terrain {
  const width = ARENA_WIDTH;
  const surface = new Float64Array(width);
  const baseY = range(rng, 650, 715);

  // Rolling hills: a few sines with random phases.
  const waves = [
    {
      amp: range(rng, 25, 45),
      len: range(rng, 600, 900),
      phase: range(rng, 0, Math.PI * 2),
    },
    {
      amp: range(rng, 12, 24),
      len: range(rng, 220, 320),
      phase: range(rng, 0, Math.PI * 2),
    },
    {
      amp: range(rng, 4, 9),
      len: range(rng, 80, 130),
      phase: range(rng, 0, Math.PI * 2),
    },
  ];

  // Tall peaks between neighbouring castles, plus a couple of smaller hills in wide gaps.
  const peaks: { x: number; h: number; sigma: number }[] = [];
  for (let i = 0; i + 1 < castleXs.length; i++) {
    const a = castleXs[i] ?? 0;
    const b = castleXs[i + 1] ?? width;
    const gap = b - a;
    const mid = (a + b) / 2 + range(rng, -0.1, 0.1) * gap;
    const maxH = Math.min(380, gap * 0.95);
    peaks.push({
      x: mid,
      h: range(rng, 0.6, 1) * maxH * peakScale,
      sigma: Math.min(150, gap * 0.16),
    });
    if (gap > 600) {
      for (const side of [-1, 1]) {
        peaks.push({
          x: mid + side * gap * range(rng, 0.22, 0.3),
          h: range(rng, 60, 150) * peakScale,
          sigma: range(rng, 50, 90),
        });
      }
    }
  }

  for (let x = 0; x < width; x++) {
    let y = baseY;
    for (const w of waves)
      y += w.amp * sin((x / w.len) * Math.PI * 2 + w.phase);
    // Peaks are slightly sharpened bumps so they read as mountains, not blobs.
    for (const p of peaks) {
      const b = bump(x - p.x, p.sigma);
      y -= p.h * b * (0.75 + 0.25 * b);
    }
    surface[x] = y;
  }

  // Flatten a pad under each castle, blending into the surrounding hills.
  for (const cx of castleXs) {
    const c = Math.round(cx);
    const padY = surface[Math.min(width - 1, Math.max(0, c))] ?? baseY;
    const flat = 44;
    const blend = 36;
    for (
      let x = Math.max(0, c - flat - blend);
      x <= Math.min(width - 1, c + flat + blend);
      x++
    ) {
      const d = Math.abs(x - c);
      const t = d <= flat ? 1 : 1 - (d - flat) / blend;
      const s = t * t * (3 - 2 * t);
      surface[x] = (surface[x] ?? padY) * (1 - s) + padY * s;
    }
  }

  // Tiny noise so the surface does not look machined.
  for (let x = 0; x < width; x++) {
    const y = (surface[x] ?? baseY) + (random(rng) - 0.5) * 1.2;
    surface[x] = Math.min(BEDROCK - 40, Math.max(HIGHEST_SURFACE, y));
  }

  return { width, height: ARENA_HEIGHT, surface, bedrock: BEDROCK, version: 0 };
}

/** Surface y at an x coordinate (columns outside the arena count as bedrock-deep pits). */
export function surfaceAt(t: TerrainView, x: number): number {
  const i = Math.floor(x);
  if (i < 0 || i >= t.width) return t.height + 1000;
  return t.surface[i] ?? t.height;
}

/** Highest ground (smallest y) over the inclusive x range. */
export function highestGround(t: TerrainView, x0: number, x1: number): number {
  const a = Math.max(0, Math.floor(x0));
  const b = Math.min(t.width - 1, Math.floor(x1));
  let best = t.bedrock;
  for (let x = a; x <= b; x++) {
    const y = t.surface[x] ?? t.bedrock;
    if (y < best) best = y;
  }
  return best;
}

/** A run of at most this many columns standing this far above both neighbours is a needle. */
const NEEDLE_WIDTH = 2;
const NEEDLE_HEIGHT = 3;

/**
 * Carves a circular crater. Every column the circle spans loses everything down to the circle's
 * bottom: a height map cannot hold an overhang, so rock above the circle goes too. Needles of
 * 1–2 columns left standing beside the crater are then levelled with their higher neighbour.
 * Returns the inclusive changed column range, or null if nothing changed.
 */
export function carveCrater(
  t: Terrain,
  cx: number,
  cy: number,
  radius: number,
): { x0: number; x1: number } | null {
  const a = Math.max(0, Math.ceil(cx - radius));
  const b = Math.min(t.width - 1, Math.floor(cx + radius));
  let x0 = -1;
  let x1 = -1;
  for (let x = a; x <= b; x++) {
    const dx = x + 0.5 - cx;
    const d2 = radius * radius - dx * dx;
    if (d2 <= 0) continue;
    const bottom = Math.min(t.bedrock, cy + Math.sqrt(d2));
    const current = t.surface[x] ?? t.bedrock;
    if (current >= bottom) continue;
    t.surface[x] = bottom;
    if (x0 < 0) x0 = x;
    x1 = x;
  }
  if (x0 < 0) return null;
  // Level needles in and just beside the crater (a column between two craters can survive both).
  // Off-arena neighbours count as bedrock (the arena edge is a pit, as in surfaceAt), so a sliver
  // left against the edge is levelled with its in-arena neighbour.
  const s = t.surface;
  const from = Math.max(0, x0 - NEEDLE_WIDTH);
  const to = Math.min(t.width - 1, x1 + 1);
  for (let x = from; x <= to; x++) {
    for (let w = 1; w <= NEEDLE_WIDTH && x + w <= t.width; w++) {
      const level = Math.min(s[x - 1] ?? t.bedrock, s[x + w] ?? t.bedrock);
      let lowest = -Infinity;
      for (let k = x; k < x + w; k++) lowest = Math.max(lowest, s[k] ?? 0);
      if (lowest >= level - NEEDLE_HEIGHT) continue;
      for (let k = x; k < x + w; k++) s[k] = level;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x + w - 1);
    }
  }
  t.version++;
  return { x0, x1 };
}
