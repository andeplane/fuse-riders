import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import * as guards from "../../../tests/fixtures/source-guards.js";
import { createWorld, MAGIC, spawnEnemy, step, toView, type Enemy } from "../src/engine/index.js"; // prettier-ignore
import { px, THROW_LIFT } from "../src/engine/tuning.js";
import type * as V from "../src/engine/view.js";
import { SPELL_KINDS, SPELL_STEPS, STEPS_PER_TICK, VIEW_H, VIEW_W } from "../src/engine/view-kit.js"; // prettier-ignore
import { HEROES } from "../src/render/art/index.js";
import { HUD_COLORS, HUD_H } from "../src/render/hud.js";
import type { Pen } from "../src/render/pen.js";
import { createScene } from "../src/render/scene.js";
import * as spells from "../src/render/spells/index.js";
import { FLASH_STEPS, SHAKE_STEPS, marksOf } from "../src/render/spells/kit.js"; // prettier-ignore
import type { MakeSurface } from "../src/render/surface.js";

interface FakeImage {
  readonly w: number;
  readonly h: number;
  rgba?: Uint8ClampedArray;
}
interface Call {
  readonly style?: string;
  readonly image?: FakeImage;
  readonly src?: readonly number[];
  readonly at: readonly number[];
}
/** Enough of a 2D context for the spells and the scene, recording every call's source and destination. */
class RecordingPen implements Pen<FakeImage> {
  fillStyle: string | CanvasGradient | CanvasPattern = "";
  readonly calls: Call[] = [];
  fillRect(...at: number[]) {
    this.calls.push({ style: String(this.fillStyle), at });
  }
  drawImage(image: FakeImage, ...r: number[]) {
    this.calls.push({ image, src: r.slice(0, 4), at: r.slice(4) });
  }
}
/** Surfaces that keep the pixels put into them, and every one made. */
function fakeMake() {
  const images: FakeImage[] = [];
  const make: MakeSurface<FakeImage> = (w, h) => {
    const image: FakeImage = { w, h };
    images.push(image);
    const paint = { fillStyle: "", fillRect: () => {} };
    return { image, paint, putPixels: (rgba) => void (image.rgba = rgba) };
  };
  return { images, make };
}
/** The colours a picture's opaque pixels wear, as `0xrrggbb`. */
const colours = (
  { rgba = new Uint8ClampedArray() }: FakeImage = { w: 0, h: 0 },
) => {
  const found = new Set<number>();
  for (let i = 0; i < rgba.length; i += 4)
    if (rgba[i + 3]) found.add((rgba[i]! << 16) | (rgba[i + 1]! << 8) | rgba[i + 2]!); // prettier-ignore
  return found;
};

const { shakeOf } = spells;
const CASTER = { storm: "brakka", fire: "rhea", earth: "gorm" } as const;
const hero = (more: Partial<V.HeroView> = {}): V.HeroView => ({
  ...{ id: 1, seat: 0, kind: "brakka", x: 110, y: 140, z: 0, facing: 1 },
  ...{ anim: "cast", animStep: 0, hp: 60, maxHp: 60, lives: 3 },
  ...{ invulnerable: false, pots: 0, maxPots: 4, charge: 0 },
  ...more,
});
const enemy = (id: number, x: number, y: number): V.EnemyView => ({
  ...{ id, kind: "ravager", tier: 0, x, y, z: 0, facing: -1 },
  ...{ anim: "idle", animStep: 0, hp: 4, maxHp: 4, flash: false },
  ...{ boss: false, enraged: false },
});
const ENEMIES = [[200, 120], [250, 150], [60, 160], [300, 130]].map(([x, y], i) => enemy(10 + i, x!, y!)); // prettier-ignore
const spell = (kind: V.SpellKind, level: number, age: number, id = 1) =>
  ({ hero: id, kind, level, age }) satisfies V.SpellView;
const world = (list: V.SpellView[], more: Partial<V.WorldView> = {}) =>
  ({
    ...{ step: 0, camX: 0, enemies: ENEMIES, fx: [], items: [], spells: list },
    heroes: [hero({ kind: CASTER[list[0]?.kind ?? "storm"] ?? "brakka" })],
    ...{ stage: 1, wave: 1, waves: 5, locked: true, go: false },
    ...{ cleared: false, defeated: false, boss: null, ...more },
  }) satisfies V.WorldView;
const levels = (kind: V.SpellKind) => SPELL_STEPS[kind].map((_, i) => i + 1);
const timing = (kind: V.SpellKind, level: number) => SPELL_STEPS[kind][level - 1]!; // prettier-ignore
/** Every age of every level of every spell. */
const everyStep = function* () {
  for (const kind of SPELL_KINDS)
    for (const level of levels(kind))
      for (let age = 0; age < timing(kind, level).steps; age++)
        yield [kind, level, age] as const;
};

const drawn = (s: spells.Spells<FakeImage>, view: V.WorldView, frame = 0) => {
  const pen = new RecordingPen();
  s.ground(pen, view, frame);
  s.draw(pen, view, frame);
  return pen.calls;
};
const screenSized = ({ image }: Call) => image?.w === VIEW_W && image.h === VIEW_H; // prettier-ignore
/** Every call lands inside the screen, on whole pixels; a blit unscaled and from inside its image. */
function assertOnScreen(calls: readonly Call[], what: string) {
  for (const { at, src, image } of calls) {
    const [x, y, w, h] = at as [number, number, number, number];
    const [sx, sy, sw, sh] = (src ?? [0, 0, w, h]) as [number, number, number, number]; // prettier-ignore
    const ok =
      [x, y, w, h].every(Number.isInteger) && w > 0 && h > 0 && x >= 0 && y >= 0 &&
      x + w <= VIEW_W && y + h <= VIEW_H && sw === w && sh === h && sx >= 0 && sy >= 0 &&
      (!image || (sx + w <= image.w && sy + h <= image.h)); // prettier-ignore
    if (!ok) assert.fail(`${what}: ${JSON.stringify([at, src, image?.w, image?.h])}`); // prettier-ignore
  }
}

test("a spell draws only while it plays; an odd age, level, frame or kind never throws, and a kind this build lacks draws nothing", () => {
  const s = spells.createSpells(fakeMake().make);
  assert.equal(drawn(s, world([])).length, 0);
  for (const kind of SPELL_KINDS)
    for (const level of levels(kind)) {
      const { steps } = timing(kind, level);
      for (const [age, draws] of [[0, true], [steps - 1, true], [-1, false], [steps, false]] as const) // prettier-ignore
        assert.equal(drawn(s, world([spell(kind, level, age)])).length > 0, draws, `${kind} ${level} ${age}`); // prettier-ignore
    }
  const kinds = [...SPELL_KINDS, "frost", "__proto__", "constructor"];
  for (const kind of kinds as V.SpellKind[])
    for (const level of [0, -2, 1.5, 99, NaN, Infinity])
      for (const age of [NaN, -1, 2.5, 1e12, -Infinity, 40])
        for (const frame of [NaN, -7, 1e9 + 0.5]) {
          // Hero 99 is nobody: a spell outliving its caster draws about the screen's middle.
          const view = world([spell(kind, level, age, 99)]);
          const calls = drawn(s, view, frame);
          assert.ok(shakeOf(view).every(Number.isInteger));
          const plays = SPELL_KINDS.includes(kind) && (age === 40 || age === 2.5); // prettier-ignore
          assert.equal(calls.length > 0, plays, `${kind} ${level} ${age}`);
          assertOnScreen(calls, `${kind} ${level} ${age} ${frame}`);
        }
});

test("every level draws more of its spell than the one below: more bolts, a taller and longer wall, more and bigger boulders", () => {
  const s = spells.createSpells(fakeMake().make);
  const ink = new Map<string, number>();
  for (const [kind, level, age] of everyStep()) {
    const key = `${kind} ${level}`;
    for (const call of drawn(s, world([spell(kind, level, age)]), age))
      if (!screenSized(call))
        ink.set(key, (ink.get(key) ?? 0) + call.at[2]! * call.at[3]!);
  }
  for (const kind of SPELL_KINDS)
    for (const level of levels(kind).slice(1))
      assert.ok(ink.get(`${kind} ${level}`)! > ink.get(`${kind} ${level - 1}`)!, `${kind} ${level}`); // prettier-ignore
});

test("the blow flashes the screen in the spell's colour from its hit step for FLASH_STEPS, under the spell's own art", () => {
  const s = spells.createSpells(fakeMake().make);
  for (const kind of SPELL_KINDS)
    for (const level of levels(kind)) {
      const { hit } = timing(kind, level);
      const flashes = (age: number) => {
        const calls = drawn(s, world([spell(kind, level, age)]), age);
        const at = calls.findIndex((c) => screenSized(c) && colours(c.image).has(spells.FLASH[kind])); // prettier-ignore
        if (at >= 0)
          assert.ok(calls.slice(at + 1).some((c) => !screenSized(c)));
        return at >= 0;
      };
      const ages = [hit - 1, hit, hit + FLASH_STEPS - 1, hit + FLASH_STEPS];
      assert.deepEqual(ages.map(flashes), [false, true, true, false], `${kind} ${level}`); // prettier-ignore
    }
});

test("nothing a spell draws lands off the 320 × 180 screen, wherever the camera, the caster and the enemies are", () => {
  const s = spells.createSpells(fakeMake().make);
  for (const camX of [0, 437])
    for (const [x, facing] of [
      [2, 1],
      [318, -1],
      [160, -1],
    ] as const) {
      const enemies = [[-30, 110], [340, 170], [1, 104], [319, 171]].map(([dx, y], i) => enemy(20 + i, camX + dx!, y!)); // prettier-ignore
      const heroes = [hero({ x: camX + x, facing })];
      for (const [kind, level, age] of everyStep())
        if (x === 160 || age % 3 === 0)
          assertOnScreen(drawn(s, world([spell(kind, level, age)], { camX, heroes, enemies }), age), `${kind} ${level} ${age}`); // prettier-ignore
    }
  // The whole scene too, shaking at each blow.
  const scene = createScene(fakeMake().make);
  for (const kind of SPELL_KINDS)
    for (const age of [0, 1, 2].map((d) => timing(kind, 1).hit + d)) {
      const pen = new RecordingPen();
      scene.draw(pen, world([spell(kind, 1, age)]), age);
      assertOnScreen(pen.calls, `scene ${kind} ${age}`);
    }
});

test("every picture a spell draws is painted once, on the first frame that needs it, never per frame", () => {
  const { images, make } = fakeMake();
  const s = spells.createSpells(make);
  const pass = () => {
    for (const [kind, level, age] of everyStep())
      drawn(s, world([spell(kind, level, age)]), age * 7);
    for (const kind of Object.keys(HEROES) as V.HeroKind[])
      for (const [anim, charge] of [["charge", 1], ["charge", 2], ["charge", 6], ["cast", 0]] as const) // prettier-ignore
        for (let frame = 0; frame < 16; frame++)
          s.aura(new RecordingPen(), hero({ kind, anim, charge }), 100, 140, 60, frame); // prettier-ignore
  };
  assert.equal(images.length, 0, "nothing is painted before a spell is cast");
  pass();
  const made = images.length;
  pass();
  assert.equal(images.length, made);
  assert.ok(made < 100, `${made} pictures`);
});

test("the same view and frame draw the same calls whatever came between, on any device: rollback never flickers", () => {
  const [a, b] = [spells.createSpells(fakeMake().make), spells.createSpells(fakeMake().make)]; // prettier-ignore
  const calls = (s: spells.Spells<FakeImage>, view: V.WorldView, frame: number) =>
    drawn(s, view, frame).map((c) => ({ ...c, image: c.image && [c.image.w, c.image.h] })); // prettier-ignore
  for (const kind of SPELL_KINDS) {
    const top = levels(kind).length;
    const view = world([spell(kind, top, timing(kind, top).hit + 1)]);
    const first = calls(a, view, 77);
    for (let age = 0; age < 60; age += 7) calls(a, world([spell(kind, top, age)]), age); // prettier-ignore
    assert.deepEqual(calls(a, view, 77), first, kind);
    assert.deepEqual(calls(b, view, 77), first, kind);
  }
  // Their only chance is the cosmetic hash: no Math.random, clock or timer.
  const folder = fileURLToPath(
    new URL("../src/render/spells", import.meta.url),
  );
  for (const file of guards.sourceFiles(folder)) {
    const found = guards.deterministicViolations(guards.syntax(file));
    assert.deepEqual(found.filter((v) => /random|Date|performance/.test(v)), [], file); // prettier-ignore
  }
});

test("a blow shakes the field a moment and Gorm's rumbles before it; the HUD never moves", () => {
  assert.deepEqual(shakeOf(world([])), [0, 0]);
  for (const kind of SPELL_KINDS) {
    const { hit } = timing(kind, 1);
    assert.notEqual(shakeOf(world([spell(kind, 1, hit)]))[0], 0, kind);
    for (const age of [5, hit + SHAKE_STEPS])
      assert.deepEqual(shakeOf(world([spell(kind, 1, age)])), [0, 0], kind);
  }
  assert.equal(Math.abs(shakeOf(world([spell("earth", 1, 20)]))[0]), 1);
  const both = world([spell("earth", 3, 84), spell("earth", 3, 84, 2)]);
  assert.ok(
    shakeOf(both).every((d) => Math.abs(d) <= 4),
    "never past 4 px",
  );
  // The scene draws the field shifted, its heroes with it, the HUD's strip where it always is, and ink at the edge.
  const scene = createScene(fakeMake().make);
  const sprite = HEROES.brakka.figure.sprite("cast");
  const frameOf = (view: V.WorldView) => {
    const pen = new RecordingPen();
    scene.draw(pen, view, 0);
    const body = pen.calls.find((c) => c.image?.w === sprite.w && c.image.h === sprite.h)!; // prettier-ignore
    return { body, first: pen.calls[0]!, strip: pen.calls.filter((c) => c.style === HUD_COLORS.strip) }; // prettier-ignore
  };
  const shaken = world([spell("storm", 1, timing("storm", 1).hit)]);
  const [still, moved] = [frameOf(world([])), frameOf(shaken)];
  assert.equal(moved.body.at[0]! - still.body.at[0]!, shakeOf(shaken)[0]);
  assert.deepEqual(
    moved.strip.map((c) => c.at),
    [[0, 0, VIEW_W, HUD_H - 2]],
  );
  assert.deepEqual(moved.first.at, [0, 0, VIEW_W, VIEW_H]);
});

test("a charging or casting hero glows in its spell's colour behind its sprite, bigger as the charge builds", () => {
  const { images, make } = fakeMake();
  const s = spells.createSpells(make);
  const glow = (more: Partial<V.HeroView>) => {
    const pen = new RecordingPen();
    s.aura(pen, hero(more), 100, 140, 60, 0);
    return { calls: pen.calls, image: pen.calls.find((c) => c.image)?.image };
  };
  assert.deepEqual([glow({ anim: "idle" }).calls, glow({ anim: "walk", charge: 3 }).calls], [[], []]); // prettier-ignore
  const [one, three] = [glow({ anim: "charge", charge: 1 }), glow({ anim: "charge", charge: 3 })]; // prettier-ignore
  assert.ok(three.image!.w > one.image!.w);
  assert.ok(three.calls.length > one.calls.length, "more motes");
  assert.equal(glow({ anim: "cast" }).image, three.image);
  assert.doesNotThrow(() => glow({ anim: "charge", charge: NaN }));
  for (const kind of Object.keys(spells.AURA) as V.HeroKind[])
    assert.ok(colours(glow({ anim: "cast", kind }).image).has(spells.AURA[kind]), kind); // prettier-ignore
  assert.ok(images.length <= 9);
  // In the scene the glow is drawn before the hero, so it shines from behind.
  const pen = new RecordingPen();
  createScene(fakeMake().make).draw(pen, world([], { heroes: [hero({ anim: "charge", charge: 2 })] }), 0); // prettier-ignore
  const sprite = HEROES.brakka.figure.sprite("charge");
  const body = pen.calls.findIndex((c) => c.image?.w === sprite.w && c.image.h === sprite.h); // prettier-ignore
  const aura = pen.calls.findIndex((c) => colours(c.image).has(spells.AURA.brakka)); // prettier-ignore
  assert.ok(aura >= 0 && aura < body, `aura ${aura}, body ${body}`);
});

test("the view moves a spell a whole tick on at a time, so the flash and the shake show whatever step it was cast on", () => {
  const s = spells.createSpells(fakeMake().make);
  for (const kind of SPELL_KINDS)
    for (const level of levels(kind)) {
      const { hit, steps } = timing(kind, level);
      // The ages the view reaches are STEPS_PER_TICK apart, from any one of the steps of the tick it was cast in.
      for (let phase = 0; phase < STEPS_PER_TICK; phase++) {
        const seen = { flash: 0, shake: 0 };
        for (let age = phase; age < steps; age += STEPS_PER_TICK) {
          const view = world([spell(kind, level, age)]);
          const flash = drawn(s, view, age).some(
            (c) => screenSized(c) && colours(c.image).has(spells.FLASH[kind]),
          );
          if (flash) seen.flash++;
          if (age >= hit && shakeOf(view)[0] !== 0) seen.shake++;
        }
        const label = `${kind} ${level} from step ${phase}`;
        assert.ok(seen.flash >= Math.floor(FLASH_STEPS / STEPS_PER_TICK), label); // prettier-ignore
        assert.ok(seen.shake >= Math.floor(SHAKE_STEPS / STEPS_PER_TICK), label); // prettier-ignore
      }
    }
});

test("a blow is drawn on the enemies the engine's blow strikes: not a sack imp, a beaten, held or thrown one, or one not whole on screen", () => {
  const heroes = [
    { seat: 0, kind: "brakka" },
    { seat: 1, kind: "rhea" },
  ] as const;
  let w = createWorld({ seed: 3, heroes });
  w = { ...w, heroes: w.heroes.map((h, i) => (i ? h : { ...h, pots: 1 })) };
  const [caster, thrower] = [w.heroes[0]!, w.heroes[1]!];
  const lane = (dx: number) => [caster.x + px(dx), caster.y] as const;
  w = spawnEnemy(w, "ravager", ...lane(60)); // struck
  w = spawnEnemy(w, "ravager", ...lane(-40)); // struck
  w = spawnEnemy(w, "imp", ...lane(90)); // never
  w = spawnEnemy(w, "ravager", ...lane(100)); // beaten
  w = spawnEnemy(w, "ravager", ...lane(120)); // held
  w = spawnEnemy(w, "ravager", ...lane(140)); // thrown
  w = spawnEnemy(w, "ravager", w.camX + px(4), caster.y); // half on screen
  w = spawnEnemy(w, "ravager", w.camX + px(340), caster.y); // off screen
  const patch = (index: number, change: Partial<Enemy>) => {
    const enemies = w.enemies.map((e, i) => (i === index ? { ...e, ...change } : e)); // prettier-ignore
    w = { ...w, enemies };
  };
  const { hit } = SPELL_STEPS.storm[0]!;
  // Brakka holds Magic for a few steps and lets go; Rhea has a body in her hands, and another flying from her.
  for (const held of [[MAGIC], [MAGIC], [MAGIC], []]) w = step(w, held);
  for (let i = 0; i < hit - 4; i++) w = step(w, []);
  patch(3, { state: "dead", hp: 0 });
  patch(4, { state: "held", holder: thrower.id });
  patch(5, { state: "thrown", holder: thrower.id, z: THROW_LIFT });
  const grabber = { state: "grab", timer: 0, x: w.enemies[4]!.x, y: w.enemies[4]!.y } as const; // prettier-ignore
  w = { ...w, heroes: w.heroes.map((h, i) => (i ? { ...h, ...grabber } : h)) };
  for (let i = 0; i < 3; i++) w = step(w, []);
  const view = toView(w);
  assert.equal(view.spells[0]!.age, hit - 1, "the last step before the blow");
  const blown = step(w, []);
  const struck = blown.enemies.filter((e, i) => e.hp < w.enemies[i]!.hp);
  assert.equal(struck.length, 2, "the two on screen");
  const spots = view.enemies.filter((e) => struck.some((s) => s.id === e.id));
  assert.deepEqual(
    marksOf(view),
    spots.map(({ x, y }) => ({ x, y })),
  );
});

test("a blow's marks use each kind's own width: an ogre, a half bigger, is struck (and marked) only further inside the screen than a ravager", () => {
  let w = createWorld({ seed: 3, heroes: [{ seat: 0, kind: "brakka" }] });
  const y = w.heroes[0]!.y,
    right = w.camX + px(VIEW_W);
  // The ravager's half-width is 10 px and the ogre's 15: 12 px from an edge is whole for the one and not for the other.
  const [near, far] = [px(12), px(16)];
  w = spawnEnemy(w, "ravager", w.camX + near, y); // struck
  w = spawnEnemy(w, "ogre", w.camX + near, y); // not whole
  w = spawnEnemy(w, "ravager", right - near, y); // struck
  w = spawnEnemy(w, "ogre", right - near, y); // not whole
  w = spawnEnemy(w, "ogre", w.camX + far, y); // struck
  w = spawnEnemy(w, "ogre", right - far, y); // struck
  const { hit } = SPELL_STEPS.storm[0]!;
  const spell = { hero: w.heroes[0]!.id, level: 1, born: w.step };
  w = { ...w, spells: [spell], heroes: w.heroes.map((h) => ({ ...h, state: "cast" })) }; // prettier-ignore
  for (let i = 0; i < hit - 1; i++) w = step(w, []);
  const view = toView(w);
  assert.equal(view.spells[0]!.age, hit - 1, "the last step before the blow");
  const struck = step(w, []).enemies.filter((e, i) => e.hp < w.enemies[i]!.hp);
  assert.deepEqual(
    struck.map((e) => w.enemies.findIndex((o) => o.id === e.id)),
    [0, 2, 4, 5],
  );
  assert.deepEqual(
    marksOf(view),
    view.enemies.filter((e) => struck.some((s) => s.id === e.id)).map(({ x, y }) => ({ x, y })), // prettier-ignore
  );
  // A kind from a newer build is as wide as a ravager.
  const wyvern = JSON.parse('"wyvern"') as V.EnemyKind;
  const odd = (x: number) => ({ ...view.enemies[0]!, kind: wyvern, x });
  assert.equal(marksOf({ ...view, camX: 0, enemies: [odd(12)] }).length, 1);
  assert.equal(marksOf({ ...view, camX: 0, enemies: [odd(9)] }).length, 0);
});

test("a blow's marks stay where the enemies stood as it fell, whatever it does to them; seen first later, they are where the enemies are", () => {
  const born = 400;
  const flung = ENEMIES.map((e, i) => ({ ...e, x: e.x + 30, hp: i ? 0 : 1, anim: "knockdown" as const })); // prettier-ignore
  const calls = (s: spells.Spells<FakeImage>, v: V.WorldView, frame: number) =>
    drawn(s, v, frame).map((c) => ({ ...c, image: c.image && [c.image.w, c.image.h] })); // prettier-ignore
  for (const kind of ["storm", "earth"] as const) {
    const { hit } = timing(kind, 1);
    const view = (age: number, enemies: V.EnemyView[]) =>
      world([spell(kind, 1, age)], { step: born + age, enemies });
    const watched = spells.createSpells(fakeMake().make);
    calls(watched, view(hit - 3, ENEMIES), 0);
    const after: [number, V.EnemyView[]][] = [
      [hit + 3, flung],
      [hit + 6, flung],
      [hit + 6, []],
    ];
    for (const [age, enemies] of after) {
      const kept = calls(watched, view(age, enemies), age);
      const [still, cold] = [ENEMIES, enemies].map((standing) =>
        calls(spells.createSpells(fakeMake().make), view(age, standing), age),
      );
      assert.deepEqual(kept, still, `${kind} ${age} ${enemies.length}`);
      assert.notDeepEqual(cold, kept, `${kind} ${age} ${enemies.length} cold`);
    }
  }
});
