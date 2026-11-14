import test from "node:test";
import assert from "node:assert/strict";
import { ACTION, LEAVE, PRESENCE, SETTINGS } from "fuse-netcode";
import {
  CLOSE_LAG,
  FINISHED,
  GAS,
  LEVELS,
  STEPS_PER_SECOND,
  STEPS_PER_TICK,
  TURN,
  advanceRider,
  centiseconds,
  createWorld,
  stepWorld,
  toView,
  type World,
} from "../src/engine/index.js";
import { PLACE_POINTS } from "../src/basics.js";
import {
  GHOST_AHEAD,
  blendViews,
  copyWorld,
  createGhosts,
  project,
  type RiderPlan,
} from "../src/app/forward.js";
import {
  LEVEL_CHOICES,
  createFinishWatch,
  levelFrom,
  present,
  type Viewer,
} from "../src/app/presenter.js";
import {
  ART_FILES,
  BIKE_KEYS,
  artBase,
  loadArt,
  type ImageLoader,
} from "../src/app/art.js";
import {
  createSfx,
  ELASTO_SONGS,
  humPitch,
  humVolume,
} from "../src/app/audio.js";
import { createGameAudio } from "fuse-ui/game-audio";
import { createAudioRig } from "fuse-ui/game-audio-fake";
import {
  bestTime,
  createBestTimes,
  keys,
  roomFailure,
  safeStore,
  sessionFor,
  NOT_OPEN,
  type Store,
} from "../src/app/session.js";
import { PLAY, DEFAULT_SETTINGS, view, type Room } from "../src/online/game.js";
import { fold, play, run, seated, started } from "./fixtures/room.js";

const SINGLE = { ...DEFAULT_SETTINGS, count: 1 as const };
/** A plan that draws a rider at step `to` of its own clock, holding `bits` all the way. */
const hold = (to: number, bits: number): RiderPlan => ({
  to,
  bits: () => bits,
});
/** A two-rider race on the first level, past its countdown and `steps` into the ride with `bits` held. */
function racing(steps = 0, bits: readonly number[] = [0, 0]): World {
  const world = createWorld(["a", "b"], 0, 0);
  for (let i = 0; i < steps; i++) stepWorld(world, bits, [true, true]);
  return world;
}
/** Puts every rider of the room's race on the flower, `a` first, and folds the tick that closes the race. */
function finishRace(room: Room, times: readonly number[] = [800, 960]): void {
  const world = room.world!;
  while (world.phase === "countdown") fold(room);
  world.step = Math.max(...times);
  world.riders.forEach((rider, slot) => {
    rider.status = FINISHED;
    rider.finish = times[slot]!;
    rider.run = times[slot]!;
    rider.step = times[slot]!;
  });
  fold(room);
}
/** The room's stage as it is now: a fold changes it behind an earlier assertion's back. */
const stageOf = (room: Room): string => room.stage;
const fakeStore = (): Store & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
};

// ---- every bike on its own clock ----

test("the screen plays a rider on to its own clock on a copy, exactly as the room will", () => {
  const world = racing(40, [GAS, 0]);
  const before = structuredClone(world);
  const drawn = project(world, [hold(48, GAS)]);
  assert.deepEqual(world, before, "the room's world is untouched");
  const expected = copyWorld(world);
  advanceRider(expected, 0, 48, GAS);
  assert.deepEqual(drawn, toView(expected));
  assert.equal(drawn.riders[0]!.step, 48);
  assert.equal(drawn.riders[1]!.step, 40, "a rider with no plan stays put");
  assert.deepEqual(project(world, []), toView(world));
  assert.deepEqual(
    project(world, [hold(12, GAS)]),
    toView(world),
    "never backwards",
  );
  // The bits are asked for step by step: a key that went down on step 44 acts there.
  const pressed = project(world, [
    { to: 48, bits: (step) => (step < 44 ? GAS : GAS | TURN) },
  ]);
  const same = copyWorld(world);
  advanceRider(same, 0, 44, GAS);
  advanceRider(same, 0, 48, GAS | TURN);
  assert.deepEqual(pressed, toView(same));
  assert.notDeepEqual(pressed, drawn);
});

test("a fraction of a step is drawn between the two steps either side", () => {
  const world = racing(60, [GAS, 0]);
  const a = project(world, [hold(62, GAS)]),
    b = project(world, [hold(63, GAS)]),
    half = project(world, [hold(62.5, GAS)]);
  const mid = (x: number, y: number) => (x + y) / 2;
  const ra = a.riders[0]!.bike,
    rb = b.riders[0]!.bike,
    rh = half.riders[0]!.bike;
  assert.notEqual(ra.x, rb.x, "the bike is moving");
  assert.ok(Math.abs(rh.x - mid(ra.x, rb.x)) < 1e-12);
  assert.ok(Math.abs(rh.left.y - mid(ra.left.y, rb.left.y)) < 1e-12);
  assert.ok(Math.abs(rh.left.rot - mid(ra.left.rot, rb.left.rot)) < 1e-12);
  assert.ok(Math.abs(rh.head.x - mid(ra.head.x, rb.head.x)) < 1e-12);
  // Clocks and counts are the earlier step's until the later one is reached.
  assert.equal(half.riders[0]!.run, a.riders[0]!.run);
  assert.deepEqual(half.riders[1], a.riders[1], "the others are not touched");
  assert.equal(blendViews(a, b, 0), a);
  assert.equal(blendViews(a, b, 1), b);
});

test("a blend never smears a restart, a turn-around, another level or a wrapped angle", () => {
  const a = toView(racing(30, [GAS, 0])),
    next = racing(31, [GAS, 0]);
  // The rider was put back on the start: a jump, not a slide.
  const restarted = toView(next);
  restarted.riders[0] = { ...restarted.riders[0]!, run: 0 };
  assert.equal(blendViews(a, restarted, 0.5).riders[0], a.riders[0]);
  const crashed = toView(next);
  crashed.riders[0] = { ...crashed.riders[0]!, status: "dead" };
  assert.equal(blendViews(a, crashed, 0.5).riders[0], a.riders[0]);
  // The other rider still blends.
  assert.notEqual(blendViews(a, restarted, 0.5).riders[1], undefined);
  const elsewhere = { ...toView(next), level: 1 };
  assert.equal(blendViews(a, elsewhere, 0.5), a);
  // A wheel's angle that wrapped is held, not spun the long way round.
  const wrapped = toView(next);
  const bike = wrapped.riders[0]!.bike;
  wrapped.riders[0] = {
    ...wrapped.riders[0]!,
    bike: { ...bike, left: { ...bike.left, rot: bike.left.rot + 6 } },
  };
  assert.equal(
    blendViews(a, wrapped, 0.5).riders[0]!.bike.left.rot,
    a.riders[0]!.bike.left.rot,
  );
  // The facing is the earlier step's: the picture flips on a whole step.
  const turned = project(racing(30, [GAS, 0]), [hold(30.5, GAS | TURN)]);
  assert.equal(
    turned.riders[0]!.bike.flipped,
    toView(racing(30, [GAS, 0])).riders[0]!.bike.flipped,
  );
  assert.equal(
    project(racing(30, [GAS, 0]), [hold(31, GAS | TURN)]).riders[0]!.bike
      .flipped,
    !toView(racing(30, [GAS, 0])).riders[0]!.bike.flipped,
    "a turn held now shows on the next whole step",
  );
});

test("a finished race is drawn as the room has it", () => {
  const over = racing(10);
  over.phase = "over";
  assert.deepEqual(
    project(over, [hold(15.5, GAS), hold(20, GAS)]),
    toView(over),
  );
});

test("the other riders are ghosts on an eased clock a little past the last word of them; this device's bike is not one", () => {
  const room = started(SINGLE);
  fold(room, { b: [play(room, GAS, 0), play(room, GAS, 20)] });
  const ghosts = createGhosts();
  const first = ghosts(room, "a", 1000);
  assert.equal(first[0], undefined, "this device's own bike has its own clock");
  const ghost = first[1]!;
  assert.ok(ghost.to >= 20 && ghost.to < 21, "from where it was last heard");
  assert.equal(ghost.bits(25), GAS, "on what it last held");
  // It runs on with the wall clock between words, a frame at a time, and never far past the last one.
  let last = ghost.to;
  for (let ms = 1016; ms < 1100; ms += 16) {
    const to = ghosts(room, "a", ms)[1]!.to;
    assert.ok(to > last && to - last < 2, "an even pace");
    last = to;
  }
  for (let ms = 1100; ms < 2000; ms += 16) last = ghosts(room, "a", ms)[1]!.to;
  assert.ok(last <= 20 + GHOST_AHEAD);
  // New word of it: the clock is never behind what was heard.
  fold(room, { b: [play(room, 0, 60)] });
  const heard = ghosts(room, "a", 2016)[1]!;
  assert.ok(heard.to >= 60);
  assert.equal(heard.bits(61), 0);
  // The drawn ghost is the room's bike played on with those bits.
  const drawn = project(room.world!, ghosts(room, "a", 2032));
  assert.ok(drawn.riders[1]!.step >= 60);
  assert.equal(drawn.riders[0]!.step, 0);
  // A rider whose device is gone is drawn where the room has it.
  fold(room, { a: [[PRESENCE, "b", false, 1]] });
  assert.equal(ghosts(room, "a", 2048)[1], undefined);
});

// ---- the presenter ----

const viewer = (me: string, extra: Partial<Viewer> = {}): Viewer => ({
  me,
  host: me === "a",
  solo: false,
  display: false,
  ...extra,
});

test("the lobby offers the tour and every level, and one rider is enough to start", () => {
  assert.equal(LEVEL_CHOICES[0]!.level, 0);
  assert.equal(LEVEL_CHOICES.length, LEVELS.length);
  assert.equal(LEVEL_CHOICES[0]!.title, LEVELS[0]!.name.toUpperCase());
  assert.equal(levelFrom("3", 0), 3);
  for (const bad of [null, "", "x", "-1", String(LEVELS.length), "1.5"])
    assert.equal(levelFrom(bad, 7), 7, String(bad));

  const room = seated();
  const host = present(view(room), viewer("a"));
  assert.equal(host.screen, "lobby");
  assert.equal(host.lobby.showStart, true);
  assert.equal(host.lobby.canStart, true);
  assert.equal(host.lobby.editable, true);
  assert.deepEqual(
    host.lobby.members.map((member) => [member.name, member.you]),
    [
      ["Ada", true],
      ["Bo", false],
    ],
  );
  assert.equal(host.askName, false);
  const guest = present(view(room), viewer("b"));
  assert.equal(guest.lobby.showStart, false);
  assert.equal(guest.lobby.editable, false);
  assert.equal(guest.lobby.note, "Waiting for the host to start");
  const stranger = present(view(room), viewer("z"));
  assert.equal(stranger.askName, true);
  assert.equal(
    present(view(room), viewer("tv", { display: true })).askName,
    false,
  );

  // Alone in the room: the host can start.
  fold(room, { a: [[LEAVE, "b"]] });
  const alone = present(view(room), viewer("a"));
  assert.equal(alone.lobby.members.length, 1);
  assert.equal(alone.lobby.canStart, true);
  assert.match(alone.lobby.note, /Start alone/);
});

test("a race is shown to its riders one pane each, to a watcher and the TV as every rider", () => {
  const room = started();
  const frame = view(room);
  const ada = present(frame, viewer("a"));
  assert.equal(ada.screen, "play");
  assert.equal(ada.riding, true);
  assert.equal(ada.localSlot, 0);
  assert.deepEqual(ada.follow, [0]);
  assert.deepEqual(ada.tags, ["Ada", "Bo"]);
  assert.equal(ada.title, `${LEVELS[0]!.name.toUpperCase()} · 1 / 3`);
  assert.equal(
    ada.controlsVisible,
    true,
    "the guide shows for the first countdown",
  );
  assert.equal(ada.status, "GET READY");
  assert.equal(ada.result, null);
  assert.equal(ada.table, null);
  const bo = present(frame, viewer("b"));
  assert.deepEqual(bo.follow, [1]);
  const tv = present(frame, viewer("tv", { display: true }));
  assert.equal(tv.screen, "play");
  assert.equal(tv.riding, false);
  assert.deepEqual(tv.follow, [0, 1]);
  assert.equal(tv.note, "");
  const watcher = present(frame, viewer("z"));
  assert.deepEqual(watcher.follow, [0, 1]);
  assert.equal(watcher.note, "Pick a name to ride in the next match");

  while (room.world!.phase === "countdown") fold(room);
  const riding = present(view(room), viewer("a"));
  assert.equal(riding.controlsVisible, false);
  assert.equal(
    riding.status,
    `APPLES 0 / ${LEVELS[0]!.objects.filter((o) => o.kind === "apple").length} · 1ST`,
  );
  // A single level has no race number.
  const single = started(SINGLE);
  assert.equal(
    present(view(single), viewer("a")).title,
    LEVELS[0]!.name.toUpperCase(),
  );
});

test("a shared screen makes every rider's phone a controller and leaves the race to the TV", () => {
  const room = started({ ...SINGLE, display: true });
  const frame = view(room);
  assert.equal(present(frame, viewer("a")).screen, "controller");
  assert.equal(present(frame, viewer("b")).screen, "controller");
  assert.equal(present(frame, viewer("tv", { display: true })).screen, "play");
  // A phone that is not in the race watches it instead.
  assert.equal(present(frame, viewer("z")).screen, "play");
  while (room.world!.phase === "countdown") fold(room);
  room.world!.riders[0]!.status = 1;
  assert.equal(present(view(room), viewer("a")).status, "CRASHED");
});

test("between two races of a tour the table shows the race's places, times and the running points", () => {
  const room = started();
  finishRace(room, [800, 960]);
  assert.equal(room.stage, "between");
  const model = present(view(room), viewer("b"));
  assert.equal(model.screen, "play");
  assert.equal(
    model.riding,
    true,
    "the controls stay this device's between races",
  );
  assert.equal(model.result, null);
  const table = model.table!;
  assert.equal(table.title, `${LEVELS[0]!.name.toUpperCase()} · RACE 1 OF 3`);
  assert.deepEqual(table.rows, [
    {
      place: 1,
      slot: 0,
      name: "Ada",
      you: false,
      detail: "0:10.00",
      points: `+${PLACE_POINTS[0]} · ${PLACE_POINTS[0]}`,
    },
    {
      place: 2,
      slot: 1,
      name: "Bo",
      you: true,
      detail: "0:12.00",
      points: `+${PLACE_POINTS[1]} · ${PLACE_POINTS[1]}`,
    },
  ]);
  assert.equal(table.next, "NEXT MAP IN 6");
  assert.equal(model.status, "NEXT MAP IN 6");
  run(room, 20 * 3);
  assert.equal(present(view(room), viewer("b")).table!.next, "NEXT MAP IN 3");
});

test("a rider who never reached the flower is listed without a time or points", () => {
  const room = started(SINGLE);
  const world = room.world!;
  while (world.phase === "countdown") fold(room);
  world.riders[0]!.status = FINISHED;
  world.riders[0]!.finish = world.riders[0]!.run = world.riders[0]!.step = 400;
  // The other rider never said how far it rode: the race stops waiting a while past its close.
  world.close = 400 + 30 * STEPS_PER_SECOND;
  world.step = world.close + CLOSE_LAG;
  fold(room);
  assert.equal(room.stage, "over");
  const model = present(view(room), viewer("b"));
  assert.equal(model.result!.title, "ADA WINS");
  assert.deepEqual(
    model.result!.rows.map((row) => [row.place, row.name, row.detail, row.you]),
    [
      [1, "Ada", "0:05.00", false],
      [2, "Bo", "DNF", true],
    ],
  );
  assert.equal(model.status, "2ND PLACE");
  assert.equal(model.result!.host, false);
  assert.match(model.result!.waiting, /Waiting for the host/);
  const host = present(view(room), viewer("a"));
  assert.equal(host.result!.title, "YOU WIN!");
  assert.equal(host.result!.host, true);
  assert.equal(host.result!.waiting, "");
  assert.equal(host.result!.solo, null);
  assert.equal(host.riding, false);
});

test("a tour's result ranks by points and says how many maps each rider finished", () => {
  const room = started();
  for (let race = 0; race < 3; race++) {
    assert.equal(room.stage, "running", `race ${race}`);
    // Bo wins the first race, Ada every other.
    finishRace(room, race === 0 ? [960, 800] : [800, 960]);
    while (stageOf(room) === "between") fold(room);
  }
  assert.equal(stageOf(room), "over");
  const model = present(view(room), viewer("b"));
  assert.equal(model.result!.title, "ADA WINS");
  assert.deepEqual(model.result!.rows, [
    {
      place: 1,
      slot: 0,
      name: "Ada",
      you: false,
      detail: "3 / 3 MAPS",
      points: "27 PTS",
    },
    {
      place: 2,
      slot: 1,
      name: "Bo",
      you: true,
      detail: "3 / 3 MAPS",
      points: "24 PTS",
    },
  ]);
  assert.equal(model.table, null);
});

/** A solo room: one rider, one level, started. */
function soloRoom(level = 0): Room {
  const room = seated({ ...SINGLE, level });
  fold(room, { a: [[PRESENCE, "b", false, 1]] });
  fold(room, { a: [[ACTION, "start", "s1"]] });
  assert.equal(room.roster.length, 1);
  return room;
}

test("a solo ride ends on its time, the best for the level, and where NEXT MAP goes", () => {
  const me = viewer("a", { solo: true, host: true });
  const room = soloRoom(0);
  assert.equal(present(view(room), me).title, LEVELS[0]!.name.toUpperCase());
  finishRace(room, [888]);
  assert.equal(room.stage, "over");
  const time = centiseconds(888);
  const first = present(view(room), me, undefined).result!;
  assert.equal(first.title, LEVELS[0]!.name.toUpperCase());
  assert.deepEqual(first.lines, ["TIME 0:11.10", "NEW BEST!"]);
  assert.deepEqual(first.solo, { level: 0, next: 1, finished: true });
  assert.equal(first.host, true);
  assert.deepEqual(first.rows, []);
  // Slower than the best there was.
  assert.deepEqual(present(view(room), me, time - 100).result!.lines, [
    "TIME 0:11.10",
    "BEST 0:10.10",
  ]);
  // Faster.
  assert.deepEqual(present(view(room), me, time + 1).result!.lines, [
    "TIME 0:11.10",
    "NEW BEST!",
  ]);
  // Equal is not a new best.
  assert.deepEqual(present(view(room), me, time).result!.lines, [
    "TIME 0:11.10",
    "BEST 0:11.10",
  ]);
  // Crashes on the way are told.
  room.world!.riders[0]!.deaths = 2;
  assert.equal(
    present(view(room), me, time).result!.lines[2],
    "2 crashes on the way",
  );
  // The last level's NEXT MAP is the first.
  const last = soloRoom(LEVELS.length - 1);
  finishRace(last, [500]);
  assert.equal(present(view(last), me).result!.solo!.next, 0);
});

test("NEXT MAP is a settings change and a rematch on one tick", () => {
  const room = soloRoom(0);
  finishRace(room, [500]);
  fold(room, {
    a: [
      [SETTINGS, { ...SINGLE, level: 1 }],
      [ACTION, "rematch", "s2"],
    ],
  });
  assert.equal(room.stage, "running");
  assert.equal(room.world!.level, 1);
  assert.equal(
    present(view(room), viewer("a", { solo: true })).title,
    LEVELS[1]!.name.toUpperCase(),
  );
});

test("each finished run is reported once, by the device that rode it, when its race is over", () => {
  const watch = createFinishWatch();
  const room = started();
  assert.deepEqual(watch(view(room), "a"), []);
  while (room.world!.phase === "countdown") fold(room);
  room.world!.riders[0]!.status = FINISHED;
  room.world!.riders[0]!.finish = room.world!.riders[0]!.run = 400;
  assert.deepEqual(
    watch(view(room), "a"),
    [],
    "not while the race is still running",
  );
  finishRace(room, [400, 960]);
  const frame = view(room);
  assert.deepEqual(watch(frame, "a"), [
    {
      level: LEVELS[0]!.id,
      centiseconds: 500,
      deaths: 0,
      place: 1,
      riders: 2,
      tour: true,
    },
  ]);
  assert.deepEqual(watch(frame, "a"), [], "once");
  assert.deepEqual(watch(frame, "tv"), [], "a device with no rider");
  assert.deepEqual(createFinishWatch()(view(seated()), "a"), []);
});

// ---- session, best times, art, sound ----

test("the page's query decides the session, and a browser that refuses storage still plays", () => {
  const store = fakeStore();
  const valid = (code: string) => /^[A-Z0-9]{4}$/.test(code);
  let n = 0;
  const secret = () => `secret-${++n}`;
  assert.deepEqual(sessionFor("", store, "g", valid, secret), {
    kind: "landing",
  });
  assert.deepEqual(sessionFor("?solo=1", store, "g", valid, secret), {
    kind: "solo",
  });
  assert.deepEqual(sessionFor("?room=no", store, "g", valid, secret), {
    kind: "invalid",
    code: "NO",
  });
  const joiner = sessionFor("?room=abcd", store, "g", valid, secret);
  assert.deepEqual(joiner, {
    kind: "room",
    code: "ABCD",
    role: "joiner",
    token: "secret-1",
  });
  assert.deepEqual(
    sessionFor("?room=ABCD", store, "g", valid, secret),
    joiner,
    "a refresh is the same member",
  );
  store.setItem(keys("g").host("WXYZ"), "host-token");
  assert.deepEqual(sessionFor("?room=WXYZ", store, "g", valid, secret), {
    kind: "room",
    code: "WXYZ",
    role: "host",
    token: "host-token",
  });
  const tv = sessionFor("?room=WXYZ&display=1", store, "g", valid, secret);
  assert.equal(tv.kind === "room" && tv.role, "display");
  assert.equal(keys("g").best("warm-up"), "g-best-warm-up");

  const refusing = safeStore(() => {
    throw new Error("blocked");
  });
  refusing.setItem("k", "v");
  assert.equal(refusing.getItem("k"), "v");
  refusing.removeItem("k");
  assert.equal(refusing.getItem("k"), null);
  assert.equal(roomFailure("unknown game elasto-fuse"), NOT_OPEN);
  assert.equal(roomFailure("anything else"), "anything else");
});

test("a solo best is stored once per ride, only when it is better, and read back defensively", () => {
  const store = fakeStore();
  const bests = createBestTimes(store);
  const key = keys("g").best("warm-up");
  assert.equal(bestTime(store, key), undefined);
  assert.equal(bests.settle("m1", key, 1200), undefined, "no best before");
  assert.equal(bestTime(store, key), 1200);
  assert.equal(
    bests.settle("m1", key, 1200),
    undefined,
    "the same ride keeps saying what the best was before it",
  );
  assert.equal(bests.settle("m2", key, 1300), 1200);
  assert.equal(bestTime(store, key), 1200, "a slower ride changes nothing");
  assert.equal(bests.settle("m3", key, 1100), 1200);
  assert.equal(bestTime(store, key), 1100);
  assert.equal(
    bests.settle("m4", key, undefined),
    1100,
    "a ride that never got home",
  );
  assert.equal(bestTime(store, key), 1100);
  for (const junk of ["", "abc", "-5", "0", "12.5", "1e99x"]) {
    store.setItem(key, junk);
    assert.equal(bestTime(store, key), undefined, junk);
  }
});

test("art arrives in the background, a missing file leaves its fallback, and each slot gets its own hue", async () => {
  const pending = new Map<
    string,
    (image: CanvasImageSource | undefined) => void
  >();
  const loader: ImageLoader = {
    load: (url) => new Promise((resolve) => pending.set(url, resolve)),
  };
  // An image is anything the canvas can draw; the loader's are opaque to the manifest.
  const image = (name: string) => ({ name }) as unknown as CanvasImageSource;
  const tints: [CanvasImageSource, number][] = [];
  const art = loadArt("/base/", loader, (plain, degrees) => {
    tints.push([plain, degrees]);
    return image(`tinted-${degrees}`);
  });
  const root = artBase("/base/");
  assert.equal(root, "/base/games/elasto-fuse/art/v1/");
  assert.deepEqual(
    [...pending.keys()].sort(),
    Object.values(ART_FILES)
      .map((file) => root + file)
      .sort(),
  );
  assert.equal(art().ground, undefined);
  assert.equal(
    art().bike?.(0),
    undefined,
    "no sprites yet: the fallback draws",
  );

  const wheel = image("wheel"),
    sky = image("sky");
  pending.get(root + ART_FILES.wheel)!(wheel);
  pending.get(root + ART_FILES.sky)!(sky);
  pending.get(root + ART_FILES.frame)!(undefined);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(art().sky, sky);
  assert.equal(art().apple, undefined);
  // The first slot rides the painted cyan; the others are turned, once.
  assert.deepEqual(art().bike?.(0), { wheel });
  assert.equal(tints.length, 0);
  const pink = art().bike?.(1);
  assert.notEqual(pink?.wheel, wheel);
  assert.equal(pink?.frame, undefined, "a file that failed stays procedural");
  assert.equal(tints.length, 1);
  assert.equal(tints[0]![0], wheel);
  assert.ok(tints[0]![1] > 0 && tints[0]![1] < 360);
  assert.equal(art().bike?.(1), pink, "asked every frame, tinted once");
  assert.equal(tints.length, 1);
  // A sprite that arrives later joins the set without tinting the wheel again.
  pending.get(root + ART_FILES.head)!(image("head"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(Object.keys(art().bike?.(1) ?? {}).sort(), [
    "head",
    "wheel",
  ]);
  assert.equal(tints.length, 2);
  assert.ok(BIKE_KEYS.every((key) => key in ART_FILES));

  // A browser that will not hand over the pixels keeps the cyan sprite.
  const plain = loadArt("/", { load: async () => wheel }, () => undefined);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(plain().bike?.(2)?.wheel, wheel);
});

test("a muted page never opens the browser's audio; the hum follows the gas and the wheel", () => {
  const quiet = createAudioRig();
  const mutedAudio = createGameAudio(quiet.deps, { forceMute: true });
  const muted = createSfx(mutedAudio);
  mutedAudio.unlock();
  muted.play({ kind: "go" });
  muted.engine(1, true, true);
  assert.equal(quiet.log.opens, 0);

  const rig = createAudioRig();
  const audio = createGameAudio(rig.deps);
  const sfx = createSfx(audio);
  sfx.engine(0.5, true, true);
  sfx.play({ kind: "go" });
  assert.equal(rig.log.oscillators, 0, "nothing before the first input");
  audio.unlock();
  sfx.engine(0, false, false);
  assert.equal(rig.log.oscillators, 0, "no bike on the track: no engine");
  sfx.engine(0.5, true, true);
  sfx.engine(0.9, true, true);
  assert.equal(rig.log.oscillators, 2, "one engine: a voice and its octave");
  sfx.play({ kind: "crash", slot: 0, x: 0, y: 0 });
  assert.equal(rig.log.noises, 1);
  assert.equal(rig.log.oscillators, 3);
  audio.setMuted(true);
  sfx.play({ kind: "go" });
  assert.equal(rig.log.oscillators, 3, "the header's mute rules the effects");
  assert.deepEqual(ELASTO_SONGS, []);

  assert.ok(humPitch(1, false) > humPitch(0, false));
  assert.ok(humPitch(0.5, true) > humPitch(0.5, false));
  assert.equal(humPitch(9, false), humPitch(1, false));
  assert.equal(humVolume(1, true, false), 0, "no bike on the track: silence");
  assert.ok(humVolume(0, false, true) > 0, "idling");
  assert.ok(humVolume(0, true, true) > humVolume(0, false, true));
});
