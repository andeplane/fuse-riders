import type {
  HeroKind,
  HeroView,
  SpellKind,
  SpellView,
  WorldView,
} from "../../engine/view.js";
import { bayer } from "../backdrop/kit.js";
import { fill } from "../pen.js";
import { createEarth } from "./earth.js";
import { createFire } from "./fire.js";
import * as S from "./kit.js";
import { hash, put, type Art, type MakeSurface, type Pen } from "./kit.js";
import { createStorm } from "./storm.js";

/**
 * The spells (design.md, "Heroes"; a module a kind), drawn from the view's `spells` over the field and under the HUD,
 * with what lies on the ground drawn under the figures (`ground`): each sinks the screen into its own dithered dusk
 * while the enemies stand frozen, plays its kind by its age against `SPELL_STEPS`, more of it at every level, and
 * flashes the screen at the blow, when the field shakes a moment (`shakeOf`, an offset the scene draws the field at;
 * the simulation never moves). A hero charging or casting glows in its spell's colour behind its sprite (`aura`).
 *
 * All of it is a pure function of the view and the 60 Hz frame, so rollback and blending never flicker, but for where
 * a blow lands: the enemies it strikes are read off the frozen screen before it and kept where they stood once it
 * flings them (`marked`). The view moves a spell on a whole tick, `STEPS_PER_TICK` steps, at a time, so no moment is
 * tested for at one exact age: each lasts a window of steps. Every picture is painted once, on the first frame that
 * needs it; a kind this build lacks, or an odd age, draws nothing.
 */
export interface Spells<I> {
  ground(pen: Pen<I>, view: WorldView, frame: number): void;
  draw(pen: Pen<I>, view: WorldView, frame: number): void;
  /** The glow behind a charging or casting hero at column `sx`, its feet on row `feet`, `crown` rows tall. */
  aura(
    pen: Pen<I>,
    hero: HeroView,
    sx: number,
    feet: number,
    crown: number,
    frame: number,
  ): void;
}
/** Each spell's dusk (colour, opacity, darkest density, and how much of that over the floor) and its blow's flash. */
export const DUSK: Readonly<Record<SpellKind, readonly number[]>> = {
  storm: [0x07030f, 0.85, 0.9, 0.5],
  fire: [0x2a0408, 0.55, 0.5, 0.8],
  earth: [0x1c0c06, 0.55, 0.5, 0.8],
};
export const FLASH: Readonly<Record<SpellKind, number>> = {
  storm: 0xe8fbff,
  fire: 0xfff6b8,
  earth: 0xfff0c8,
};
/** The dusk deepens in `DUSK_STEPS` veils, the last only at a spell's top level. */
export const DUSK_STEPS = 3;
/** Each hero's glow: Brakka's storm cyan, Rhea's fire orange, Gorm's earth green; three sizes of it. */
export const AURA: Readonly<Record<HeroKind, number>> = {
  brakka: S.CYAN,
  rhea: 0xff8a2e,
  gorm: S.LIME,
};
const AURA_RX = [12, 15, 18] as const;
const whole = (n: number) =>
  Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;

/** The field's offset: a jolt at every blow, fading over `SHAKE_STEPS`, and the ground's rumble before Gorm's. */
export function shakeOf(view: WorldView): readonly [number, number] {
  let [dx, dy] = [0, 0];
  for (const spell of view.spells) {
    const { t, age } = S.playing(spell) ?? {};
    if (!t || age === undefined) continue;
    const [since, sign] = [age - t.hit, hash(age, spell.hero) < 0.5 ? -1 : 1];
    const jolt = Math.ceil((1 - since / S.SHAKE_STEPS) * (1 + t.level / 2));
    const earth = spell.kind === "earth";
    if (since >= 0 && since < S.SHAKE_STEPS) {
      dx += sign * jolt;
      if (earth) dy += (since & 2 ? 1 : -1) * Math.ceil(jolt / 2);
    } else if (earth && age >= 12 && since < 0) dx += sign;
  }
  return [Math.max(-4, Math.min(4, dx)), Math.max(-4, Math.min(4, dy))];
}

export function createSpells<I>(make: MakeSurface<I>): Spells<I> {
  const makers = { storm: createStorm, fire: createFire, earth: createEarth };
  const kinds = new Map<SpellKind, S.KindArt<I>>();
  const pictures = new Map<string, Art<I>>();
  const auras = new Map<HeroKind, readonly Art<I>[]>();
  const kindArt = (kind: SpellKind) => {
    if (!kinds.has(kind)) kinds.set(kind, makers[kind](make));
    return kinds.get(kind)!;
  };
  const cached = (key: string, paint: () => Art<I>) => {
    if (!pictures.has(key)) pictures.set(key, paint());
    return pictures.get(key)!;
  };
  const dusk = (kind: SpellKind, step: number) =>
    cached(`${kind} dusk ${step}`, () => {
      const [rgb, alpha, most, floor] = DUSK[kind] as [
        number,
        number,
        number,
        number,
      ];
      const density = (most * step) / DUSK_STEPS;
      return S.veil(make, rgb, alpha, (y) => density * (y < 104 ? 1 : floor));
    });
  const flash = (kind: SpellKind, dense: boolean) =>
    cached(`${kind} flash ${dense}`, () =>
      S.veil(make, FLASH[kind], 0.75, (y) =>
        y < S.SKY ? 0 : dense ? 0.25 : 0.125,
      ),
    );
  /** Three glows, small to large: a dithered halo thinning outward, white at its heart. */
  const auraArt = (kind: HeroKind) =>
    AURA_RX.map((rx) => {
      const ry = Math.round(rx * 1.6);
      return S.bakeArt(make, 2 * rx + 1, 2 * ry + 1, (dot) => {
        for (let y = 0; y <= 2 * ry; y++)
          for (let x = 0; x <= 2 * rx; x++) {
            const d = ((x - rx) / rx) ** 2 + ((y - ry) / ry) ** 2;
            if (d < 1 && bayer(x, y) < (1 - d) * 0.8)
              dot(x, y, d < 0.3 ? S.WHITE : AURA[kind], 0.75);
          }
      });
    });
  /**
   * Where each playing spell's blow lands, by its caster and the step it was born: refreshed while the enemies stand
   * frozen before the blow, then kept, so a boulder or a bolt stays where it fell whatever the blow does to the enemy
   * under it. A spell first seen after its blow (a device that joined or recovered meanwhile) keeps what it finds.
   */
  const marked = new Map<string, readonly S.Mark[]>();
  const marksFor = (
    spell: SpellView,
    t: S.Timing,
    age: number,
    view: WorldView,
  ) => {
    const key = `${spell.hero} ${view.step - age}`;
    if (age < t.hit || !marked.has(key)) marked.set(key, S.marksOf(view));
    return { key, marks: marked.get(key)! };
  };
  const playing = (view: WorldView) =>
    view.spells.flatMap((spell) => {
      const now = S.playing(spell);
      return now ? [{ spell, ...now }] : [];
    });

  return {
    ground(pen, view, frame) {
      for (const { spell, t, age } of playing(view)) {
        const { marks } = marksFor(spell, t, age, view);
        const art = kindArt(spell.kind);
        art.ground?.(pen, spell, t, age, view, whole(frame), marks);
      }
    },
    draw(pen, view, frame) {
      const live = new Set<string>();
      for (const { spell, t, age } of playing(view)) {
        const { key, marks } = marksFor(spell, t, age, view);
        live.add(key);
        const deepest = DUSK_STEPS - (t.level < t.max ? 1 : 0);
        const step = Math.ceil(S.envelope(age, t.steps) * deepest);
        if (step > 0) put(pen, dusk(spell.kind, step), 0, 0);
        // The blow's flash lights the screen under the spell's own art, so its bolts, flames and boulders stand out.
        const since = age - t.hit;
        if (since >= 0 && since < S.FLASH_STEPS)
          put(pen, flash(spell.kind, since < S.FLASH_STEPS / 2), 0, 0);
        const art = kindArt(spell.kind);
        art.over(pen, spell, t, age, view, whole(frame), marks);
      }
      for (const key of marked.keys()) if (!live.has(key)) marked.delete(key);
    },
    aura(pen, hero, sx, feet, crown, frame) {
      if (hero.anim !== "charge" && hero.anim !== "cast") return;
      if (!Object.hasOwn(AURA, hero.kind)) return;
      const f = whole(frame);
      const charge = Math.min(6, whole(hero.charge));
      if (!auras.has(hero.kind)) auras.set(hero.kind, auraArt(hero.kind));
      const size =
        hero.anim === "cast" ? 2 : Math.min(2, Math.max(0, charge - 1));
      const art = auras.get(hero.kind)![Math.max(0, size - ((f >> 3) & 1))]!;
      put(
        pen,
        art,
        Math.floor(sx) - (art.w >> 1),
        Math.floor(feet - crown / 2) - (art.h >> 1),
      );
      // Motes of the spell rise about the hero, more as the charge builds.
      pen.fillStyle = S.css(AURA[hero.kind]);
      for (let m = 0; m < (hero.anim === "cast" ? 8 : 2 + 2 * charge); m++) {
        const life = ((f + m * 13) % 30) / 30;
        const x = Math.floor(sx + (hash(m, hero.id) - 0.5) * 26);
        fill(
          pen,
          x,
          Math.floor(feet - life * (crown + 10)),
          1,
          life < 0.7 ? 2 : 1,
        );
      }
    },
  };
}
