import test from "node:test";
import assert from "node:assert/strict";
import {
  ATTACK,
  createWorld,
  spawnEnemy,
  step,
  toView,
} from "../src/engine/index.js";
import { px } from "../src/engine/tuning.js";
import type {
  EnemyView,
  FxView,
  HeroKind,
  HeroView,
  ItemView,
  WorldView,
} from "../src/engine/view.js";
import {
  DEAD_STEPS,
  ENEMY_STATES,
  FLOOR_BOTTOM_PX,
  FX_KINDS,
  FX_LIFE,
  VIEW_H,
  VIEW_W,
} from "../src/engine/view-kit.js";
import { HERO_ANIMS, stripFrame } from "../src/render/art/animate.js";
import { BRAKKA } from "../src/render/art/brakka.js";
import { HEROES } from "../src/render/art/index.js";
import { RAVAGER, RAVAGER_ANIMS } from "../src/render/art/ravager.js";
import { IMP_STAND_IN, POT_STAND_IN } from "../src/render/art/stand-ins.js";
import { createBackdrop } from "../src/render/backdrop/backdrop.js";
import { BLINK_FRAMES } from "../src/render/hud.js";
import type { Pen } from "../src/render/pen.js";
import {
  createLooks,
  createScene,
  deadShows,
  GO_AT,
  GO_FLASH,
  GO_SIGN,
  heroLooks,
  ITEM_SHADE,
  MARKER,
  shadowRadius,
} from "../src/render/scene.js";
import { SEAT_COLORS } from "../src/render/seat-colors.js";
import { drawSpark, HIT_STEPS } from "../src/render/sparks.js";
import {
  paintPixels,
  type MakeSurface,
  type PixelPaint,
} from "../src/render/surface.js";

interface Fill {
  style: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
interface FakeImage {
  readonly id: number;
  readonly w: number;
  readonly h: number;
  readonly fills: Fill[];
}
interface Blit {
  image: FakeImage;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

class FakePaint implements PixelPaint {
  fillStyle: string | CanvasGradient | CanvasPattern = "";
  constructor(readonly fills: Fill[] = []) {}
  fillRect(x: number, y: number, w: number, h: number) {
    this.fills.push({ style: String(this.fillStyle), x, y, w, h });
  }
}

/** Enough of a 2D context for the scene, recording every call. */
class RecordingPen extends FakePaint implements Pen<FakeImage> {
  readonly blits: Blit[] = [];
  drawImage(image: FakeImage, ...r: number[]) {
    const [sx = 0, sy = 0, sw = 0, sh = 0, dx = 0, dy = 0, dw = 0, dh = 0] = r;
    this.blits.push({ image, sx, sy, sw, sh, dx, dy, dw, dh });
  }
}

function fakeScene() {
  const images: FakeImage[] = [];
  const make: MakeSurface<FakeImage> = (w, h) => {
    const image = { id: images.length, w, h, fills: [] };
    images.push(image);
    // The backdrop's layers take the fast path; everything else is painted.
    return { image, paint: new FakePaint(image.fills), putPixels: () => {} };
  };
  return { images, scene: createScene(make) };
}
const shared = fakeScene();

const hero = (
  id: number,
  seat: number,
  x: number,
  y: number,
  more: Partial<HeroView> = {},
): HeroView => ({
  ...{ id, seat, kind: "brakka", x, y, z: 0, facing: 1 },
  ...{ anim: "idle", animStep: 0, hp: 60, maxHp: 60, lives: 3 },
  ...{ invulnerable: false, pots: 0, maxPots: 4, charge: 0 },
  ...more,
});
const enemy = (
  id: number,
  x: number,
  y: number,
  more: Partial<EnemyView> = {},
): EnemyView => ({
  ...{ id, kind: "ravager", tier: 0, x, y, z: 0, facing: 1 },
  ...{ anim: "idle", animStep: 0, hp: 4, maxHp: 4, flash: false },
  ...more,
});
const world = (more: Partial<WorldView>): WorldView => ({
  ...{ step: 0, camX: 0, heroes: [], enemies: [], fx: [], items: [] },
  spells: [],
  ...{ wave: 0, waves: 5, locked: false, go: false, cleared: false },
  ...{ defeated: false },
  ...more,
});

/**
 * One frame on the shared scene, its blits sorted into the layers they belong to. The HUD (`hud.test.ts`) draws over
 * everything, after the grass in front, the last layer: what follows it but the GO sign is the HUD's.
 */
function draw(view: WorldView, frame = 0, scene = shared.scene) {
  const pen = new RecordingPen();
  scene.draw(pen, view, frame);
  const is = (w: number, h: number) => (b: Blit) =>
    b.image.w === w && b.image.h === h;
  const shadow = (b: Blit) =>
    b.image.fills.length > 0 &&
    b.image.fills.every((f) => f.style.startsWith("rgba("));
  const layer = (b: Blit) => b.image.w >= VIEW_W;
  const [marker, sign] = [is(MARKER.w, MARKER.h), is(GO_SIGN.w, GO_SIGN.h)];
  let front = pen.blits.length - 1;
  while (front >= 0 && !layer(pen.blits[front]!)) front--;
  const field = pen.blits.slice(0, front + 1);
  return {
    pen,
    shadows: field.filter(shadow),
    markers: field.filter(marker),
    signs: pen.blits.filter(sign),
    // A spell's art and a charging hero's glow are pixel buffers (`spells.test.ts`), which paint no rectangles.
    sprites: field.filter(
      (b) =>
        !layer(b) &&
        !shadow(b) &&
        !marker(b) &&
        !sign(b) &&
        b.image.fills.length > 0,
    ),
    hud: pen.blits.slice(front + 1).filter((b) => !sign(b)),
  };
}

test("figures draw by depth: further up the floor first, then lower before higher, then by id", () => {
  const brakka = BRAKKA.sprite("idle0").ax;
  const ravager = RAVAGER.sprite(stripFrame(RAVAGER_ANIMS.idle, 0)).ax;
  const view = world({
    camX: 10,
    heroes: [hero(1, 0, 110, 140), hero(2, 1, 150, 120, { z: 8 })],
    enemies: [
      enemy(3, 190, 120),
      enemy(4, 230, 160),
      enemy(5, 270, 140),
      enemy(6, 70, 140),
    ],
  });
  const columns = draw(view).sprites.map(
    (b) =>
      b.dx +
      (b.image.w === BRAKKA.sprite("idle0").w ? brakka : ravager) +
      view.camX,
  );
  assert.deepEqual(columns, [190, 150, 110, 270, 70, 230]);
});

test("a jumping hero's shadow stays on the floor under it, and shrinks", () => {
  const [ground, air] = [0, 30].map((z) =>
    draw(world({ heroes: [hero(1, 0, 100, 140, { z, anim: "jump" })] })),
  );
  for (const [frame, z] of [
    [ground!, 0],
    [air!, 30],
  ] as const) {
    const [s] = frame.shadows;
    assert.equal(s!.dy + (s!.image.h >> 1), 140, "centred on the feet row");
    assert.equal(s!.dx + (s!.image.w >> 1), 100);
    assert.equal(s!.image.w, 2 * shadowRadius(z) + 1);
    const ay = BRAKKA.sprite("rise").ay;
    assert.equal(frame.sprites[0]!.dy + ay, 140 - z, "the figure rises");
  }
  assert.ok(shadowRadius(30) < shadowRadius(0));
  assert.equal(shadowRadius(-5), shadowRadius(0));
});

test("a figure facing left is its mirror image about the feet", () => {
  const [right, left] = ([1, -1] as const).map(
    (facing) =>
      draw(world({ heroes: [hero(1, 0, 160, 140, { facing })] })).sprites[0]!,
  );
  assert.notEqual(right!.image, left!.image);
  const runs = (b: Blit, mirror: boolean) =>
    b.image.fills
      .map((f) => `${f.style} ${mirror ? b.image.w - f.x - f.w : f.x} ${f.y}`)
      .sort();
  assert.deepEqual(runs(left!, true), runs(right!, false));
  const ax = BRAKKA.sprite("idle0").ax;
  assert.equal(right!.dx, 160 - ax);
  assert.equal(left!.dx, 160 - (right!.image.w - 1 - ax));
});

test("an enemy in hit-stop flashes, and each tier has its own palette", () => {
  const image = (more: Partial<EnemyView>) =>
    draw(world({ enemies: [enemy(1, 160, 140, more)] })).sprites[0]!.image;
  const plain = image({});
  const flash = image({ flash: true });
  assert.notEqual(flash, plain);
  assert.deepEqual(
    flash.fills.map(({ x, y, w }) => [x, y, w]),
    plain.fills.map(({ x, y, w }) => [x, y, w]),
  );
  assert.notDeepEqual(
    flash.fills.map((f) => f.style),
    plain.fills.map((f) => f.style),
  );
  const tiers = new Set([0, 1, 2].map((tier) => image({ tier: tier as 0 })));
  assert.equal(tiers.size, 3);
});

test("a defeated enemy lies still, then blinks out over DEAD_STEPS, shadow and all", () => {
  const shown = (animStep: number) => {
    const frame = draw(
      world({ enemies: [enemy(1, 160, 140, { anim: "dead", animStep })] }),
    );
    assert.equal(frame.shadows.length, frame.sprites.length);
    return frame.sprites.length === 1;
  };
  const steps = Array.from({ length: DEAD_STEPS }, (_, i) => i);
  const still = steps.filter((i) => i < DEAD_STEPS / 3);
  assert.ok(still.every(shown));
  const blinking = steps.filter((i) => i >= DEAD_STEPS / 3).map(shown);
  assert.ok(blinking.includes(true) && blinking.includes(false));
  assert.deepEqual(blinking, steps.slice(still.length).map(deadShows));
  assert.equal(shown(DEAD_STEPS), false);
});

test("an invulnerable hero blinks its sprite, keeping its shadow and marker; a vulnerable one never does", () => {
  const shows = (invulnerable: boolean, frame: number) => {
    const view = world({
      heroes: [hero(1, 0, 100, 140, { invulnerable, anim: "getup" })],
    });
    const { sprites, shadows, markers } = draw(view, frame);
    assert.equal(shadows.length, 1);
    assert.equal(markers.length, 1);
    return sprites.length === 1;
  };
  const frames = Array.from({ length: 4 * BLINK_FRAMES }, (_, i) => i);
  assert.ok(frames.every((frame) => shows(false, frame)));
  assert.deepEqual(
    frames.map((frame) => shows(true, frame)),
    frames.map((frame) => Math.floor(frame / BLINK_FRAMES) % 2 === 0),
  );
  assert.ok(frames.some((frame) => !shows(true, frame)));
});

test("duplicate heroes each get a palette of their own, the same on every draw", () => {
  const five = [0, 1, 2, 3, 4].map((seat) =>
    hero(seat + 1, seat, 60 + seat * 50, 120 + seat * 10),
  );
  const images = draw(world({ heroes: five })).sprites.map((b) => b.image);
  assert.equal(new Set(images).size, 5);
  assert.deepEqual(
    draw(world({ heroes: five })).sprites.map((b) => b.image),
    images,
  );
  // A mixed party: each hero is drawn as its own kind, the first of a kind in seat order in its own colours.
  const kinds: HeroKind[] = ["brakka", "gorm", "brakka", "rhea", "gorm"];
  const mixed = five.map((h, i) => ({ ...h, kind: kinds[i]! }));
  const looks = heroLooks([...mixed].reverse());
  const pairs = mixed.map((h) => looks.get(h.id)!);
  for (const [i, look] of pairs.entries())
    assert.equal(look.figure, HEROES[kinds[i]!].figure);
  assert.deepEqual(
    pairs.map((look) => look.swap === undefined),
    [true, true, false, true, false],
  );
  const same = pairs.filter((a, i) =>
    pairs.some((b, j) => i < j && a.figure === b.figure && a.swap === b.swap),
  );
  assert.deepEqual(same, []);
});

test("a hero's look depends only on the heroes of its own kind: another kind joining or leaving never recolours it", () => {
  const kinds: HeroKind[] = ["gorm", "brakka", "gorm", "rhea", "gorm"];
  const party = kinds.map((kind, seat) => ({
    ...hero(seat + 1, seat, 60 + seat * 50, 130),
    kind,
  }));
  const all = heroLooks(party);
  for (const kind of new Set(kinds)) {
    const own = heroLooks(party.filter((h) => h.kind === kind));
    for (const { id } of party.filter((h) => h.kind === kind))
      assert.deepEqual(own.get(id), all.get(id), `${kind} ${id}`);
  }
  // Three Gorms are in three palettes whoever else is in the room.
  const gorms = party.filter((h) => h.kind === "gorm");
  assert.equal(new Set(gorms.map((h) => all.get(h.id)!.swap)).size, 3);
});

test("a hero's look is worked out once per roster: it holds across frames and anims, and follows a roster change", () => {
  const looks = createLooks();
  const roster = [0, 1, 2].map((seat) =>
    hero(seat + 1, seat, 60 + seat * 50, 130),
  );
  const first = looks(roster);
  const expected = heroLooks(roster);
  for (const { id } of roster)
    assert.deepEqual(first.get(id), expected.get(id));
  const acting = roster.map((h) => ({
    ...{ ...h, x: h.x + 9, z: 12, facing: -1 as const },
    ...{ anim: "attack2" as const, animStep: 7 },
  }));
  assert.equal(
    looks(acting),
    first,
    "moving, swinging or jumping changes none",
  );
  assert.equal(looks([...roster]), first);
  const rhea = roster.map((h, i) =>
    i === 1 ? { ...h, kind: "rhea" as const } : h,
  );
  const changed = looks(rhea);
  assert.notEqual(changed, first, "a new kind in the party is a new roster");
  assert.equal(looks(rhea), changed);
  assert.notEqual(looks(roster.slice(0, 2)), changed, "so is one fewer hero");
});

test("every anim of a hero and an enemy draws at any step, and one the art lacks stands idle", () => {
  const heroAnims = [...HERO_ANIMS] as HeroView["anim"][];
  const enemyAnims = Object.keys(RAVAGER_ANIMS) as EnemyView["anim"][];
  const steps = [0, 1, 7, 19, 33, 60, 100_000, 2.5, -4, Number.NaN];
  for (const animStep of [...steps, Number.POSITIVE_INFINITY]) {
    const { sprites } = draw(
      world({
        heroes: heroAnims.map((anim, i) =>
          hero(i + 1, i % 5, 30 + i * 14, 130, { anim, animStep }),
        ),
        enemies: enemyAnims.map((anim, i) =>
          enemy(20 + i, 50 + i * 20, 160, { anim, animStep }),
        ),
      }),
    );
    // Whole, finite steps draw every figure but a defeated enemy that has blinked out.
    if (Number.isFinite(animStep) && animStep >= 0 && animStep < 20)
      assert.equal(sprites.length, heroAnims.length + enemyAnims.length);
  }
  // A kind of anim from a build with more of them: the hero and the enemy stand idle.
  const unknown = JSON.parse('"ride"') as HeroView["anim"] & EnemyView["anim"];
  const [odd, idle] = [unknown, "idle" as const].map((anim) =>
    draw(
      world({
        heroes: [hero(1, 0, 100, 130, { anim, animStep: 12 })],
        enemies: [enemy(2, 200, 150, { anim, animStep: 12 })],
      }),
    ).sprites.map((b) => b.image),
  );
  assert.equal(odd!.length, 2);
  assert.deepEqual(odd, idle);
});

test("a sack imp draws its stand-in in every anim, as does a kind with no art; pots lie among the figures and blink before they vanish", () => {
  const stand = IMP_STAND_IN;
  const imps = ENEMY_STATES.map((anim, i) =>
    enemy(i + 2, 20 + i * 18, 140, { kind: "imp", anim }),
  );
  const drawn = draw(world({ enemies: imps })).sprites;
  assert.deepEqual(
    drawn.map((b) => [b.image.w, b.image.h]),
    imps.map(() => [stand.w, stand.h]),
  );
  const odd = JSON.parse('"wizard"') as EnemyView["kind"];
  const [unknown] = draw(
    world({ enemies: [enemy(2, 160, 140, { kind: odd, facing: -1 })] }),
  ).sprites;
  // Facing left, mirrored about its feet.
  assert.deepEqual(
    [unknown!.image.w, unknown!.dx],
    [stand.w, 160 - (stand.w - 1 - stand.ax)],
  );
  // A pot lies by its feet with a small shadow, in depth order: in front of an imp further up the floor.
  const pot: ItemView = {
    id: 9,
    kind: "pot",
    x: 100,
    y: 150,
    z: 4,
    blink: false,
  };
  const { sprites, shadows } = draw(
    world({
      enemies: [enemy(2, 100, 140, { kind: "imp", anim: "walk" })],
      items: [pot],
    }),
  );
  assert.deepEqual(
    sprites.map((b) => [b.image.w, b.dx, b.dy]),
    [
      [stand.w, 100 - stand.ax, 140 - stand.ay],
      [POT_STAND_IN.w, 100 - POT_STAND_IN.ax, 150 - 4 - POT_STAND_IN.ay],
    ],
  );
  assert.equal(shadows[1]!.image.w, 2 * ITEM_SHADE + 1);
  const blinking = world({ items: [{ ...pot, blink: true }] });
  assert.equal(draw(blinking, 0).sprites.length, 1);
  assert.equal(draw(blinking, BLINK_FRAMES).sprites.length, 0);
  assert.equal(draw(blinking, BLINK_FRAMES).shadows.length, 1);
  const meat = JSON.parse('"meat"') as ItemView["kind"];
  assert.equal(
    draw(world({ items: [{ ...pot, kind: meat }] })).sprites[0]!.image.w,
    POT_STAND_IN.w,
  );
});

test("each hero wears a marker in its seat's colour over its head, rising with it", () => {
  const [ground, air] = [0, 30].map((z) =>
    draw(world({ heroes: [hero(1, 2, 100, 140, { z })] })),
  );
  const [low, high] = [ground!.markers[0]!, air!.markers[0]!];
  assert.ok(low.image.fills.some((f) => f.style === SEAT_COLORS[2]));
  assert.equal(low.dy - high.dy, 30);
  assert.ok(low.dy + low.dh < ground!.sprites[0]!.dy + 40, "over the head");
  assert.equal(draw(world({ enemies: [enemy(1, 9, 140)] })).markers.length, 0);
});

test("sparks burst within their life only, and a light hit's sooner", () => {
  for (const kind of FX_KINDS)
    for (let age = -1; age <= FX_LIFE; age++) {
      const pen = new RecordingPen();
      const fx: FxView = { kind, x: 200, y: 140, z: 30, age };
      drawSpark(pen, fx, 40);
      const life = kind === "hit" ? HIT_STEPS : FX_LIFE;
      assert.equal(
        pen.fills.length > 0,
        age >= 0 && age < life,
        `${kind} ${age}`,
      );
      for (const f of pen.fills) {
        assert.ok(Math.abs(f.x - 160) < 24 && Math.abs(f.y - 110) < 24);
      }
    }
});

test("GO → flashes at the right while the road is open, and only then", () => {
  const go = world({ go: true });
  const [sign] = draw(go, 0).signs;
  assert.deepEqual([sign?.dx, sign?.dy], [GO_AT[0], GO_AT[1]]);
  assert.equal(draw(go, GO_FLASH).signs.length, 0);
  assert.equal(draw(go, 2 * GO_FLASH).signs.length, 1);
  assert.equal(draw(world({}), 0).signs.length, 0);
});

test("nothing is drawn outside the 320 × 180 screen", () => {
  const camX = 300;
  const view = world({
    camX,
    go: true,
    heroes: [
      hero(1, 0, camX - 20, 110, { z: 90, anim: "jump" }),
      hero(2, 1, camX + 318, FLOOR_BOTTOM_PX, { facing: -1 }),
      hero(3, 2, camX + 700, 140),
    ],
    enemies: [
      enemy(4, camX - 200, 140),
      enemy(5, camX + 330, 172, { anim: "enter", animStep: 13 }),
      enemy(6, camX + 2, FLOOR_BOTTOM_PX, { anim: "knockdown", z: 40 }),
    ],
    fx: FX_KINDS.map((kind, i) => ({
      kind,
      x: camX + [0, 319, 160][i]!,
      y: [104, 179, 172][i]!,
      z: [100, 0, 0][i]!,
      age: 6,
    })),
  });
  for (const frame of [0, 1, 37]) {
    const { pen, sprites } = draw(view, frame);
    assert.equal(sprites.length, 4, "the far-off hero and enemy are skipped");
    for (const f of pen.fills)
      assert.ok(
        f.x >= 0 && f.y >= 0 && f.x + f.w <= VIEW_W && f.y + f.h <= VIEW_H,
        JSON.stringify(f),
      );
    for (const b of pen.blits) {
      const where = JSON.stringify({ ...b, image: b.image.id });
      assert.ok(b.dw === b.sw && b.dh === b.sh && b.sw > 0 && b.sh > 0, where);
      assert.ok(b.dx >= 0 && b.dy >= 0, where);
      assert.ok(b.dx + b.dw <= VIEW_W && b.dy + b.dh <= VIEW_H, where);
      assert.ok(b.sx >= 0 && b.sy >= 0, where);
      assert.ok(b.sx + b.sw <= b.image.w && b.sy + b.sh <= b.image.h, where);
    }
  }
});

test("sprites, shadows and markers are baked once: a repeated frame makes no surface", () => {
  const { images, scene } = fakeScene();
  const view = world({
    heroes: [hero(1, 0, 100, 140), hero(2, 1, 140, 150, { z: 12 })],
    enemies: [enemy(3, 200, 130, { flash: true, tier: 2 })],
    fx: [{ kind: "heavy", x: 150, y: 140, z: 20, age: 3 }],
    go: true,
  });
  draw(view, 0, scene);
  const made = images.length;
  for (let frame = 1; frame < 90; frame++) draw(view, frame, scene);
  assert.equal(images.length, made);
});

test("an anim strip loops or holds its last frame, and never throws", () => {
  const strip = {
    frames: [
      ["a", 2],
      ["b", 3],
    ] as const,
    loop: true,
  };
  const at = (s: typeof strip | { frames: typeof strip.frames; loop: false }) =>
    [0, 1, 2, 4, 5, 7, Number.NaN, -3, 2.9].map((step) => stripFrame(s, step));
  assert.deepEqual(at(strip), ["a", "a", "b", "b", "a", "b", "a", "a", "b"]);
  assert.deepEqual(at({ ...strip, loop: false }), [
    ...["a", "a", "b", "b", "b", "b", "a", "a", "b"],
  ]);
});

test("the scene draws every view of real brawls, heroes cut down and ravagers beaten alike", () => {
  const { scene } = fakeScene();
  const seen = { heroes: new Set<string>(), enemies: new Set<string>() };
  for (const [swing, enemies] of [
    [() => 0, 5],
    [(i: number) => (i % 30 < 20 ? ATTACK : 0), 5],
  ] as const) {
    let brawl = createWorld({
      seed: 7,
      heroes: [
        { seat: 0, kind: "brakka" },
        { seat: 1, kind: "rhea" },
      ],
    });
    const { x, y } = brawl.heroes[0]!;
    for (let i = 0; i < enemies; i++)
      brawl = spawnEnemy(
        brawl,
        "ravager",
        x + px(60 + 25 * i),
        y + px((i % 3) * 8),
        (i % 3) as 0,
      );
    for (let i = 0; i < 3000; i++) {
      brawl = step(brawl, [swing(i), swing(i + 10)]);
      const view = toView(brawl);
      for (const h of view.heroes) seen.heroes.add(h.anim);
      for (const e of view.enemies) seen.enemies.add(e.anim);
      scene.draw(new RecordingPen(), view, i);
    }
  }
  // The brawls do reach the states the art has to cover: a hero hurt and cut down, a ravager winding up and swinging.
  for (const anim of ["hurt", "dead"] as const)
    assert.ok(seen.heroes.has(anim));
  for (const anim of ["windup", "attack"] as const)
    assert.ok(seen.enemies.has(anim));
});

/** A paint that writes into an RGBA buffer, to read back what `paintPixels` drew. */
class RasterPaint implements PixelPaint {
  fillStyle: string | CanvasGradient | CanvasPattern = "";
  readonly rgba: Uint8ClampedArray<ArrayBuffer>;
  constructor(
    readonly width: number,
    height: number,
  ) {
    this.rgba = new Uint8ClampedArray(width * height * 4);
  }
  fillRect(x: number, y: number, w: number, h: number) {
    const style = String(this.fillStyle);
    const rgba = style.startsWith("#")
      ? [1, 3, 5].map((i) => parseInt(style.slice(i, i + 2), 16)).concat(255)
      : style
          .slice(5, -1)
          .split(",")
          .map((v, i) => (i < 3 ? Number(v) : Math.round(Number(v) * 255)));
    for (let j = y; j < y + h; j++)
      for (let i = x; i < x + w; i++)
        this.rgba.set(rgba, (j * this.width + i) * 4);
  }
}

test("the backdrop painted through a plain surface matches its pixel buffers exactly", () => {
  const sources: Uint8ClampedArray[] = [];
  createBackdrop<null>(
    () => ({
      image: null,
      paint: new FakePaint(),
      putPixels: (rgba) => void sources.push(rgba),
    }),
    1,
  );
  const painted: RasterPaint[] = [];
  createBackdrop<null>((w, h) => {
    const paint = new RasterPaint(w, h);
    painted.push(paint);
    return { image: null, paint };
  }, 1);
  assert.equal(painted.length, sources.length);
  painted.forEach((paint, i) =>
    assert.ok(
      Buffer.from(paint.rgba).equals(Buffer.from(sources[i]!)),
      `layer ${i}`,
    ),
  );
  // A half-transparent pixel keeps its alpha; runs of one colour are one rectangle; clear pixels draw nothing.
  const rgba = new Uint8ClampedArray([
    ...[10, 20, 30, 255, 10, 20, 30, 255, 0, 0, 0, 0],
    ...[255, 0, 0, 128, 0, 0, 0, 0, 1, 2, 3, 255],
  ]);
  const paint = new RasterPaint(3, 2);
  const calls = new FakePaint();
  paintPixels(paint, 3, rgba);
  paintPixels(calls, 3, rgba);
  assert.deepEqual(paint.rgba, rgba);
  assert.deepEqual(
    calls.fills.map((f) => [f.style, f.x, f.y, f.w]),
    [
      ["#0a141e", 0, 0, 2],
      [`rgba(255, 0, 0, ${128 / 255})`, 0, 1, 1],
      ["#010203", 2, 1, 1],
    ],
  );
});
