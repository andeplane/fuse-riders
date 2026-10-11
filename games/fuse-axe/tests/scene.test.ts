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
  EnemyKind,
  EnemyView,
  FxView,
  HeroKind,
  HeroView,
  ItemView,
  MountAnim,
  MountView,
  Tier,
  WorldView,
} from "../src/engine/view.js";
import {
  CLAWBEAK,
  CLAWBEAK_STEPS,
  DRAKE_STEPS,
  MOUNT_STATES,
  DEAD_STEPS,
  ENEMY_KINDS,
  HERO_KINDS,
  ENEMY_STATES,
  FLOOR_BOTTOM_PX,
  FX_KINDS,
  FX_LIFE,
  OGRE_STEPS,
  SIGIL,
  QUAKE,
  SPEAR,
  VIEW_H,
  VIEW_W,
  cameraEndPx,
  stageLengthPx,
} from "../src/engine/view-kit.js";
import {
  enemyFrame,
  heroFrame,
  HERO_ANIMS,
  mountFrame,
  riderFrame,
  stripFrame,
} from "../src/render/art/animate.js";
import {
  BONE_KNIGHT,
  BONEWALKER,
  type BonewalkerFrame,
} from "../src/render/art/bonewalker.js";
import { BRAKKA } from "../src/render/art/brakka.js";
import { CAPTAIN, type CaptainFrame } from "../src/render/art/captain.js";
import {
  DRAKE_DIPS,
  DRAKE_FIGURE,
  type DrakeFrame,
} from "../src/render/art/drake.js";
import {
  CLAWBEAK_DIPS,
  CLAWBEAK_FIGURE,
  type ClawbeakFrame,
} from "../src/render/art/clawbeak.js";
import { IMP, IMP_WALK_STEPS } from "../src/render/art/imp.js";
import { FIGURES, HEROES } from "../src/render/art/index.js";
import {
  LANCER,
  LANCER_TIERS,
  type LancerFrame,
} from "../src/render/art/lancer.js";
import {
  OGRE,
  OGRE_CROWNS,
  OGRE_RAGE,
  OGRE_TIERS,
  type OgreFrame,
} from "../src/render/art/ogre.js";
import { MEAT } from "../src/render/art/meat.js";
import { POT } from "../src/render/art/pot.js";
import {
  RAVAGER,
  RAVAGER_ANIMS,
  RAVAGER_TIERS,
} from "../src/render/art/ravager.js";
import { flipSprite, type Sprite } from "../src/render/pixel/sprite.js";
import {
  createSpriteBaker,
  type BakeOptions,
} from "../src/render/pixel/surface.js";
import { createBackdrop } from "../src/render/backdrop/backdrop.js";
import { FIRE, FLAME } from "../src/render/backdrop/camp.js";
import {
  CRYPT_END,
  CRYPT_LENGTH,
} from "../src/render/backdrop/drowned-crypt.js";
import { KEEP_END } from "../src/render/backdrop/vorhals-keep.js";
import { BLINK_FRAMES } from "../src/render/hud.js";
import type { Pen } from "../src/render/pen.js";
import {
  createLooks,
  createScene,
  deadShows,
  ENEMY_ART,
  MOUNT_ART,
  GO_AT,
  GO_FLASH,
  GO_SIGN,
  heroLooks,
  ITEM_SHADE,
  MARKER,
  MARKER_GAP,
  TELEGRAPH,
  scenery,
  shadowRadius,
  SHADOW_RX,
} from "../src/render/scene.js";
import { SEAT_COLORS } from "../src/render/seat-colors.js";
import { MASTER, UNLIT } from "../src/render/pixel/palette.js";
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
  /** Every fill and blit, in the order they were drawn. */
  readonly calls: (Fill | Blit)[] = [];
  override fillRect(x: number, y: number, w: number, h: number) {
    super.fillRect(x, y, w, h);
    this.calls.push(this.fills.at(-1)!);
  }
  drawImage(image: FakeImage, ...r: number[]) {
    const [sx = 0, sy = 0, sw = 0, sh = 0, dx = 0, dy = 0, dw = 0, dh = 0] = r;
    const blit = { image, sx, sy, sw, sh, dx, dy, dw, dh };
    this.blits.push(blit);
    this.calls.push(blit);
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
/** The fills a sprite bakes to, to tell which art a blit drew. */
const reference = createSpriteBaker<FakeImage>((w, h) => {
  const image = { id: -1, w, h, fills: [] };
  return { image, paint: new FakePaint(image.fills) };
});
const fillsOf = (sprite: Sprite, options?: BakeOptions) =>
  reference.bake(sprite, options).image.fills;

const hero = (
  id: number,
  seat: number,
  x: number,
  y: number,
  more: Partial<HeroView> = {},
): HeroView => ({
  ...{ id, seat, kind: "brakka", x, y, z: 0, facing: 1 },
  ...{ anim: "idle", animStep: 0, hp: 60, maxHp: 60, lives: 3 },
  ...{ invulnerable: false, pots: 0, maxPots: 4, charge: 0, mounted: false },
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
  ...{ boss: false, enraged: false, mounted: false },
  ...more,
});
const world = (more: Partial<WorldView>): WorldView => ({
  ...{ step: 0, camX: 0, heroes: [], enemies: [], fx: [], items: [] },
  ...{ spells: [], mounts: [], stage: 1, camp: false },
  ...{ wave: 0, waves: 5, locked: false, go: false, cleared: false },
  ...{ defeated: false, boss: null, sigils: [] },
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
  // The tiers are the ravager's palettes: a sack imp, which has only the one, is never tinted by them.
  const imps = [0, 1, 2].map((tier) =>
    image({ kind: "imp", tier: tier as 0, anim: "walk" }),
  );
  assert.equal(new Set(imps).size, 1);
  assert.deepEqual(imps[0]!.fills, fillsOf(IMP.sprite("walk1")));
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

test("a beast draws its own art on its feet, its rider astride the saddle over it, sinking as the saddle dips, in the beast's one shadow", () => {
  const beast = (more: Partial<MountView> = {}): MountView => ({
    ...{ id: 9, kind: "clawbeak", x: 150, y: 140, z: 0, facing: 1 },
    ...{ anim: "idle", animStep: 0, rider: { kind: "enemy", id: 2 }, ...more },
  });
  const seated = { anim: "ride", mounted: true, z: CLAWBEAK.saddle } as const;
  const ride = RAVAGER.sprite("ride");
  const anchorX = (s: Sprite, flip: boolean) =>
    flip ? flipSprite(s).ax : s.ax;
  // Out of the wind-up's blink, every anim at steps through its strips, facing either way.
  for (const anim of MOUNT_STATES)
    for (const animStep of [21, 27, 40, 64, 100])
      for (const facing of [1, -1] as const) {
        const flip = facing < 0;
        const { sprites, shadows } = draw(
          world({
            enemies: [enemy(2, 150, 140, { ...seated, facing })],
            mounts: [beast({ anim, animStep, facing })],
          }),
        );
        const frame = mountFrame("clawbeak", anim, animStep) as ClawbeakFrame;
        const art = CLAWBEAK_FIGURE.sprite(frame);
        const label = `${anim} ${animStep} ${facing}`;
        // The beast first, its feet on its floor position; its rider after it, its feet on the saddle point.
        const [body, rider] = sprites;
        assert.deepEqual(body!.image.fills, fillsOf(art, { flash: false, flip }), label); // prettier-ignore
        assert.deepEqual([body!.dx + anchorX(art, flip), body!.dy + art.ay], [150, 140], label); // prettier-ignore
        assert.deepEqual(rider!.image.fills, fillsOf(ride, { flash: false, flip }), label); // prettier-ignore
        assert.equal(rider!.dx + anchorX(ride, flip), 150, label);
        const saddle = 140 - CLAWBEAK.saddle + CLAWBEAK_DIPS[frame];
        assert.equal(rider!.dy + ride.ay, saddle, label);
        // One shadow, the beast's, a third wider than a body's: the rider casts none of its own.
        assert.equal(shadows.length, 1, label);
        assert.equal(shadows[0]!.image.w, 2 * Math.round((SHADOW_RX * 4) / 3) + 1); // prettier-ignore
      }
  // The strut's dip lowers the rider with the saddle.
  const walking = (animStep: number) =>
    draw(world({ enemies: [enemy(2, 150, 140, seated)], mounts: [beast({ anim: "walk", animStep })] })).sprites[1]!.dy; // prettier-ignore
  assert.equal(walking(0), walking(5) + 1);
  // A rider whose beast is not in the view (or is another's) fails safe: it stays at the height the view gives it, in a
  // shadow of its own, not hanging in the air with none.
  const strays = [
    [],
    [beast({ rider: { kind: "enemy", id: 3 } })],
    [beast({ rider: { kind: "hero", id: 2 } })],
  ];
  for (const mounts of strays) {
    const { sprites, shadows } = draw(world({ enemies: [enemy(2, 150, 140, seated)], mounts })); // prettier-ignore
    assert.equal(sprites.at(-1)!.dy + ride.ay, 140 - CLAWBEAK.saddle);
    const own = shadows.filter((s) => s.image.w === 2 * shadowRadius(CLAWBEAK.saddle) + 1); // prettier-ignore
    assert.equal(own.length, 1, "the rider's own shadow");
  }
});

test("a hero rides as an enemy does: astride the saddle, sinking with the beast's dip, doing what its beast does, in the beast's one shadow, facing either way, a hop and all", () => {
  const seated = { anim: "ride", mounted: true, z: CLAWBEAK.saddle } as const;
  const beast = (more: Partial<MountView> = {}): MountView => ({
    ...{ id: 9, kind: "clawbeak", x: 150, y: 140, z: 0, facing: 1 },
    ...{ anim: "idle", animStep: 0, rider: { kind: "hero", id: 1 }, ...more },
  });
  const anchorX = (s: Sprite, flip: boolean) =>
    flip ? flipSprite(s).ax : s.ax;
  for (const anim of MOUNT_STATES)
    // Out of the wind-up's blink, every anim at steps through its strips, facing either way.
    for (const animStep of [21, 27, 40, 64, 100])
      for (const facing of [1, -1] as const) {
        const flip = facing < 0;
        const rider = hero(1, 0, 150, 140, { ...seated, facing });
        const { sprites, shadows } = draw(
          world({ heroes: [rider], mounts: [beast({ anim, animStep, facing })] }), // prettier-ignore
        );
        const frame = mountFrame("clawbeak", anim, animStep) as ClawbeakFrame;
        const label = `${anim} ${animStep} ${facing}`;
        // The beast first, its rider after it, in the hero's own colours and in the frame its beast's anim calls for
        // (`riderFrame`), its feet on the saddle point.
        const [body, sat] = sprites;
        const art = CLAWBEAK_FIGURE.sprite(frame);
        const ride = BRAKKA.sprite(riderFrame(anim, animStep));
        assert.deepEqual(body!.image.fills, fillsOf(art, { flash: false, flip }), label); // prettier-ignore
        assert.deepEqual(sat!.image.fills, fillsOf(ride, { flip }), label);
        assert.equal(sat!.dx + anchorX(ride, flip), 150, label);
        const saddle = 140 - CLAWBEAK.saddle + CLAWBEAK_DIPS[frame];
        assert.equal(sat!.dy + ride.ay, saddle, label);
        // One shadow, the beast's: the rider casts none of its own.
        assert.equal(shadows.length, 1, label);
      }
  // A rider whose beast is not in the view (or is another's) fails safe: it sits (`heroFrame`) at the height the view
  // gives it, in a shadow of its own, not hanging in the air with none.
  const sitting = BRAKKA.sprite(heroFrame("brakka", "ride", 0));
  const strays = [[], [beast({ rider: { kind: "enemy", id: 1 } })], [beast({ rider: { kind: "hero", id: 2 } })]]; // prettier-ignore
  for (const mounts of strays) {
    const { sprites, shadows } = draw(world({ heroes: [hero(1, 0, 150, 140, seated)], mounts })); // prettier-ignore
    assert.deepEqual(sprites.at(-1)!.image.fills, fillsOf(sitting, {}));
    assert.equal(sprites.at(-1)!.dy + sitting.ay, 140 - CLAWBEAK.saddle);
    const own = shadows.filter((s) => s.image.w === 2 * shadowRadius(CLAWBEAK.saddle) + 1); // prettier-ignore
    assert.equal(own.length, 1, "the rider's own shadow");
  }
});

test("a beast blinks as its tail winds up, coiling, and lashes with the ring in its own frame; any anim or kind draws one beast", () => {
  const beast = (more: Partial<MountView> = {}): MountView => ({
    ...{ id: 9, kind: "clawbeak", x: 150, y: 140, z: 0, facing: 1 },
    ...{ anim: "sweep", animStep: 0, rider: null, ...more },
  });
  const fills = (more: Partial<MountView>) =>
    draw(world({ mounts: [beast(more)] })).sprites[0]!.image.fills;
  const { windup } = CLAWBEAK_STEPS;
  const art = (frame: ClawbeakFrame, flash: boolean) =>
    fillsOf(CLAWBEAK_FIGURE.sprite(frame), { flash, flip: false });
  // Blinking every `TELEGRAPH` steps through the wind-up, from its first step to its last, then lashing unlit.
  assert.deepEqual(fills({ animStep: 0 }), art("coil1", true));
  assert.deepEqual(fills({ animStep: TELEGRAPH }), art("coil1", false));
  assert.deepEqual(fills({ animStep: windup - 1 }), art("coil2", true));
  assert.deepEqual(fills({ animStep: windup }), art("lash", false));
  // The ring is the sprite's own: nothing else is drawn for it.
  const { sprites, pen } = draw(
    world({ mounts: [beast({ animStep: windup })] }),
  );
  assert.equal(sprites.length, 1);
  assert.deepEqual(
    pen.fills.filter((f) => f.style === "#f4f8ff"),
    [],
  );
  // Every anim at any step, facing either way, and a kind from a build with more of them, draws one beast.
  const odd = JSON.parse('"wyvern"') as MountView["kind"];
  for (const anim of MOUNT_STATES)
    for (const animStep of [0, 7, 21, 1e9, -3, 2.5, Number.NaN])
      for (const kind of ["clawbeak", "drake", odd] as const) {
        const more = { anim, animStep, kind, facing: -1 as const };
        const { sprites } = draw(world({ mounts: [beast(more)] }));
        assert.equal(sprites.length, 1);
      }
  assert.deepEqual(fills({ kind: odd, anim: "idle" }), fills({ anim: "idle" }));
});

test("a lancer draws from its own art in its tier's colours, the spear in its sprite: the thrust's point at the reach either way", () => {
  const sprites = (more: Partial<EnemyView>) =>
    draw(world({ enemies: [enemy(1, 150, 140, { kind: "lancer", ...more })] }))
      .sprites;
  const anims = [
    ...[
      ["idle", 0],
      ["walk", 9],
      ["windup", 5],
      ["thrust", 3],
    ],
    ...[
      ["recover", 4],
      ["leap", 30],
      ["plunge", 2],
      ["down", 9],
    ],
  ] as const;
  for (const tier of [0, 1, 2] as const)
    for (const [anim, animStep] of anims)
      for (const facing of [1, -1] as const) {
        const z = anim === "leap" ? 20 : 0;
        const drawn = sprites({ tier, anim, animStep, facing, z });
        const frame = enemyFrame("lancer", anim, animStep) as LancerFrame;
        assert.equal(drawn.length, 1);
        assert.deepEqual(
          drawn[0]!.image.fills,
          fillsOf(LANCER.sprite(frame), {
            ...{ swap: LANCER_TIERS[tier], flash: false },
            flip: facing < 0,
          }),
          `${tier} ${anim} ${facing}`,
        );
      }
  // The thrust's steel point on screen, found in the sprite's rows and placed by the blit: on the column the spear
  // reaches from the lancer's.
  const thrust = LANCER.sprite("thrust");
  const point = Math.max(
    ...thrust.rows.map((row) => row.search(/[^.k][.k]*$/)),
  );
  for (const facing of [1, -1] as const) {
    const { dx } = sprites({ anim: "thrust", facing })[0]!;
    const column = facing > 0 ? dx + point : dx + thrust.w - 1 - point;
    assert.equal(column, 150 + facing * Math.round(SPEAR.reach), `${facing}`);
  }
});

test("every anim of a hero and an enemy draws at any step, and one the art lacks stands idle", () => {
  const heroAnims = [...HERO_ANIMS] as HeroView["anim"][];
  // Every kind in every anim the view has, a ravager's `flee` and an imp's `windup` included.
  const enemyAnims = ENEMY_KINDS.flatMap((kind) =>
    ENEMY_STATES.map((anim) => ({ kind, anim })),
  );
  const steps = [0, 1, 7, 19, 33, 60, 100_000, 2.5, -4, Number.NaN];
  for (const animStep of [...steps, Number.POSITIVE_INFINITY]) {
    const { sprites } = draw(
      world({
        heroes: heroAnims.map((anim, i) =>
          hero(i + 1, i % 5, 30 + i * 12, 130, { anim, animStep }),
        ),
        enemies: enemyAnims.map(({ kind, anim }, i) =>
          enemy(40 + i, 20 + ((i * 10) % 280), 160, { kind, anim, animStep }),
        ),
      }),
    );
    // Whole, finite steps draw every figure but a defeated enemy that has blinked out.
    if (Number.isFinite(animStep) && animStep >= 0 && animStep < 20)
      assert.equal(sprites.length, heroAnims.length + enemyAnims.length);
  }
  // A kind of anim from a build with more of them: the hero and each enemy stand idle.
  const unknown = JSON.parse('"dance"') as HeroView["anim"] & EnemyView["anim"];
  const [odd, idle] = [unknown, "idle" as const].map((anim) =>
    draw(
      world({
        heroes: [hero(1, 0, 100, 130, { anim, animStep: 12 })],
        enemies: [
          enemy(2, 200, 150, { anim, animStep: 12 }),
          enemy(3, 250, 150, { kind: "imp", anim, animStep: 12 }),
        ],
      }),
    ).sprites.map((b) => b.image),
  );
  assert.equal(odd!.length, 3);
  assert.deepEqual(odd, idle);
});

test("a bonewalker draws its own figure in its tier's rags, the violet one the armoured knight, its pile and crumbling bones too", () => {
  const drawn = (more: Partial<EnemyView>) =>
    draw(
      world({
        enemies: [enemy(2, 150, 150, { kind: "bonewalker", ...more })],
      }),
    );
  const { tiers } = ENEMY_ART.bonewalker;
  // prettier-ignore
  const shows = [["idle", 0], ["rise", 25], ["attack", 0], ["pile", 3], ["pile", 149], ["reassemble", 12], ["dead", 3]] as const;
  for (const tier of [0, 1, 2] as const)
    for (const [anim, animStep] of shows) {
      const figure = tier === 2 ? BONE_KNIGHT : BONEWALKER;
      const frame = enemyFrame("bonewalker", anim, animStep) as BonewalkerFrame;
      const { sprites, shadows } = drawn({ tier, anim, animStep, facing: -1 });
      assert.deepEqual(
        sprites[0]!.image.fills,
        fillsOf(figure.sprite(frame), { swap: tiers[tier], flip: true }),
        `${tier} ${anim}`,
      );
      assert.equal(shadows[0]!.image.w, 2 * SHADOW_RX + 1);
    }
  const looks = ([0, 1, 2] as const).map(
    (tier) => drawn({ tier }).sprites[0]!.image.fills,
  );
  assert.equal(new Set(looks.map((each) => JSON.stringify(each))).size, 3);
  // No anim at any step throws, nor a tier from a build with more of them, which draws in the figure's own rags.
  const odd = JSON.parse("7") as Tier;
  for (const anim of ENEMY_STATES)
    for (const animStep of [0, 30, 1e9, Number.NaN])
      assert.equal(
        drawn({ anim, animStep }).sprites.length,
        anim === "dead" && !deadShows(animStep) ? 0 : 1,
      );
  assert.deepEqual(
    drawn({ tier: odd }).sprites[0]!.image.fills,
    fillsOf(BONEWALKER.sprite("idle")),
  );
});

test("no state of a bonewalker, in any tier at any step, draws a frame its own figure lacks, a ravager's stand-in least of all", () => {
  const { tiers } = ENEMY_ART.bonewalker;
  for (const tier of [0, 1, 2] as const)
    for (const anim of ENEMY_STATES)
      for (const animStep of [0, 1, 7, 29, 59, 149, 1e9, Number.NaN]) {
        const figure = tier === 2 ? BONE_KNIGHT : BONEWALKER;
        const frame = enemyFrame("bonewalker", anim, animStep);
        assert.ok(
          (figure.frames as readonly string[]).includes(frame),
          `${tier} ${anim} ${animStep}: ${frame}`,
        );
        const { sprites } = draw(
          world({
            enemies: [
              enemy(2, 150, 150, { kind: "bonewalker", tier, anim, animStep }),
            ],
          }),
        );
        if (anim === "dead" && !deadShows(animStep)) continue;
        assert.deepEqual(
          sprites[0]!.image.fills,
          fillsOf(figure.sprite(frame as BonewalkerFrame), {
            swap: tiers[tier],
          }),
          `${tier} ${anim} ${animStep}`,
        );
      }
});

test("an ogre draws its own figure in its twin's colours on its feet, burns and steams once enraged, casts a bigger shadow, cracks the floor and is cut to the screen", () => {
  const ogre = (x: number, more: Partial<EnemyView> = {}) =>
    draw(
      world({
        enemies: [
          enemy(2, x, 150, { kind: "ogre", tier: 1, boss: true, ...more }),
        ],
      }),
      7,
    );
  const windup = { anim: "windup", animStep: 30 } as const;
  const { sprites, shadows, pen } = ogre(160, windup);
  assert.equal(sprites.length, 1);
  const [b] = sprites;
  assert.equal(enemyFrame("ogre", "windup", 30), "windup");
  const pose = OGRE.sprite("windup");
  const options = { flash: false, flip: false };
  assert.deepEqual(
    b!.image.fills,
    fillsOf(pose, { swap: OGRE_TIERS[1], ...options }),
  );
  // Drawn at its own size, its feet on its floor position.
  assert.deepEqual([b!.dw, b!.dh], [b!.sw, b!.sh]);
  assert.deepEqual([b!.dx + pose.ax, b!.dy + pose.ay], [160, 150]);
  assert.equal(shadows[0]!.image.w, 2 * Math.round(SHADOW_RX * 1.5) + 1);
  // Enraged, the same frame in the rage palette, steam rising from its crown over it; fallen, no steam.
  const rage = ogre(160, { ...windup, enraged: true });
  assert.deepEqual(
    rage.sprites[0]!.image.fills,
    fillsOf(pose, { swap: OGRE_RAGE[1], ...options }),
  );
  const calm = new Set(pen.fills.map((f) => JSON.stringify(f)));
  const steam = rage.pen.fills.filter((f) => !calm.has(JSON.stringify(f)));
  assert.ok(steam.length > 0, "it steams");
  const [cx, cy] = OGRE_CROWNS.windup;
  for (const f of steam) {
    assert.ok(Math.abs(f.x - (160 + cx)) <= 8, `${f.x} far from the crown`);
    assert.ok(f.y <= 150 + cy && f.y > 130 + cy, `${f.y} off the crown`);
  }
  const dead = { anim: "dead", animStep: 1 } as const;
  assert.equal(
    ogre(160, { ...dead, enraged: true }).pen.fills.length,
    ogre(160, dead).pen.fills.length,
  );
  // Its shockwave cracks the floor and breaks it into shards while it runs, not as the hammer lands, the shards
  // crumbling on after the wave's end until the hammer rises.
  const fills = (more: Partial<EnemyView>) => ogre(160, more).pen.fills.length;
  const landed = fills({ anim: "slam", animStep: 0 });
  assert.ok(fills({ anim: "slam", animStep: 5 }) > landed);
  assert.ok(fills({ anim: "slam", animStep: QUAKE.steps + 1 }) > landed);
  assert.ok(fills({ anim: "slam", animStep: OGRE_STEPS.slam - 1 }) > landed);
  assert.equal(fills({ anim: "slam", animStep: OGRE_STEPS.slam }), landed);
  // At the screen's edge only what is on screen is drawn.
  const [edge] = ogre(4, { anim: "idle" }).sprites;
  assert.ok(edge!.dx === 0 && edge!.sx > 0 && edge!.dx + edge!.dw <= VIEW_W);
  assert.equal(edge!.sw, edge!.dw);
  // A ravager's rage, which nothing gives it, changes nothing.
  const ravager = (enraged: boolean) =>
    draw(world({ enemies: [enemy(2, 160, 150, { enraged })] })).pen.fills;
  assert.equal(ravager(true).length, ravager(false).length);
});

test("an enraged ogre's steam is drawn with it by depth: a hero in front of it hides the puffs, one behind it does not", () => {
  /** Every fill and blit of a frame in the order they were drawn. */
  class OrderedPen extends RecordingPen {
    readonly order: (Fill | Blit)[] = [];
    override fillRect(x: number, y: number, w: number, h: number) {
      super.fillRect(x, y, w, h);
      this.order.push(this.fills.at(-1)!);
    }
    override drawImage(image: FakeImage, ...r: number[]) {
      super.drawImage(image, ...r);
      this.order.push(this.blits.at(-1)!);
    }
  }
  const frame = (enraged: boolean, heroY: number) => {
    const pen = new OrderedPen();
    shared.scene.draw(
      pen,
      world({
        heroes: [hero(1, 0, 160, heroY)],
        enemies: [enemy(2, 160, 150, { kind: "ogre", boss: true, enraged })],
      }),
      7,
    );
    return pen.order;
  };
  const key = (f: Fill) => JSON.stringify(f);
  const [heroSize, ogreSize] = [BRAKKA.sprite("idle0"), OGRE.sprite("idle")];
  assert.notEqual(heroSize.w, ogreSize.w);
  const sized = (sprite: Sprite) => (b: Fill | Blit) =>
    "image" in b && b.image.w === sprite.w && b.image.h === sprite.h;
  for (const [heroY, hides] of [
    [160, true],
    [140, false],
  ] as const) {
    const calm = new Set(
      frame(false, heroY)
        .filter((c) => "style" in c)
        .map(key),
    );
    const order = frame(true, heroY);
    // The puffs are the fills the calm frame lacks.
    const steam = order.flatMap((c, i) =>
      "style" in c && !calm.has(key(c)) ? [i] : [],
    );
    const mine = order.findIndex(sized(heroSize));
    const ogre = order.findIndex(sized(ogreSize));
    assert.ok(steam.length > 0 && mine >= 0 && ogre >= 0);
    // The steam follows the ogre it blows off, and the hero in front of it is drawn over the steam.
    assert.ok(steam.every((i) => i > ogre));
    assert.equal(
      steam.every((i) => i < mine),
      hides,
      `hero at ${heroY}`,
    );
    assert.equal(
      steam.every((i) => i > mine),
      !hides,
      `hero at ${heroY}`,
    );
  }
});

test("a sack imp draws its own frames, a kind from a newer build draws as a ravager, and pots lie among the figures and blink before they vanish", () => {
  // Every anim the imp has, a few steps in, draws the frame `enemyFrame` picks from the imp's art, on its feet.
  const anims = ["walk", "flee", "stumble", "knockdown", "down", "getup"];
  for (const animStep of [0, IMP_WALK_STEPS, 13]) {
    const imps = anims.map((anim, i) =>
      enemy(i + 2, 30 + i * 40, 140, {
        kind: "imp",
        anim: anim as EnemyView["anim"],
        animStep,
      }),
    );
    const drawn = draw(world({ enemies: imps })).sprites;
    assert.equal(drawn.length, imps.length);
    imps.forEach(({ x, y, anim }, i) => {
      const sprite = FIGURES.imp!.sprite(enemyFrame("imp", anim, animStep));
      const { image, dx, dy } = drawn[i]!;
      assert.deepEqual(image.fills, fillsOf(sprite), `${anim} ${animStep}`);
      assert.deepEqual([dx, dy], [x - sprite.ax, y - sprite.ay]);
    });
  }
  const scurry = (animStep: number) =>
    draw(
      world({
        enemies: [enemy(2, 100, 140, { kind: "imp", anim: "walk", animStep })],
      }),
    ).sprites[0]!.image;
  assert.notDeepEqual(scurry(0).fills, scurry(IMP_WALK_STEPS).fills);
  // A kind from a build with more of them, or one that names a property every object has, stands as a ravager,
  // mirrored about its feet when it faces left.
  const ravager = RAVAGER.sprite("idle");
  for (const odd of ['"wizard"', '"constructor"', '"__proto__"']) {
    const kind = JSON.parse(odd) as EnemyView["kind"];
    const [unknown] = draw(
      world({ enemies: [enemy(2, 160, 140, { kind, facing: -1 })] }),
    ).sprites;
    assert.deepEqual(unknown!.image.fills, fillsOf(ravager, { flip: true }));
    assert.equal(unknown!.dx, 160 - (ravager.w - 1 - ravager.ax));
  }
  // A pot lies by the imp's feet with a small shadow, in depth order: in front of an imp further up the floor.
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
  const walk = IMP.sprite("walk1");
  assert.deepEqual(
    sprites.map((b) => [b.image.fills, b.dx, b.dy]),
    [
      [fillsOf(walk), 100 - walk.ax, 140 - walk.ay],
      [fillsOf(POT), 100 - POT.ax, 150 - 4 - POT.ay],
    ],
  );
  assert.equal(shadows[1]!.image.w, 2 * ITEM_SHADE + 1);
  const blinking = world({ items: [{ ...pot, blink: true }] });
  assert.equal(draw(blinking, 0).sprites.length, 1);
  assert.equal(draw(blinking, BLINK_FRAMES).sprites.length, 0);
  assert.equal(draw(blinking, BLINK_FRAMES).shadows.length, 1);
  // Camp's meat is a drumstick; an item of a kind from a newer build lies as a pot.
  const [meat] = draw(world({ items: [{ ...pot, kind: "meat" }] })).sprites;
  assert.deepEqual(
    [meat!.image.fills, meat!.dx, meat!.dy],
    [fillsOf(MEAT), 100 - MEAT.ax, 150 - 4 - MEAT.ay],
  );
  for (const odd of ['"bread"', '"constructor"']) {
    const kind = JSON.parse(odd) as ItemView["kind"];
    const [item] = draw(world({ items: [{ ...pot, kind }] })).sprites;
    assert.deepEqual(item!.image.fills, fillsOf(POT));
  }
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

test("a rider's marker hangs the same gap over its seated head as a standing hero's over its own, whichever hero it is", () => {
  const beast: MountView = {
    ...{ id: 9, kind: "clawbeak", x: 150, y: 140, z: 0, facing: 1 },
    ...{ anim: "idle", animStep: 0, rider: { kind: "hero", id: 1 } },
  };
  const seated = { anim: "ride", mounted: true, z: CLAWBEAK.saddle } as const;
  for (const kind of HERO_KINDS) {
    const walking = draw(world({ heroes: [hero(1, 0, 150, 140, { kind })] }));
    const riding = draw(
      world({
        heroes: [hero(1, 0, 150, 140, { kind, ...seated })],
        mounts: [beast],
      }),
    );
    // The beast first, its rider after it (the marker is the one chevron over it).
    for (const [drawn, who] of [
      [walking, walking.sprites[0]!],
      [riding, riding.sprites[1]!],
    ] as const) {
      assert.equal(drawn.markers.length, 1, kind);
      const [marker] = drawn.markers;
      assert.equal(marker!.dy + marker!.dh, who.dy - MARKER_GAP, kind);
    }
  }
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

test("Wyrmbone Pass draws its own backdrop at the camera as it is, a stage without art Stage 1's, and no stage throws", () => {
  const layers = (view: WorldView) =>
    draw(view).pen.blits.filter((b) => b.image.w >= VIEW_W);
  for (const stage of [2, 3, 4, 5, 0, -1, 1.5, Number.NaN])
    assert.doesNotThrow(() => draw(world({ stage, camX: 100 })), `${stage}`);
  // Its road is the stage's whole length, scrolled with the floor out to the skull gate.
  const end = cameraEndPx(2);
  const road = (camX: number) =>
    layers(world({ stage: 2, camX })).find(
      (b) => b.image.w === stageLengthPx(2),
    );
  assert.equal(road(0)?.sx, 0);
  assert.equal(road(end)?.sx, end);
  assert.notDeepEqual(layers(world({ stage: 2 })), layers(world({ stage: 1 })));
  assert.deepEqual(scenery(2, 700), { art: 2, camX: 700 });
  assert.deepEqual(scenery(1, 500), { art: 1, camX: 500 });
  assert.deepEqual(scenery(5, 500), { art: 1, camX: 500 }, "an unknown one");
  assert.deepEqual(layers(world({ stage: 5 })), layers(world({ stage: 1 })));
});

test("Stage 4 draws Vorhal's Keep at the camera as it is, out to the throne room, not Stage 1's village", () => {
  const layers = (stage: number, camX = 0) =>
    draw(world({ stage, camX })).pen.blits.filter((b) => b.image.w >= VIEW_W);
  const road = (camX: number) =>
    layers(4, camX).find((b) => b.image.w === stageLengthPx(4));
  assert.equal(road(0)?.sx, 0);
  assert.equal(road(KEEP_END)?.sx, KEEP_END);
  const images = (stage: number) => layers(stage).map((b) => b.image);
  for (const other of [1, 2, 3]) {
    const theirs = new Set(images(other));
    assert.ok(
      images(4).every((image) => !theirs.has(image)),
      `${other}`,
    );
  }
  assert.deepEqual(scenery(4, KEEP_END), { art: 4, camX: KEEP_END });
});

test("Stage 3 draws the Drowned Crypt at the camera as it is, out to its great doors", () => {
  const layers = (stage: number, camX = 0) =>
    draw(world({ stage, camX })).pen.blits.filter((b) => b.image.w >= VIEW_W);
  const road = (camX: number) =>
    layers(3, camX).find((b) => b.image.w === CRYPT_LENGTH);
  assert.equal(road(0)?.sx, 0);
  assert.equal(road(CRYPT_END)?.sx, CRYPT_END);
  const images = (stage: number) => layers(stage).map((b) => b.image);
  for (const other of [1, 2]) {
    const theirs = new Set(images(other));
    assert.ok(
      images(3).every((image) => !theirs.has(image)),
      `${other}`,
    );
  }
  assert.deepEqual(scenery(3, 700), { art: 3, camX: 700 });
});

test("every stage's backdrop is baked with the scene, so no frame stalls baking one as its stage begins", () => {
  const { images, scene } = fakeScene();
  const wide = () => images.filter((image) => image.w >= VIEW_W).length;
  const baked = wide();
  for (const length of [stageLengthPx(1), stageLengthPx(2), CRYPT_LENGTH])
    assert.ok(
      images.some((image) => image.w === length),
      `a ${length} px road`,
    );
  for (const stage of [1, 2, 3, 4, 3, 2, 1, Number.NaN])
    draw(world({ stage, camX: 100 }), 0, scene);
  assert.equal(wide(), baked, "drawing a stage baked a layer");
});

test("camp draws its own night clearing, baked with the scene, and a stage its own backdrop", () => {
  const { images, scene } = fakeScene();
  const wide = () => images.filter((image) => image.w >= VIEW_W).length;
  const baked = wide();
  const camp = (frame: number, more: Partial<WorldView> = {}) =>
    draw(world({ camp: true, ...more }), frame, scene).pen;
  const layers = (pen: RecordingPen) =>
    pen.blits.filter((b) => b.image.w >= VIEW_W).map((b) => [b.image.id, b.sx]);
  const stage = (stage: number) =>
    layers(draw(world({ stage, camX: 90 }), 0, scene).pen);
  // Whatever stage it follows and wherever the view says the camera is, camp is one screen at rest.
  const clearing = layers(camp(0));
  for (const more of [{ stage: 2, camX: 90 }, { stage: 3 }, { camX: NaN }])
    assert.deepEqual(layers(camp(0, more)), clearing, JSON.stringify(more));
  assert.ok(clearing.every(([, sx]) => sx === 0));
  // A stage draws its own backdrop at its camera, none of it camp's, and camp none of a stage's.
  for (const each of [stage(1), stage(2), stage(3)]) {
    assert.ok(
      each.some(([, sx]) => sx !== 0),
      "a stage scrolls",
    );
    const ids = new Set(each.map(([id]) => id));
    assert.ok(clearing.every(([id]) => !ids.has(id)));
  }
  assert.notDeepEqual(stage(1), stage(2));
  for (const frame of [-5, Number.NaN, Infinity, 1e9])
    assert.doesNotThrow(() => camp(frame), `frame ${frame}`);
  // The flames and their light flicker frame to frame, each fill a whole pixel's rectangle on screen.
  const fills = (frame: number) => camp(frame).fills;
  assert.notDeepEqual(fills(0), fills(7));
  for (const frame of [0, 7, 1e9])
    for (const f of fills(frame))
      assert.ok(
        f.x >= 0 && f.x + f.w <= VIEW_W && f.y >= 0 && f.y + f.h <= VIEW_H,
        `frame ${frame}: ${JSON.stringify(f)}`,
      );
  assert.equal(wide(), baked, "drawing camp baked no layer");
});

test("camp's fire stands among the figures: in front of one behind it, behind one in front", () => {
  const flame = new Set<string>(FLAME);
  const order = (...heroes: HeroView[]) => {
    const { pen, sprites } = draw(world({ camp: true, heroes }), 12);
    const fire = pen.calls.findIndex(
      (c) => "style" in c && flame.has(c.style) && c.y + c.h <= FIRE.y,
    );
    assert.ok(fire >= 0, "the fire is drawn");
    return sprites.map((s) => pen.calls.indexOf(s) < fire);
  };
  const [behind, before] = [FIRE.y - 6, FIRE.y + 18];
  assert.deepEqual(
    order(hero(1, 0, FIRE.x, behind), hero(2, 1, FIRE.x + 4, before)),
    [true, false],
  );
  assert.deepEqual(order(hero(1, 0, FIRE.x, behind)), [true], "the last");
  assert.deepEqual(order(hero(1, 0, FIRE.x, before)), [false], "the first");
  assert.deepEqual(order(), [], "with nobody there");
  // A figure on the fire's own row is drawn before it, as one further up the floor would be.
  assert.deepEqual(order(hero(1, 0, FIRE.x - 30, FIRE.y)), [true]);
});

test("an ember drake draws from its own art, blinking as it inhales; its flame is one jet from its jaws to the front, drawn at its depth", () => {
  const drake = (more: Partial<MountView> = {}): MountView => ({
    ...{ id: 9, kind: "drake", x: 150, y: 140, z: 0, facing: 1 },
    ...{ anim: "breathe", animStep: 0, rider: null, ...more },
  });
  const look = (more: Partial<MountView>) =>
    draw(world({ mounts: [drake(more)] })).sprites[0]!.image.fills;
  const art = (frame: DrakeFrame, flash: boolean) =>
    fillsOf(DRAKE_FIGURE.sprite(frame), { flash, flip: false });
  assert.deepEqual(look({}), art("inhale1", true));
  assert.deepEqual(look({ animStep: TELEGRAPH }), art("inhale1", false));
  assert.deepEqual(look({ animStep: DRAKE_STEPS.inhale }), art("blast0", false)); // prettier-ignore
  // The jet (`drake-fx.ts`) is drawn once the flame is out, nothing while it inhales; at the drake's depth, over a
  // hero further up the floor in its lane, under one in front of it.
  const jets = (animStep: number) =>
    draw(world({ mounts: [drake({ animStep })] })).sprites.length - 1;
  assert.deepEqual([jets(DRAKE_STEPS.inhale - 1), jets(DRAKE_STEPS.inhale + 20)], [0, 1]); // prettier-ignore
  const flaming = drake({ animStep: DRAKE_STEPS.inhale + 20 });
  const [behind, before] = [hero(1, 0, 200, 136), hero(2, 1, 210, 144)];
  const { sprites } = draw(world({ heroes: [behind, before], mounts: [flaming] })); // prettier-ignore
  // In order: the hero behind, the drake, its jet, the hero in front.
  assert.equal(sprites.length, 4);
  assert.deepEqual(sprites[0]!.image.fills, fillsOf(BRAKKA.sprite("idle0"), {})); // prettier-ignore
  assert.deepEqual(sprites[1]!.image.fills, look(flaming));
  assert.notDeepEqual(sprites[3]!.image.fills, sprites[2]!.image.fills);
  assert.equal(sprites[3]!.dy + BRAKKA.sprite("idle0").ay, 144);
  // Any step of any anim, odd ones too, draws the drake and never throws.
  for (const anim of MOUNT_STATES)
    for (const step of [0, 40, 79, 1e9, -3, 2.5, Number.NaN, Infinity])
      assert.ok(draw(world({ mounts: [drake({ anim, animStep: step })] })).sprites.length >= 1); // prettier-ignore
});

test("the captain draws from his own art in his own colours, and in the saddle does what his drake's anim says: sits, or draws back and thrusts", () => {
  const boss = enemy(3, 150, 140, { kind: "captain", tier: 2, boss: true });
  const captain = (frame: CaptainFrame) =>
    fillsOf(CAPTAIN.sprite(frame), { flash: false, flip: false });
  // On foot: his own figure whatever his palette, staggering in his own frame.
  for (const tier of [0, 1, 2] as const)
    assert.deepEqual(draw(world({ enemies: [{ ...boss, tier }] })).sprites[0]!.image.fills, captain("idle")); // prettier-ignore
  assert.deepEqual(draw(world({ enemies: [{ ...boss, anim: "stagger" }] })).sprites[0]!.image.fills, captain("stagger")); // prettier-ignore
  // On his drake: the frame his beast's anim and step say, on its saddle as it dips, over it.
  const ridden = (
    anim: MountAnim,
    animStep: number,
    kind: EnemyKind = "captain",
  ) =>
    // prettier-ignore
    draw(
      world({
        enemies: [{ ...boss, kind, anim: "ride", animStep: 90, mounted: true, z: CLAWBEAK.saddle }], // prettier-ignore
        mounts: [{ id: 9, kind: "drake", x: 150, y: 140, z: 0, facing: 1, anim, animStep, rider: { kind: "enemy", id: 3 } }], // prettier-ignore
      }),
    ).sprites;
  const { lanceWindup, lance } = DRAKE_STEPS;
  for (const [anim, animStep, frame, under] of [
    ["walk", 0, "ride", "walk0"],
    ["breathe", 30, "ride", mountFrame("drake", "breathe", 30)],
    ["lance", 0, "ridewindup", "crouch"],
    ["lance", lanceWindup - 1, "ridewindup", "crouch"],
    ["lance", lanceWindup, "ridethrust", "brace"],
    ["lance", lance - 1, "ridethrust", "brace"],
  ] as const) {
    // The drake first (its flame after it, if it breathes one), then its rider over it.
    const rider = ridden(anim, animStep).at(-1)!;
    assert.deepEqual(rider.image.fills, captain(frame), `${anim} ${animStep}`);
    const seat = CAPTAIN.sprite(frame).ay;
    assert.equal(rider.dy + seat, 140 - CLAWBEAK.saddle + DRAKE_DIPS[under as DrakeFrame], `${anim} ${animStep}`); // prettier-ignore
  }
  assert.deepEqual([0, 1, 2].map((tier) => ENEMY_ART.captain.tiers[tier as 0]), [undefined, undefined, undefined]); // prettier-ignore
  // Another rider of the drake's lance (none the rules make) sits; any anim at any step draws, never throwing.
  const sat = ridden("lance", lance - 1, "ravager").at(-1)!;
  assert.deepEqual(sat.image.fills, fillsOf(RAVAGER.sprite("ride"), { swap: RAVAGER_TIERS.violet, flash: false, flip: false })); // prettier-ignore
  for (const anim of MOUNT_STATES)
    for (const animStep of [0, 23, 24, 1e9, -3, 2.5, Number.NaN, Infinity])
      assert.ok(ridden(anim, animStep).length >= 2, `${anim} ${animStep}`);
});

test("Vorhal draws as a horned dark ogre in every anim, his sigils glow on the floor and their pillars burn over the figures, and nothing throws", () => {
  const vorhal = (more: Partial<EnemyView> = {}) =>
    enemy(3, 200, 150, { kind: "vorhal", boss: true, ...more });
  const horns = (view: WorldView) =>
    draw(view).pen.fills.filter((f) => f.style === MASTER.B).length;
  for (const anim of ENEMY_STATES)
    for (const animStep of [0, 30, 1e9, -3, 2.5, Number.NaN])
      assert.doesNotThrow(
        () => draw(world({ enemies: [vorhal({ anim, animStep })] })),
        `${anim} ${animStep}`,
      );
  // His figure is the ogre's in his own palette, with horns; enraged, crimson.
  assert.deepEqual(
    draw(world({ enemies: [vorhal()] })).sprites[0]!.image.fills,
    fillsOf(OGRE.sprite(enemyFrame("vorhal", "idle", 0) as OgreFrame), {
      swap: ENEMY_ART.vorhal.tiers[0],
      flash: false,
      flip: false,
    }),
  );
  assert.ok(horns(world({ enemies: [vorhal()] })) >= 4);
  assert.equal(horns(world({ enemies: [vorhal({ kind: "ogre" })] })), 0);
  assert.notDeepEqual(ENEMY_ART.vorhal.rage!.tiers[0], ENEMY_ART.vorhal.tiers[0]); // prettier-ignore
  // A sigil glows until its pillar erupts, which burns white-hot for its steps, then nothing is left.
  const fire = (age: number, colour: string, frame = 0) =>
    draw(world({ sigils: [{ x: 160, y: 140, age }] }), frame).pen.fills.filter(
      (f) => f.style === colour,
    );
  const none = (colour: string, frame = 0) =>
    draw(world({}), frame).pen.fills.filter((f) => f.style === colour).length;
  assert.ok(fire(0, UNLIT["~"]!).length > none(UNLIT["~"]!), "its ring");
  assert.ok(fire(SIGIL.delay - 1, UNLIT.f!).length > none(UNLIT.f!));
  assert.equal(fire(SIGIL.delay - 1, UNLIT.f!, 4).length, none(UNLIT.f!, 4), "blinking"); // prettier-ignore
  const pillar = fire(SIGIL.delay + 10, UNLIT.F!);
  assert.ok(pillar.some((f) => f.h >= 40 && f.y + f.h >= 140), "up from the floor"); // prettier-ignore
  assert.equal(fire(SIGIL.delay + SIGIL.burn, UNLIT.F!).length, none(UNLIT.F!));
  for (const age of [-3, 1.5, Number.NaN, 1e9])
    assert.doesNotThrow(() => fire(age, UNLIT.F!));
  assert.doesNotThrow(() =>
    draw(world({ sigils: [{ x: Number.NaN, y: -50, age: 60 }] })),
  );
});
