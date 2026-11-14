import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTION,
  BOT,
  JOIN,
  LEAVE,
  PRESENCE,
  SETTINGS,
  SPECTATOR,
} from "fuse-netcode";
import { createGameAudio } from "fuse-ui/game-audio";
import { createAudioRig } from "fuse-ui/game-audio-fake";
import {
  DUCK,
  HIGH,
  JUMP,
  LOW,
  STEPS_PER_TICK,
  cloneWorld,
  stepWorld,
  toView,
  type World,
} from "../src/engine/index.js";
import type { WorldView } from "../src/engine/view.js";
import * as T from "../src/engine/tuning.js";
import {
  MAX_AHEAD,
  blendViews,
  createLeadClock,
  forward,
  forwardInputs,
  memoBot,
  stepsAhead,
} from "../src/app/forward.js";
import {
  BOT_CHOICES,
  HIT_CHOICES,
  PACE_CHOICES,
  RECOVER_CHOICES,
  ROUND_SETTLE_STEPS,
  TARGET_CHOICES,
  TIME_CHOICES,
  createRoundWatch,
  listNames,
  present,
  type Viewer,
} from "../src/app/presenter.js";
import { createSfx } from "../src/app/audio.js";
import {
  NOT_OPEN,
  keys,
  roomFailure,
  safeStore,
  sessionFor,
  type Store,
} from "../src/app/session.js";
import { sendReport, type DueReport } from "../src/app/reports.js";
import { LAST_SECONDS, cuesBetween, type Cue } from "../src/render/cues.js";
import {
  LANE,
  hexA,
  laneColor,
  laneDeep,
  laneLight,
  laneName,
} from "../src/render/palette.js";
import { DECAY_MS, TELEPORT, createSmoother } from "../src/render/smooth.js";
import {
  DEFAULT_SETTINGS,
  PLAY,
  parseSettings,
  view,
  type BotInput,
} from "../src/online/game.js";
import { matchResult } from "../src/online/result.js";
import { fresh, playing, steps, surge, until } from "./fixtures/world.js";
import { finish, fold, run, seated, started } from "./fixtures/room.js";

const hold = (...bits: number[]) => ({
  held: (_world: World, slot: number) => bits[slot] ?? 0,
});

test("the forward run plays the newest world on a copy, exactly as the fold would", () => {
  const world = fresh();
  steps(world, 30);
  const before = JSON.stringify(world);
  const drawn = forward(world, STEPS_PER_TICK, hold(JUMP, DUCK));
  assert.equal(JSON.stringify(world), before, "the room's world is untouched");
  const expected = cloneWorld(world);
  for (let i = 0; i < STEPS_PER_TICK; i++) stepWorld(expected, [JUMP, DUCK]);
  assert.deepEqual(drawn, toView(expected));
  assert.deepEqual(forward(world, 0, hold()), toView(world));
  assert.deepEqual(
    forward(world, 99, hold()),
    forward(world, MAX_AHEAD, hold()),
    "never further than two log ticks",
  );
});

test("a fraction of a step is drawn between the two steps either side, but never across a new round", () => {
  const world = playing();
  surge(world, LOW, 200);
  const a = toView(world);
  const next = cloneWorld(world);
  stepWorld(next, [JUMP, 0]);
  const b = toView(next);
  const half = forward(world, 0.5, hold(JUMP, 0));
  assert.equal(half.riders[0]!.y, (a.riders[0]!.y + b.riders[0]!.y) / 2);
  assert.equal(half.surges[0]!.x, (a.surges[0]!.x + b.surges[0]!.x) / 2);
  assert.equal(blendViews(a, b, 0), a);
  assert.equal(blendViews(a, b, 1), b);
  // A surge that is gone from the later view stays where the earlier one had it.
  assert.equal(
    blendViews(a, { ...b, surges: [] }, 0.5).surges[0]!.x,
    a.surges[0]!.x,
  );
  // A rider missing from the later view keeps its place too.
  assert.equal(
    blendViews(a, { ...b, riders: [] }, 0.5).riders[0]!.y,
    a.riders[0]!.y,
  );
  assert.equal(blendViews(a, { ...b, round: a.round + 1 }, 0.5), a);
  // A finished match is drawn as it stands.
  const over = cloneWorld(world);
  over.phase = "over";
  assert.deepEqual(forward(over, 3.5, hold(JUMP, JUMP)), toView(over));
});

test("steps ahead come from the runtime's clock, clamped to a log tick", () => {
  assert.equal(stepsAhead({ tick: 60, lead: 0.5 }, 60), 3);
  assert.equal(stepsAhead({ tick: 60, lead: 5 }, 60), STEPS_PER_TICK);
  assert.equal(stepsAhead({ tick: 54, lead: 0 }, 60), 0);
});

test("while the fold is late the wall clock carries the picture on, then hands back without a jump", () => {
  const lead = createLeadClock();
  assert.equal(lead(3, 60, 1000), 3);
  assert.equal(lead(STEPS_PER_TICK, 60, 1025), STEPS_PER_TICK);
  const late = lead(STEPS_PER_TICK, 60, 1025 + 1000 / 60);
  assert.ok(late > STEPS_PER_TICK && late <= MAX_AHEAD, String(late));
  assert.equal(
    lead(STEPS_PER_TICK, 60, 9999),
    MAX_AHEAD,
    "never past two ticks",
  );
  assert.equal(lead(1, 66, 10010), 1, "the next tick takes over");
});

test("the forward run plays a bot as the fold would, a human as last logged, and leads this device when asked", () => {
  const room = started();
  fold(room, { a: [[PLAY, "m1", DUCK]] });
  const bot: BotInput = () => JUMP;
  const world = room.world!;
  const logged = forwardInputs(room, "a", JUMP, false, bot);
  assert.equal(logged.held(world, 0), DUCK, "what a logged");
  assert.equal(logged.held(world, 1), 0, "b holds nothing");
  assert.equal(logged.held(world, 9), 0, "nobody rides that slot");
  const leading = forwardInputs(room, "a", JUMP, true, bot);
  assert.equal(leading.held(world, 0), JUMP, "what a holds right now");
  assert.equal(leading.held(world, 1), 0);
  // A room with a bot seat asks the bot.
  const withBot = seated();
  fold(withBot, { a: [[LEAVE, "b"]] });
  fold(withBot, { a: [[BOT, "add", "bot:1", "Volt", 1, "robot"]] });
  fold(withBot, { a: [[ACTION, "start", "m1"]] });
  assert.equal(withBot.stage, "running");
  assert.equal(
    forwardInputs(withBot, "a", 0, false, bot).held(withBot.world!, 1),
    JUMP,
  );
});

test("the drawn bot plans once per folded step and rider", () => {
  let calls = 0;
  const bot = memoBot(() => {
    calls++;
    return JUMP;
  });
  const world = fresh();
  assert.equal(bot(world, 0, 1), JUMP);
  bot(world, 0, 1);
  bot(world, 1, 1);
  assert.equal(calls, 2);
  stepWorld(world, []);
  bot(world, 0, 1);
  assert.equal(calls, 3);
});

const host: Viewer = { me: "a", host: true, solo: false, display: false },
  guest: Viewer = { me: "b", host: false, solo: false, display: false },
  tv: Viewer = { me: "", host: false, solo: false, display: true },
  stranger: Viewer = { me: "z", host: false, solo: false, display: false };

test("the lobby offers the match's choices, and says who can start", () => {
  for (const choices of [
    HIT_CHOICES,
    TIME_CHOICES,
    PACE_CHOICES,
    TARGET_CHOICES,
    RECOVER_CHOICES,
    BOT_CHOICES,
  ])
    assert.ok(choices.length >= 2);
  // Every choice the lobby offers is a setting the room takes, and the defaults are among them.
  for (const [key, choices] of [
    ["hits", HIT_CHOICES],
    ["seconds", TIME_CHOICES],
    ["pace", PACE_CHOICES],
    ["target", TARGET_CHOICES],
    ["recover", RECOVER_CHOICES],
    ["bot", BOT_CHOICES],
  ] as const) {
    for (const choice of choices)
      assert.ok(
        parseSettings({ ...DEFAULT_SETTINGS, [key]: choice.value }),
        key,
      );
    assert.ok(
      choices.some((choice) => choice.value === DEFAULT_SETTINGS[key]),
      key,
    );
  }
  const empty = present(view(fold0()), stranger);
  assert.equal(empty.lobby.note, "Pick a name to take a seat");
  assert.equal(empty.askName, true);
  const one = seated();
  fold(one, { a: [[LEAVE, "b"]] });
  const alone = present(view(one), host);
  assert.equal(alone.screen, "lobby");
  assert.equal(alone.lobby.canStart, false);
  assert.match(alone.lobby.note, /needs two riders/);
  assert.equal(alone.lobby.canAddBot, true);
  const room = seated();
  const mine = present(view(room), host);
  assert.equal(mine.lobby.canStart, true);
  assert.equal(mine.lobby.showStart, true);
  assert.equal(mine.lobby.editable, true);
  assert.equal(mine.lobby.note, "");
  assert.deepEqual(
    mine.lobby.members.map((member) => [member.name, member.you]),
    [
      ["Ada", true],
      ["Bo", false],
    ],
  );
  const theirs = present(view(room), guest);
  assert.equal(theirs.lobby.showStart, false);
  assert.equal(theirs.lobby.editable, false);
  assert.equal(theirs.lobby.note, "Waiting for the host to start");
  assert.deepEqual(theirs.lobby.removable, []);
  // A bot can be removed by the host, and a shared room says how it works.
  fold(room, { a: [[BOT, "add", "bot:1", "Volt", 2, "robot"]] });
  fold(room, { a: [[SETTINGS, { ...DEFAULT_SETTINGS, display: true }]] });
  const shared = present(view(room), host);
  assert.deepEqual(shared.lobby.removable, ["bot:1"]);
  assert.equal(shared.lobby.hasBot, true);
  assert.match(shared.lobby.note, /Shared screen/);
  assert.equal(present(view(room), tv).askName, false);
  assert.equal(present(view(room), { ...stranger, solo: true }).askName, false);
  assert.equal(listNames(["A"]), "A");
  assert.equal(listNames(["A", "B"]), "A & B");
  assert.equal(listNames(["A", "B", "C"]), "A, B & C");
});

/** An empty room in its lobby. */
function fold0() {
  const room = seated();
  fold(room, { a: [[LEAVE, "b"]] });
  fold(room, { a: [[LEAVE, "a"]] });
  return room;
}

test("in a match each rider gets its line; on a shared screen a phone becomes a controller", () => {
  const room = started({ ...DEFAULT_SETTINGS, target: 2 });
  let mine = present(view(room), host);
  assert.equal(mine.screen, "play");
  assert.equal(mine.riding, true);
  assert.equal(mine.localSlot, 0);
  assert.equal(
    mine.controlsVisible,
    true,
    "the guide shows for the first countdown",
  );
  assert.equal(mine.status, "ROUND 1 · GET READY");
  assert.deepEqual(mine.names, ["Ada", "Bo"]);
  assert.deepEqual(
    mine.riders.map((rider) => [
      rider.name,
      rider.you,
      rider.away,
      rider.wins,
      rider.out,
    ]),
    [
      ["Ada", true, false, 0, false],
      ["Bo", false, false, 0, false],
    ],
  );
  run(room, T.READY_STEPS / STEPS_PER_TICK);
  mine = present(view(room), host);
  assert.equal(mine.controlsVisible, false);
  assert.equal(mine.status, "3 HITS LEFT · 60 S");
  room.world!.riders[0]!.hits = 2;
  assert.match(present(view(room), host).status, /^1 HIT LEFT/);
  // A watcher, a seat for the next match and a stranger each get a line under the deck; the TV gets none.
  const watching = present(view(room), stranger);
  assert.equal(watching.screen, "play");
  assert.equal(watching.riding, false);
  assert.equal(watching.status, "ROUND 1");
  assert.equal(watching.note, "Pick a name to ride in the next match");
  fold(room, { a: [[SPECTATOR, "join", "z", "Zed", 1]] });
  assert.equal(present(view(room), stranger).note, "Watching");
  fold(room, { a: [[JOIN, "y", "Yo", 2, "robot", 1]] });
  assert.equal(
    present(view(room), { ...stranger, me: "y" }).note,
    "You ride in the next match",
  );
  assert.equal(present(view(room), tv).note, "");
  // b's device drops: its rider is away.
  fold(room, { a: [[PRESENCE, "b", false, 1]] });
  assert.equal(present(view(room), host).riders[1]!.away, true);
  // b is knocked off: the round is a's.
  finishRound(room, 0);
  const won = present(view(room), host),
    lost = present(view(room), guest);
  assert.equal(won.status, "ROUND WON!");
  assert.equal(lost.status, "ROUND LOST");
  assert.equal(won.riders[0]!.wins, 1);
  assert.equal(lost.riders[1]!.out, true);
  // A shared screen: riders hold controllers, the TV shows the deck.
  const shared = started({ ...DEFAULT_SETTINGS, display: true });
  assert.equal(present(view(shared), host).screen, "controller");
  assert.equal(present(view(shared), tv).screen, "play");
  assert.equal(present(view(shared), stranger).screen, "play");
});

/** Knocks everyone but `winner` off the deck this round. */
function finishRound(room: ReturnType<typeof started>, winner: number): void {
  const world = room.world!;
  const round = world.round;
  for (
    let i = 0;
    i < 2000 && world.phase !== "break" && world.round === round;
    i++
  ) {
    if (world.phase === "play")
      for (const [slot, rider] of world.riders.entries())
        if (slot !== winner && !rider.out)
          Object.assign(rider, {
            hits: world.rules.hits,
            out: true,
            duck: false,
            reel: 0,
            grace: 0,
          });
    run(room, 1);
  }
}

test("a rider knocked off reads so, a drawn round is drawn, and the result names the winner or the draw", () => {
  const room = started({ ...DEFAULT_SETTINGS, target: 1, hits: 1 });
  fold(room, { a: [[JOIN, "c", "Cy", 2, "robot", 1]] });
  run(room, T.READY_STEPS / STEPS_PER_TICK);
  // Nobody moves: the first surge takes both riders together.
  for (let i = 0; i < 2000 && room.world!.phase === "play"; i++) {
    run(room, 1);
    if (room.world!.riders[0]!.out && room.world!.phase === "play")
      assert.equal(present(view(room), host).status, "KNOCKED OFF");
  }
  assert.equal(room.world!.phase, "break");
  assert.equal(present(view(room), host).status, "ROUND DRAWN");
  run(room, T.BREAK_STEPS / STEPS_PER_TICK);
  assert.equal(room.stage, "over");
  const drawn = present(view(room), host);
  assert.equal(drawn.status, "A DRAW!");
  assert.equal(drawn.result!.title, "A DRAW: YOU SHARE IT!");
  assert.equal(drawn.result!.host, true);
  assert.equal(drawn.result!.waiting, "");
  assert.match(drawn.result!.lines[0]!, /^Ada: 1 round · 0 dodged · 1 hit$/);
  const onlooker = present(view(room), { ...stranger, me: "c" });
  assert.equal(onlooker.result!.title, "A DRAW: ADA & BO");
  assert.equal(
    onlooker.result!.waiting,
    "Waiting for the host to start a rematch",
  );
  assert.equal(onlooker.status, "MATCH OVER");
  assert.equal(onlooker.note, "", "the result speaks for itself");
  // One winner.
  const duel = started({ ...DEFAULT_SETTINGS, target: 2 });
  finish(duel, 1);
  assert.equal(present(view(duel), guest).result!.title, "YOU WIN!");
  assert.equal(present(view(duel), guest).status, "YOU WIN!");
  assert.equal(present(view(duel), host).result!.title, "BO WINS");
  assert.equal(present(view(duel), host).status, "YOU LOSE");
  assert.match(present(view(duel), host).result!.lines[0]!, /^Bo: 2 rounds/);
});

test("each round is reported once, by a device that rode it, after its end has settled", () => {
  const room = started({ ...DEFAULT_SETTINGS, target: 2 });
  const mine = createRoundWatch(),
    watcher = createRoundWatch();
  assert.deepEqual(
    mine(view(seated()), "a"),
    [],
    "no match, nothing to report",
  );
  assert.deepEqual(mine(view(room), "a"), []);
  finishRound(room, 0);
  assert.deepEqual(mine(view(room), "a"), [], "not settled yet");
  run(room, ROUND_SETTLE_STEPS / STEPS_PER_TICK + 1);
  assert.deepEqual(mine(view(room), "a"), [
    { round: 1, reason: "last", won: true, riders: 2, seconds: 60, hits: 3 },
  ]);
  assert.deepEqual(mine(view(room), "a"), [], "once");
  assert.deepEqual(watcher(view(room), "z"), [], "a watcher rode nothing");
  finish(room, 1);
  // The second round ended the match... and a's device slept through the third: it reports the last it sees.
  const last = mine(view(room), "a");
  assert.equal(last.length, 1);
  assert.equal(last[0]!.won, false);
  assert.equal(last[0]!.round, room.world!.round);
  // A new match starts the count again.
  fold(room, { a: [[ACTION, "rematch", "m2"]] });
  finishRound(room, 1);
  run(room, ROUND_SETTLE_STEPS / STEPS_PER_TICK + 1);
  assert.equal(mine(view(room), "b")[0]!.round, 1);
});

/** Two views a few steps apart, played with `bits`. */
function pair(
  world: World,
  count: number,
  ...bits: number[]
): [WorldView, WorldView] {
  const before = toView(world);
  steps(world, count, ...bits);
  return [before, toView(world)];
}
const kinds = (cues: readonly Cue[]) => cues.map((cue) => cue.kind);

test("cues come from the view moving forward, once each", () => {
  const world = fresh({ seconds: 10 });
  assert.deepEqual(cuesBetween(undefined, toView(world)), []);
  // The countdown calls each second, then GO.
  let [a, b] = pair(world, 1);
  assert.deepEqual(cuesBetween(a, b), []);
  steps(world, T.STEPS_PER_SECOND - 2);
  [a, b] = pair(world, 1);
  assert.deepEqual(cuesBetween(a, b), [{ kind: "count", seconds: 2 }]);
  assert.deepEqual(cuesBetween(b, a), [], "a view from the past says nothing");
  steps(world, T.READY_STEPS - T.STEPS_PER_SECOND - 1);
  [a, b] = pair(world, 1);
  assert.deepEqual(cuesBetween(a, b), [{ kind: "go", round: 1 }]);
  // Jump, land and duck are the rider's own.
  world.nextSpawn = 1_000_000;
  [a, b] = pair(world, 1, JUMP, DUCK);
  assert.deepEqual(cuesBetween(a, b), [
    { kind: "jump", slot: 0 },
    { kind: "duck", slot: 1 },
  ]);
  until(
    world,
    (w) => w.riders[0]!.vy < 0 && w.riders[0]!.y < 3000,
    200,
    JUMP,
    DUCK,
  );
  [a, b] = pair(world, 3, 0, DUCK);
  assert.deepEqual(cuesBetween(a, b), [{ kind: "land", slot: 0 }]);
  // A surge: struck for one, dodged for the other.
  surge(world, HIGH, 30);
  const before = toView(world);
  until(
    world,
    (w) => w.surges.length === 0 || w.surges[0]!.done === 3,
    400,
    0,
    DUCK,
  );
  const after = toView(world);
  const struck = cuesBetween(before, after);
  assert.deepEqual(kinds(struck).sort(), ["dodge", "hit"]);
  const hit = struck.find((cue) => cue.kind === "hit");
  assert.ok(hit?.kind === "hit" && hit.slot === 0 && !hit.out);
  const dodge = struck.find((cue) => cue.kind === "dodge");
  assert.ok(dodge?.kind === "dodge" && dodge.slot === 1 && dodge.streak === 1);
  assert.deepEqual(cuesBetween(after, after), []);
  // A flip at the gate.
  surge(world, LOW, 0, { x: T.GATE_X + 100, flip: true });
  [a, b] = pair(world, 2, 0, 0);
  assert.deepEqual(kinds(cuesBetween(a, b)), ["flip"]);
  // A foothold won back.
  until(world, (w) => w.surges.length === 0, 2000, JUMP, JUMP);
  until(
    world,
    (w) =>
      w.riders[0]!.reel === 0 &&
      w.riders[0]!.grace === 0 &&
      w.riders[0]!.y === 0,
    400,
  );
  world.riders[0]!.streak = T.STREAK_FOR_STEP - 1;
  surge(world, HIGH, 0, { x: world.riders[0]!.x + T.REACH + 10 });
  const behind = toView(world);
  until(world, (w) => w.riders[0]!.hits === 0, 400, DUCK, DUCK);
  assert.ok(kinds(cuesBetween(behind, toView(world))).includes("recover"));
  // The clock's last seconds tick; then time is called.
  world.surges.length = 0;
  world.clock = 10 * T.STEPS_PER_SECOND - LAST_SECONDS * T.STEPS_PER_SECOND - 1;
  [a, b] = pair(world, 1);
  assert.deepEqual(cuesBetween(a, b), [
    { kind: "tick", seconds: LAST_SECONDS },
  ]);
  world.clock = 10 * T.STEPS_PER_SECOND - 1;
  [a, b] = pair(world, 1);
  assert.deepEqual(cuesBetween(a, b), [
    { kind: "round", reason: "time", winners: [0, 1] },
  ]);
  // The next round's countdown opens with its first call, and says nothing about riders being put back.
  steps(world, T.BREAK_STEPS - 1);
  [a, b] = pair(world, 1);
  assert.deepEqual(cuesBetween(a, b), [{ kind: "count", seconds: 3 }]);
  // The match ends.
  const done = fresh({ target: 1, hits: 1 });
  steps(done, T.READY_STEPS);
  until(done, (w) => w.phase === "break");
  steps(done, T.BREAK_STEPS - 1);
  [a, b] = pair(done, 1);
  assert.deepEqual(cuesBetween(a, b), [{ kind: "over", winners: [0, 1] }]);
  // The last hit of a round is a hit that knocks out, and ends the round.
  const last = playing({ hits: 1 });
  surge(last, HIGH, 30);
  const upright = toView(last);
  until(last, (w) => w.phase === "break", 400, DUCK, 0);
  const fell = cuesBetween(upright, toView(last));
  assert.ok(
    fell.some((cue) => cue.kind === "hit" && cue.out && cue.slot === 1),
  );
  assert.ok(fell.some((cue) => cue.kind === "round" && cue.reason === "last"));
});

test("a rollback correction eases in, the local rider never does, and a new round is shown as it is", () => {
  const world = playing();
  const smoother = createSmoother();
  const base = toView(world);
  assert.deepEqual(smoother.apply(base, 1, 0, 0), base);
  const moved: WorldView = {
    ...base,
    riders: base.riders.map((rider) => ({ ...rider, y: rider.y + 40 })),
  };
  // The same revision: nothing to hide.
  assert.deepEqual(smoother.apply(moved, 1, 16, 0), moved);
  // A new revision moves both riders 40 px back down: the other is held where it was and eases over.
  const corrected = smoother.apply(base, 2, 32, 0);
  assert.equal(
    corrected.riders[0]!.y,
    base.riders[0]!.y,
    "the local rider snaps",
  );
  assert.equal(corrected.riders[1]!.y, base.riders[1]!.y + 40);
  const later = smoother.apply(base, 2, 32 + DECAY_MS, 0);
  const left = later.riders[1]!.y - base.riders[1]!.y;
  assert.ok(left > 10 && left < 20, String(left));
  const settled = smoother.apply(base, 2, 32 + DECAY_MS * 20, 0);
  assert.deepEqual(settled, base);
  // A correction that would draw a standing rider under the deck is clamped to it.
  const high: WorldView = {
    ...base,
    riders: base.riders.map((rider) => ({ ...rider, y: 30 })),
  };
  smoother.apply(base, 3, 2000, 0);
  smoother.apply(high, 3, 2016, 0);
  const sunk = smoother.apply(base, 4, 2032, 0);
  assert.equal(sunk.riders[1]!.y, 30);
  const under = smoother.apply(
    { ...base, riders: base.riders.map((rider) => ({ ...rider, y: 0 })) },
    5,
    2033,
    0,
  );
  assert.ok(under.riders[1]!.y >= 0);
  // Too far to be a correction: shown as it is.
  const far: WorldView = {
    ...base,
    riders: base.riders.map((rider) => ({
      ...rider,
      x: rider.x - TELEPORT - 10,
    })),
  };
  smoother.apply(base, 6, 9000, 0);
  assert.deepEqual(smoother.apply(far, 7, 9016, 0), far);
  // A new round drops whatever was easing.
  smoother.apply(base, 8, 12000, 0);
  smoother.apply(moved, 8, 12016, 0);
  smoother.apply(base, 9, 12032, 0);
  const next = { ...base, round: base.round + 1 };
  assert.deepEqual(smoother.apply(next, 9, 12033, 0), next);
});

test("sounds: silent when muted, a voice for each cue once the page may play", async () => {
  const quiet = createAudioRig();
  const muted = createGameAudio(quiet.deps, { forceMute: true });
  const cues: Cue[] = [
    { kind: "jump", slot: 0 },
    { kind: "land", slot: 0 },
    { kind: "duck", slot: 0 },
    { kind: "hit", slot: 0, x: 1, y: 2, out: false },
    { kind: "hit", slot: 1, x: 1, y: 2, out: true },
    { kind: "dodge", slot: 0, streak: 3 },
    { kind: "recover", slot: 0 },
    { kind: "flip", id: 4 },
    { kind: "count", seconds: 3 },
    { kind: "go", round: 1 },
    { kind: "tick", seconds: 4 },
    { kind: "round", reason: "last", winners: [0] },
    { kind: "round", reason: "time", winners: [0, 1] },
    { kind: "over", winners: [0] },
  ];
  for (const cue of cues) createSfx(muted).play(cue, 0);
  assert.equal(quiet.log.opens, 0, "a muted page never opens audio");
  const rig = createAudioRig("suspended");
  const audio = createGameAudio(rig.deps);
  const sfx = createSfx(audio);
  sfx.play(cues[0]!, 0);
  assert.equal(rig.log.oscillators, 0, "nothing before the first input");
  audio.unlock();
  await Promise.resolve();
  for (const cue of cues) sfx.play(cue, 0);
  rig.timers.forEach((run) => run());
  const all = rig.log.oscillators;
  assert.ok(all > 10 && rig.log.noises >= 2);
  // Another rider's jump, duck, landing and dodge are not this device's to sound; a watcher hears everyone's moves.
  for (const cue of cues.slice(0, 3)) sfx.play(cue, 1);
  sfx.play({ kind: "dodge", slot: 0, streak: 3 }, 1);
  sfx.play({ kind: "dodge", slot: 0, streak: 0 }, 0);
  sfx.play({ kind: "count", seconds: 0 }, 0);
  assert.equal(rig.log.oscillators, all);
  for (const cue of cues.slice(0, 3)) sfx.play(cue, -1);
  assert.equal(rig.log.oscillators, all + 3);
});

test("colours: a lane each, and an opacity for any of them", () => {
  assert.equal(laneColor(0), LANE[0]);
  assert.equal(laneColor(5), LANE[0], "they come round again");
  assert.ok(laneLight(1) && laneDeep(2));
  assert.equal(laneName(1), "PINK");
  assert.equal(hexA("#ff0080", 0.5), "rgba(255,0,128,0.5)");
  assert.equal(hexA("#000000", 7), "rgba(0,0,0,1)");
  assert.equal(hexA("#000000", -1), "rgba(0,0,0,0)");
});

function memory(
  initial: Record<string, string> = {},
): Store & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

test("the page's query says where it is: landing, solo, a room as host, joiner or TV", () => {
  const valid = (code: string) => /^[A-Z0-9]{4}$/.test(code);
  let made = 0;
  const secret = () => `secret-${++made}`;
  const names = keys("fuse-surge");
  const store = memory({ [names.host("ABCD")]: "host-token" });
  assert.deepEqual(sessionFor("", store, "fuse-surge", valid, secret), {
    kind: "landing",
  });
  assert.deepEqual(
    sessionFor("?solo=1&room=ABCD", store, "fuse-surge", valid, secret),
    {
      kind: "solo",
    },
  );
  assert.deepEqual(
    sessionFor("?room=nope!", store, "fuse-surge", valid, secret),
    {
      kind: "invalid",
      code: "NOPE!",
    },
  );
  assert.deepEqual(
    sessionFor("?room=abcd", store, "fuse-surge", valid, secret),
    {
      kind: "room",
      code: "ABCD",
      role: "host",
      token: "host-token",
    },
  );
  assert.deepEqual(
    sessionFor("?room=ABCD&display=1", store, "fuse-surge", valid, secret),
    {
      kind: "room",
      code: "ABCD",
      role: "display",
      token: "secret-1",
    },
  );
  const joined = sessionFor("?room=WXYZ", store, "fuse-surge", valid, secret);
  assert.deepEqual(joined, {
    kind: "room",
    code: "WXYZ",
    role: "joiner",
    token: "secret-2",
  });
  assert.deepEqual(
    sessionFor("?room=WXYZ", store, "fuse-surge", valid, secret),
    joined,
    "a refresh is the same member",
  );
  assert.equal(names.name, "fuse-surge-player-name");
  assert.equal(names.shared, "fuse-surge-shared-screen");
  assert.equal(roomFailure("Unknown game"), NOT_OPEN);
  assert.match(roomFailure("This is a room of another game"), /another game/);
  assert.equal(roomFailure("Room is full"), "Room is full");
});

test("storage that refuses falls back to memory for the page's life", () => {
  const refused = safeStore(() => {
    throw new Error("blocked");
  });
  assert.equal(refused.getItem("a"), null);
  refused.setItem("a", "1");
  assert.equal(refused.getItem("a"), "1");
  refused.removeItem("a");
  assert.equal(refused.getItem("a"), null);
  const data = new Map<string, string>();
  let broken = false;
  const flaky = {
    getItem: (key: string) => {
      if (broken) throw new Error("gone");
      return data.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      if (broken) throw new Error("full");
      data.set(key, value);
    },
    removeItem: (key: string) => {
      if (broken) throw new Error("gone");
      data.delete(key);
    },
  } as unknown as Storage;
  const store = safeStore(() => flaky);
  store.setItem("a", "1");
  assert.equal(store.getItem("a"), "1");
  store.removeItem("a");
  assert.equal(data.size, 0);
  broken = true;
  store.setItem("b", "2");
  assert.equal(store.getItem("b"), "2", "kept in memory instead");
  store.removeItem("b");
  assert.equal(store.getItem("b"), null);
});

test("a report is retried through a lost race or a dropped connection, and a refusal is final", async () => {
  const room = started({ ...DEFAULT_SETTINGS, target: 1 });
  finish(room, 0);
  const report: DueReport = {
    key: "k",
    path: "results",
    result: matchResult(room)!,
  };
  const waits: number[] = [];
  const wait = async (ms: number) => void waits.push(ms);
  const answers: (() => Response)[] = [
    () => new Response("{}", { status: 503 }),
    () => {
      throw new Error("offline");
    },
    () =>
      new Response(JSON.stringify({ status: "confirmed" }), { status: 200 }),
  ];
  let calls = 0;
  const seen: RequestInit[] = [];
  const fetcher = (async (_url: unknown, init?: RequestInit) => {
    seen.push(init ?? {});
    return answers[calls++]!();
  }) as typeof fetch;
  assert.equal(
    await sendReport("/api/x", report, {
      fetch: fetcher,
      roomToken: "room",
      wait,
    }),
    "confirmed",
  );
  assert.equal(calls, 3);
  assert.deepEqual(waits, [1000, 2000]);
  assert.equal(
    (seen[0]!.headers as Record<string, string>).Authorization,
    "Bearer room",
  );
  assert.deepEqual(JSON.parse(String(seen[0]!.body)), {
    result: report.result,
  });
  const pending = (async () =>
    new Response(JSON.stringify({ status: "pending" }), {
      status: 200,
    })) as typeof fetch;
  assert.equal(
    await sendReport("/api/x", report, {
      fetch: pending,
      roomToken: "r",
      wait,
    }),
    "pending",
  );
  const refused = (async () =>
    new Response("{}", { status: 400 })) as typeof fetch;
  assert.equal(
    await sendReport("/api/x", report, {
      fetch: refused,
      roomToken: "r",
      wait,
    }),
    "failed",
  );
  const down = (async () =>
    new Response("{}", { status: 403 })) as typeof fetch;
  assert.equal(
    await sendReport(
      "/api/x",
      report,
      { fetch: down, roomToken: "r", wait },
      2,
    ),
    "failed",
  );
});
