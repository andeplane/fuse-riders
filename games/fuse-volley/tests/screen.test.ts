import type { Cue } from "../src/render/cues.js";
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
  SCORING_CHOICES,
  createPointWatch,
  present,
  type Viewer,
} from "../src/app/presenter.js";
import { loadArt, type ImageLoader } from "../src/app/art.js";
import { createSfx } from "../src/app/audio.js";
import { createGameAudio } from "fuse-ui/game-audio";
import { createAudioRig } from "fuse-ui/game-audio-fake";
import { advanced, cuesBetween } from "../src/render/cues.js";
import { createJelly } from "../src/render/jelly.js";
import { view, type BotInput } from "../src/online/game.js";
import { fresh, rally, steps } from "./fixtures/world.js";
import { fold, run, seated, started } from "./fixtures/room.js";

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
    format: "1v1",
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
  const lime = { width: 2 } as unknown as CanvasImageSource;
  const loader: ImageLoader = {
    load(url) {
      asked.push(url);
      return Promise.resolve(url.endsWith("ball.png") ? undefined : image);
    },
    recolour: () => lime,
  };
  const art = loadArt("/base/", loader);
  assert.deepEqual(art(), {});
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(
    asked.every((url) => url.startsWith("/base/games/fuse-volley/art/v1/")),
  );
  assert.equal(art().court, image);
  assert.equal(art().ball, undefined);
  // The third team's lime blob is the cyan one recoloured.
  assert.deepEqual(art().blobs, [image, image, lime]);
});

test("sounds: silent when muted, a voice for each cue once the page may play", async () => {
  const quiet = createAudioRig();
  const muted = createGameAudio(quiet.deps, { forceMute: true });
  const cues: Cue[] = [
    { kind: "hit", side: 0, slot: 0, x: 1, y: 2, speed: 6, touches: 1 },
    { kind: "net", x: 1, y: 2 },
    { kind: "floor", x: 1, speed: 4 },
    { kind: "floor", x: 1, speed: 0.1 },
    { kind: "land", side: 0, slot: 0, x: 1 },
    { kind: "jump", side: 0, slot: 0, x: 1 },
    { kind: "point", loser: 0, scored: true, matchPoint: 1 },
    { kind: "serve", side: 0 },
    { kind: "over", winner: 0 },
  ];
  for (const cue of cues) createSfx(muted).play(cue);
  assert.equal(quiet.log.opens, 0, "a muted page never opens audio");
  const rig = createAudioRig("suspended");
  const audio = createGameAudio(rig.deps);
  const sfx = createSfx(audio);
  sfx.play(cues[0]!);
  assert.equal(rig.log.oscillators, 0, "nothing before the first input");
  audio.unlock();
  await Promise.resolve();
  for (const cue of cues) sfx.play(cue);
  rig.timers.forEach((run) => run());
  assert.ok(rig.log.oscillators > 10 && rig.log.noises >= 2);
});

test("a classic side-out is not reported as a point", () => {
  const room = started({
    display: false,
    scoring: "classic",
    bot: 1,
    format: "1v1",
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
