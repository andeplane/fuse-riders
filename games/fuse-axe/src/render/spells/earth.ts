import { VIEW_W } from "../../engine/view-kit.js";
import type { SpellView, WorldView } from "../../engine/view.js";
import { bayer } from "../backdrop/kit.js";
import * as S from "./kit.js";
import { bakeArt, blitPart, hash, put, type MakeSurface } from "./kit.js";

/**
 * Gorm's earth: the ground rumbles while the enemies stand frozen, then a boulder crashes on every enemy on screen at
 * the blow, more of them about it and bigger at every level, each hopping twice on away from Gorm in a puff of dust
 * and lying there until the spell ends. Level 3 first splits the ground: a crack runs out from his feet to both edges
 * and bursts open, glowing, with shards of rock thrust up along it at the blow.
 */
export const FISSURE_LEVEL = 3;
/** Extra boulders by level, beside one on every enemy, and the boulders' sizes. */
export const BOULDERS = [2, 4, 7] as const;
export const RADII = [5, 7, 10] as const;
/** A boulder falls `DROP` pixels over `FALL` steps, then hops for `HOP` and `HOP2`. */
const [FALL, DROP, HOP, HOP2, CRACK_H] = [22, 170, 14, 8, 16];
const ROCK = [0xf0c890, 0xb07a4e, 0x784a38, 0x45283a] as const;

/** A boulder `r` across from its middle, lit from the upper left, faceted, a rune glowing in a crack. */
const boulderArt = <I>(make: MakeSurface<I>, r: number, turn: number) =>
  bakeArt(make, 2 * r + 3, 2 * r + 3, (dot) => {
    for (let y = -r - 1; y <= r + 1; y++)
      for (let x = -r - 1; x <= r + 1; x++) {
        const [u, v] = turn ? [-y, x] : [x, y];
        const facet = hash(Math.round(Math.atan2(v, u) * 2.5) + 9, turn) - 0.5;
        const d = Math.hypot(x * 0.95, y * 1.05) + facet * 1.1;
        const light = (-x - y) / r + (hash(u * 3 + 40, v * 7 + 40) - 0.5) / 2;
        const shade = light > 0.75 ? 0 : light > 0 ? 1 : light > -0.8 ? 2 : 3;
        if (d <= r + 0.6)
          dot(r + 1 + x, r + 1 + y, d > r - 0.5 ? S.INK : ROCK[shade]);
      }
    const [rx, ry] = turn ? [r, r + 2] : [r + 2, r + 1];
    dot(rx, ry, S.LIME);
    dot(rx + 1, ry + 1, S.LIME);
  });

/** A soft dithered ellipse in `rgb`, solid at its heart and thinning to its edge, hollow inside `hole`. */
const blobArt = <I>(
  make: MakeSurface<I>,
  rx: number,
  ry: number,
  rgb: number,
  hole = 0,
) =>
  bakeArt(make, 2 * rx + 1, 2 * ry + 1, (dot) => {
    for (let y = 0; y <= 2 * ry; y++)
      for (let x = 0; x <= 2 * rx; x++) {
        const d = ((x - rx) / rx) ** 2 + ((y - ry) / ry) ** 2;
        if (d <= 1 && d >= hole && (d < 0.4 || (1 - d) / 0.6 > bayer(x, y)))
          dot(x, y, rgb, 0.7);
      }
  });

/** The crack across the floor: a dark seam with green glints, or burst open, glowing green and gold. */
const crackArt = <I>(make: MakeSurface<I>, open: boolean) =>
  bakeArt(make, VIEW_W, CRACK_H, (dot) => {
    for (let x = 0; x < VIEW_W; x++) {
      const y = 8 + Math.round(seam(x) + hash(x >> 1, 3) - 0.5);
      const w = open ? 1 + Math.round(hash(x >> 2, 5) * 1.5) : 0;
      for (let k = -w - 2; k <= w + 2 && open; k++) {
        const edge = Math.abs(k);
        if (edge <= w)
          dot(x, y + k, edge === w ? S.INK : edge ? S.LIME : S.FLAME[0]);
        else if (bayer(x, y + k) < 0.5 - (edge - w) * 0.15)
          dot(x, y + k, S.LIME, 0.6);
      }
      if (!open) dot(x, y, S.INK);
      if (!open && x % 5 === 0) dot(x, y - 1, S.LIME);
      if (open && hash(x, 9) > 0.93)
        for (let k = 1; k < 4; k++) dot(x + k, y + (x & 1 ? k : -k), S.INK);
    }
  });
const seam = (x: number) =>
  2.5 * Math.sin(x * 0.07) + 1.5 * Math.sin(x * 0.19 + 2);

/** A shard of rock `h` rows tall thrust up from the crack: lit left, dark right, outlined. */
const shardArt = <I>(make: MakeSurface<I>, h: number) =>
  bakeArt(make, 7, h, (dot) => {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < 7; x++) {
        const [off, half] = [x - 3, 0.6 + (y / h) * 2.6];
        if (Math.abs(off) <= half + 0.5)
          dot(x, y, Math.abs(off) > half - 0.5 ? S.INK : ROCK[off < 0 ? 1 : 3]);
      }
  });

export function createEarth<I>(make: MakeSurface<I>): S.KindArt<I> {
  const boulders = RADII.map((r) => [0, 1].map((t) => boulderArt(make, r, t)));
  const shadows = RADII.map((r) => blobArt(make, r + 2, r >> 1, 0x0e0418));
  const dust = [
    blobArt(make, 9, 4, 0xd6c2a8),
    blobArt(make, 13, 5, 0xc8a07a, 0.35),
  ];
  const cracks = [crackArt(make, false), crackArt(make, true)] as const;
  const shards = [shardArt(make, 16), shardArt(make, 10)] as const;
  /** Every boulder this step: where it landed and where it is, its height and size, and the steps since it landed. */
  const flights = (
    spell: SpellView,
    t: S.Timing,
    age: number,
    view: WorldView,
  ) => {
    const [seed, cx] = [spell.hero * 53 + 29, S.casterX(view, spell)];
    const drops = S.targets(view).map(
      (e) => [e.x - view.camX, e.y, t.hit, Math.min(2, t.level)] as const,
    );
    for (let i = 0; i < BOULDERS[t.level - 1]!; i++) {
      const size = Math.floor(hash(seed, i + 3) * Math.min(3, t.level + 1));
      drops.push([
        ...S.spot(i, seed),
        t.hit - 14 + Math.floor(hash(i, seed + 3) * 26),
        size,
      ]);
    }
    return drops.flatMap(([x0, feet, land, size]) => {
      const [since, dir] = [age - land, x0 < cx ? -1 : 1];
      const u = since < HOP ? since / HOP : Math.min(1, (since - HOP) / HOP2);
      const [x, z] =
        since < 0
          ? [x0, DROP * (1 - ((since + FALL) / FALL) ** 2)]
          : since < HOP
            ? [x0 + dir * 16 * u, (RADII[size]! + 6) * 4 * u * (1 - u)]
            : [x0 + dir * (16 + 6 * u), 16 * u * (1 - u)];
      return since < -FALL ? [] : [{ x0, x, z, feet, size, since }];
    });
  };
  /** On the ground, under the figures: the boulders' shadows, the crack and its shards. */
  const ground: S.Play<I> = (pen, spell, t, age, view) => {
    for (const { x, z, feet, size } of flights(spell, t, age, view)) {
      const s = shadows[size]!;
      if (z < DROP * 0.8) put(pen, s, x - (s.w >> 1), feet - (s.h >> 1));
    }
    if (t.level < FISSURE_LEVEL || age >= t.steps - 6) return;
    // The crack runs out from his feet to both edges before the blow, bursts open at it, and seals at the end.
    const cx = S.casterX(view, spell);
    const reach = Math.ceil(
      Math.max(cx, VIEW_W - cx) * Math.min(1, (age + 1) / (t.hit - 10)),
    );
    const open = age >= t.hit - 2 && age < t.steps - 16;
    const top = S.FLOOR_MID - CRACK_H / 2;
    blitPart(
      pen,
      cracks[open ? 1 : 0].image,
      [cx - reach, 0, 2 * reach, CRACK_H],
      cx - reach,
      top,
    );
    const since = age - t.hit;
    for (let k = 0; since >= 0 && since < 16 && k < 14; k++) {
      const art = shards[k & 1]!;
      const rise = Math.ceil(art.h * Math.sin((Math.PI * (since + 1)) / 17));
      const x = 8 + k * 22 + Math.floor(hash(k, spell.hero) * 10);
      const y = top + 10 + Math.round(seam(x));
      blitPart(pen, art.image, [0, 0, art.w, rise], x - 3, y - rise);
    }
  };
  /** Over the figures: the boulders and their dust, blinking out over the spell's last steps. */
  const over: S.Play<I> = (pen, spell, t, age, view, frame) => {
    if (age >= t.steps - 12 && (frame >> 2) & 1) return;
    for (const { x0, x, z, feet, size, since } of flights(
      spell,
      t,
      age,
      view,
    )) {
      const puff = dust[since < 4 ? 0 : 1]!;
      if (since >= 0 && since < 8)
        put(pen, puff, x0 - (puff.w >> 1), feet - puff.h + 2);
      const art = boulders[size]![since < HOP + HOP2 ? (age / 3) & 1 : 0]!;
      put(pen, art, x - (art.w >> 1), feet - z - art.h + 1);
    }
  };
  return { ground, over };
}
