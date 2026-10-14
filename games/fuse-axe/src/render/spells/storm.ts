import { VIEW_W } from "../../engine/view-kit.js";
import * as S from "./kit.js";
import {
  bakeArt,
  hash,
  put,
  type Art,
  type MakeSurface,
  type Pen,
} from "./kit.js";

/**
 * Brakka's storm: the sky darkens and crackles while the enemies stand frozen, then lightning strikes every enemy on
 * screen at the blow and the floor around them, more bolts at every level; level 4 first rolls a thunderhead over the
 * screen, and its bolts fall from it doubled. A bolt is stacked from baked segments, each `SEG` rows stepping up to
 * `REACH` pixels sideways; a white-hot bolt re-forks every few frames as it crackles, its afterglow keeps its shape.
 */
export const THUNDERHEAD_LEVEL = 4;
/** Extra bolts striking the floor by level, beside one on every enemy; steps a bolt shows, the first `HOT` white. */
export const STRIKES = [1, 3, 5, 8] as const;
export const BOLT_STEPS = 10;
const [HOT, SEG, REACH, CLOUD_H] = [5, 6, 3, 48];

interface Bolt<I> {
  readonly seg: readonly Art<I>[];
  readonly fork: readonly Art<I>[];
  readonly burst: Art<I>;
}
/** A bolt's segments (one per sideways step), its forks and the burst where it lands, in a core and a rim colour. */
const boltArt = <I>(make: MakeSurface<I>, core: number, rim: number) => ({
  seg: Array.from({ length: 2 * REACH + 1 }, (_, k) =>
    bakeArt(make, 2 * REACH + 4, SEG, (dot) => {
      for (let r = 0; r < SEG; r++) {
        const x = REACH + 2 + Math.round(((k - REACH) * (r + 1)) / SEG);
        [rim, core, core, rim].forEach((rgb, i) => dot(x - 2 + i, r, rgb));
      }
    }),
  ),
  fork: [-1, 1].map((dir) =>
    bakeArt(make, 12, 10, (dot) => {
      for (let k = 0; k < 9; k++) {
        dot(6 + Math.round(dir * k * 0.7), k, k < 5 ? core : rim);
        dot(6 + Math.round(dir * k * 0.7) + dir, k, rim);
      }
    }),
  ),
  burst: bakeArt(make, 23, 9, (dot) => {
    for (let y = 0; y < 9; y++)
      for (let x = 0; x < 23; x++) {
        const d = ((x - 11) / 11) ** 2 + ((y - 4) / 4) ** 2;
        if (d < 0.12) dot(x, y, S.WHITE);
        else if (d < 1 && hash(x, y) > d) dot(x, y, d < 0.5 ? core : rim, 0.85);
      }
  }),
});

/** The thunderhead: a band of storm cloud with a billowing underside, dark or lit from within. */
const cloudArt = <I>(make: MakeSurface<I>, lit: boolean) =>
  bakeArt(make, VIEW_W, CLOUD_H, (dot) => {
    const shades = lit
      ? [0x1a0e2e, 0x47265a, 0x8c7ab0, 0xc8f8ff]
      : [0x0e0718, 0x1a0e2e, 0x2c1846, 0x47265a];
    for (let x = 0; x < VIEW_W; x++) {
      const under = 34 + 6 * Math.sin(x * 0.09) + 4 * Math.sin(x * 0.23 + 1);
      for (let y = 0; y < under + 2 * Math.sin(x * 0.61); y++) {
        const puff =
          Math.sin(x * 0.3 + y * 0.4) * 0.5 + hash(x >> 1, y >> 1) * 0.6;
        const depth = under + 2 * Math.sin(x * 0.61) - y;
        dot(
          x,
          y,
          shades[
            depth < 1.5
              ? 3
              : depth < 4 + puff * 3
                ? 2
                : y > 14 + puff * 8
                  ? 1
                  : 0
          ]!,
        );
      }
    }
  });

/** A jagged bolt from row `top` down to (`x`, `feet`), shaped by `seed`, bursting where it lands if `lands`. */
function bolt<I>(
  pen: Pen<I>,
  art: Bolt<I>,
  x: number,
  top: number,
  feet: number,
  seed: number,
  lands = true,
) {
  let bottom = Math.floor(x);
  for (let k = 0, y = Math.floor(feet); y > top; k++, y -= SEG) {
    let shift = Math.floor(hash(k, seed) * (2 * REACH + 1)) - REACH;
    // A bolt wanders, but no further than a dozen pixels from the line it falls along.
    if (Math.abs(bottom - shift - x) > 12) shift = -shift;
    put(pen, art.seg[shift + REACH]!, bottom - shift - REACH - 2, y - SEG);
    if (k > 1 && hash(seed, k) > 0.85)
      put(pen, art.fork[k & 1]!, bottom - shift - 6, y - SEG);
    bottom -= shift;
  }
  if (lands) put(pen, art.burst, Math.floor(x) - 11, Math.floor(feet) - 4);
}

export function createStorm<I>(make: MakeSurface<I>): S.KindArt<I> {
  const [hot, dim] = [
    boltArt(make, S.WHITE, S.CYAN),
    boltArt(make, S.CYAN, S.VIOLET),
  ];
  const clouds = [cloudArt(make, false), cloudArt(make, true)] as const;
  const over: S.Play<I> = (
    pen,
    spell,
    { steps, hit, level },
    age,
    view,
    frame,
    marks,
  ) => {
    const seed = spell.hero * 97 + 13;
    let top = S.SKY;
    if (level >= THUNDERHEAD_LEVEL) {
      // It rolls down over half a second and back up over the last third of one, flickering through the strikes.
      const drop = Math.min(1, (age + 1) / 30, (steps - age) / 20);
      const striking = age >= hit - 2 && age < hit + 12;
      const lit = hash(frame >> 2, seed) > (striking ? 0.4 : 0.9);
      top = S.SKY - Math.round((1 - drop) * CLOUD_H);
      put(pen, clouds[lit ? 1 : 0], 0, top);
      top += 30;
    }
    // As the storm gathers, short bolts crackle in the sky, a few more at every level.
    const tick = Math.floor(age / 3);
    if (age >= 8 && age < hit - 1)
      for (let j = 0; j <= level; j++)
        if (hash(tick * 5 + j, seed) < 0.45) {
          const x = 10 + hash(j, tick + seed) * 300;
          bolt(
            pen,
            dim,
            x,
            top - 6,
            top + 8 + hash(tick, j) * 16,
            seed + tick * 31 + j,
            false,
          );
        }
    // Every enemy on screen is struck at the blow, and the floor around them through the strikes.
    const strikes = marks.map((m) => [m.x - view.camX, m.y, hit - 1] as const);
    for (let i = 0; i < STRIKES[level - 1]!; i++)
      strikes.push([
        ...S.spot(i, seed),
        hit - 8 + Math.floor(hash(i, seed + 5) * (8 + 6 * level)),
      ]);
    strikes.forEach(([x, feet, at], i) => {
      const since = age - at;
      if (!(since >= 0 && since < BOLT_STEPS)) return;
      const shape = seed + i * 131 + (since < HOT ? frame >> 2 : 0);
      bolt(pen, since < HOT ? hot : dim, x, top, feet, shape);
      if (since < HOT && level >= THUNDERHEAD_LEVEL)
        bolt(pen, dim, x + 3, top, feet, shape + 7, false);
    });
  };
  return { over };
}
