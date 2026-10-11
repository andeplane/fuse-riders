import type {
  EnemyKind,
  EnemyView,
  HeroView,
  ItemKind,
  ItemView,
  MountKind,
  MountView,
  Tier,
  WorldView,
} from "../engine/view.js";
import {
  CAMERA_END_PX,
  CLAWBEAK_STEPS,
  DRAKE_STEPS,
  DEAD_STEPS,
  VIEW_H,
  VIEW_W,
  cameraEndPx,
} from "../engine/view-kit.js";
import {
  enemyFrame,
  heroFrame,
  mountFrame,
  riderFrame,
} from "./art/animate.js";
import { CLAWBEAK_DIPS, CLAWBEAK_FIGURE } from "./art/clawbeak.js";
import { IMP } from "./art/imp.js";
import { MEAT } from "./art/meat.js";
import { HEROES } from "./art/index.js";
import { LANCER, LANCER_TIERS } from "./art/lancer.js";
import { OGRE, OGRE_CROWNS, OGRE_RAGE, OGRE_TIERS } from "./art/ogre.js";
import { POT, paintItem } from "./art/pot.js";
import { RAVAGER, RAVAGER_TIERS } from "./art/ravager.js";
import {
  createBackdrop,
  createCampBackdrop,
  hasBackdrop,
  type Backdrop,
  type StageNumber,
} from "./backdrop/backdrop.js";
import { bayer } from "./backdrop/kit.js";
import { blinksOn, createHud, type HudSeats } from "./hud.js";
import { drawFlames } from "./drake-fx.js";
import { drawCracks, drawShards, drawSteam } from "./ogre-fx.js";
import { blit, fill, type Pen } from "./pen.js";
import type { Figure } from "./pixel/kit.js";
import { UNLIT, rampSwap, type Palette } from "./pixel/palette.js";
import type { Point } from "./pixel/rig.js";
import { cropSprite, type Sprite } from "./pixel/sprite.js";
import { createSpriteBaker, type BakeOptions } from "./pixel/surface.js";
import { SEAT_COLORS } from "./seat-colors.js";
import { drawSpark } from "./sparks.js";
import { createSpells, shakeOf } from "./spells/index.js";
import { shifted } from "./spells/kit.js";
import type { MakeSurface } from "./surface.js";

/**
 * The game's picture: one native 320 × 180 frame of the engine's view, drawn in layers — the stage's backdrop (one
 * without art of its own draws Stage 1's, scrolled across the stage's longer or shorter road: `scenery`; camp its
 * night clearing, `backdrop/camp.ts`); every
 * figure's shadow on the floor; heroes, enemies, beasts and items on the floor by depth (further up the floor first,
 * then lower before higher, then by id), camp's fire among them by its row (the backdrop's `prop`), each flipped to
 * its facing, an enemy flashing in hit-stop and blinking out when
 * defeated, a beast's rider astride its saddle over it, a hero blinking while it is invulnerable and an item before it
 * vanishes; an ogre's shockwave cracking the
 * floor under the figures and bursting dust over them, and an enraged ogre's steam, drawn with it (`ogre-fx.ts`); the hit sparks; the
 * grass in front; the spells playing (`spells/`), a charging or casting hero glowing behind its sprite and the field
 * shaking a moment at a spell's blow; a flashing GO → when the road ahead opens; and over it all the HUD (`hud.ts`),
 * naming each seat's player from `seats` (the room's names, which the world does not hold). It only draws: positions
 * come from the view (the app blends two ticks for smooth motion), and `frame`, a 60 Hz count, moves only scenery, the
 * spells' flicker, the steam's drift and the HUD's health trails.
 *
 * Every sprite, shadow, sign and label is painted once into a surface from `make` and reused, so a frame is blits
 * and a few spark and bar pixels, and (for the 24 steps of an ogre's shockwave, or while one steams) a few hundred
 * flat rectangles of its crack, shards and dust.
 */
export interface Scene<Image> {
  draw(pen: Pen<Image>, view: WorldView, frame: number, seats?: HudSeats): void;
}

/**
 * What an enemy kind draws with: its figure, whose frames `enemyFrame` picks, and a palette per tier (none: the
 * figure's own).
 */
interface EnemyArt {
  readonly figure: Figure;
  readonly tiers: Readonly<Record<Tier, Palette | undefined>>;
  /** Enraged (an ogre whose twin has fallen): a palette per tier, and where its steam rises in each frame. */
  readonly rage?: {
    readonly tiers: Readonly<Record<Tier, Palette>>;
    readonly crowns: Readonly<Record<string, Point>>;
  };
  /** Its shadow's width as a multiple of a body's (none: a body's). */
  readonly shade?: number;
}
const CAPTAIN_LOOK = { ...rampSwap("Cc0", "Nn8"), ...rampSwap("Mm7", "Ii#") };
const BONE_LOOK = { ...rampSwap("Ss1", "Bb6"), ...rampSwap("Ll9", "Ww5") };
/** Every enemy kind's art. A kind from a build with more of them draws as a ravager, as `enemyFrame` plays it. */
export const ENEMY_ART: Readonly<Record<EnemyKind, EnemyArt>> = {
  ravager: {
    figure: RAVAGER,
    tiers: { 0: undefined, 1: RAVAGER_TIERS.rust, 2: RAVAGER_TIERS.violet },
  },
  imp: { figure: IMP, tiers: { 0: undefined, 1: undefined, 2: undefined } },
  ogre: {
    figure: OGRE,
    tiers: OGRE_TIERS,
    rage: { tiers: OGRE_RAGE, crowns: OGRE_CROWNS },
    shade: 1.5,
  },
  lancer: { figure: LANCER, tiers: LANCER_TIERS },
  // The lancer captain until he has art of his own: a lancer in gold and dark steel, whatever his palette.
  captain: {
    figure: LANCER,
    tiers: { 0: CAPTAIN_LOOK, 1: CAPTAIN_LOOK, 2: CAPTAIN_LOOK },
  },
  // A bonewalker until it has art of its own: a ravager in bone, in ash, rust or a knight's dark steel.
  bonewalker: {
    figure: RAVAGER,
    tiers: {
      0: { ...BONE_LOOK, ...rampSwap("Aa$", "Ww5") },
      1: { ...BONE_LOOK, ...RAVAGER_TIERS.rust },
      2: { ...BONE_LOOK, ...rampSwap("Aa$", "Ii#") },
    },
  },
};
/** A bonewalker's bone pile, and one shattered, until it has art of its own: a skull and a few bones on the floor. */
export const BONE_PILE = paintItem(
  [
    "....kkk.........",
    "...kBBbk..kk....",
    "..kBkbkbkkBbk...",
    ".kkbbbbkbBbbbkk.",
    "kBBbbBbbbbbb66bk",
    ".kkkkkkkkkkkkkk.",
  ],
  8,
);
const bonesOf = (enemy: EnemyView) =>
  enemy.kind === "bonewalker" &&
  (enemy.anim === "pile" || enemy.anim === "dead");
/** What each item kind draws (a kind from a build with more of them, a pot), and the half-width of its shadow. */
export const ITEM_ART: Readonly<Record<ItemKind, Sprite>> = {
  pot: POT,
  meat: MEAT,
};
export const ITEM_SHADE = 3;

/**
 * What a beast kind draws with: its figure, whose frames `mountFrame` picks, the rows each frame's saddle dips, and its
 * palette (none: the figure's own).
 */
interface MountArt {
  readonly figure: Figure;
  readonly dips: Readonly<Record<string, number>>;
  readonly swap?: Palette;
}
/**
 * Every beast kind's art (a kind from a build with more of them draws as a clawbeak, as `mountFrame` plays it); the
 * ember drake is a clawbeak in ember red until it has its own, its flame drawn over the figures (`drake-fx.ts`). It
 * blinks as its blow winds up (a tail, an inhale, a saddle thrust: every `TELEGRAPH` steps); the lash's ring is its own
 * frame's. Its shadow is a third wider than a body's, and its rider, sinking with the saddle as it dips, casts none.
 */
export const MOUNT_ART: Readonly<Record<MountKind, MountArt>> = {
  clawbeak: { figure: CLAWBEAK_FIGURE, dips: CLAWBEAK_DIPS },
  drake: {
    figure: CLAWBEAK_FIGURE,
    dips: CLAWBEAK_DIPS,
    swap: rampSwap("Yy&", "Xx*"),
  },
};
export const TELEGRAPH = 3;
/** The steps each beast blow's anim winds up for, which it blinks through. */
const WINDUPS: Readonly<Partial<Record<string, number>>> = {
  sweep: CLAWBEAK_STEPS.windup,
  breathe: DRAKE_STEPS.inhale,
  lance: DRAKE_STEPS.lanceWindup,
};
const winding = (mount: MountView) =>
  Object.hasOwn(WINDUPS, mount.anim) &&
  mount.animStep < WINDUPS[mount.anim]! &&
  Math.floor(mount.animStep / TELEGRAPH) % 2 === 0;
const mountArt = (kind: MountKind) =>
  Object.hasOwn(MOUNT_ART, kind) ? MOUNT_ART[kind] : MOUNT_ART.clawbeak;
/** The beast rider `id` (of `kind`) sits, if it is in the view. */
const mountUnder = (
  mounts: readonly MountView[],
  kind: "hero" | "enemy",
  id: number,
) => mounts.find((each) => each.rider?.kind === kind && each.rider.id === id);
/**
 * The rows the saddle of `mount` dips in its frame, or undefined for a rider whose beast is not in the view: it keeps
 * its own height and shadow, rather than hanging in the air shadowless.
 */
function saddleDip(mount: MountView | undefined): number | undefined {
  if (!mount) return undefined;
  const frame = mountFrame(mount.kind, mount.anim, mount.animStep);
  return mountArt(mount.kind).dips[frame] ?? 0;
}

/** How a hero looks: its figure and its palette. */
export interface HeroLook {
  readonly figure: Figure;
  readonly swap: Palette | undefined;
}

/**
 * Every hero's look, by id. Heroes of one kind each get a palette of their own, its figure's palettes taken from the
 * first (its own colours) in seat order. A pure function of the view, the same on every device.
 */
export function heroLooks(heroes: readonly HeroView[]): Map<number, HeroLook> {
  const looks = new Map<number, HeroLook>();
  const bySeat = [...heroes].sort((a, b) => a.seat - b.seat);
  for (const kind of new Set(bySeat.map((hero) => hero.kind))) {
    const { figure } = HEROES[kind];
    const palettes = [undefined, ...Object.values(figure.swaps)];
    bySeat
      .filter((hero) => hero.kind === kind)
      .forEach((hero, i) =>
        looks.set(hero.id, { figure, swap: palettes[i % palettes.length] }),
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

/**
 * A hero's marker: a small chevron in its seat's colour, `MARKER_GAP` pixels over the top of its idle frame (a rider's,
 * of its seated one).
 */
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
  /**
   * The shadow's half-width, for a figure smaller or bigger than a body (0: none, a rider over its beast's); otherwise
   * it shrinks with height.
   */
  readonly shade?: number;
  /** An enraged ogre's steam, drawn with it so a figure in front of it hides the puffs: where it rises from its feet. */
  readonly steam?: { readonly enemy: EnemyView; readonly crown: Point };
}

/**
 * The backdrop a stage draws on, and where its camera stands: the stage's own art at the camera, or for a stage with
 * none Stage 1's, its camera scaled from the stage's road onto the village's so the scenery runs out at the same end.
 * On a longer road than the village's the layers scroll the slower for it, the floor-speed ones too: a placeholder
 * until the stage has its own art, which takes the camera as it is (Ashen Village's, Wyrmbone Pass's and the Drowned
 * Crypt's do).
 */
export function scenery(
  stage: number,
  camX: number,
): { art: StageNumber; camX: number } {
  if (hasBackdrop(stage)) return { art: stage, camX };
  return { art: 1, camX: (camX * CAMERA_END_PX) / cameraEndPx(stage) };
}

export function createScene<Image>(make: MakeSurface<Image>): Scene<Image> {
  // Every stage's backdrop is baked now, not as its stage is first drawn: a long road's takes long enough to stall the
  // frame the stage begins on. `satisfies` has a new stage's art added here.
  const backdrops = {
    1: createBackdrop(make, 1),
    2: createBackdrop(make, 2),
    3: createBackdrop(make, 3),
  } satisfies Record<StageNumber, Backdrop<Image>>;
  const backdropOf = (art: StageNumber) => backdrops[art];
  const camp = createCampBackdrop(make);
  const baker = createSpriteBaker(make);
  const shadows = new Map<number, { image: Image; w: number; h: number }>();
  const crowns = new Map<Figure, Map<string, number>>();
  const lookOf = createLooks();
  const hud = createHud(make, baker);
  const spells = createSpells(make);

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
  /** The rows from the top of a figure's `frame` (its idle one) down to its feet. */
  const crown = (figure: Figure, frame = "idle0") => {
    const known = crowns.get(figure) ?? new Map<string, number>();
    const rows = known.get(frame) ?? cropSprite(figure.sprite(frame)).ay;
    crowns.set(figure, known.set(frame, rows));
    return rows;
  };

  return {
    draw(pen, view, frame, seats) {
      const camX = view.camX;
      // A spell's blow shakes the field, never the HUD: the strip it leaves bare at an edge is ink.
      const [dx, dy] = shakeOf(view);
      const field = dx || dy ? shifted(pen, dx, dy) : pen;
      if (field !== pen) {
        pen.fillStyle = UNLIT.k!;
        fill(pen, 0, 0, VIEW_W, VIEW_H);
      }
      // Camp has its own night clearing, one screen that never scrolls, whatever stage it follows; a stage has its own
      // backdrop at its camera.
      let backdrop = camp,
        backX = 0;
      if (!view.camp) {
        const back = scenery(view.stage, camX);
        backdrop = backdropOf(back.art);
        backX = back.camX;
      }
      backdrop.draw(field, backX, frame);
      const at = (f: HeroView | EnemyView | ItemView | MountView) => ({
        id: f.id,
        y: Math.floor(f.y),
        z: Math.floor(f.z),
        sx: Math.floor(f.x - camX),
      });
      const looks = lookOf(view.heroes);
      const standing: Standing[] = view.heroes.map((hero) => {
        const { figure, swap } = looks.get(hero.id)!;
        // A rider sits astride, doing what its beast's anim says the pair does (`riderFrame`).
        const mount = hero.mounted
          ? mountUnder(view.mounts, "hero", hero.id)
          : undefined;
        const pose = mount
          ? riderFrame(mount.anim, mount.animStep)
          : heroFrame(hero.kind, hero.anim, hero.animStep);
        const dip = saddleDip(mount);
        const place = at(hero);
        return {
          ...place,
          sprite: figure.sprite(pose),
          options: { swap, flip: hero.facing < 0 },
          lit: !hero.invulnerable || blinksOn(frame),
          // Its marker over a rider's seated head, which sits higher or lower than a standing hero's.
          marker: {
            seat: hero.seat,
            crown: crown(figure, mount ? "ride" : "idle0"),
          },
          // A rider sits on its beast's saddle, sinking as it dips, in its shadow, as an enemy does.
          ...(dip !== undefined && { z: place.z - dip, shade: 0 }),
        };
      });
      for (const enemy of view.enemies) {
        if (enemy.anim === "dead" && !deadShows(enemy.animStep)) continue;
        // A kind from a build with more of them draws as a ravager, and an anim with no strip stands idle, as a
        // hero's does (`enemyFrame`), rather than stopping the frame loop.
        const art = Object.hasOwn(ENEMY_ART, enemy.kind)
          ? ENEMY_ART[enemy.kind]
          : ENEMY_ART.ravager;
        const pose = enemyFrame(enemy.kind, enemy.anim, enemy.animStep);
        const dip = saddleDip(
          enemy.mounted
            ? mountUnder(view.mounts, "enemy", enemy.id)
            : undefined,
        );
        // An enraged ogre burns in its rage palette and steams, unless it has fallen.
        const rage = enemy.enraged ? art.rage : undefined;
        const crown = rage?.crowns[pose];
        const bones = bonesOf(enemy);
        standing.push({
          ...at(enemy),
          ...(crown && enemy.anim !== "dead" && { steam: { enemy, crown } }),
          sprite: bones ? BONE_PILE : art.figure.sprite(pose),
          options: {
            swap: (rage ?? art).tiers[enemy.tier],
            flash: enemy.flash,
            flip: enemy.facing < 0,
          },
          lit: true,
          ...(art.shade && {
            shade: Math.round(shadowRadius(enemy.z) * art.shade),
          }),
          ...(bones && { shade: ITEM_SHADE * 2 }),
          // A rider sits on its beast's saddle, sinking as it dips, in its shadow.
          ...(dip !== undefined && { z: Math.floor(enemy.z) - dip, shade: 0 }),
        });
      }
      // Items lie among the figures, a pot in its last moments blinking as an invulnerable hero does.
      for (const item of view.items)
        standing.push({
          ...at(item),
          sprite: Object.hasOwn(ITEM_ART, item.kind)
            ? ITEM_ART[item.kind]
            : POT,
          options: {},
          lit: !item.blink || blinksOn(frame),
          shade: ITEM_SHADE,
        });
      // A beast stands among them, its rider on it: the rider shares its depth, higher up, so it is drawn after.
      for (const mount of view.mounts) {
        const frame = mountFrame(mount.kind, mount.anim, mount.animStep),
          art = mountArt(mount.kind);
        standing.push({
          ...at(mount),
          sprite: art.figure.sprite(frame),
          options: {
            swap: art.swap,
            flash: winding(mount),
            flip: mount.facing < 0,
          },
          lit: true,
          shade: Math.round((shadowRadius(mount.z) * 4) / 3),
        });
      }
      standing.sort((a, b) => a.y - b.y || a.z - b.z || a.id - b.id);
      for (const { y, z, sx, shade } of standing) {
        if (shade === 0) continue;
        const s = shadow(shade ?? shadowRadius(z));
        blit(field, s.image, s.w, s.h, sx - (s.w >> 1), y - (s.h >> 1));
      }
      spells.ground(field, view, frame);
      drawCracks(field, view.enemies, camX);
      for (const hero of view.heroes) {
        const { y, z, sx } = at(hero);
        const top = crown(looks.get(hero.id)!.figure);
        spells.aura(field, hero, sx, y - z, top, frame);
      }
      // Camp's fire stands among the figures: after those further up the floor, before those in front of it.
      let prop = backdrop.prop;
      for (const { y, z, sx, sprite, options, lit, steam } of standing) {
        if (prop && y > prop.y) {
          prop.draw(field, frame);
          prop = undefined;
        }
        if (!lit) continue;
        const b = baker.bake(sprite, options);
        blit(field, b.image, b.w, b.h, sx - b.ax, y - z - b.ay);
        if (steam) drawSteam(field, steam.enemy, steam.crown, camX, frame);
      }
      prop?.draw(field, frame);
      for (const { y, z, sx, marker } of standing) {
        if (!marker) continue;
        const { seat, crown } = marker;
        const swap = SEAT_SWAPS[seat % SEAT_SWAPS.length];
        const m = baker.bake(MARKER, { swap });
        const top = y - z - crown - MARKER_GAP - m.h;
        blit(field, m.image, m.w, m.h, sx - (m.w >> 1), top);
      }
      drawShards(field, view.enemies, camX);
      drawFlames(field, view.mounts, camX, frame);
      for (const fx of view.fx) drawSpark(field, fx, camX);
      backdrop.drawFront(field, backX);
      spells.draw(field, view, frame);
      if (view.go && Math.floor(frame / GO_FLASH) % 2 === 0) {
        const sign = baker.bake(GO_SIGN);
        blit(pen, sign.image, sign.w, sign.h, GO_AT[0], GO_AT[1]);
      }
      hud.draw(pen, view, frame, looks, seats);
    },
  };
}
