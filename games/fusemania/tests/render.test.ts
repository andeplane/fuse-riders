import test from "node:test";
import assert from "node:assert/strict";
import type { PlayerView, WorldView } from "../src/engine/view.js";
import {
  BATTLE_MODE,
  BLACKOUT,
  BOO,
  COLUMNS,
  DOUBLE,
  DRUNK,
  FLIP,
  GREAT,
  HOLD,
  LAG,
  MARVELOUS,
  MINE,
  MINED,
  MINES,
  MISS,
  NO_ITEM,
  PERFECT,
  ROLL,
  SCORE_MODE,
  STAR,
  TAP,
  itemNotes,
  turnedMine,
  type Effect,
  type StepNote,
  type Steps,
} from "../src/engine/view-kit.js";
import { SLIDE_MS, createFeedback, rowOf } from "../src/render/feedback.js";
import { boxX, boxY, laneOf, layoutFor } from "../src/render/layout.js";
import {
  LAG_MS,
  noMods,
  notePlacement,
  targetX,
  type LaneGeometry,
} from "../src/render/mods.js";
import {
  CYAN,
  GOLD,
  JUDGMENT_COLORS,
  PINK,
  RED,
} from "../src/render/palette.js";
import type { Pen, SceneCanvas, SpriteCanvas } from "../src/render/pen.js";
import {
  createScene,
  type DrawOptions,
  type SceneOptions,
} from "../src/render/scene.js";
import { spriteName } from "../src/render/sprites.js";

// ---- a canvas that records what is drawn on it ----

interface Call {
  op: string;
  /** For an image: the sprite's name. For text: the text. */
  what: string;
  /** Where it landed on the canvas: an image's or a rectangle's centre, a text's anchor, a path point. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** How much the transform (and, for an image, the drawn size) scales it. */
  scale: number;
  alpha: number;
  fill: string;
  stroke: string;
  lineWidth: number;
  lighter: boolean;
}

class FakePen implements Pen {
  fillStyle: string | CanvasGradient | CanvasPattern = "#000000";
  strokeStyle: string | CanvasGradient | CanvasPattern = "#000000";
  lineWidth = 1;
  lineCap: CanvasLineCap = "butt";
  lineJoin: CanvasLineJoin = "miter";
  globalAlpha = 1;
  globalCompositeOperation: GlobalCompositeOperation = "source-over";
  font = "10px sans-serif";
  textAlign: CanvasTextAlign = "start";
  textBaseline: CanvasTextBaseline = "alphabetic";
  shadowBlur = 0;
  shadowColor = "rgba(0, 0, 0, 0)";
  private matrix: [number, number, number, number, number, number] = [
    1, 0, 0, 1, 0, 0,
  ];
  private stack: (typeof this.matrix)[] = [];
  constructor(readonly calls: Call[]) {}

  private note(
    op: string,
    what: string,
    x: number,
    y: number,
    width = 0,
    height = 0,
    scale = 1,
  ): void {
    const [a, b, c, d, e, f] = this.matrix;
    // Only the state the call uses: a path point has no colour, a fill no line width.
    const paints = !["beginPath", "moveTo", "lineTo", "arc"].includes(op);
    const strokes = op.startsWith("stroke");
    const fills = op.startsWith("fill");
    this.calls.push({
      op,
      what,
      x: a * x + c * y + e,
      y: b * x + d * y + f,
      width,
      height,
      scale: scale * Math.hypot(a, b),
      alpha: paints ? this.globalAlpha : 1,
      fill: fills ? String(this.fillStyle) : "",
      stroke: strokes ? String(this.strokeStyle) : "",
      lineWidth: strokes ? this.lineWidth : 0,
      lighter: paints && this.globalCompositeOperation === "lighter",
    });
  }
  save(): void {
    this.stack.push([...this.matrix]);
  }
  restore(): void {
    this.matrix = this.stack.pop() ?? this.matrix;
  }
  setTransform(
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
  ): void {
    this.matrix = [a, b, c, d, e, f];
  }
  translate(x: number, y: number): void {
    const [a, b, c, d, e, f] = this.matrix;
    this.matrix = [a, b, c, d, a * x + c * y + e, b * x + d * y + f];
  }
  rotate(angle: number): void {
    const [a, b, c, d, e, f] = this.matrix,
      cos = Math.cos(angle),
      sin = Math.sin(angle);
    this.matrix = [
      a * cos + c * sin,
      b * cos + d * sin,
      c * cos - a * sin,
      d * cos - b * sin,
      e,
      f,
    ];
  }
  beginPath(): void {
    this.note("beginPath", "", 0, 0);
  }
  closePath(): void {}
  moveTo(x: number, y: number): void {
    this.note("moveTo", "", x, y);
  }
  lineTo(x: number, y: number): void {
    this.note("lineTo", "", x, y);
  }
  arc(x: number, y: number, radius: number): void {
    this.note("arc", "", x, y, radius * 2, radius * 2);
  }
  fill(): void {
    this.note("fill", "", 0, 0);
  }
  stroke(): void {
    this.note("stroke", "", 0, 0);
  }
  fillRect(x: number, y: number, width: number, height: number): void {
    this.note("fillRect", "", x + width / 2, y + height / 2, width, height);
  }
  strokeRect(x: number, y: number, width: number, height: number): void {
    this.note("strokeRect", "", x + width / 2, y + height / 2, width, height);
  }
  clearRect(x: number, y: number, width: number, height: number): void {
    this.note("clearRect", "", x + width / 2, y + height / 2, width, height);
  }
  fillText(text: string, x: number, y: number): void {
    this.note("fillText", text, x, y);
  }
  strokeText(text: string, x: number, y: number): void {
    this.note("strokeText", text, x, y);
  }
  drawImage(
    image: SpriteCanvas | CanvasImageSource,
    x: number,
    y: number,
    width?: number,
    height?: number,
  ): void {
    const sprite = image instanceof FakeCanvas ? image : undefined;
    const w = width ?? sprite?.width ?? 0,
      h = height ?? sprite?.height ?? 0;
    this.note(
      "drawImage",
      (sprite && spriteName(sprite)) ?? "?",
      x + w / 2,
      y + h / 2,
      w,
      h,
      sprite && sprite.width > 0 ? w / sprite.width : 1,
    );
  }
}

class FakeCanvas implements SceneCanvas {
  width = 0;
  height = 0;
  readonly calls: Call[] = [];
  private readonly pen = new FakePen(this.calls);
  constructor(
    public clientWidth = 0,
    public clientHeight = 0,
    private readonly context = true,
  ) {}
  getContext(): Pen | null {
    return this.context ? this.pen : null;
  }
}

function rig(
  width = 1366,
  height = 768,
  ratio = 1,
  options: Partial<SceneOptions> = {},
) {
  const canvas = new FakeCanvas(width, height);
  let made = 0;
  const scene = createScene(canvas, {
    createCanvas(w, h) {
      made++;
      const sprite = new FakeCanvas();
      sprite.width = w;
      sprite.height = h;
      return sprite;
    },
    pixelRatio: () => ratio,
    ...options,
  });
  return {
    scene,
    canvas,
    made: () => made,
    /** Draws one frame and returns what it drew. */
    frame(view: WorldView, shot: DrawOptions): Call[] {
      canvas.calls.length = 0;
      scene.draw(view, shot);
      return canvas.calls.slice();
    },
  };
}
const images = (calls: readonly Call[], name: string): Call[] =>
  calls.filter(
    (call) =>
      call.op === "drawImage" &&
      (call.what === name || call.what.startsWith(`${name}:`)),
  );
const texts = (calls: readonly Call[]): string[] =>
  calls.filter((call) => call.op === "fillText").map((call) => call.what);
const textAt = (calls: readonly Call[], text: string): Call | undefined =>
  calls.find((call) => call.op === "fillText" && call.what === text);

// ---- a match built by hand ----

const each = <T>(value: T): T[] => Array.from({ length: COLUMNS }, () => value);

/** A chart from `[ms, column, kind, endMs, beat]` rows. */
function chart(
  rows: readonly (readonly [number, number, number?, number?, number?])[],
): Steps {
  const notes: StepNote[] = rows
    .map(([ms, column, kind = TAP, endMs = ms, beat = ms / 500]) => ({
      ms,
      endMs,
      column,
      kind,
      beat,
    }))
    .sort((a, b) => a.ms - b.ms || a.column - b.column);
  const lanes = each(0).map((): number[] => []),
    mines = each(0).map((): number[] => []);
  for (const [id, note] of notes.entries())
    (note.kind === MINE ? mines : lanes)[note.column]!.push(id);
  const played = notes.filter((note) => note.kind !== MINE);
  return {
    notes,
    lanes,
    mines,
    steps: played.length,
    holds: played.filter((note) => note.kind !== TAP).length,
    full: Math.max(1, played.length * 10),
    firstMs: played[0]?.ms ?? 0,
    lastMs: Math.max(0, ...played.map((note) => note.endMs)),
  };
}
/** Taps every `every` ms from `from`, walking across the columns. */
const stream = (count: number, from = 1000, every = 250): Steps =>
  chart(
    Array.from(
      { length: count },
      (_, i) => [from + i * every, i % COLUMNS] as const,
    ),
  );

function rider(slot: number, over: Partial<PlayerView> = {}): PlayerView {
  return {
    id: `rider-${slot}`,
    slot,
    bot: false,
    chart: 0,
    score: 0,
    rating: 0,
    place: slot + 1,
    combo: 0,
    best: 0,
    counts: Array.from({ length: 9 }, () => 0),
    next: each(0),
    hold: each(-1),
    let: each(-1),
    down: each(false),
    hits: Array.from({ length: 64 }, () => 0),
    judged: -1,
    judgedAt: 0,
    judgedOff: 0,
    item: NO_ITEM,
    itemAt: 0,
    effects: [],
    shield: 0,
    blocked: 0,
    ...over,
  };
}
/** The bit set with these notes hit. */
function hitting(ids: readonly number[]): number[] {
  const hits = Array.from({ length: 64 }, () => 0);
  for (const id of ids)
    hits[id >>> 5] = (hits[id >>> 5]! | (1 << (id & 31))) >>> 0;
  return hits;
}
function world(
  players: PlayerView[],
  over: Partial<WorldView> = {},
): WorldView {
  return {
    song: "song",
    mode: SCORE_MODE,
    seed: 7,
    ms: 0,
    endMs: 60_000,
    phase: "playing",
    players,
    ...over,
  };
}
const NAMES = ["ADA", "BEA", "CY", "DEE", "EVE"];
function shot(
  steps: Steps | readonly Steps[],
  songMs: number,
  over: Partial<DrawOptions> = {},
): DrawOptions {
  return {
    songMs,
    beat: songMs / 500,
    bpm: 120,
    steps: "notes" in steps ? Array.from({ length: 5 }, () => steps) : steps,
    names: NAMES,
    local: 0,
    speed: 1,
    down: false,
    title: "Neon Run",
    chartNames: ["HARD", "EASY", "HARD", "EASY", "HARD"],
    itemKey: "SPACE",
    ...over,
  };
}
/** Where the scene puts a note of rider `local` alone on a laptop: the same arithmetic, asked directly. */
function placer(
  width = 1366,
  height = 768,
  riders = 1,
  local = 0,
  down = false,
  speed = 1,
) {
  const field = layoutFor(width, height, riders, local, 0, 1).fields[0]!;
  const lane: LaneGeometry = laneOf(field, speed, down, {
    columnWidth: 0,
    targetY: 0,
    length: 0,
    runout: 0,
    windowMs: 0,
    down,
  });
  return {
    field,
    lane,
    note(column: number, ahead: number, mods = noMods(), songMs = 0) {
      const at = notePlacement(mods, column, ahead, songMs, lane);
      return { ...at, x: field.x + at.x };
    },
    target: (column: number, flip = 0) => ({
      x: field.x + targetX(flip, column, lane),
      y: lane.targetY,
    }),
  };
}
const near = (a: number, b: number, slack = 0.51): boolean =>
  Math.abs(a - b) <= slack;

// ---- the notes ----

test("notes ahead of the cursor are drawn where the song time puts them, in their beat's colour; hit notes are not", () => {
  const steps = chart([
    [1000, 0, TAP, 1000, 0],
    [1250, 1, TAP, 1250, 0.5],
    [1500, 2, TAP, 1500, 1.25],
    [9000, 3],
  ]);
  const r = rig(),
    where = placer();
  const calls = r.frame(world([rider(0)]), shot(steps, 500));
  for (const [name, column, ahead] of [
    ["arrow:0:0", 0, 500],
    ["arrow:1:1", 1, 750],
    ["arrow:3:2", 2, 1000],
  ] as const) {
    const drawn = images(calls, name);
    assert.equal(drawn.length, 1, name);
    const at = where.note(column, ahead);
    assert.ok(near(drawn[0]!.x, at.x) && near(drawn[0]!.y, at.y), name);
    assert.equal(drawn[0]!.alpha, 1);
    assert.equal(drawn[0]!.scale, 1, "blitted, not resampled");
    assert.ok(
      Number.isInteger(drawn[0]!.y - drawn[0]!.height / 2),
      "on whole pixels",
    );
  }
  assert.equal(images(calls, "arrow").length, 3, "the far note is not in view");
  // Classic: the targets are at the top and the notes below them, rising.
  const targets = images(calls, "receptor");
  assert.equal(targets.length, COLUMNS);
  for (const [column, target] of targets.entries()) {
    assert.ok(near(target.x, where.target(column).x));
    assert.ok(near(target.y, where.target(column).y));
    assert.ok(target.y < images(calls, "arrow")[0]!.y);
  }

  // The same moment with the first note hit: it is gone. The second, missed, scrolls on dimmed.
  const later = r.frame(
    world([rider(0, { next: [1, 1, 0, 0], hits: hitting([0]) })]),
    shot(steps, 1290),
  );
  assert.equal(images(later, "arrow:0:0").length, 0);
  const missed = images(later, "arrow:1:1")[0]!;
  assert.ok(missed.alpha > 0 && missed.alpha < 0.4, "dimmed");
  assert.ok(missed.y < where.lane.targetY, "past the target");
  assert.equal(images(later, "arrow:3:2")[0]!.alpha, 1);
  // Further on it has scrolled off.
  assert.equal(
    images(
      r.frame(
        world([rider(0, { next: [1, 1, 0, 0], hits: hitting([0]) })]),
        shot(steps, 1480),
      ),
      "arrow:1:1",
    ).length,
    0,
  );
});

test("the picture is a function of the song time: any frame, in any order, puts a note in the same place", () => {
  const steps = stream(40);
  const view = world([rider(0)]);
  const straight = rig().frame(view, shot(steps, 2345.6));
  const wandering = rig();
  for (const ms of [0, 5000, 1200, 2345.5, 9000])
    wandering.frame(view, shot(steps, ms));
  assert.deepEqual(wandering.frame(view, shot(steps, 2345.6)), straight);
  // Scrolling down mirrors it; twice the speed shows half as much.
  const where = placer(1366, 768, 1, 0, true, 2);
  const down = rig().frame(view, shot(steps, 900, { down: true, speed: 2 }));
  const first = images(down, "arrow:0:0")[0]!;
  assert.ok(near(first.y, where.note(0, 100).y));
  assert.ok(first.y < where.lane.targetY, "falling to targets at the bottom");
  assert.ok(images(down, "arrow").length < images(straight, "arrow").length);
});

test("only the notes in view are drawn, however long the chart", () => {
  const steps = stream(20_000, 1000, 100);
  const r = rig();
  for (const ms of [0, 500_000, 1_999_000]) {
    const calls = r.frame(world([rider(0)]), shot(steps, ms));
    const drawn = images(calls, "arrow").length;
    // 2.2 s ahead at a note every 100 ms, and the few just past the targets.
    assert.ok(drawn > 5 && drawn <= 27, `${drawn} arrows at ${ms}`);
    assert.ok(calls.length < 400, "a frame is a few hundred calls");
  }
});

test("sprites are drawn once: frames make no canvases and use no blur", () => {
  const steps = stream(60);
  const r = rig();
  r.frame(world([rider(0)]), shot(steps, 0));
  const made = r.made();
  assert.ok(made > 20, "an arrow per colour and direction, and the rest");
  for (let ms = 0; ms < 3000; ms += 16)
    r.frame(world([rider(0)]), shot(steps, ms));
  assert.equal(r.made(), made);
});

test("a tap a mine attack turned is drawn as a mine, and a star keeps it an arrow", () => {
  const steps = stream(16, 1000, 100);
  const effects: Effect[] = [[MINES, 0, 9000, 1]];
  const view = world([rider(0, { effects }), rider(1)], { seed: 12345 });
  const turned = steps.notes.map((note, id) =>
    turnedMine(effects, view.seed, id, note),
  );
  assert.ok(
    turned.includes(true) && turned.includes(false),
    "the fixture has both",
  );
  const where = placer(1366, 768, 2, 0);
  const calls = rig().frame(view, shot(steps, 800));
  for (const [id, note] of steps.notes.entries()) {
    const at = where.note(note.column, note.ms - 800);
    const here = (call: Call) => near(call.x, at.x) && near(call.y, at.y);
    assert.equal(
      images(calls, "mine").some(here),
      turned[id],
      `note ${id} a mine`,
    );
    assert.equal(
      images(calls, "arrow").some(here),
      !turned[id],
      `note ${id} an arrow`,
    );
  }
  // Starred, every note is the rider's to hit.
  const starred = world(
    [rider(0, { effects: [...effects, [STAR, 0, 9000, 0]] }), rider(1)],
    { seed: 12345 },
  );
  const calm = rig().frame(starred, shot(steps, 800));
  assert.equal(images(calm, "mine").length, 0);
  assert.equal(
    images(calm, "receptor").length,
    0,
    "the targets are every colour",
  );
  // A chart's own mines are drawn until they go off.
  const mined = chart([
    [1000, 0],
    [1200, 1, MINE],
    [1400, 2, MINE],
  ]);
  const own = rig().frame(
    world([rider(0, { hits: hitting([2]) })]),
    shot(mined, 800),
  );
  assert.equal(images(own, "mine").length, 1);
  assert.ok(near(images(own, "mine")[0]!.x, placer().note(1, 400).x));
});

test("in a battle the item notes are capsules while the hand is empty, and the prompt is only on the local field", () => {
  const steps = stream(60, 1000, 250);
  const carriers = [...itemNotes(steps)];
  assert.ok(carriers.length > 1);
  const first = steps.notes[carriers[0]!]!;
  const songMs = first.ms - 600;
  const battle = (item: number, mode = BATTLE_MODE) =>
    world([rider(0, { item }), rider(1)], { mode });
  const where = placer(1366, 768, 2, 0);
  const at = where.note(first.column, 600);
  const here = (call: Call) => near(call.x, at.x) && near(call.y, at.y);

  const empty = rig().frame(battle(NO_ITEM), shot(steps, songMs));
  assert.ok(
    images(empty, "capsule").some(here),
    "a capsule where the item note is",
  );
  assert.ok(!images(empty, "arrow").some(here));
  assert.ok(!texts(empty).some((text) => text.startsWith("PRESS")));

  const holding = rig().frame(battle(DRUNK), shot(steps, songMs));
  assert.equal(images(holding, "capsule").length, 0, "hand full: plain notes");
  assert.ok(images(holding, "arrow").some(here));
  assert.ok(texts(holding).includes("PRESS SPACE"));
  assert.ok(texts(holding).includes("DRUNK"));
  assert.ok(images(holding, "icon:1").length >= 1, "the item's icon");

  assert.equal(
    images(
      rig().frame(battle(NO_ITEM, SCORE_MODE), shot(steps, songMs)),
      "capsule",
    ).length,
    0,
    "no items outside a battle",
  );
  // The other rider's device, and the shared screen: the item shows, the prompt does not.
  for (const local of [1, -1]) {
    const calls = rig().frame(battle(DRUNK), shot(steps, songMs, { local }));
    assert.ok(
      !texts(calls).some((text) => text.startsWith("PRESS")),
      `local ${local}`,
    );
    assert.ok(images(calls, "icon:1").length >= 1, `local ${local}`);
  }
});

test("a hold shortens from its head at the target while kept, dims when let go, and a roll's core zigzags", () => {
  const steps = chart([
    [1000, 2, HOLD, 2000],
    [1000, 0, ROLL, 2000],
  ]);
  const where = placer();
  const r = rig();
  const before = r.frame(world([rider(0)]), shot(steps, 600));
  const bodyOf = (calls: readonly Call[], column: number) => {
    const x = where.target(column).x;
    return calls.filter(
      (call) =>
        (call.op === "moveTo" || call.op === "lineTo") && near(call.x, x, 12),
    );
  };
  // Coming: the body runs from the head to the tail, and the head is an arrow.
  const coming = bodyOf(before, 2);
  assert.ok(near(coming[0]!.y, where.note(2, 400).y));
  assert.ok(near(coming[1]!.y, where.note(2, 1400).y));
  assert.equal(images(before, "arrow").length, 2);
  assert.ok(bodyOf(before, 0).length > coming.length, "the roll zigzags");

  // Held: from the target to the tail, bright, with a glow on the target and no head.
  const held = rider(0, {
    next: [1, 0, 1, 0],
    hits: hitting([0, 1]),
    hold: [0, -1, 1, -1],
    let: [1000, -1, -1, -1],
    down: [true, false, true, false],
  });
  const running = r.frame(world([held]), shot(steps, 1400));
  const kept = bodyOf(running, 2);
  assert.ok(near(kept[0]!.y, where.lane.targetY), "from the target");
  assert.ok(near(kept[1]!.y, where.note(2, 600).y), "to the tail");
  assert.equal(images(running, "arrow").length, 0);
  const glows = images(running, "glow:6");
  assert.equal(glows.length, 2);
  assert.ok(glows.every((glow) => glow.lighter));
  const pressed = images(running, "lit").filter((lit) => lit.alpha === 1);
  assert.equal(pressed.length, 2, "the held targets are lit");
  assert.ok(
    pressed.every((lit) => near(lit.scale, 0.9, 0.001)),
    "and pressed in",
  );
  const bright = running
    .filter((call) => call.op === "stroke")
    .map((call) => call.alpha);
  assert.ok(bright.every((alpha) => alpha === 1));

  // Let go: still running, dimmed, no glow.
  const loose = r.frame(
    world([{ ...held, let: [1000, -1, 1500, -1], down: each(false) }]),
    shot(steps, 1600),
  );
  assert.equal(images(loose, "glow:6").length, 1, "the roll still glows");
  assert.ok(
    loose.some((call) => call.op === "stroke" && near(call.alpha, 0.45, 0.01)),
  );

  // Kept to the end: a burst of its own. Dropped: no burst, and the rest scrolls on dimmed.
  const done = r.frame(
    world([{ ...held, hold: [0, -1, -1, -1], let: [1000, -1, -1, -1] }]),
    shot(steps, 2005),
  );
  const burst = images(done, "burst:5");
  assert.equal(burst.length, 1);
  assert.ok(burst[0]!.lighter && near(burst[0]!.x, where.target(2).x, 1));
  const other = rig();
  other.frame(world([held]), shot(steps, 1400));
  const dropped = other.frame(
    world([{ ...held, hold: [0, -1, -1, -1], hits: hitting([0]) }]),
    shot(steps, 1800),
  );
  assert.equal(images(dropped, "burst:5").length, 0);
  assert.ok(
    dropped.some((call) => call.op === "stroke" && near(call.alpha, 0.3, 0.01)),
  );
});

// ---- hitting things ----

/** A chord on columns 0 and 1 at 1000 ms, then more. */
const CHORD = chart([
  [1000, 0],
  [1000, 1],
  [1500, 2],
  [2000, 3],
  [2500, 0],
]);
const struck = (judged: number, over: Partial<PlayerView> = {}): PlayerView =>
  rider(0, {
    next: [1, 1, 0, 0],
    hits: hitting([0, 1]),
    judged,
    judgedAt: 1000,
    judgedOff: -30,
    combo: 2,
    ...over,
  });

test("a hit bursts on its target in the judgment's colour: both columns of a chord, once, growing and fading", () => {
  const where = placer();
  for (const judgment of [MARVELOUS, PERFECT, GREAT, BOO]) {
    const r = rig();
    const before = r.frame(world([rider(0)]), shot(CHORD, 990));
    assert.equal(images(before, "burst").length, 0);
    assert.equal(images(before, "core").length, 0);

    const calls = r.frame(world([struck(judgment)]), shot(CHORD, 1000));
    const bursts = images(calls, `burst:${judgment}`);
    assert.equal(bursts.length, 2, `judgment ${judgment}`);
    for (const [column, burst] of bursts.entries()) {
      assert.ok(burst.lighter, "added light");
      assert.ok(near(burst.x, where.target(column).x, 1e-6));
      assert.ok(near(burst.y, where.target(column).y, 1e-6));
      assert.ok(near(burst.scale, 1, 1e-6) && near(burst.alpha, 1, 1e-6));
    }
    assert.equal(images(calls, "core").length, 2, "a white-hot core");
    assert.equal(
      images(calls, `glow:${judgment}`).filter((g) => g.lighter).length >= 2,
      true,
    );
    // Sparks and a shimmer of other colours for a Marvelous, and for nothing else.
    assert.equal(
      images(calls, "spark").length,
      judgment === MARVELOUS ? 12 : 0,
    );
    assert.equal(images(calls, "burst").length, judgment === MARVELOUS ? 4 : 2);

    // The same view again, later: the same burst further on, not a new one.
    const growing = r.frame(world([struck(judgment)]), shot(CHORD, 1120));
    const grown = images(growing, `burst:${judgment}`)[0]!;
    assert.ok(grown.scale > 1.4 && grown.scale < 1.6, "it grows towards 1.6x");
    assert.ok(grown.alpha > 0.1 && grown.alpha < 0.5, "and fades");
    assert.equal(images(growing, "core").length, 0, "the core is quick");
    const over = r.frame(world([struck(judgment)]), shot(CHORD, 1260));
    assert.equal(
      images(over, "burst").length,
      0,
      "gone in a quarter of a second",
    );

    // A rollback to before the hit and the same outcome again shows nothing twice.
    r.frame(world([rider(0)]), shot(CHORD, 1270));
    const again = r.frame(world([struck(judgment)]), shot(CHORD, 1280));
    assert.equal(images(again, "burst").length, 0);
  }
});

test("a miss has no burst: the word is red and the field's border flickers", () => {
  const r = rig();
  r.frame(world([rider(0)]), shot(CHORD, 1100));
  const missed = rider(0, {
    next: [1, 1, 0, 0],
    judged: MISS,
    judgedAt: 1180,
    counts: [0, 0, 0, 0, 0, 2, 0, 0, 0],
  });
  const calls = r.frame(world([missed]), shot(CHORD, 1180));
  assert.equal(images(calls, "burst").length, 0);
  assert.equal(images(calls, "core").length, 0);
  assert.equal(textAt(calls, "MISS")?.fill, JUDGMENT_COLORS[MISS]);
  const border = (frame: readonly Call[]) =>
    frame.filter((call) => call.op === "fillRect" && call.fill === RED).length;
  assert.equal(border(calls), 2, "both edges");
  assert.equal(
    border(r.frame(world([missed]), shot(CHORD, 1180 + 60))),
    0,
    "flickering",
  );
  assert.equal(border(r.frame(world([missed]), shot(CHORD, 1180 + 100))), 2);
  assert.equal(border(r.frame(world([missed]), shot(CHORD, 1180 + 400))), 0);
});

test("the judgment word pops in, holds and fades, with EARLY or LATE for anything short of Marvelous", () => {
  const where = placer();
  const word = (judged: number, off: number, songMs: number) =>
    rig().frame(
      world([struck(judged, { judgedOff: off })]),
      shot(CHORD, songMs),
    );

  const popping = word(GREAT, 40, 1000);
  const great = textAt(popping, "GREAT")!;
  assert.equal(great.fill, JUDGMENT_COLORS[GREAT]);
  assert.ok(near(great.scale, 1.35, 1e-6), "it overshoots");
  assert.ok(
    near(great.x, where.field.x + where.field.col * 2, 1e-6),
    "centred on the field",
  );
  assert.ok(
    great.y > where.lane.targetY + where.field.col,
    "below the targets",
  );
  assert.ok(
    popping.some((call) => call.op === "strokeText" && call.what === "GREAT"),
    "outlined",
  );
  assert.ok(
    texts(popping).includes("LATE") && !texts(popping).includes("EARLY"),
  );

  const settled = textAt(word(GREAT, -40, 1100), "GREAT")!;
  assert.equal(settled.scale, 1);
  assert.equal(settled.alpha, 1);
  assert.ok(texts(word(GREAT, -40, 1100)).includes("EARLY"));
  const fading = textAt(word(GREAT, 40, 1470), "GREAT")!;
  assert.ok(fading.alpha > 0 && fading.alpha < 1);
  assert.equal(
    textAt(word(GREAT, 40, 1530), "GREAT"),
    undefined,
    "gone by half a second",
  );

  const best = word(MARVELOUS, 5, 1040);
  assert.ok(texts(best).includes("MARVELOUS"));
  assert.ok(!texts(best).includes("LATE") && !texts(best).includes("EARLY"));
  // Nothing judged yet, nothing said.
  assert.ok(
    !texts(rig().frame(world([rider(0)]), shot(CHORD, 0))).some(
      (t) => t === "MARVELOUS",
    ),
  );
});

test("the combo shows from four, bumps on every step and flashes at each hundred", () => {
  const r = rig();
  const at = (combo: number) =>
    world([struck(PERFECT, { combo, judgedAt: 0 })]);
  const three = r.frame(at(3), shot(CHORD, 3000));
  assert.ok(!texts(three).includes("COMBO"));
  const four = r.frame(at(4), shot(CHORD, 3010));
  assert.ok(texts(four).includes("COMBO"));
  const size = (calls: readonly Call[], text: string) =>
    calls.findIndex((call) => call.op === "fillText" && call.what === text);
  assert.ok(size(four, "4") >= 0);
  // The number is drawn bigger the moment it changes: the stroke under it is wider.
  const width = (calls: readonly Call[], text: string) =>
    calls.find((call) => call.op === "strokeText" && call.what === text)!
      .lineWidth;
  const bumped = width(four, "4"),
    rested = width(r.frame(at(4), shot(CHORD, 3200)), "4");
  assert.ok(bumped > rested);
  // A hundred.
  r.frame(at(99), shot(CHORD, 4000));
  const hundred = r.frame(at(100), shot(CHORD, 4016));
  assert.equal(textAt(hundred, "100")?.fill, GOLD);
  assert.ok(images(hundred, "glow:1").some((glow) => glow.lighter));
  // Lost: the old number falls away in red.
  const broken = r.frame(at(0), shot(CHORD, 5000));
  assert.equal(textAt(broken, "100")?.fill, RED);
  assert.ok(!texts(broken).includes("COMBO"));
});

test("the targets pulse on the beat, and press in and light up under a held key", () => {
  const steps = stream(4, 60_000);
  const lit = (
    beat: number,
    down = each(false),
    options: Partial<SceneOptions> = {},
  ) =>
    images(
      rig(1366, 768, 1, options).frame(
        world([rider(0, { down })]),
        shot(steps, 1000, { beat }),
      ),
      "lit",
    );
  const on = lit(8),
    off = lit(8.9);
  assert.equal(on.length, COLUMNS);
  assert.ok(on[0]!.alpha > 0.5, "bright on the beat");
  assert.ok(off.length === 0 || off[0]!.alpha < 0.02, "faded before the next");
  assert.ok(lit(8.3)[0]!.alpha < on[0]!.alpha);
  const held = lit(8.9, [true, false, false, true]);
  assert.equal(held.filter((sprite) => sprite.alpha === 1).length, 2);
  assert.ok(
    held
      .filter((sprite) => sprite.alpha === 1)
      .every((s) => near(s.scale, 0.9, 1e-6)),
  );
  // Reduced motion: no pulse, no press, the lit target still shows the key.
  const calm = lit(8, [true, false, false, false], { reducedMotion: true });
  assert.equal(calm.length, 1);
  assert.equal(calm[0]!.scale, 1);
});

test("a mine going off is an explosion on its column and a shake of that field only", () => {
  const steps = chart([
    [1000, 0],
    [1200, 1, MINE],
    [3000, 2],
  ]);
  const r = rig(1920, 1080, 1);
  const quiet = [rider(0), rider(1)];
  const before = r.frame(world(quiet), shot(steps, 1190, { local: -1 }));
  const boom = rider(0, {
    hits: hitting([1]),
    judged: MINED,
    judgedAt: 1200,
    counts: [0, 0, 0, 0, 0, 0, 0, 0, 1],
  });
  const calls = r.frame(
    world([boom, rider(1)]),
    shot(steps, 1230, { local: -1 }),
  );
  const blast = images(calls, "blast");
  assert.equal(blast.length, 1);
  assert.ok(blast[0]!.lighter);
  const fields = layoutFor(1920, 1080, 2, -1).fields;
  assert.ok(
    blast[0]!.x > fields[0]!.x &&
      blast[0]!.x < fields[0]!.x + fields[0]!.col * 2,
  );
  assert.ok(texts(calls).includes("MINE"));
  assert.ok(texts(calls).includes("MINE!"), "and on the rider's box");
  // The lanes of the first field are knocked off their place; the second's are where they were.
  const lanes = (frame: readonly Call[]) =>
    frame.filter(
      (call) =>
        call.op === "fillRect" &&
        call.height > 500 &&
        call.width > 300 &&
        call.width < 1000,
    );
  const [a0, b0] = lanes(before),
    [a1, b1] = lanes(calls);
  assert.ok(a0!.x !== a1!.x || a0!.y !== a1!.y, "shaken");
  assert.deepEqual([b0!.x, b0!.y], [b1!.x, b1!.y], "not the neighbour");
  const after = r.frame(
    world([boom, rider(1)]),
    shot(steps, 1700, { local: -1 }),
  );
  assert.equal(images(after, "blast").length, 0);
  assert.deepEqual(
    [lanes(after)[0]!.x, lanes(after)[0]!.y],
    [a0!.x, a0!.y],
    "settled",
  );
});

// ---- attacks ----

test("the attacks move the notes: flip mirrors the targets, lag draws the past, a blackout shows the notes only on the beat", () => {
  const steps = stream(12);
  const where = placer();
  const under = (kind: number, songMs: number, beat = songMs / 500) =>
    rig().frame(
      world([rider(0, { effects: [[kind, 0, 60_000, 1]] })]),
      shot(steps, songMs, { beat }),
    );

  const flipped = under(FLIP, 1000);
  for (const [column, target] of images(flipped, "receptor").entries())
    assert.ok(
      near(target.x, where.target(COLUMNS - 1 - column).x),
      "targets move with it",
    );
  // The nearest note is drawn last.
  const note = images(flipped, "arrow:1:1").at(-1)!;
  assert.ok(near(note.x, where.target(2).x), "the down arrow, where up was");

  const lagged = images(under(LAG, 1000), "arrow:1:1").at(-1)!;
  assert.ok(
    near(lagged.y, where.note(1, 250 + LAG_MS).y),
    "as if it were earlier",
  );

  const flash = images(under(BLACKOUT, 1000, 2), "arrow"),
    dark = images(under(BLACKOUT, 1000, 2.5), "arrow");
  assert.ok(flash.length > 3 && flash.some((arrow) => arrow.alpha === 1));
  assert.ok(dark.every((arrow) => arrow.alpha < 0.05));
  assert.equal(
    images(under(BLACKOUT, 1000, 2.5), "receptor").length,
    COLUMNS,
    "the targets stay",
  );

  // Drunk: the same note is off its column, and somewhere else a moment later.
  const swayed = (ms: number) =>
    images(under(DRUNK, ms), "arrow").map((arrow) => arrow.x % where.field.col);
  assert.notDeepEqual(
    swayed(1000),
    swayed(1000.5).map((x) => x),
  );
  assert.ok(
    images(under(DRUNK, 1000), "arrow").some(
      (arrow) => arrow.scale !== 1 || !Number.isInteger(arrow.x * 2),
    ),
  );
});

test("an attack on its way warns the victim, then shows as a label with a draining bar; double, star and shield look their part", () => {
  const steps = stream(12, 20_000);
  const attacked = (songMs: number, over: Partial<PlayerView> = {}) =>
    rig().frame(
      world([
        rider(0, { effects: [[DRUNK, 6200, 15_200, 1]], ...over }),
        rider(1),
      ]),
      shot(steps, songMs),
    );
  const warned = attacked(5200);
  assert.equal(textAt(warned, "INCOMING: DRUNK")?.fill, PINK);
  assert.ok(!texts(warned).includes("DRUNK"), "not in force yet");
  const under = attacked(8000);
  assert.ok(!texts(under).includes("INCOMING: DRUNK"));
  assert.ok(texts(under).includes("DRUNK"));
  // The bar: its coloured part is what is left of the effect.
  const bars = (calls: readonly Call[]) =>
    calls.filter(
      (call) =>
        call.op === "fillRect" && call.fill === PINK && call.height <= 4,
    );
  const early = bars(under)[0]!.width,
    late = bars(attacked(14_000))[0]!.width;
  assert.ok(early > late && late > 0);
  assert.equal(bars(attacked(15_300)).length, 0, "over");

  const boosted = rig().frame(
    world([
      rider(0, {
        effects: [
          [DOUBLE, 0, 10_000, 0],
          [STAR, 0, 5000, 0],
        ],
        shield: 20_000,
      }),
    ]),
    shot(steps, 1000),
  );
  for (const name of ["DOUBLE", "STAR", "SHIELD", "x2"])
    assert.ok(texts(boosted).includes(name), name);
  assert.ok(
    boosted.some((call) => call.op === "strokeRect" && call.stroke === CYAN),
    "a bubble",
  );
  assert.equal(images(boosted, "receptor").length, 0);
  assert.equal(images(boosted, "arrow").length, COLUMNS, "rainbow targets");
  const plain = rig().frame(world([rider(0)]), shot(steps, 1000));
  assert.ok(!plain.some((call) => call.op === "strokeRect"));
  assert.ok(!texts(plain).includes("x2"));

  // A shield that swallows an attack says so.
  const r = rig();
  r.frame(world([rider(0, { shield: 20_000 }), rider(1)]), shot(steps, 7000));
  const blocked = r.frame(
    world([rider(0, { blocked: 7050 }), rider(1)]),
    shot(steps, 7050),
  );
  assert.equal(textAt(blocked, "BLOCKED!")?.fill, CYAN);
  assert.equal(
    textAt(
      r.frame(
        world([rider(0, { blocked: 7050 }), rider(1)]),
        shot(steps, 8100),
      ),
      "BLOCKED!",
    ),
    undefined,
  );
});

// ---- the leaderboard ----

/** Two riders on a laptop, the first local, at these ratings. */
function duel(
  first: number,
  second: number,
  over: Partial<PlayerView> = {},
): WorldView {
  const lead = first >= second;
  return world([
    rider(0, { rating: first, place: lead ? 1 : 2, ...over }),
    rider(1, { rating: second, place: lead ? 2 : 1 }),
  ]);
}

test("more than one rider: a box each on the right, ranked, with place, name, score, combos, chart and the local rider marked", () => {
  const steps = stream(8, 30_000);
  const calls = rig().frame(
    world([
      rider(0, { rating: 412_345, place: 2, combo: 12, best: 40 }),
      rider(1, { rating: 600_000, place: 1, combo: 3, best: 57, item: DRUNK }),
      rider(2, {
        rating: 1000,
        place: 3,
        effects: [[FLIP, 0, 60_000, 0]],
        shield: 9e9,
      }),
    ]),
    shot(steps, 1000),
  );
  const panel = layoutFor(1366, 768, 3, 0).panel!;
  const inRow = (call: Call, row: number) =>
    call.y > boxY(panel, row) &&
    call.y < boxY(panel, row) + panel.boxHeight &&
    call.x >= panel.x;
  const row = (index: number) =>
    calls
      .filter((call) => call.op === "fillText" && inRow(call, index))
      .map((call) => call.what);
  assert.deepEqual(row(0).slice(0, 2), ["1ST", "BEA"]);
  assert.ok(
    row(0).includes("0600000") &&
      row(0).includes("x3") &&
      row(0).includes("MAX 57"),
  );
  assert.ok(row(0).includes("EASY"), "the chart it plays");
  assert.deepEqual(row(1).slice(0, 3), ["2ND", "ADA", "YOU"]);
  assert.ok(
    row(1).includes("0412345") &&
      row(1).includes("x12") &&
      row(1).includes("MAX 40"),
  );
  assert.deepEqual(row(2).slice(0, 2), ["3RD", "CY"]);
  // The item in hand and the effects a rider is under, as icons in its box.
  const icons = (index: number) =>
    calls
      .filter(
        (call) =>
          call.op === "drawImage" &&
          call.what.startsWith("icon:") &&
          inRow(call, index),
      )
      .map((call) => call.what);
  assert.deepEqual(icons(0), ["icon:1"]);
  assert.deepEqual(icons(2).sort(), ["icon:13", "icon:6"]);
  assert.deepEqual(icons(1), []);
  // Only the local rider's field is drawn, with its place and how far behind the leader it is.
  assert.equal(images(calls, "receptor").length, COLUMNS);
  const field = layoutFor(1366, 768, 3, 0).fields[0]!;
  const header = calls
    .filter(
      (call) =>
        call.op === "fillText" &&
        call.y < field.laneTop &&
        call.y > field.top &&
        call.x < panel.x,
    )
    .map((call) => call.what);
  assert.deepEqual(header, ["2ND", "ADA", "HARD", "0412345", "-187,655"]);

  // Alone there is no board and no place.
  const solo = rig().frame(world([rider(0, { rating: 5 })]), shot(steps, 1000));
  assert.ok(!texts(solo).includes("1ST") && !texts(solo).includes("YOU"));
  assert.ok(texts(solo).includes("0000005"));
});

test("an overtake slides the boxes to their new rows over several frames, the riser on top, and tells the local rider", () => {
  const steps = stream(8, 90_000);
  const r = rig();
  const panel = layoutFor(1366, 768, 2, 0).panel!;
  const nameY = (calls: readonly Call[], name: string) =>
    textAt(calls, name)!.y;
  const still = r.frame(duel(300_000, 200_000), shot(steps, 5000));
  const top = nameY(still, "ADA"),
    bottom = nameY(still, "BEA");
  assert.ok(near(bottom - top, panel.boxHeight + panel.gap));
  assert.ok(!texts(still).includes("OVERTAKEN"));

  // BEA passes ADA.
  const seen: number[] = [];
  let last: Call[] = [];
  for (let ms = 5016; ms <= 5016 + SLIDE_MS + 32; ms += 16) {
    last = r.frame(duel(300_000, 320_000), shot(steps, ms));
    seen.push(nameY(last, "BEA"));
    assert.ok(
      near(nameY(last, "ADA") + nameY(last, "BEA"), top + bottom, 1.01),
      "they swap",
    );
  }
  assert.ok(near(seen[0]!, bottom, 1.01), "it starts from where it was");
  assert.ok(near(seen[seen.length - 1]!, top), "and ends on top");
  for (const [i, y] of seen.entries())
    if (i > 0) {
      assert.ok(y <= seen[i - 1]!, "always upwards");
      assert.ok(seen[i - 1]! - y < (bottom - top) * 0.2, "never a jump");
    }
  assert.ok(new Set(seen).size > 12, "over many frames");
  // Ease-out: most of the way in the first half of the time.
  assert.ok(seen[Math.floor(seen.length / 2)]! - top < (bottom - top) * 0.2);

  // While it slides, the riser's box is drawn after the one it passes, and glows.
  const mid = r.frame(duel(300_000, 320_000), shot(steps, 5416));
  void mid;
  const sliding = rig();
  sliding.frame(duel(300_000, 200_000), shot(steps, 5000));
  const during = sliding.frame(duel(300_000, 320_000), shot(steps, 5100));
  const order = during
    .filter(
      (call) =>
        call.op === "fillText" &&
        (call.what === "ADA" || call.what === "BEA") &&
        call.x >= panel.x,
    )
    .map((call) => call.what);
  assert.deepEqual(order, ["ADA", "BEA"]);
  assert.ok(
    during.some(
      (call) =>
        call.op === "strokeRect" && call.lighter && call.stroke === GOLD,
    ),
  );
  assert.ok(
    during.some(
      (call) =>
        call.op === "fillRect" &&
        call.x >= panel.x &&
        call.alpha < 0.8 &&
        call.alpha > 0.5,
    ),
    "the one passed dims",
  );
  assert.equal(textAt(during, "OVERTAKEN")?.fill, PINK);

  // Taking it back straight away says nothing (one banner in two seconds); later it does.
  const back = sliding.frame(duel(340_000, 320_000), shot(steps, 5600));
  assert.ok(!texts(back).includes("YOU LEAD!"));
  sliding.frame(duel(300_000, 320_000), shot(steps, 6000));
  const lead = sliding.frame(duel(340_000, 320_000), shot(steps, 7200));
  assert.equal(textAt(lead, "YOU LEAD!")?.fill, GOLD);
  assert.ok(
    !texts(sliding.frame(duel(340_000, 320_000), shot(steps, 8600))).includes(
      "YOU LEAD!",
    ),
  );
});

test("the slide is from wherever the box is, and survives the clock standing still", () => {
  const feedback = createFeedback();
  const steps = [stream(4), stream(4), stream(4)];
  const places = (a: number, b: number, c: number) =>
    world([
      rider(0, { place: a }),
      rider(1, { place: b }),
      rider(2, { place: c }),
    ]);
  feedback.observe(places(1, 2, 3), steps, 1000, 0);
  const third = feedback.riders[2]!;
  assert.equal(rowOf(third, 1000), 2);
  feedback.observe(places(2, 3, 1), steps, 1100, 0);
  assert.equal(rowOf(third, 1100), 2, "not yet moved");
  const part = rowOf(third, 1100 + SLIDE_MS / 4);
  assert.ok(part > 0 && part < 2);
  // Passed again half way: it turns round from where it is.
  feedback.observe(places(1, 3, 2), steps, 1100 + SLIDE_MS / 4, 0);
  assert.equal(rowOf(third, 1100 + SLIDE_MS / 4), part);
  assert.ok(rowOf(third, 1100 + SLIDE_MS / 2) > part);
  assert.equal(rowOf(third, 1100 + SLIDE_MS * 2), 1);
  // The same view again changes nothing.
  feedback.observe(places(1, 3, 2), steps, 1100 + SLIDE_MS / 4, 0);
  assert.equal(rowOf(third, 1100 + SLIDE_MS / 4), part);
});

test("a box flashes in the colour of each judgment, its score rolls up, a miss nudges it and a broken combo drops", () => {
  const steps = stream(8, 90_000);
  const r = rig();
  const panel = layoutFor(1366, 768, 2, 0).panel!;
  const them = (over: Partial<PlayerView>) =>
    world([rider(0, { rating: 500_000 }), rider(1, { place: 2, ...over })]);
  r.frame(them({ rating: 100_000, combo: 9 }), shot(steps, 3000));
  const flashes = (calls: readonly Call[], color: string) =>
    calls.filter(
      (call) =>
        call.op === "fillRect" &&
        call.fill === color &&
        call.width === panel.boxWidth,
    );
  // A Great for the other rider: their box (the second row) flashes green and fades.
  const judged = { rating: 160_000, combo: 10, judged: GREAT, judgedAt: 3010 };
  const flash = flashes(
    r.frame(them(judged), shot(steps, 3016)),
    JUDGMENT_COLORS[GREAT],
  );
  assert.equal(flash.length, 1);
  assert.ok(near(flash[0]!.y, boxY(panel, 1) + panel.boxHeight / 2, 1));
  const fading = flashes(
    r.frame(them(judged), shot(steps, 3116)),
    JUDGMENT_COLORS[GREAT],
  );
  assert.ok(fading[0]!.alpha < flash[0]!.alpha);
  assert.equal(
    flashes(r.frame(them(judged), shot(steps, 3230)), JUDGMENT_COLORS[GREAT])
      .length,
    0,
  );

  // The score rolls rather than jumps.
  const scores = new Set<string>();
  const fresh = rig();
  fresh.frame(them({ rating: 100_000 }), shot(steps, 3000));
  for (let ms = 3016; ms < 4200; ms += 16) {
    const shown = texts(
      fresh.frame(them({ rating: 160_000 }), shot(steps, ms)),
    ).filter((text) => /^0\d{6}$/.test(text) && text !== "0500000");
    for (const text of shown) scores.add(text);
    assert.ok(
      shown.every((text) => Number(text) >= 100_000 && Number(text) <= 160_000),
    );
  }
  assert.ok(scores.size > 10 && scores.has("0160000"));

  // A miss: red flash, the box nudged sideways, the lost combo falling in red.
  const calm = r.frame(them(judged), shot(steps, 4000));
  const missed = {
    rating: 160_000,
    combo: 0,
    judged: MISS,
    judgedAt: 4010,
    counts: [0, 0, 0, 0, 0, 1, 0, 0, 0],
  };
  const hurt = r.frame(them(missed), shot(steps, 4040));
  assert.equal(flashes(hurt, JUDGMENT_COLORS[MISS]).length, 1);
  const nudged = r.frame(them(missed), shot(steps, 4080));
  assert.notEqual(textAt(nudged, "BEA")!.x, textAt(calm, "BEA")!.x);
  assert.equal(textAt(nudged, "ADA")!.x, textAt(calm, "ADA")!.x);
  assert.equal(
    textAt(r.frame(them(missed), shot(steps, 4400)), "BEA")!.x,
    textAt(calm, "BEA")!.x,
    "and back",
  );
  assert.equal(textAt(hurt, "x10")?.fill, RED);
  assert.ok(texts(hurt).includes("x0"));
});

test("an attack runs as a zap from the thrower's box to the victim's, and the victim's box shakes with its name when it lands", () => {
  const steps = stream(8, 90_000);
  const r = rig();
  const panel = layoutFor(1366, 768, 2, 1).panel!;
  const thrown: Effect[] = [[DRUNK, 6200, 15_200, 1]];
  const at = (effects: Effect[], songMs: number) =>
    r.frame(
      world([rider(0, { effects }), rider(1)]),
      shot(steps, songMs, { local: 1 }),
    );
  const zaps = (calls: readonly Call[]) =>
    calls.filter(
      (call) => call.op === "stroke" && call.lighter && call.stroke === PINK,
    );
  assert.equal(zaps(at([], 4990)).length, 0);
  const calls = at(thrown, 5000);
  assert.equal(zaps(calls).length, 1);
  // The line leaves the thrower's row (the second) and ends at the victim's (the first), in the gutter.
  const index = calls.indexOf(zaps(calls)[0]!);
  const path = calls
    .slice(0, index)
    .filter((call) => call.op === "moveTo" || call.op === "lineTo")
    .slice(-4);
  assert.ok(near(path[0]!.y, boxY(panel, 1) + panel.boxHeight / 2));
  assert.ok(near(path[3]!.y, boxY(panel, 0) + panel.boxHeight / 2));
  assert.ok(
    path.every(
      (point) => point.x <= boxX(panel, 0) && point.x >= boxX(panel, 0) - 20,
    ),
  );
  assert.equal(zaps(at(thrown, 5300)).length, 1, "still running");
  assert.equal(zaps(at(thrown, 5600)).length, 0);
  assert.ok(!texts(at(thrown, 5600)).includes("DRUNK!"), "not landed yet");

  // It takes hold: the victim's box shakes and wears the attack's name; no second zap.
  const still = at(thrown, 6190);
  const landed = at(thrown, 6230);
  assert.equal(textAt(landed, "DRUNK!")?.fill, PINK);
  assert.equal(zaps(landed).length, 0);
  const shaking = at(thrown, 6250);
  assert.notEqual(textAt(shaking, "ADA")!.x, textAt(still, "ADA")!.x);
  assert.equal(textAt(shaking, "BEA")!.x, textAt(still, "BEA")!.x);
  assert.ok(!texts(at(thrown, 7100)).includes("DRUNK!"));
  // A device that joins with the attack already on sees neither.
  const late = rig().frame(
    world([rider(0, { effects: thrown }), rider(1)]),
    shot(steps, 6230, { local: 1 }),
  );
  assert.equal(zaps(late).length, 0);
  assert.ok(!texts(late).includes("DRUNK!"));
});

test("on a portrait phone the board is a strip of compact boxes above the field", () => {
  const steps = stream(8, 30_000);
  const r = rig(360, 640, 3);
  assert.deepEqual(
    [r.canvas.width, r.canvas.height],
    [1080, 1920],
    "device pixels",
  );
  const calls = r.frame(
    world([rider(0, { rating: 9 }), rider(1), rider(2), rider(3), rider(4)]),
    shot(steps, 1000, { inset: 120 }),
  );
  const layout = layoutFor(1080, 1920, 5, 0, 120, 3);
  assert.equal(layout.panel?.strip, true);
  const field = layout.fields[0]!;
  for (const place of ["1ST", "2ND", "3RD", "4TH", "5TH"]) {
    const inStrip = calls.filter(
      (call) =>
        call.op === "fillText" && call.what === place && call.y < field.top,
    );
    assert.equal(inStrip.length, 1, place);
  }
  // Nothing is drawn under the touch buttons.
  const floor = 1920 - 120 * 3;
  for (const call of calls)
    if (call.op === "drawImage" && call.what.startsWith("receptor"))
      assert.ok(call.y + call.height / 2 <= floor);
  assert.ok(
    calls
      .filter((call) => call.op === "fillText")
      .every((call) => call.y <= floor),
  );
});

// ---- the frame around it ----

test("the title, the song's progress, and GET READY with three, two, one before it starts", () => {
  const steps = stream(8);
  const r = rig();
  const view = world([rider(0)], { endMs: 100_000 });
  const ready = r.frame(view, shot(steps, -3500));
  assert.ok(texts(ready).includes("GET READY"));
  assert.ok(!["3", "2", "1"].some((count) => texts(ready).includes(count)));
  assert.ok(texts(ready).includes("NEON RUN") && texts(ready).includes("HARD"));
  for (const [ms, count] of [
    [-2500, "3"],
    [-1999, "2"],
    [-1, "1"],
  ] as const) {
    const calls = r.frame(view, shot(steps, ms));
    assert.ok(texts(calls).includes(count), count);
    assert.ok(texts(calls).includes("GET READY"));
  }
  const playing = r.frame(view, shot(steps, 25_000));
  assert.ok(!texts(playing).includes("GET READY"));
  const bar = (calls: readonly Call[]) =>
    calls
      .filter(
        (call) => call.op === "fillRect" && call.fill === CYAN && call.y < 30,
      )
      .at(-1)!.width;
  assert.equal(bar(ready), 0);
  assert.equal(bar(playing), Math.round(1366 / 4));
  assert.equal(
    bar(r.frame({ ...view, phase: "over" }, shot(steps, 25_000))),
    1366,
  );
});

test("the shared screen shows every field in a row with its place, and the board beside them", () => {
  const steps = stream(30);
  const players = [0, 1, 2, 3, 4].map((slot) =>
    rider(slot, { rating: 1000 * (5 - slot) }),
  );
  const calls = rig(1920, 1080).frame(
    world(players),
    shot(steps, 1500, { local: -1 }),
  );
  assert.equal(images(calls, "receptor").length, 5 * COLUMNS);
  const layout = layoutFor(1920, 1080, 5, -1);
  assert.equal(layout.fields.length, 5);
  for (const [slot, name] of NAMES.entries()) {
    const shown = calls.filter(
      (call) => call.op === "fillText" && call.what === name,
    );
    assert.equal(shown.length, 2, `${name}: over its field and in its box`);
    const field = layout.fields[slot]!;
    assert.ok(
      shown.some(
        (call) => call.x >= field.x && call.x < field.x + field.col * COLUMNS,
      ),
    );
  }
  assert.ok(!texts(calls).includes("YOU"));
  assert.ok(
    !texts(calls).some((text) => text.startsWith("+") || text.startsWith("-")),
    "no gap for a watcher",
  );
});

test("the canvas follows its CSS size and the screen's pixel ratio on resize", () => {
  let ratio = 2;
  const canvas = new FakeCanvas(400, 300);
  const scene = createScene(canvas, {
    createCanvas: () => new FakeCanvas(),
    pixelRatio: () => ratio,
  });
  assert.deepEqual([canvas.width, canvas.height], [800, 600]);
  canvas.clientWidth = 1000;
  canvas.clientHeight = 500;
  assert.deepEqual([canvas.width, canvas.height], [800, 600], "not until told");
  scene.resize();
  assert.deepEqual([canvas.width, canvas.height], [2000, 1000]);
  ratio = 8;
  scene.resize();
  assert.deepEqual(
    [canvas.width, canvas.height],
    [3000, 1500],
    "a sane ceiling",
  );
  const steps = stream(8);
  scene.draw(world([rider(0)]), shot(steps, 500));
  const targets = images(canvas.calls, "receptor");
  assert.ok(targets.every((target) => target.x > 0 && target.x < 3000));
  scene.destroy();
  canvas.calls.length = 0;
  scene.draw(world([rider(0)]), shot(steps, 600));
  scene.resize();
  assert.equal(canvas.calls.length, 0, "nothing after destroy");
});

test("drawing never throws: no riders, a finished match, a watcher, five riders, missing charts, no canvas at all", () => {
  const steps = stream(30);
  const five = [0, 1, 2, 3, 4].map((slot) =>
    rider(slot, {
      effects: [
        [1 + slot, 500, 9000, (slot + 1) % 5],
        [9 + slot, 0, 9000, slot],
      ],
      item: 1 + slot * 3,
      shield: slot === 2 ? 5000 : 0,
      judged: slot,
      judgedAt: 1400,
      combo: 100 * slot,
      hold: [slot, -1, -1, -1],
      down: [true, false, true, false],
    }),
  );
  const views: WorldView[] = [
    world([]),
    world([rider(0)], { phase: "over", ms: 60_000 }),
    world(five, { mode: BATTLE_MODE }),
    world(five, { mode: BATTLE_MODE, phase: "over" }),
    world([
      rider(0, {
        judged: 99,
        hold: [999, -1, -1, -1],
        item: 99,
        effects: [[99, 0, 9e9, 9]],
      }),
    ]),
  ];
  const sizes: [number, number, number][] = [
    [0, 0, 1],
    [1, 1, 1],
    [360, 640, 3],
    [1366, 768, 1],
    [3840, 2160, 1],
  ];
  for (const [width, height, ratio] of sizes)
    for (const reducedMotion of [false, true]) {
      const r = rig(width, height, ratio, { reducedMotion });
      for (const view of views)
        for (const local of [-1, 0, 4, 9])
          for (const songMs of [-4000, 0, 1500, 1516, 70_000])
            for (const down of [false, true]) {
              const calls = r.frame(
                view,
                shot(steps, songMs, { local, down, inset: 100, speed: 4 }),
              );
              if (width === 0)
                assert.equal(calls.length, 0, "nothing to draw on");
              for (const call of calls)
                assert.ok(
                  Number.isFinite(call.x) &&
                    Number.isFinite(call.y) &&
                    Number.isFinite(call.alpha),
                  `${call.op} ${call.what}`,
                );
            }
      // Charts that are missing, short or empty, and odd numbers.
      r.frame(world(five), shot([], 1500, { names: [], chartNames: [] }));
      r.frame(
        world(five),
        shot(chart([]), 1500, { speed: 0, beat: Number.NaN }),
      );
      r.scene.resize();
    }
  // A canvas with no 2D context.
  const blind = createScene(new FakeCanvas(300, 300, false), {
    createCanvas: () => new FakeCanvas(0, 0, false),
    pixelRatio: () => 1,
  });
  blind.draw(world(five), shot(steps, 1500));
  blind.resize();
  blind.destroy();
});

test("drawing the same thing twice issues the same calls", () => {
  const steps = chart([
    ...Array.from(
      { length: 40 },
      (_, i) => [1000 + i * 125, i % COLUMNS] as const,
    ),
    [1300, 3, HOLD, 2400],
    [1700, 1, ROLL, 2600],
    [1900, 2, MINE],
  ]);
  const busy = [
    rider(0, {
      next: [2, 1, 0, 0],
      hits: hitting([0, 4]),
      judged: GREAT,
      judgedAt: 1480,
      judgedOff: 22,
      combo: 14,
      rating: 400_000,
      item: STAR,
      shield: 9000,
      effects: [
        [DRUNK, 500, 9000, 1],
        [BLACKOUT, 700, 9000, 1],
        [MINES, 0, 9000, 1],
        [FLIP, 2600, 9000, 1],
      ],
    }),
    rider(1, { rating: 500_000, place: 1, effects: [[DOUBLE, 0, 9000, 1]] }),
    rider(2, { place: 3 }),
  ];
  for (const local of [0, -1])
    for (const reducedMotion of [false, true]) {
      const r = rig(1920, 1080, 1, { reducedMotion });
      const view = world(busy, { mode: BATTLE_MODE });
      const first = r.frame(view, shot(steps, 1500, { local }));
      const second = r.frame(view, shot(steps, 1500, { local }));
      assert.ok(first.length > 100);
      assert.deepEqual(second, first);
      // And again after other frames have come and gone, on a scene that has seen nothing else.
      assert.deepEqual(
        rig(1920, 1080, 1, { reducedMotion }).frame(
          view,
          shot(steps, 1500, { local }),
        ),
        first,
      );
    }
});

test("reduced motion keeps the game and drops the fireworks", () => {
  const r = rig(1366, 768, 1, { reducedMotion: true });
  r.frame(world([rider(0)]), shot(CHORD, 990));
  const calls = r.frame(world([struck(MARVELOUS)]), shot(CHORD, 1000));
  assert.equal(images(calls, "burst").length, 0);
  assert.equal(images(calls, "spark").length, 0);
  assert.equal(images(calls, "core").length, 0);
  assert.ok(images(calls, "glow:0").length >= 2, "a soft glow says it was hit");
  assert.equal(
    textAt(calls, "MARVELOUS")?.scale,
    1,
    "the word is there, without the pop",
  );
  assert.equal(images(calls, "lit").length, 0, "no beat pulse");
  // The attacks stay.
  const steps = stream(12);
  const flipped = rig(1366, 768, 1, { reducedMotion: true }).frame(
    world([rider(0, { effects: [[FLIP, 0, 60_000, 1]] })]),
    shot(steps, 1000),
  );
  assert.ok(near(images(flipped, "receptor")[0]!.x, placer().target(3).x));
});

test("a new match on the same scene starts clean", () => {
  const r = rig();
  r.frame(world([rider(0)]), shot(CHORD, 990));
  r.frame(world([struck(PERFECT)]), shot(CHORD, 1000));
  // Another match (another seed), the song back at its start: the old cursors must not mute its bursts.
  r.frame(world([rider(0)], { seed: 8 }), shot(CHORD, 990));
  const calls = r.frame(
    world([struck(PERFECT)], { seed: 8 }),
    shot(CHORD, 1000),
  );
  assert.equal(images(calls, "burst:1").length, 2);
  // The same match wound back to the start (a restart) too.
  r.frame(world([rider(0)], { seed: 8 }), shot(CHORD, -3000));
  r.frame(world([rider(0)], { seed: 8 }), shot(CHORD, 990));
  assert.equal(
    images(
      r.frame(world([struck(PERFECT)], { seed: 8 }), shot(CHORD, 1000)),
      "burst:1",
    ).length,
    2,
  );
});
