import { FLAME, flamePx } from "../engine/view-kit.js";
import type { MountView } from "../engine/view.js";
import { DRAKE_MOUTHS, type DrakeFrame } from "./art/drake.js";
import { blit, type Pen } from "./pen.js";
import { UNLIT } from "./pixel/palette.js";
import { CLEAR, type Sprite } from "./pixel/sprite.js";
import type { SpriteBaker } from "./pixel/surface.js";

/**
 * An ember drake's breath: a jet of fire from its jaws (the frame's `DRAKE_MOUTHS`) along its facing to the flame's
 * front (`flamePx`), at the drake's depth so it is drawn with the drake: over a figure further up the floor, under
 * one in front of it. A white-hot core at the jaws cools through gold and orange to a deep red rim, the jet widening
 * and drooping as it goes and billowing at its front; tongues lick up off it and embers rise, streaming forward as the
 * steps go by. The jet is one sprite per length and phase, made once (`flameSprite`) and baked once, so a breath is
 * one blit a frame; it is a pure function of the drake's view (no randomness, no clock: the same on every device).
 */
export const FLAME_PHASES = 4;
/** Steps each phase shows, and how far the flame's pattern streams forward from one phase to the next. */
export const PHASE_STEPS = 2;
const SHIFT = 3;
const PERIOD = SHIFT * FLAME_PHASES;
/** The longest jet, from the drake's centre: no jet is longer. */
const LONGEST = Math.ceil(FLAME.mouth + FLAME.length);
/** The rows over and under the jaws a jet's sprite holds: tongues and embers above, the droop and billow below. */
const ABOVE = 20;
const BELOW = 14;
const DROOP = 0.06;
const PALETTE = Object.fromEntries(
  ["Z", "F", "f", "~", "="].map((key) => [key, UNLIT[key]!]),
);

/** A fixed integer hash of a whole number to [0, 1): the same tongues and embers on every device. */
const hash = (n: number) => {
  let h = Math.imul(n | 0, 0x2c1b3c6d) ^ 0x297a2d39;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  return ((h ^ (h >>> 13)) >>> 0) / 2 ** 32;
};

/**
 * The jet `length` pixels long from the jaws (its anchor, at their row) in `phase`: each column's top and bottom edge
 * wave with the pattern streaming `SHIFT` px a phase (`PERIOD` px round, so the phases loop), its last ten pixels
 * swelling into a rounded billow.
 */
export function flameSprite(length: number, phase: number): Sprite {
  const n = Math.max(1, Math.min(LONGEST, Math.floor(length)));
  const p = (((Math.floor(phase) % FLAME_PHASES) + FLAME_PHASES) % FLAME_PHASES) * SHIFT; // prettier-ignore
  const rows = Array.from({ length: ABOVE + BELOW + 1 }, () =>
    Array<string>(n).fill(CLEAR),
  );
  const put = (u: number, row: number, key: string) => {
    const y = ABOVE + row;
    if (u >= 0 && u < n && y >= 0 && y < rows.length) rows[y]![u] = key;
  };
  const bulb = Math.min(12, n / 2);
  const KEYS = ["=", "~", "f", "F", "Z"];
  for (let u = 0; u < n; u++) {
    const wave = (u - p) * ((2 * Math.PI) / PERIOD);
    // The billow: swelling past the jet, then rounding off to its front.
    const s = (u + 0.5 - (n - bulb)) / bulb;
    const cap = s > 0.5 ? Math.sqrt(Math.max(0.05, 1 - ((s - 0.5) / 0.5) ** 2)) : 1; // prettier-ignore
    const swell = s > 0 ? (1 + 0.6 * Math.sin(Math.PI * Math.min(s, 0.6))) * cap : 1; // prettier-ignore
    const body = (1.6 + 6.4 * Math.sqrt(Math.min(u, 56) / 56)) * swell;
    const top = body + 1.1 * Math.sin(wave) + 0.6 * Math.sin(2 * wave + 1);
    const bottom = body * 0.8 + 0.7 * Math.sin(wave + 2);
    const centre = u * DROOP;
    const cool = u / LONGEST;
    for (let row = -ABOVE; row <= BELOW; row++) {
      const dy = row + 0.5 - centre;
      const r = dy < 0 ? -dy / Math.max(top, 0.6) : dy / Math.max(bottom, 0.6);
      if (r > 1) continue;
      // Hotter at the heart and nearer the jaws; streaks trailing back through it a shade cooler.
      const heat = (1 - r) * (1.1 - 0.55 * cool);
      const streak = (u - p - 1.6 * row + PERIOD * 99) % 9 < 1.3 ? 1 : 0;
      const level = heat > 0.85 && u < 8 ? 4 : heat > 0.62 ? 3 : heat > 0.38 ? 2 : heat > 0.15 ? 1 : 0; // prettier-ignore
      put(u, row, KEYS[Math.max(Math.min(level, 1), level - streak)]!);
    }
    // A tongue licks up off the top edge once a period, leaning back, its height the pattern's own.
    const lick = (u - p + PERIOD * 99) % PERIOD;
    if (u > 4 && lick < 3.5) {
      const tall = 3 + Math.floor(3 * hash(Math.floor((u - p) / PERIOD)));
      const high = Math.round(tall * (lick < 1 ? 1 : 1 - (lick - 1) / 3));
      const edge = Math.floor(centre - top) + 1;
      for (let k = 0; k < high; k++)
        put(u, edge - k, k + 1 < high ? (k < 1 ? "f" : "~") : "=");
    }
  }
  // Embers flung up off the jet, rising and dimming phase by phase.
  for (let i = 0; i * 9 < n; i++) {
    const u = Math.floor(i * 9 + 4 * hash(i) + p) % Math.max(1, n - 2);
    const age = (p / SHIFT + Math.floor(4 * hash(i + 50))) % FLAME_PHASES;
    const rise = Math.floor(3 + 2 * age + 3 * hash(i + 99) + u * 0.08);
    put(u, Math.floor(u * DROOP) - rise - 4, ["F", "f", "~", "="][age]!);
  }
  return {
    w: n,
    h: rows.length,
    ax: 0,
    ay: ABOVE,
    palette: PALETTE,
    rows: rows.map((row) => row.join("")),
  };
}

/** Every jet, by length and phase, made on first use and kept, so the baker's cache keeps each one baked. */
const jets = new Map<number, Sprite>();
const jetOf = (length: number, phase: number) => {
  const key = length * FLAME_PHASES + phase;
  const known = jets.get(key) ?? flameSprite(length, phase);
  jets.set(key, known);
  return known;
};

/**
 * A breathing drake's flame, drawn showing `frame` of its figure: from its jaws to the flame's front along its facing.
 * Nothing for a beast that is not a drake breathing, a frame with no jaws, or while the front is still behind the jaws
 * (the breath's first steps and its last).
 */
export function drawFlame<Image>(
  pen: Pen<Image>,
  baker: SpriteBaker<Image>,
  mount: MountView,
  frame: string,
  camX: number,
): void {
  const breathing = mount.kind === "drake" && mount.anim === "breathe";
  if (!breathing || !Object.hasOwn(DRAKE_MOUTHS, frame)) return;
  const mouth = DRAKE_MOUTHS[frame as DrakeFrame];
  const length = Math.round(flamePx(mount.animStep)) - mouth[0];
  if (!(length > 0)) return;
  const step = Math.max(0, Math.floor(mount.animStep));
  const phase = Math.floor(step / PHASE_STEPS) % FLAME_PHASES;
  const jet = baker.bake(jetOf(length, phase), { flip: mount.facing < 0 });
  const x = Math.floor(mount.x - camX) + mount.facing * mouth[0],
    y = Math.floor(mount.y) - Math.floor(mount.z) - mouth[1];
  blit(pen, jet.image, jet.w, jet.h, x - jet.ax, y - jet.ay);
}
