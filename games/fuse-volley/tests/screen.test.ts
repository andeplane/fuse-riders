import test from "node:test";
import assert from "node:assert/strict";
import {
  JUMP,
  RIGHT,
  STEPS_PER_TICK,
  stepWorld,
  toView,
  type World,
} from "../src/engine/index.js";
import type { WorldView } from "../src/engine/view.js";
import * as T from "../src/engine/tuning.js";
import {
  MAX_AHEAD,
  blendViews,
  copyWorld,
  createLeadClock,
  forward,
  forwardInputs,
  memoBot,
  stepsAhead,
} from "../src/app/forward.js";
import {
  SCORING_CHOICES,
  createPointWatch,
  present,
  type Viewer,
} from "../src/app/presenter.js";
import { loadArt, type ImageLoader } from "../src/app/art.js";
import { createSfx, type SfxDependencies } from "../src/app/audio.js";
import { advanced, cuesBetween } from "../src/render/cues.js";
import { createJelly } from "../src/render/jelly.js";
import { DECAY_MS, createSmoother } from "../src/render/smooth.js";
import { view, type BotInput } from "../src/online/game.js";
import { fresh, rally, steps } from "./fixtures/world.js";
import { fold, run, seated, started } from "./fixtures/room.js";

const hold = (left: number, right: number) => ({
  held: (_world: World, side: 0 | 1) => (side === 0 ? left : right),
});

test("the forward run plays the newest world on a copy, exactly as the fold would", () => {
  const world = fresh();
  steps(world, 30);
  const before = JSON.stringify(world);
  const drawn = forward(world, STEPS_PER_TICK, hold(RIGHT, JUMP));
  assert.equal(JSON.stringify(world), before, "the room's world is untouched");
  const expected = copyWorld(world);
  for (let i = 0; i < STEPS_PER_TICK; i++) stepWorld(expected, [RIGHT, JUMP]);
  assert.deepEqual(drawn, toView(expected));
  assert.deepEqual(forward(world, 0, hold(0, 0)), toView(world));
  assert.deepEqual(
    forward(world, 99, hold(0, 0)),
    forward(world, MAX_AHEAD, hold(0, 0)),
    "never further than two log ticks",
  );
});

test("a fraction of a step is drawn between the two steps either side", () => {
  const world = rally(fresh(), 300, 300, 64, 0);
  const a = forward(world, 2, hold(0, 0)),
    b = forward(world, 3, hold(0, 0)),
    half = forward(world, 2.5, hold(0, 0));
  assert.ok(Math.abs(half.ball.x - (a.ball.x + b.ball.x) / 2) < 1e-9);
  assert.deepEqual(half.score, a.score);
  // A new serve is never smeared across.
  const served = { ...b, phase: "serve" as const };
  assert.equal(blendViews(a, served, 0.5), a);
  assert.equal(blendViews(a, b, 0), a);
  assert.equal(blendViews(a, b, 1), b);
});

test("steps ahead come from the runtime's clock, clamped to a log tick", () => {
  assert.equal(stepsAhead({ tick: 60, lead: 0.5 }, 60), 3);
  assert.equal(stepsAhead({ tick: 57, lead: 1 }, 60), 3);
  assert.equal(stepsAhead({ tick: 54, lead: 0 }, 60), 0);
  assert.equal(stepsAhead({ tick: 60, lead: 1 }, 54), STEPS_PER_TICK);
});

test("while the fold is late the wall clock carries the picture on, then hands back without a jump", () => {
  const lead = createLeadClock();
  const stepMs = 1000 / T.STEPS_PER_SECOND;
  assert.equal(lead(3, 60, 1000), 3);
  assert.equal(lead(STEPS_PER_TICK, 60, 1000 + 3 * stepMs), STEPS_PER_TICK);
  const late = lead(STEPS_PER_TICK, 60, 1000 + 4 * stepMs);
  assert.ok(Math.abs(late - 7) < 1e-9, `the clock kept moving: ${late}`);
  assert.equal(lead(STEPS_PER_TICK, 60, 1000 + 99 * stepMs), MAX_AHEAD);
  assert.equal(lead(1, 66, 1000 + 7 * stepMs), 1, "the next fold takes over");
});

test("the forward run plays a bot as the fold would, a human as last logged, and leads this device when asked", () => {
  const room = started();
  room.held = { a: RIGHT, b: JUMP };
  const asked: number[] = [];
  const bot: BotInput = (_world, side) => {
    asked.push(side);
    return JUMP;
  };
  const world = room.world!;
  const plain = forwardInputs(room, "a", 0, false, bot);
  assert.equal(plain.held(world, 0), RIGHT);
  assert.equal(plain.held(world, 1), JUMP);
  const led = forwardInputs(room, "a", 0, true, bot);
  assert.equal(led.held(world, 0), 0, "this device's own live bits");
  room.seats.get("b")!.connected = false;
  assert.equal(plain.held(world, 1), 0, "an absent player holds nothing");
  room.seats.get("b")!.bot = true;
  assert.equal(plain.held(world, 1), JUMP);
  assert.deepEqual(asked, [1]);
});

const viewer = (me: string, host = false): Viewer => ({
  me,
  host,
  solo: false,
  display: false,
});

test("the lobby says what scoring means and who can start", () => {
  assert.match(SCORING_CHOICES[0]!.blurb, /Every rally scores a point/);
  assert.match(SCORING_CHOICES[1]!.blurb, /Only the serving side can score/);
  const room = seated();
  const host = present(view(room), viewer("a", true));
  assert.equal(host.screen, "lobby");
  assert.equal(host.lobby.canStart, true);
  assert.equal(host.lobby.members.length, 2);
  assert.equal(host.scoringName, "QUICK · TO 11");
  const guest = present(view(room), viewer("b"));
  assert.equal(guest.lobby.showStart, false);
  assert.equal(guest.lobby.note, "Waiting for the host to start");
});

test("in a match each player sees their side; on a shared screen a phone becomes a controller", () => {
  const room = started();
  const a = present(view(room), viewer("a", true));
  assert.equal(a.screen, "play");
  assert.equal(a.localSlot, 0);
  assert.equal(a.riding, true);
  assert.equal(a.controlsVisible, true, "the guide shows for the first serve");
  assert.deepEqual(a.names, ["Ada", "Bo"]);
  const shared = started({
    display: true,
    scoring: "classic",
    bot: 1,
    team: 1,
  });
  const phone = present(view(shared), viewer("b"));
  assert.equal(phone.screen, "controller");
  assert.match(phone.status, /^0 – 0 · /);
  assert.equal(phone.scoringName, "CLASSIC · TO 15");
  const tv = present(view(shared), { ...viewer("tv"), display: true });
  assert.equal(tv.screen, "play");
  assert.equal(tv.localSlot, -1);
});

/** Drops the ball on `loser`'s sand and runs until the rally's settle has passed the reporting point. */
function losePoint(room: ReturnType<typeof started>, loser: 0 | 1): void {
  const world = room.world!;
  Object.assign(world.ball, {
    x: (loser === 0 ? 200 : 600) * T.BU,
    y: T.BALL_FLOOR + 10,
    vx: 0,
    vy: -50,
    live: true,
  });
  world.phase = "rally";
  world.lastTouch = -1;
  run(room, 3);
}

test("each point is reported once, by the device that won it, after its settle", () => {
  const room = started();
  const forA = createPointWatch(),
    forB = createPointWatch();
  assert.deepEqual(forA(view(room), "a"), []);
  assert.deepEqual(forB(view(room), "b"), []);
  losePoint(room, 1);
  assert.equal(room.world!.phase, "dead");
  assert.deepEqual(forA(view(room), "a"), [], "not before the settle");
  run(room, 12);
  const reports = forA(view(room), "a");
  assert.equal(reports.length, 1);
  assert.equal(reports[0]!.mine, true);
  assert.equal(reports[0]!.scoring, "rally");
  assert.deepEqual(forA(view(room), "a"), [], "once");
  assert.deepEqual(
    forB(view(room), "b"),
    [],
    "the loser does not report a human's point",
  );
  fold(room, {});
});

test("cues come from counters moving forward, once each", () => {
  assert.equal(advanced(5, 6), 1);
  assert.equal(advanced(0xffff, 0), 1);
  assert.equal(advanced(6, 5), 0);
  const world = rally(fresh(), 200, 200, 0, 0);
  const before = toView(world);
  world.hitCounter = 1;
  world.lastTouch = 0;
  world.netCounter = 1;
  world.blobs[1]!.air = true;
  const after = toView(world);
  const kinds = cuesBetween(before, after).map((cue) => cue.kind);
  assert.deepEqual(kinds, ["hit", "net", "jump"]);
  assert.deepEqual(cuesBetween(after, after), []);
  assert.deepEqual(cuesBetween(undefined, after), []);
  assert.deepEqual(
    cuesBetween(after, { ...before, step: before.step - 1 }),
    [],
    "a rollback to an earlier step says nothing",
  );
});

const moved = (base: WorldView, dx: number): WorldView => ({
  ...base,
  ball: { ...base.ball, x: base.ball.x + dx },
  blobs: [
    { ...base.blobs[0]!, x: base.blobs[0]!.x + dx },
    { ...base.blobs[1]!, x: base.blobs[1]!.x + dx },
  ],
});

test("a rollback correction eases in, the local blob never does, and a teleport is shown as it is", () => {
  const smoother = createSmoother();
  const base = toView(rally(fresh(), 300, 200, 0, 0));
  assert.equal(smoother.apply(base, 1, 0, 0).ball.x, base.ball.x);
  const corrected = moved(base, 20);
  const first = smoother.apply(corrected, 2, 0, 0);
  assert.equal(first.ball.x, base.ball.x, "drawn where it was");
  assert.equal(
    first.blobs[0]!.x,
    corrected.blobs[0]!.x,
    "the local blob follows its player exactly",
  );
  assert.equal(first.blobs[1]!.x, base.blobs[1]!.x);
  const later = smoother.apply(corrected, 2, DECAY_MS, 0);
  assert.ok(Math.abs(later.ball.x - (corrected.ball.x - 20 / Math.E)) < 0.01);
  const settled = smoother.apply(corrected, 2, DECAY_MS * 20, 0);
  assert.equal(settled.ball.x, corrected.ball.x);
  const far = moved(corrected, 300);
  assert.equal(smoother.apply(far, 3, DECAY_MS * 21, 0).ball.x, far.ball.x);
});

test("the jelly wobbles after a kick and comes back to rest", () => {
  const jelly = createJelly(() => 0.5);
  const blobs = toView(fresh()).blobs;
  const rest = jelly.update(blobs, 0);
  assert.equal(rest[0]!.stretch, 1);
  jelly.kick(0, 1);
  let low = 1,
    high = 1;
  for (let t = 16; t < 400; t += 16) {
    const pose = jelly.update(blobs, t)[0]!;
    low = Math.min(low, pose.stretch);
    high = Math.max(high, pose.stretch);
  }
  assert.ok(low < 0.95, `squashed: ${low}`);
  assert.ok(high > 1, `overshoots back past rest: ${high}`);
  const end = jelly.update(blobs, 3000)[0]!;
  for (let t = 3016; t < 6000; t += 16) jelly.update(blobs, t);
  assert.ok(
    Math.abs(jelly.update(blobs, 6000)[0]!.stretch - 1) < 0.03,
    `${end.stretch}`,
  );
});

test("art arrives in the background and a missing file leaves its fallback", async () => {
  const asked: string[] = [];
  const image = { width: 1 } as unknown as CanvasImageSource;
  const loader: ImageLoader = {
    load(url) {
      asked.push(url);
      return Promise.resolve(url.endsWith("ball.png") ? undefined : image);
    },
  };
  const art = loadArt("/base/", loader);
  assert.deepEqual(art(), {});
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(
    asked.every((url) => url.startsWith("/base/games/fuse-volley/art/v1/")),
  );
  assert.equal(art().court, image);
  assert.equal(art().ball, undefined);
  assert.deepEqual(art().blobs, [image, image]);
});

test("a muted page never opens the browser's audio", () => {
  let opened = 0;
  const deps: SfxDependencies = {
    open() {
      opened++;
      return undefined;
    },
    later() {},
    random: () => 0.5,
  };
  const muted = createSfx(true, deps);
  muted.resume();
  muted.play({ kind: "point", loser: 0, scored: true, matchPoint: -1 });
  assert.equal(opened, 0);
  const sounding = createSfx(false, deps);
  sounding.play({ kind: "serve", side: 0 });
  assert.equal(opened, 1);
});

test("the drawn bot plans once per folded step and side", () => {
  let plans = 0;
  const bot = memoBot((_world, side) => {
    plans++;
    return side === 0 ? RIGHT : JUMP;
  });
  const world = fresh();
  assert.equal(bot(world, 0, 2), RIGHT);
  assert.equal(bot(world, 0, 2), RIGHT);
  assert.equal(bot(world, 1, 2), JUMP);
  assert.equal(plans, 2);
  steps(world, 1);
  bot(world, 0, 2);
  assert.equal(plans, 3);
});

test("a classic side-out is not reported as a point", () => {
  const room = started({
    display: false,
    scoring: "classic",
    bot: 1,
    team: 1,
  });
  const server = room.world!.server;
  const watch = createPointWatch();
  const me = server === 0 ? "b" : "a";
  watch(view(room), me);
  // The receiver wins the rally: the serve moves, nobody scores.
  losePoint(room, server);
  run(room, 15);
  assert.deepEqual(room.world!.score, [0, 0]);
  assert.deepEqual(watch(view(room), me), []);
});
