import test from "node:test";
import assert from "node:assert/strict";
import {
  CITY,
  FRESHCO,
  JOBHUB,
  MONO,
  PLACES,
  STREETS,
  fuseLaneView,
  nextStep,
} from "../src/game/index.js";
import { createArt, shade, type Art } from "../src/app/art.js";
import { drawBoard, labelFont, type BoardFrame } from "../src/app/board.js";
import {
  boardView,
  centreOn,
  clampCamera,
  toScreen,
  type BoardView,
} from "../src/app/layout.js";
import { boardModel, type Viewer } from "../src/app/presenter.js";
import { FakeContext } from "./fixtures/canvas.js";
import { FakeImages, installDom } from "./fixtures/dom.js";
import { started } from "./fixtures/lane.js";

const dom = installDom();
const ADA: Viewer = {
  me: "a",
  host: true,
  solo: false,
  display: false,
  shared: false,
};
const DESKTOP = boardView(1280, 720, CITY.map, {
  top: 84,
  bottom: 6,
  left: 0,
  right: 0,
});
const middle = (view: BoardView) =>
  centreOn(view, [CITY.map.width / 2, CITY.map.height / 2]);

/** Ada and Bo at home on Monday morning, nothing lit. */
function frame(): BoardFrame & { before: Map<string, number> } {
  return {
    ...boardModel(fuseLaneView(started()), ADA),
    before: new Map(),
    fraction: 1,
    time: 0,
    hover: -1,
  };
}
function draw(
  board: BoardFrame,
  art: Art = createArt("/", new FakeImages().make),
  view = DESKTOP,
  camera = middle(view),
  ratio = 1,
  debug = false,
): FakeContext {
  const c = new FakeContext();
  drawBoard(c.context, view, camera, board, art, ratio, { debug });
  return c;
}
/** The offscreen picture of the map a draw blitted, and its recorded drawing. */
function picture(c: FakeContext) {
  const canvas = c.named("drawImage")[0]!.args[0] as HTMLCanvasElement;
  return { canvas, context: dom.context(canvas) };
}

test("while the map's picture loads, the board is a lawn with roads and blocks, drawn once per layout; then the picture", () => {
  const images = new FakeImages(),
    art = createArt("/", images.make),
    camera = middle(DESKTOP);
  const first = draw(frame(), art, DESKTOP, camera, 2);
  assert.deepEqual(first.named("clearRect")[0]!.args, [0, 0, 1280, 720]);
  assert.deepEqual(first.named("drawImage")[0]!.args.slice(1), [
    camera.x,
    camera.y,
    DESKTOP.mapWidth,
    DESKTOP.mapHeight,
  ]);
  const { canvas, context: lawn } = picture(first);
  assert.equal(canvas.width, Math.ceil(DESKTOP.mapWidth * 2));
  assert.equal(canvas.height, Math.ceil(DESKTOP.mapHeight * 2));
  assert.equal(lawn.imageSmoothingQuality, "high");
  const scale = DESKTOP.scale * 2;
  assert.deepEqual(lawn.named("fillRect")[0]!.args, [
    0,
    0,
    CITY.map.width * scale,
    CITY.map.height * scale,
  ]);
  assert.equal(lawn.named("fillRect")[0]!.style.fill, "#8cc363");
  const strokes = lawn.named("stroke");
  assert.equal(
    strokes.length,
    2 * CITY.edges.length + CITY.places.length,
    "every street twice (kerb, then tarmac), every building once",
  );
  assert.deepEqual(
    lawn.named("fill").map((call) => call.style.fill),
    CITY.places.map((place) => art.asset(`building-${place.id}`)!.color),
  );

  // The same layout and ratio: the picture is reused as it is.
  lawn.clear();
  const again = draw(frame(), art, DESKTOP, camera, 2);
  assert.equal(picture(again).canvas, canvas);
  assert.deepEqual(lawn.calls, []);
  // Another pixel ratio, or the picture arriving, draws it afresh.
  assert.notEqual(
    picture(draw(frame(), art, DESKTOP, camera, 1)).canvas,
    canvas,
  );
  images.find("fusetown.jpg")!.load(3072);
  const loaded = picture(draw(frame(), art, DESKTOP, camera, 2));
  assert.notEqual(loaded.canvas, canvas);
  assert.deepEqual(loaded.context.named("drawImage")[0]!.args, [
    images.find("fusetown.jpg"),
    0,
    0,
    loaded.canvas.width,
    loaded.canvas.height,
  ]);
  assert.equal(loaded.context.named("fillRect").length, 0, "no lawn");
});

test("a glow on the place you are in (green), walking to (pulsing amber) and pointing at (white)", () => {
  const board = frame();
  board.places[JOBHUB]!.here = true;
  board.places[FRESHCO]!.dest = true;
  board.hover = MONO;
  board.time = 0.1;
  const glows = draw(board)
    .named("stroke")
    .filter((call) => call.style.shadowBlur === 14)
    .map((call) => String(call.style.stroke));
  const pulse = 0.5 + 0.5 * Math.sin(0.1 * 5);
  assert.deepEqual(glows, [
    "rgba(255, 196, 61, " + (0.6 + 0.4 * pulse) + ")",
    "rgba(46, 204, 113, 1)",
    "rgba(255, 255, 255, 1)",
  ]);
});

test("labels: a pill per place on screen, coloured where you are and are going, with walking hours on hover and a W where you work", () => {
  const board = frame();
  board.places[JOBHUB]!.here = true;
  board.places[FRESHCO]!.dest = true;
  board.places[MONO]!.work = true;
  board.places[MONO]!.hours = 2.5;
  board.places[FRESHCO]!.hours = 3;
  board.hover = MONO;
  const c = draw(board);
  const texts = c.texts();
  assert.ok(texts.includes("Mono Burger · 2.5h"));
  assert.ok(texts.includes("FreshCo"), "hours only on hover");
  assert.ok(texts.includes("W"));
  // The pill is the first fill after its name is measured.
  const pill = (name: string) => {
    const at = c.calls.findIndex(
      (call) => call.name === "measureText" && call.args[0] === name,
    );
    return c.calls.slice(at).find((call) => call.name === "fill")!;
  };
  assert.equal(pill("Job Hub").style.fill, "#2ecc71");
  assert.equal(pill("FreshCo").style.fill, "#ffc43d");
  assert.equal(pill("KeyNest").style.fill, "#fffdf6");
  assert.equal(
    labelFont(DESKTOP),
    Math.max(11, Math.min(15, 15.5 * DESKTOP.scale)),
  );
  board.hover = FRESHCO;
  assert.ok(draw(board).texts().includes("FreshCo · 3h"));
});

test("labels off the screen are skipped, on every side; a picture too small to read has none", () => {
  const names = new Set(PLACES.map((place) => place.name));
  const check = (view: BoardView, camera: { x: number; y: number }) => {
    const font = labelFont(view),
      th = font * 1.7;
    const shown = PLACES.filter((place, index) => {
      const at = toScreen(view, camera, CITY.places[index]!.label),
        tw = place.name.length * 7 + font * 1.2;
      return (
        at.x + tw / 2 >= 0 &&
        at.x - tw / 2 <= view.width &&
        at.y + th >= 0 &&
        at.y - th <= view.height
      );
    }).map((place) => place.name);
    assert.ok(shown.length > 0 && shown.length < PLACES.length);
    assert.deepEqual(
      draw(frame(), undefined, view, camera)
        .texts()
        .filter((text) => names.has(text)),
      shown,
    );
  };
  // A phone held upright pans sideways; an ultrawide screen up and down.
  const phone = boardView(390, 844),
    wide = boardView(2560, 1080);
  for (const view of [phone, wide]) {
    check(view, clampCamera(view, { x: 0, y: 0 }));
    check(view, clampCamera(view, { x: -1e6, y: -1e6 }));
  }
  const menu = boardView(300, 200, CITY.map, undefined, false);
  assert.ok(menu.scale < 0.42);
  assert.deepEqual(
    draw(frame(), undefined, menu).texts().sort(),
    ["A", "B"],
    "only the walkers' initials",
  );
});

test("walkers: a disc with an initial until the sprites load, the sprite after, mirrored walking left; a marker over you", () => {
  const images = new FakeImages(),
    art = createArt("/", images.make);
  const board = frame();
  const ada = board.players.find((player) => player.id === "a")!,
    bo = board.players.find((player) => player.id === "b")!;
  const discs = draw(board, art);
  assert.deepEqual(discs.texts().slice(0, 2).sort(), ["A", "B"]);
  // Your ring is thicker, and only you get the marker (a triangle with a soft shadow).
  const rings = discs.named("ellipse").filter((call) => call.args[4] === 0);
  assert.equal(rings.length, 2);
  const markers = discs
    .named("fill")
    .filter((call) => call.style.shadowBlur === 4);
  assert.deepEqual(
    markers.map((call) => call.style.fill),
    [ada.color],
  );

  // Ada walks a step toward the Job Hub, between two frames; Bo has called it a week.
  const from = ada.pos;
  ada.dest = JOBHUB;
  ada.inside = -1;
  ada.pos = nextStep(nextStep(from, JOBHUB), JOBHUB);
  board.before.set("a", from);
  board.fraction = 0.5;
  bo.done = true;
  const walking = draw(board, art);
  assert.ok(images.find("fox-walk.png"), "a walker asks for the walk cycle");
  assert.ok(images.find("cat-idle.png"), "someone standing for the idle pose");
  assert.ok(
    walking.named("fill").some((call) => call.style.alpha === 0.6),
    "a player whose week is over is faded",
  );
  images.loadAll();
  const sprites = draw(board, art);
  const drawn = sprites
    .named("drawImage")
    .map((call) => (call.args[0] as { src?: string }).src)
    .filter(Boolean);
  assert.deepEqual(drawn.sort(), [
    "/fuse-lane/avatars/cat-idle.png",
    "/fuse-lane/avatars/fox-walk.png",
  ]);
  const left = STREETS.points[ada.pos]![0] < STREETS.points[from]![0];
  assert.equal(
    sprites.named("scale").some((call) => call.args[0] === -1),
    left,
    "mirrored only when walking left",
  );
  // Back the other way: the mirror flips.
  board.before.set("a", ada.pos);
  ada.pos = from;
  ada.dest = PLACES.findIndex((place) => place.id === "roomshare");
  const back = draw(board, art);
  if (nextStep(board.before.get("a")!, ada.dest) !== board.before.get("a"))
    assert.equal(
      back.named("scale").some((call) => call.args[0] === -1),
      !left,
    );
});

test("the parts of the picture in front of the streets are drawn again over a walker behind them", () => {
  const board = frame();
  // Bo alone on the board (Roomshare's door is behind a building), standing on each step in turn.
  const bo = board.players.find((player) => player.id === "b")!;
  board.players = [bo];
  bo.inside = -1;
  let behind: FakeContext | undefined, clear: FakeContext | undefined;
  for (
    let step = 0;
    step < STREETS.points.length && !(behind && clear);
    step++
  ) {
    bo.pos = step;
    const c = draw(board);
    if (c.named("clip").length) behind ??= c;
    else clear ??= c;
  }
  assert.ok(clear, "most of the streets are in the open");
  assert.ok(behind, "a street runs behind a building");
  const clip = behind.calls.findIndex((call) => call.name === "clip");
  const map = behind.named("drawImage")[0]!.args[0];
  assert.equal(behind.calls[clip + 1]!.name, "drawImage");
  assert.equal(
    behind.calls[clip + 1]!.args[0],
    map,
    "the map, clipped to the occluder",
  );
  assert.equal(behind.calls[clip + 2]!.name, "restore");
});

test("the debug overlay traces the tap outlines, occluders, street graph and doors", () => {
  const c = draw(frame(), undefined, DESKTOP, middle(DESKTOP), 1, true);
  assert.equal(
    c.named("setLineDash").filter((call) => (call.args[0] as number[]).length)
      .length,
    CITY.places.length,
  );
  assert.deepEqual(
    c.named("strokeText").map((call) => call.args[0]),
    CITY.places.map((place) => place.id),
  );
  const nodes = c.named("arc").filter((call) => call.args[2] === 5).length;
  assert.equal(nodes, CITY.nodes.length);
  assert.equal(
    c.named("arc").filter((call) => call.args[2] === 2.5).length,
    STREETS.points.length - CITY.nodes.length,
  );
  assert.ok(c.named("stroke").some((call) => call.style.stroke === "#ff3b30"));
  assert.equal(shade("#ffffff", 0), "rgb(255, 255, 255)");
});

test("loose ends: a building with no art is a grey block, a nameless walker a question mark, and you stand in front of someone level with you", () => {
  const art = createArt("/", new FakeImages().make);
  const bare: Art = { ...art, asset: () => undefined };
  const lawn = picture(draw(frame(), bare, boardView(640, 480))).context;
  assert.ok(lawn.named("fill").every((call) => call.style.fill === "#9ab"));

  const board = frame();
  const ada = board.players.find((player) => player.id === "a")!,
    bo = board.players.find((player) => player.id === "b")!;
  bo.name = "";
  // Two steps on one level, far enough apart not to share a spot.
  const points = STREETS.points;
  let pair: [number, number] | undefined;
  for (let s = 0; s < points.length && !pair; s++)
    for (let t = 0; t < points.length && !pair; t++)
      if (
        points[s]![1] === points[t]![1] &&
        Math.abs(points[s]![0] - points[t]![0]) > 40
      )
        pair = [s, t];
  assert.ok(pair, "a level street");
  for (const [player, step] of [
    [ada, pair[0]],
    [bo, pair[1]],
  ] as const)
    Object.assign(player, { pos: step, inside: -1, dest: -1 });
  for (const order of [
    [ada, bo],
    [bo, ada],
  ]) {
    board.players = order;
    const c = draw(board);
    assert.ok(c.texts().includes("?"));
    const rings = c
      .named("ellipse")
      .filter((call) => call.args[4] === 0)
      .map((call) => call.style.lineWidth);
    assert.deepEqual(rings, [2, 3], "Bo first, then you on top");
  }
});
