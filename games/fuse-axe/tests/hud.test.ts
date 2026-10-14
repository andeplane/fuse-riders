import test from "node:test";
import assert from "node:assert/strict";
import type { EnemyKind, HeroView, WorldView } from "../src/engine/view.js";
import { CAPACITY, VIEW_H, VIEW_W } from "../src/engine/view-kit.js";
import { HEROES } from "../src/render/art/index.js";
import {
  ADVANCE,
  createLettering,
  fontText,
  GLYPH_H,
  MAX_LABELS,
  paintText,
  textWidth,
} from "../src/render/font.js";
import {
  BAR,
  BLINK_FRAMES,
  BOSS_BAR,
  createHud,
  CHARGE_BLINK,
  CHARGED,
  drawPots,
  FRAME,
  HEALTH,
  HUD_COLORS as C,
  HUD_H,
  JOIN_FRAMES,
  NAME,
  PANEL_W,
  POTS,
  SEGMENT,
  TRAIL_DRAIN,
  TRAIL_HOLD,
  barWidth,
  type HudSeats,
  type Looks,
} from "../src/render/hud.js";
import type { Pen } from "../src/render/pen.js";
import { createSpriteBaker, paintSprite } from "../src/render/pixel/surface.js";
import { swapPalette, type Sprite } from "../src/render/pixel/sprite.js";
import { createScene, heroLooks } from "../src/render/scene.js";
import { SEAT_COLORS } from "../src/render/seat-colors.js";
import type { MakeSurface, PixelPaint } from "../src/render/surface.js";

interface Fill {
  style: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
interface FakeImage {
  readonly w: number;
  readonly h: number;
  readonly fills: Fill[];
}
class FakePaint implements PixelPaint {
  fillStyle: string | CanvasGradient | CanvasPattern = "";
  constructor(readonly fills: Fill[] = []) {}
  fillRect(x: number, y: number, w: number, h: number) {
    this.fills.push({ style: String(this.fillStyle), x, y, w, h });
  }
}
/** Enough of a 2D context for the HUD, recording every call. */
class RecordingPen extends FakePaint implements Pen<FakeImage> {
  readonly blits: { image: FakeImage; w: number; h: number; x: number; y: number }[] = []; // prettier-ignore
  drawImage(image: FakeImage, ...r: number[]) {
    const [, , w = 0, h = 0, x = 0, y = 0] = r;
    this.blits.push({ image, w, h, x, y });
  }
}
/** Surfaces that record what is painted into them, and every one made. */
function fakeMake() {
  const images: FakeImage[] = [];
  const make: MakeSurface<FakeImage> = (w, h) => {
    const image = { w, h, fills: [] };
    images.push(image);
    return { image, paint: new FakePaint(image.fills), putPixels: () => {} };
  };
  return { images, make };
}
function fakeHud() {
  const { images, make } = fakeMake();
  const hud = createHud(make, createSpriteBaker(make));
  /** One frame of the HUD alone, every hero in its own colours unless `looks` says otherwise. */
  const draw = (
    view: WorldView,
    frame = 0,
    seats?: HudSeats,
    looks: Looks = new Map(),
  ) => {
    const pen = new RecordingPen();
    hud.draw(pen, view, frame, looks, seats);
    return pen;
  };
  return { images, draw };
}

const hero = (
  id: number,
  seat: number,
  more: Partial<HeroView> = {},
): HeroView => ({
  ...{ id, seat, kind: "brakka", x: 100, y: 140, z: 0, facing: 1 },
  ...{ anim: "idle", animStep: 0, hp: 60, maxHp: 60, lives: 3 },
  ...{ invulnerable: false, pots: 0, maxPots: 4, charge: 0, mounted: false },
  ...more,
});
const out = (id: number, seat: number) =>
  hero(id, seat, { anim: "out", lives: 0, hp: 0 });
const world = (heroes: HeroView[]): WorldView => ({
  ...{ step: 0, camX: 0, heroes, enemies: [], fx: [], items: [], spells: [] },
  mounts: [],
  ...{ stage: 1, wave: 0, waves: 5, locked: false, go: false, cleared: false },
  camp: false,
  ...{ defeated: false, boss: null, sigils: [] },
});

/** The blits of `text` written in `color`, known by what the font paints for it. */
const labels = (pen: RecordingPen, text: string, color: string) => {
  const paint = new FakePaint();
  paintText(paint, text, 0, 0, color);
  const fills = JSON.stringify(paint.fills);
  return pen.blits.filter(
    (b) => b.image.h === GLYPH_H && JSON.stringify(b.image.fills) === fills,
  );
};
const wrote = (pen: RecordingPen, text: string, color: string) =>
  labels(pen, text, color).length;
/** What a sprite paints, to know a portrait by. */
const painted = (sprite: Sprite) => {
  const paint = new FakePaint();
  paintSprite(paint, sprite);
  return paint.fills;
};
const portraits = (pen: RecordingPen) =>
  pen.blits.filter((b) => b.image.w === 16 && b.image.h === 16);
const fillsAt = (pen: RecordingPen, x: number, y: number, style: string) =>
  pen.fills.filter((f) => f.x === x && f.y === y && f.style === style).length;
/** The pixels of the bar in seat `seat`'s panel lit in `style`. */
const barLit = (pen: RecordingPen, seat: number, style: string) =>
  pen.fills
    .filter(
      (f) =>
        f.style === style &&
        f.y === BAR.y &&
        f.h === BAR.h &&
        f.x >= seat * PANEL_W + BAR.x &&
        f.x < seat * PANEL_W + BAR.x + BAR.w,
    )
    .reduce((w, f) => w + f.w, 0);

test("a panel a seat: a hero's portrait framed in its seat's colour, an empty seat's tag, a blinking JOIN or a player for the next run", () => {
  const { draw } = fakeHud();
  assert.equal(PANEL_W * CAPACITY, VIEW_W);
  const view = world([hero(1, 0), hero(2, 2, { kind: "rhea", maxHp: 48 })]);
  const pen = draw(view, 0);
  for (let seat = 0; seat < CAPACITY; seat++) {
    const color = seat === 0 || seat === 2 ? SEAT_COLORS[seat]! : C.empty;
    assert.equal(fillsAt(pen, seat * PANEL_W + FRAME.x, FRAME.y, color), 1);
    assert.equal(wrote(pen, `P${seat + 1}`, color), 1, "a nameless seat's tag");
  }
  assert.deepEqual(
    portraits(pen).map((b) => [b.x, b.y]),
    [
      [FRAME.x + 1, FRAME.y + 1],
      [2 * PANEL_W + FRAME.x + 1, FRAME.y + 1],
    ],
  );
  assert.equal(wrote(pen, "JOIN", C.dim), 3);
  assert.equal(wrote(draw(view, JOIN_FRAMES), "JOIN", C.dim), 0);
  assert.equal(wrote(draw(view, 2 * JOIN_FRAMES), "JOIN", C.dim), 3);
  // A player seated mid-run waits on an empty seat for the next run.
  const late = draw(view, 0, { names: [null, "Bo", null, null, null] });
  assert.equal(wrote(late, "BO", C.dim), 1);
  assert.equal(wrote(late, "NEXT RUN", C.empty), 1);
  assert.equal(wrote(late, "JOIN", C.dim), 2);
  // A player whose name the font cannot write still holds the seat: its tag stands for it, and no JOIN invites another.
  const emoji = draw(view, 0, { names: [null, "😀🔥", null, null, null] });
  assert.equal(wrote(emoji, "P2", C.dim), 1);
  assert.equal(wrote(emoji, "NEXT RUN", C.empty), 1);
  assert.equal(wrote(emoji, "JOIN", C.dim), 2);
  // Where nobody can join (a solo game) an empty seat shows its tag and never JOIN.
  assert.equal(wrote(draw(view, 0, { names: [], open: false }), "JOIN", C.dim), 0); // prettier-ignore
  assert.equal(
    wrote(draw(view, 0, { names: [], open: true }), "JOIN", C.dim),
    3,
  );
});

test("names in the font's capitals, unknown characters dropped and cut to fit before the lives, ×N at the right", () => {
  assert.equal(fontText("Åse Øyvind", 18), "ASE OYVIND");
  assert.equal(fontText("  ninja🗡️  of\tthe  dusk ", 18), "NINJA OF THE DUSK");
  assert.equal(fontText("Bo-7!", 8), "BO-7!");
  assert.equal(fontText("Æsir", 8), "AESIR");
  assert.equal(fontText("abc defgh", 4), "ABC", "no space left at the end");
  assert.equal(fontText("😀😀", 8), "");
  assert.equal(fontText("Łukasz Đorđe Þór", 30), "LUKASZ DORDE THOR");
  assert.equal(
    fontText("Ｂｏｂ 𝓒𝔂", 8),
    "BOB CY",
    "styled letters are plain ones",
  );
  assert.equal(
    fontText("Дмитрий", 8),
    "",
    "a script the font lacks is no name",
  );
  assert.equal(
    fontText("ﬃ ㎏ ™", 20),
    "FFI KG TM",
    "ligatures and units are spelled",
  );
  assert.equal(fontText("A​B‮C\u0000D", 8), "ABCD", "invisible and control characters are dropped"); // prettier-ignore
  assert.equal(textWidth(""), 0);
  assert.equal(textWidth("AB"), 2 * ADVANCE - 1);

  const { draw } = fakeHud();
  const names = ["Ada Lovelace-Byron", "😀", null, "Wes", null];
  const view = world([hero(1, 0), hero(2, 1, { lives: 1 }), hero(3, 3)]);
  const pen = draw(view, 0, { names });
  assert.equal(wrote(pen, "ADA LOVE", SEAT_COLORS[0]!), 1);
  assert.equal(wrote(pen, "P2", SEAT_COLORS[1]!), 1, "nothing left: the tag");
  assert.equal(wrote(pen, "WES", SEAT_COLORS[3]!), 1);
  const [three] = labels(pen, "×3", C.text);
  const [one] = labels(pen, "×1", C.text);
  assert.deepEqual([three!.x + three!.w, three!.y], [PANEL_W - 1, NAME.y]);
  assert.equal(one!.x + one!.w, 2 * PANEL_W - 1);
  // Two digits of lives leave a long name a glyph fewer.
  const long = draw(world([hero(1, 0, { lives: 12 })]), 0, { names });
  assert.equal(wrote(long, "ADA LOV", SEAT_COLORS[0]!), 1);
  assert.equal(wrote(long, "×12", C.text), 1);
});

test("the health bar is as long as the health left, coloured by how much, and notched into segments", () => {
  assert.equal(barWidth(60, 60), BAR.w);
  assert.equal(barWidth(30, 60), Math.round(BAR.w / 2));
  assert.equal(barWidth(1, 72), 1, "a sliver while any is left");
  assert.equal(barWidth(0, 60), 0);
  assert.equal(barWidth(90, 60), BAR.w);
  assert.equal(barWidth(10, 0), 0);
  const { draw } = fakeHud();
  const pen = draw(
    world([
      hero(1, 0),
      hero(2, 1, { hp: 24 }),
      hero(3, 2, { hp: 12 }),
      hero(4, 3, { hp: 0, anim: "dead", lives: 2 }),
    ]),
  );
  const tones = [HEALTH.high, HEALTH.low, HEALTH.critical, HEALTH.high];
  assert.deepEqual(
    tones.map((tone, seat) => barLit(pen, seat, tone.color)),
    [BAR.w, barWidth(24, 60), barWidth(12, 60), 0],
  );
  const notches = pen.fills.filter(
    (f) => f.style === C.ink && f.y === BAR.y && f.w === 1 && f.x < PANEL_W,
  );
  assert.equal(notches.length, Math.ceil(BAR.w / SEGMENT) - 1);
});

test("a hit leaves a white trail on the bar that holds a moment, then drains to the health left", () => {
  const { draw } = fakeHud();
  const at = (hp: number, frame: number) =>
    barLit(draw(world([hero(1, 0, { hp })]), frame), 0, C.trail);
  assert.equal(at(60, 0), 0);
  const lost = BAR.w - barWidth(30, 60);
  assert.equal(at(30, 1), lost, "the lost part shows white");
  assert.equal(at(30, TRAIL_HOLD), lost, "and holds");
  const draining = [4, 8, 12].map((n) => at(30, TRAIL_HOLD + n));
  assert.deepEqual(
    [...draining].sort((a, b) => b - a),
    draining,
  );
  assert.ok(draining[2]! < draining[0]! && draining[0]! < lost, `${draining}`);
  assert.equal(at(30, TRAIL_HOLD + 4 + Math.ceil(lost / TRAIL_DRAIN)), 0);
  // A second hit holds the trail again; a heal takes it away.
  assert.equal(at(18, 200), barWidth(30, 60) - barWidth(18, 60));
  assert.equal(at(18, 205), barWidth(30, 60) - barWidth(18, 60));
  assert.equal(at(60, 206), 0);
  // A hero that leaves and comes back starts without one.
  draw(world([hero(2, 1)]), 300);
  assert.equal(at(30, 301), 0);
});

test("a portrait wears its hero's look on the field; out of lives it is greyed, and it blinks while the hero cannot be hit", () => {
  const two = [hero(1, 0), hero(2, 1)];
  const looks = heroLooks(two);
  const second = looks.get(2)!.swap;
  assert.ok(second, "a second Brakka has a palette of his own");
  const { draw } = fakeHud();
  const portrait = HEROES.brakka.portrait;
  assert.deepEqual(
    portraits(draw(world(two), 0, undefined, looks)).map((b) => b.image.fills),
    [painted(portrait), painted(swapPalette(portrait, second))],
  );

  const grey = draw(world([out(1, 0)]), 0, { names: ["Ada"] });
  for (const { style } of portraits(grey)[0]!.image.fills) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(style.slice(i, i + 2), 16));
    assert.ok(r === g && b! - r! <= 14, style);
  }
  assert.equal(fillsAt(grey, FRAME.x, FRAME.y, C.outFrame), 1);
  assert.equal(wrote(grey, "ADA", C.outText), 1);
  assert.equal(wrote(grey, "×0", C.outText), 1);
  const later = draw(world([out(1, 0)]), BLINK_FRAMES);
  assert.equal(portraits(later).length, 1, "out never blinks");
  // The last life lost, a hero is out from the moment it lands: ×0, no life to drop back in with, so no blink either.
  const last = world([hero(1, 0, { anim: "dead", hp: 0, lives: 0 })]);
  for (const frame of [0, BLINK_FRAMES]) {
    const fallen = draw(last, frame);
    assert.equal(portraits(fallen).length, 1, `frame ${frame}`);
    assert.equal(fillsAt(fallen, FRAME.x, FRAME.y, C.outFrame), 1);
    assert.equal(wrote(fallen, "×0", C.outText), 1);
  }
  // A second Brakka out of lives greys his own colours, so the two stay told apart.
  const both = portraits(draw(world([out(1, 0), out(2, 1)]), 0, undefined, looks)); // prettier-ignore
  assert.notDeepEqual(both[0]!.image.fills, both[1]!.image.fills);

  for (const blinking of [
    hero(1, 0, { invulnerable: true }),
    hero(1, 0, { anim: "dead", hp: 0, lives: 2 }),
    hero(1, 0, { anim: "respawn", lives: 2 }),
  ]) {
    const shown = [0, BLINK_FRAMES, 2 * BLINK_FRAMES].map(
      (frame) => portraits(draw(world([blinking]), frame)).length,
    );
    assert.deepEqual(shown, [1, 0, 1], blinking.anim);
  }
});

test("the scene's HUD shows each hero in the look it wears on the field, and underlines this device's seat", () => {
  const scene = createScene(fakeMake().make);
  const party = [
    hero(1, 0, { kind: "gorm" }),
    hero(2, 1, { kind: "gorm" }),
    hero(3, 2, { kind: "rhea" }),
  ];
  const looks = heroLooks(party);
  const pen = new RecordingPen();
  const names = ["Ada", "Bo", "Cy", null, null];
  scene.draw(pen, world(party), 0, { names, you: 1 });
  assert.deepEqual(
    portraits(pen)
      .filter((b) => b.y === FRAME.y + 1)
      .map((b) => b.image.fills),
    party.map((h) => {
      const swap = looks.get(h.id)!.swap ?? {};
      return painted(swapPalette(HEROES[h.kind].portrait, swap));
    }),
  );
  assert.equal(wrote(pen, "BO", SEAT_COLORS[1]!), 1);
  assert.equal(fillsAt(pen, PANEL_W, HUD_H - 2, SEAT_COLORS[1]!), 1);
  assert.equal(fillsAt(pen, 0, HUD_H - 2, SEAT_COLORS[0]!), 0);
});

test("pots: a row of the most a hero can hold, the held ones full, as each hero's view says", () => {
  const pen = new RecordingPen();
  drawPots(pen, 20, POTS.y, { held: 2, max: 4 });
  const bodies = pen.fills.filter((f) => f.w === 5 && f.h === 4);
  assert.deepEqual(
    bodies.map((f) => [f.x, f.style]),
    [0, 1, 2, 3].map((i) => [20 + i * POTS.step, i < 2 ? C.pot : C.potEmpty]),
  );
  assert.equal(pen.fills.filter((f) => f.style === C.potGlint).length, 2);
  const none = new RecordingPen();
  drawPots(none, 20, POTS.y, { held: 0, max: 0 });
  assert.equal(none.fills.length, 0);
  // The panels draw each hero's own: Rhea holding 5 of 6 in seat 1, Gorm none of 3 in seat 3.
  const panels = fakeHud().draw(
    world([
      hero(1, 1, { kind: "rhea", pots: 5, maxPots: 6 }),
      hero(2, 3, { kind: "gorm", pots: 0, maxPots: 3 }),
    ]),
  );
  const row = (seat: number) =>
    panels.fills
      .filter((f) => f.w === 5 && f.h === 4 && f.y === POTS.y + 1)
      .filter((f) => f.x >= seat * PANEL_W && f.x < (seat + 1) * PANEL_W)
      .map((f) => f.style);
  assert.deepEqual(row(1), [...Array(5).fill(C.pot), C.potEmpty]);
  assert.deepEqual(row(3), Array(3).fill(C.potEmpty));
  assert.deepEqual(row(0), []);
});

test("while a boss's wave is fought, its name and a bar of its health run under the strip", () => {
  const { draw } = fakeHud();
  const name = "OGRE TWINS",
    bx = BOSS_BAR.x + textWidth(name) + BOSS_BAR.gap,
    w = VIEW_W - BOSS_BAR.x - bx;
  const boss = (hp: number, kind: EnemyKind = "ogre") =>
    draw({ ...world([hero(1, 0)]), boss: { kind, hp, maxHp: 300 } });
  const lit = (pen: RecordingPen) =>
    pen.fills.filter((f) => f.style === C.boss).map((f) => [f.x, f.w, f.h]);
  assert.equal(wrote(draw(world([hero(1, 0)])), name, C.text), 0);
  const half = boss(150);
  assert.equal(wrote(half, name, C.text), 1);
  assert.deepEqual(lit(half), [[bx, Math.round(w / 2), BOSS_BAR.h]]);
  assert.deepEqual(
    lit(boss(1)),
    [[bx, 1, BOSS_BAR.h]],
    "never none while any is left",
  );
  assert.deepEqual(lit(boss(0)), []);
  for (const r of [...half.fills, ...half.blits])
    assert.ok(r.x >= 0 && r.x + r.w <= VIEW_W && r.y + r.h <= VIEW_H);
  // A boss of a kind from a newer build is the BOSS.
  const odd = boss(100, JSON.parse('"wyvern"') as EnemyKind);
  assert.equal(wrote(odd, "BOSS", C.text), 1);
});

test("the charge meter: while a hero charges, its pots glow up to the level chosen, the last of them blinking", () => {
  const row = (pen: RecordingPen, seat = 0) =>
    pen.fills
      .filter((f) => f.w === 5 && f.h === 4 && f.y === POTS.y + 1)
      .filter((f) => f.x >= seat * PANEL_W && f.x < (seat + 1) * PANEL_W)
      .map((f) => f.style);
  const { draw } = fakeHud();
  const charging = (charge: number, frame = 0) =>
    row(draw(world([hero(1, 0, { anim: "charge", pots: 3, charge })]), frame));
  assert.deepEqual(charging(0), Array(3).fill(C.pot).concat(C.potEmpty));
  assert.deepEqual(charging(2), [CHARGED.pot, CHARGED.pot, C.pot, C.potEmpty]);
  // The level just reached blinks: every other `CHARGE_BLINK` frames it shows as a pot only held.
  assert.deepEqual(charging(2, CHARGE_BLINK), [
    CHARGED.pot,
    C.pot,
    C.pot,
    C.potEmpty,
  ]);
  assert.deepEqual(charging(3, CHARGE_BLINK * 2), [
    ...Array(3).fill(CHARGED.pot),
    C.potEmpty,
  ]);
  // A charge past the pots held lights only those; one out of lives lights none.
  assert.deepEqual(charging(9), [...Array(3).fill(CHARGED.pot), C.potEmpty]);
  const gone = draw(
    world([hero(1, 0, { anim: "out", lives: 0, pots: 2, charge: 2 })]),
  );
  assert.ok(!row(gone).includes(CHARGED.pot));
  // Each glowing pot keeps its highlight and glint, in white-hot cyan.
  const pen = new RecordingPen();
  drawPots(pen, 20, POTS.y, { held: 4, max: 4, charged: 2 });
  assert.equal(pen.fills.filter((f) => f.style === CHARGED.glint).length, 2);
  assert.equal(pen.fills.filter((f) => f.style === C.potGlint).length, 2);
});

test("the HUD keeps to its strip at the top of the 320 × 180 screen", () => {
  const { draw } = fakeHud();
  const heroes = [0, 1, 2, 3, 4].map((seat) =>
    hero(seat + 1, seat, { hp: 7 * seat, lives: [3, 1, 0, 12, 100][seat]! }),
  );
  const names = ["W".repeat(18), "MMMMMMMM", "Ada", "Ω", "x"];
  for (const frame of [0, 1, 40]) {
    const pen = draw(world(heroes), frame, { names, you: 4 });
    for (const r of [...pen.fills, ...pen.blits])
      assert.ok(
        r.x >= 0 && r.y >= 0 && r.x + r.w <= VIEW_W && r.y + r.h <= HUD_H,
        JSON.stringify({ ...r, image: undefined }),
      );
  }
});

test("portraits and labels are baked once, and only so many are kept", () => {
  const { draw, images } = fakeHud();
  const view = world([hero(1, 0), out(2, 1)]);
  const seats = { names: ["Ada", "Bo", null, null, null] };
  draw(view, 0, seats);
  const made = images.length;
  draw(view, 0, seats);
  draw(view, 2 * JOIN_FRAMES, seats);
  assert.equal(images.length, made, "a repeated frame makes no surface");
  // A long line of passing names starts the HUD's names over, and it still names the seat.
  for (let i = 0; i < 70; i++) draw(view, i, { names: [`P${i}`] });
  assert.equal(wrote(draw(view, 0, seats), "ADA", SEAT_COLORS[0]!), 1);

  const lettering = createLettering(fakeMake().make);
  const first = lettering.label("A", "#ffffff");
  for (let i = 1; i < MAX_LABELS; i++) lettering.label(String(i), "#ffffff");
  assert.equal(lettering.label("A", "#ffffff"), first, "still kept");
  lettering.label("FULL", "#ff0000");
  assert.notEqual(lettering.label("A", "#ffffff"), first, "started over");
});
