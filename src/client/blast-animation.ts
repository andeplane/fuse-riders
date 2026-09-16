import { BLAST_VISIBLE_TICKS } from '../shared/game.js';
import type { ViewSnapshot } from './snapshot-stream.js';

type Blast = ViewSnapshot['blasts'][number];
export type BlastTone = 'outer' | 'warm' | 'core';
export interface BlastCircleFrame { x: number; y: number; radius: number; alpha: number; tone: BlastTone }
export interface BlastSparkFrame { x: number; y: number; size: number; alpha: number }
export interface BlastFrame {
  circles: BlastCircleFrame[];
  sparks: BlastSparkFrame[];
  ring: { radius: number; alpha: number };
  footprintAlpha: number;
}

const clamp = (n: number): number => Math.max(0, Math.min(1, n));
const easeOut = (n: number): number => 1 - (1 - clamp(n)) ** 3;
const smooth = (n: number): number => { const t = clamp(n); return t * t * (3 - 2 * t); };
const pop = (n: number): number => {
  const t = clamp(n) - 1;
  return 1 + 2.4 * t ** 3 + 1.4 * t ** 2;
};

/** Stable cosmetic variation, independent of frame order and the simulation's random stream. */
function variation(id: number, lane: number): number {
  let n = Math.imul(id ^ Math.imul(lane + 1, 0x9e3779b9), 0x85ebca6b);
  n = Math.imul(n ^ (n >>> 16), 0xc2b2ae35);
  return ((n ^ (n >>> 16)) >>> 0) / 0x100000000;
}

/**
 * A stateless pop / bloom / break / clear, sampled from presentation ticks. The existing
 * eight-tick blast lifetime (400 ms) owns expiry; no timers, effect history or physics changes.
 * Every filled circle and square stays inside the supplied damage disk, even at overshoot.
 */
export function blastFrame(blast: Blast, tick: number): BlastFrame {
  const age = 1 - (blast.expiresAtTick - tick) / BLAST_VISIBLE_TICKS;
  const frame: BlastFrame = { circles: [], sparks: [], ring: { radius: 0, alpha: 0 }, footprintAlpha: 0 };
  const { x, y, radius } = blast.circle;
  if (age < 0 || age >= 1 || radius <= 0) return frame;

  // The faint full-size disk keeps the hazardous footprint readable during the small initial pop.
  frame.footprintAlpha = .045 * (1 - smooth((age - .8) / .2));
  frame.ring = { radius: radius * (.25 + .75 * easeOut(age / .24)), alpha: .24 * (1 - age) };
  const rotation = variation(blast.bombId, 0) * Math.PI * 2;
  for (let i = 0; i < 9; i++) {
    const outer = i < 5;
    const size = variation(blast.bombId, i * 4 + 1);
    const timing = variation(blast.bombId, i * 4 + 2);
    const jitter = variation(blast.bombId, i * 4 + 3);
    const angle = rotation + (outer ? i / 5 : (i - 5) / 4 + .13) * Math.PI * 2 + (jitter - .5) * .65;
    const delay = timing * .075;
    const growth = pop((age - delay) / (.21 + size * .07));
    const collapse = smooth((age - (.34 + timing * .12)) / (.42 + size * .1));
    const distance = radius * ((outer ? .41 + jitter * .12 : .17 + jitter * .13) * easeOut((age - delay) / .25) + collapse * .16);
    const circleRadius = Math.min(radius - distance, radius * (outer ? .27 + size * .09 : .24 + size * .07) * growth * (1 - collapse));
    if (circleRadius <= 0) continue;
    frame.circles.push({ x: x + Math.cos(angle) * distance, y: y + Math.sin(angle) * distance,
      radius: circleRadius, alpha: (outer ? .78 : .9) * (1 - smooth((age - .65) / .35)), tone: outer ? 'outer' : 'warm' });
  }
  // The core punches in immediately and contracts before the surrounding lobes separate.
  const coreRadius = radius * (.09 + .2 * pop(age / .15)) * (1 - smooth((age - .25) / .42));
  if (coreRadius > 0) frame.circles.push({ x, y, radius: coreRadius, alpha: .96, tone: 'core' });
  for (let i = 0; i < 6; i++) {
    const random = variation(blast.bombId, 50 + i);
    const travel = easeOut((age - .06 - random * .05) / .75);
    const size = Math.min(5, radius * .035) * (1 - smooth((age - .45) / .55));
    const angle = rotation + (i + .3 + random * .4) * Math.PI / 3;
    const distance = Math.min(radius - size * Math.SQRT1_2, radius * (.3 + travel * (.5 + random * .12)));
    frame.sparks.push({ x: x + Math.cos(angle) * distance, y: y + Math.sin(angle) * distance,
      size, alpha: smooth(age / .1) * (1 - smooth((age - .5) / .5)) });
  }
  return frame;
}
