import * as K from "../../engine/view-kit.js";
import { bayer } from "../backdrop/kit.js";
import { fill } from "../pen.js";
import * as S from "./kit.js";
import {
  bakeArt,
  blitPart,
  hash,
  put,
  type Dot,
  type MakeSurface,
} from "./kit.js";

/**
 * Rhea's fire: a wall of flame bursts up either side of her and rolls out across the floor, reaching both edges of
 * the screen at the blow, taller and longer at every level; the floor it crossed flares up at the blow and smoulders
 * after. Level 6 also calls a firebird, which swoops across over the enemies' heads at the blow, trailing flame. The
 * wall is three rows of tongues across the floor's depth, every tongue read from one baked atlas.
 */
export const FIREBIRD_LEVEL = 6;
/** The tongues' heights, three flickers of each; the wall's crest and length at a level, and its gap about Rhea. */
export const TONGUES = [8, 13, 19, 26, 34, 43, 54, 66] as const;
export const wallHeight = (level: number) => 18 + 8 * level;
export const wallLength = (level: number) => 40 + 16 * level;
const [FLICKERS, TONGUE_W, TALLEST, GAP] = [3, 9, 66, 12];
const ROWS = [K.FLOOR_TOP_PX + 12, S.FLOOR_MID + 2, K.FLOOR_BOTTOM_PX - 4];
/** The firebird's size, and the steps it takes to cross the screen, lowest over the floor at the blow. */
const [BIRD_W, BIRD_H, FLIGHT] = [64, 40, 90];

/** A tongue `h` rows tall: white-hot at the root, through gold and orange to deep red at the licking tip. */
function tongue(dot: Dot, h: number, flicker: number) {
  for (let y = 0; y < h; y++) {
    const q = 1 - y / h;
    const half = 4.4 * Math.sqrt(1 - q) * (q < 0.12 ? 0.75 + 2 * q : 1);
    const lick = Math.sin(q * 7 + flicker * 2) * 0.8 * q;
    const mid = 4 + (flicker - 1) * 1.6 * q * q + lick;
    for (let x = 0; x < TONGUE_W; x++) {
      const off = Math.abs(x - mid);
      const heat = (q * 0.85 + (off / (half + 0.5)) * 0.4) * 3;
      const step = Math.floor(heat) + (heat % 1 > bayer(x, y) ? 1 : 0);
      if (off <= half) dot(x, y, S.FLAME[Math.min(3, step)]!);
    }
  }
}

/**
 * The firebird with its wings up, level or down: a white-hot body and head, a wing fanning from the shoulder gold to
 * red behind a white leading edge, three streamers of tail flame, all rimmed in deep red to stand out on the fire.
 */
const birdArt = <I>(make: MakeSurface<I>, wing: number, flip: boolean) =>
  bakeArt(make, BIRD_W, BIRD_H, (dot) => {
    const grid = new Map<number, number>();
    const set = (x: number, y: number, rgb: number) =>
      grid.set(y * BIRD_W + (flip ? BIRD_W - 1 - x : x), rgb);
    const [tx, ty] = (
      [
        [20, 0],
        [3, 7],
        [22, 39],
      ] as const
    )[wing]!;
    // Which side of the line from (ax, ay) to (bx, by) a point is, for the wing's triangle.
    const side = (x: number, y: number, [ax, ay, bx, by]: readonly number[]) =>
      Math.sign((bx! - ax!) * (y - ay!) - (by! - ay!) * (x - ax!));
    const edges = [
      [48, 18, 26, 25],
      [26, 25, tx, ty],
      [tx, ty, 48, 18],
    ];
    for (let x = 0; x < BIRD_W; x++)
      for (let y = 0; y < BIRD_H; y++) {
        const sides = new Set(edges.map((edge) => side(x, y, edge)));
        const out = Math.hypot(x - 40, y - 20) / Math.hypot(tx - 40, ty - 20);
        const body = ((x - 41) / 11) ** 2 + ((y - 21) / 4.2) ** 2;
        const head = ((x - 54) / 3.8) ** 2 + ((y - 18) / 3.2) ** 2;
        const tail = [0, 1, 2].some((k) => {
          const wave = Math.sin(x * 0.35 + k * 2) * (32 - x) * 0.09;
          return x < 32 && Math.abs(y - 21 - k * 2.5 - wave) < x / 25 + 0.4;
        });
        const feather = out > 0.55 && (x * 3 + y * 2) % 7 === 0;
        const shade = Math.floor(out * 3.6 + bayer(x, y) - 0.5);
        if (body < 1 || head < 1)
          set(x, y, body < 0.45 || head < 1 ? S.WHITE : S.FLAME[0]);
        else if (!(sides.has(1) && sides.has(-1)) && !feather)
          set(x, y, S.FLAME[Math.max(0, Math.min(3, shade))]!);
        else if (tail) set(x, y, S.FLAME[x < 10 ? 3 : x < 20 ? 2 : 1]);
      }
    for (let k = 0; k <= 16; k++)
      set(48 + (((tx - 48) * k) >> 4), 18 + (((ty - 18) * k) >> 4), S.WHITE);
    for (let k = 0; k < 4; k++) set(57 + k, 18 + (k >> 1), S.FLAME[1]);
    set(55, 17, S.INK);
    for (let i = 0; i < BIRD_W * BIRD_H; i++) {
      const [x, y] = [i % BIRD_W, Math.floor(i / BIRD_W)];
      const near = [i - 1, i + 1, i - BIRD_W, i + BIRD_W].some(
        (j) => grid.has(j) && Math.abs((j % BIRD_W) - x) <= 1,
      );
      const rgb = grid.get(i) ?? (near ? S.FLAME[3] : undefined);
      if (rgb !== undefined) dot(x, y, rgb);
    }
  });

export function createFire<I>(make: MakeSurface<I>): S.KindArt<I> {
  const width = TONGUE_W * FLICKERS * TONGUES.length;
  const atlas = bakeArt(make, width, TALLEST, (dot) =>
    TONGUES.forEach((h, k) => {
      for (let f = 0; f < FLICKERS; f++) {
        const left = (k * FLICKERS + f) * TONGUE_W;
        tongue((x, y, rgb) => dot(left + x, TALLEST - h + y, rgb), h, f);
      }
    }),
  );
  const birds = [false, true].map((flip) =>
    [0, 1, 2].map((wing) => birdArt(make, wing, flip)),
  );
  /** The tallest tongue no taller than `h` (none under the shortest), standing on `feet`. */
  const flame = (
    pen: S.Pen<I>,
    x: number,
    feet: number,
    h: number,
    flicker: number,
  ) => {
    let k = -1;
    while (k + 1 < TONGUES.length && TONGUES[k + 1]! <= h) k++;
    if (k < 0) return;
    const [tall, left] = [
      TONGUES[k]!,
      (k * FLICKERS + (flicker % FLICKERS)) * TONGUE_W,
    ];
    const at = [
      Math.floor(x) - (TONGUE_W >> 1),
      Math.floor(feet) - tall,
    ] as const;
    blitPart(pen, atlas.image, [left, TALLEST - tall, TONGUE_W, tall], ...at);
  };
  const over: S.Play<I> = (
    pen,
    spell,
    { steps, hit, level },
    age,
    view,
    frame,
  ) => {
    const cx = S.casterX(view, spell);
    const [height, length, seed] = [
      wallHeight(level),
      wallLength(level),
      spell.hero * 61 + 7,
    ];
    const flick = frame >> 2;
    // The flames die down from the blow to the end, the floor the wall crossed flaring up at the blow.
    const burn = age < hit ? 1 : 1 - (age - hit) / (steps - hit);
    const flare = age >= hit && age < hit + 10 ? 1 - (age - hit) / 10 : 0;
    for (const dir of [-1, 1]) {
      const edge = dir < 0 ? cx : K.VIEW_W - cx;
      const front = GAP + ((edge + 16 - GAP) * (age + 1)) / hit;
      for (let s = GAP, i = 0; s < front - length; s += flare ? 6 : 11, i++) {
        if (!flare && hash(s, seed) < 0.45) continue;
        const row = ROWS[i % 3]! + Math.floor(hash(s, seed + 2) * 9) - 4;
        const smoulder = (14 * hash(seed, s) + 6) * burn;
        const h = smoulder + flare * height * (0.4 + 0.6 * hash(s, seed + 4));
        flame(pen, cx + dir * s, row, h, flick + s);
      }
      // The wall: tallest just behind its rolling front, lower toward its tail, the back row tallest, roots ragged.
      for (let s = 0; s < length && front - s >= GAP; s += 5) {
        const x = cx + dir * (front - s);
        const crest = s < 12 ? 0.55 + s / 26 : 1 - ((s - 12) / length) * 0.8;
        ROWS.forEach((row, r) => {
          const h =
            height *
            crest *
            burn *
            (1 - r * 0.15) *
            (0.8 + 0.4 * hash(s + r, seed));
          const root = row + Math.floor(hash(s, r + 9) * 9) - 4;
          flame(
            pen,
            x + Math.floor(hash(r, s) * 4) - 2,
            root,
            h,
            flick + s + r,
          );
        });
        if (hash(s, seed + 1) >= 0.08 * level * burn) continue;
        const life = ((frame + s * 7) % 40) / 40;
        pen.fillStyle = S.css(S.FLAME[Math.min(3, Math.floor(life * 4))]!);
        const ember = ROWS[0]! - height * crest - life * 30;
        fill(
          pen,
          Math.floor(x + (hash(s, frame >> 3) - 0.5) * 12),
          Math.floor(ember),
          1,
          1,
        );
      }
    }
    const caster = view.heroes.find((hero) => hero.id === spell.hero);
    const u = (age - hit + FLIGHT / 2) / FLIGHT;
    if (level < FIREBIRD_LEVEL || !caster || u < 0 || u >= 1) return;
    // The firebird crosses from behind the caster, a trail of flame behind it.
    const path = (v: number) => {
      const x = caster.facing > 0 ? -50 + v * 420 : K.VIEW_W + 50 - v * 420;
      return [x, 34 + 62 * Math.sin(Math.PI * v)] as const;
    };
    for (let k = 6; k >= 1; k--) {
      const [x, y] = path(u - k * 0.02);
      flame(pen, x, y + 8, 26 - k * 3, flick + k);
    }
    const [x, y] = path(u);
    const bird = birds[caster.facing > 0 ? 0 : 1]![Math.floor(frame / 5) % 3]!;
    put(pen, bird, x - BIRD_W / 2, y - BIRD_H / 2);
  };
  return { over };
}
