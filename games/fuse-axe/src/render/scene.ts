import type {
  EnemyAnim,
  EnemyKind,
  EnemyView,
  HeroView,
  Tier,
  WorldView,
} from "../engine/view.js";
import { DEAD_STEPS, VIEW_W } from "../engine/view-kit.js";
import { heroFrame, stripFrame } from "./art/animate.js";
import { BRAKKA } from "./art/brakka.js";
import { HEROES } from "./art/index.js";
import {
  RAVAGER,
  RAVAGER_ANIMS,
  RAVAGER_TIERS,
  type AnimStrip,
} from "./art/ravager.js";
import { createBackdrop, type StageNumber } from "./backdrop/backdrop.js";
import { bayer } from "./backdrop/kit.js";
import { blit, type Pen } from "./pen.js";
import type { Figure } from "./pixel/kit.js";
import { UNLIT, type Palette } from "./pixel/palette.js";
import { cropSprite, type Sprite } from "./pixel/sprite.js";
import { createSpriteBaker, type BakeOptions } from "./pixel/surface.js";
import { SEAT_COLORS } from "./seat-colors.js";
import { drawSpark } from "./sparks.js";
import type { MakeSurface } from "./surface.js";

/**
 * The game's picture: one native 320 × 180 frame of the engine's view, drawn in layers — the backdrop; every
 * figure's shadow on the floor; heroes and enemies by depth (further up the floor first, then lower before higher,
 * then by id), each flipped to its facing, an enemy flashing in hit-stop and blinking out when defeated, a hero
 * blinking while it is invulnerable; the hit
 * sparks; the grass in front; and a flashing GO → when the road ahead opens. It only draws: positions come from the
 * view (the app blends two ticks for smooth motion), and `frame`, a 60 Hz count, moves only scenery.
 *
 * Every sprite, shadow and sign is painted once into a surface from `make` and reused, so a frame is blits and a few
 * spark pixels.
 */
export interface Scene<Image> {
  draw(pen: Pen<Image>, view: WorldView, frame: number): void;
}

/** What an enemy kind draws with: its figure, a strip per anim, and a palette per tier (none: the figure's own). */
interface EnemyArt {
  readonly figure: Figure;
  readonly anims: Readonly<Record<EnemyAnim, AnimStrip<string>>>;
  readonly tiers: Readonly<Record<Tier, Palette | undefined>>;
}
export const ENEMY_ART: Readonly<Record<EnemyKind, EnemyArt>> = {
  ravager: {
    figure: RAVAGER,
    anims: RAVAGER_ANIMS,
    tiers: { 0: undefined, 1: RAVAGER_TIERS.rust, 2: RAVAGER_TIERS.violet },
  },
};

/** How a hero looks: its figure (Brakka's for a hero whose art has not landed) and its palette. */
export interface HeroLook {
  readonly figure: Figure;
  readonly swap: Palette | undefined;
}

/**
 * Every hero's look, by id. Heroes sharing a figure each get a palette of their own: the figure's heroes take its
 * palettes from the first (its own colours) in seat order, and a hero borrowing the figure takes them from the last
 * back, so a borrower never looks like the figure's own hero. A pure function of the view, the same on every device.
 */
export function heroLooks(heroes: readonly HeroView[]): Map<number, HeroLook> {
  const looks = new Map<number, HeroLook>();
  const bySeat = [...heroes].sort((a, b) => a.seat - b.seat);
  const figures = new Set(
    bySeat.map((hero) => HEROES[hero.kind]?.figure ?? BRAKKA),
  );
  for (const figure of figures) {
    const palettes = [undefined, ...Object.values(figure.swaps)];
    const owners = bySeat.filter((h) => HEROES[h.kind]?.figure === figure);
    const borrowers = bySeat.filter(
      (h) => !HEROES[h.kind] && figure === BRAKKA,
    );
    const n = palettes.length;
    owners.forEach((hero, i) =>
      looks.set(hero.id, { figure, swap: palettes[i % n] }),
    );
    borrowers.forEach((hero, i) =>
      looks.set(hero.id, { figure, swap: palettes[(n - 1 - (i % n)) % n] }),
    );
  }
  return looks;
}

/**
 * `heroLooks` kept for as long as the roster (each hero's id, seat and kind) is the same, which is the whole run: a
 * frame reads the one map back instead of sorting, filtering and allocating a new one sixty times a second. A hero's
 * position, anim or hit points do not enter into it, so a look never changes mid-fight.
 */
export function createLooks(): (
  heroes: readonly HeroView[],
) => ReadonlyMap<number, HeroLook> {
  let roster: readonly Pick<HeroView, "id" | "seat" | "kind">[] = [];
  let looks = new Map<number, HeroLook>();
  const same = (heroes: readonly HeroView[]) => {
    if (heroes.length !== roster.length) return false;
    for (let i = 0; i < heroes.length; i++) {
      const hero = heroes[i]!;
      const known = roster[i]!;
      if (
        hero.id !== known.id ||
        hero.seat !== known.seat ||
        hero.kind !== known.kind
      )
        return false;
    }
    return true;
  };
  return (heroes) => {
    if (!same(heroes)) {
      roster = heroes.map(({ id, seat, kind }) => ({ id, seat, kind }));
      looks = heroLooks(heroes);
    }
    return looks;
  };
}

/** A defeated enemy lies still for a third of `DEAD_STEPS`, then blinks every `BLINK_STEPS` until it is gone. */
export const BLINK_STEPS = 4;
export const deadShows = (animStep: number): boolean =>
  animStep < DEAD_STEPS / 3 ||
  (animStep < DEAD_STEPS && Math.floor(animStep / BLINK_STEPS) % 2 === 0);

/** An invulnerable hero (getting up, or just risen) blinks: its sprite shows and hides every `BLINK_FRAMES` frames. */
export const BLINK_FRAMES = 4;

/** A shadow's half-width on the ground; it shrinks as the figure rises, to half at `SHADOW_FADE` pixels up. */
export const SHADOW_RX = 13;
const SHADOW_FADE = 60;
const SHADOW = "rgba(14, 4, 24, 0.62)";
export const shadowRadius = (z: number): number =>
  Math.round(
    SHADOW_RX * (1 - Math.min(Math.max(z, 0), SHADOW_FADE) / (2 * SHADOW_FADE)),
  );

/** A mask (`#` on) drawn `scale` times its size in gold (`D`), outlined, with a pink drop below and right if `drop`. */
function signSprite(mask: readonly string[], scale: number, drop: boolean) {
  const on = (x: number, y: number) =>
    mask[Math.floor((y - 1) / scale)]?.[Math.floor((x - 1) / scale)] === "#";
  const under = (x: number, y: number) => drop && on(x - 1, y - 1);
  const near = (x: number, y: number) =>
    [-1, 0, 1].some((dx) =>
      [-1, 0, 1].some((dy) => on(x + dx, y + dy) || under(x + dx, y + dy)),
    );
  const pad = drop ? 3 : 2;
  const [w, h] = [mask[0]!.length * scale + pad, mask.length * scale + pad];
  const rows = Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) =>
      on(x, y) ? "D" : under(x, y) ? "P" : near(x, y) ? "k" : ".",
    ).join(""),
  );
  const palette = { k: UNLIT.k!, D: UNLIT.D!, P: UNLIT.P! };
  return { w, h, ax: 0, ay: 0, palette, rows } satisfies Sprite;
}
/** "GO →", flashing at the right when a wave is cleared: its top-left corner, and the 60 Hz frames it shows and hides. */
export const GO_SIGN = signSprite(
  [
    ".####..###.....#..",
    "#.....#...#....##.",
    "#.###.#...#..#####",
    "#...#.#...#....##.",
    ".###...###.....#..",
  ],
  2,
  true,
);
export const GO_AT = [VIEW_W - GO_SIGN.w - 10, 28] as const;
export const GO_FLASH = 20;

/** A hero's marker: a small chevron in its seat's colour, `MARKER_GAP` pixels over the top of its idle frame. */
export const MARKER = signSprite(["#####", ".###.", "..#.."], 1, false);
export const MARKER_GAP = 3;
const SEAT_SWAPS: readonly Palette[] = SEAT_COLORS.map((D) => ({ D }));

/** A figure ready to draw: its id, floor depth, height and screen column, its sprite and how it is baked. */
interface Standing {
  readonly id: number;
  readonly y: number;
  readonly z: number;
  readonly sx: number;
  readonly sprite: Sprite;
  readonly options: BakeOptions;
  /** False while an invulnerable hero blinks out: its sprite is left off, its shadow and marker stay. */
  readonly lit: boolean;
  /** A hero's seat, and the rows its figure stands above its feet, for its marker. */
  readonly marker?: { readonly seat: number; readonly crown: number };
}

export function createScene<Image>(
  make: MakeSurface<Image>,
  stage: StageNumber = 1,
): Scene<Image> {
  const backdrop = createBackdrop(make, stage);
  const baker = createSpriteBaker(make);
  const shadows = new Map<number, { image: Image; w: number; h: number }>();
  const crowns = new Map<Figure, number>();
  const lookOf = createLooks();

  /** A soft dithered ellipse `rx` wide either side: solid in the middle, thinning to its edge. */
  const shadow = (rx: number) => {
    const known = shadows.get(rx);
    if (known) return known;
    const ry = Math.max(2, Math.round(rx * 0.32));
    const [w, h] = [2 * rx + 1, 2 * ry + 1];
    const { image, paint } = make(w, h);
    paint.fillStyle = SHADOW;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const d = ((x - rx) / rx) ** 2 + ((y - ry) / ry) ** 2;
        if (d <= 1 && (d < 0.55 || (1 - d) / 0.45 > bayer(x, y)))
          paint.fillRect(x, y, 1, 1);
      }
    const made = { image, w, h };
    shadows.set(rx, made);
    return made;
  };
  /** The rows from the top of a figure's idle frame down to its feet. */
  const crown = (figure: Figure) => {
    const rows = crowns.get(figure) ?? cropSprite(figure.sprite("idle0")).ay;
    crowns.set(figure, rows);
    return rows;
  };

  return {
    draw(pen, view, frame) {
      const camX = view.camX;
      backdrop.draw(pen, camX, frame);
      const at = (f: HeroView | EnemyView) => ({
        id: f.id,
        y: Math.floor(f.y),
        z: Math.floor(f.z),
        sx: Math.floor(f.x - camX),
      });
      const looks = lookOf(view.heroes);
      const standing: Standing[] = view.heroes.map((hero) => {
        const { figure, swap } = looks.get(hero.id)!;
        const pose = heroFrame(hero.kind, hero.anim, hero.animStep);
        return {
          ...at(hero),
          sprite: figure.sprite(pose),
          options: { swap, flip: hero.facing < 0 },
          lit: !hero.invulnerable || Math.floor(frame / BLINK_FRAMES) % 2 === 0,
          marker: { seat: hero.seat, crown: crown(figure) },
        };
      });
      for (const enemy of view.enemies) {
        if (enemy.anim === "dead" && !deadShows(enemy.animStep)) continue;
        const art = ENEMY_ART[enemy.kind];
        // An anim the art has no strip for stands idle, as a hero's does, rather than stopping the frame loop.
        const strip = art.anims[enemy.anim] ?? art.anims.idle;
        standing.push({
          ...at(enemy),
          sprite: art.figure.sprite(stripFrame(strip, enemy.animStep)),
          options: {
            swap: art.tiers[enemy.tier],
            flash: enemy.flash,
            flip: enemy.facing < 0,
          },
          lit: true,
        });
      }
      standing.sort((a, b) => a.y - b.y || a.z - b.z || a.id - b.id);
      for (const { y, z, sx } of standing) {
        const s = shadow(shadowRadius(z));
        blit(pen, s.image, s.w, s.h, sx - (s.w >> 1), y - (s.h >> 1));
      }
      for (const { y, z, sx, sprite, options, lit } of standing) {
        if (!lit) continue;
        const b = baker.bake(sprite, options);
        blit(pen, b.image, b.w, b.h, sx - b.ax, y - z - b.ay);
      }
      for (const { y, z, sx, marker } of standing) {
        if (!marker) continue;
        const { seat, crown } = marker;
        const swap = SEAT_SWAPS[seat % SEAT_SWAPS.length];
        const m = baker.bake(MARKER, { swap });
        const top = y - z - crown - MARKER_GAP - m.h;
        blit(pen, m.image, m.w, m.h, sx - (m.w >> 1), top);
      }
      for (const fx of view.fx) drawSpark(pen, fx, camX);
      backdrop.drawFront(pen, camX);
      if (view.go && Math.floor(frame / GO_FLASH) % 2 === 0) {
        const sign = baker.bake(GO_SIGN);
        blit(pen, sign.image, sign.w, sign.h, GO_AT[0], GO_AT[1]);
      }
    },
  };
}
