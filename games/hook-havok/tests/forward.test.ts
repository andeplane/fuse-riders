import test from "node:test";
import assert from "node:assert/strict";
import { ACTION, BOT, JOIN, type StreamEntries } from "fuse-netcode";
import {
  BOT_NAMES,
  createRoom,
  foldTick,
  hookGame,
  type Entry,
  type Room,
  type View,
} from "../src/online/game.js";
import { planBots } from "../src/engine/bot.js";
import { COUNTDOWN_TICKS } from "../src/engine/contest.js";
import {
  DEFAULT_TUNING,
  NEUTRAL,
  type Input,
  type Tuning,
} from "../src/engine/world.js";
import {
  confirmed,
  createEventLatch,
  createSmoother,
  forward,
  memoBots,
  type ForwardInputs,
} from "../src/app/forward.js";

const host = "host",
  guest = "guest";
const stream = (
  entries: Entry[],
  more: Entry[] = [],
): Map<string, StreamEntries<Entry>> =>
  new Map([
    [host, { generation: 1, entries }],
    [guest, { generation: 1, entries: more }],
  ]);
/** A running room: the host in slot 0, then a second person or `bots` AI keepers. */
function room(tuning: Tuning = DEFAULT_TUNING, bots = 0, second = true): Room {
  const r = createRoom("lobby", tuning),
    entries: Entry[] = [[1, 1, JOIN, host, "Keeper", 0, "keeper", 1]];
  if (second) entries.push([2, 1, JOIN, guest, "Guest", 1, "keeper", 1]);
  for (let i = 0; i < bots; i++)
    entries.push([
      entries.length + 1,
      1,
      BOT,
      "add",
      `bot:${i + 1}`,
      BOT_NAMES[i + 2]!,
      i + 2,
    ]);
  entries.push([entries.length + 1, 1, ACTION, "start", "match"]);
  foldTick(r, host, stream(entries));
  for (let i = 0; i < 20; i++) foldTick(r, host, stream([]));
  return r;
}
let seq = 1000;
const press = (r: Room, input: Partial<Input>): Entry => [
  seq++,
  r.tick + 1,
  0,
  r.matchId,
  r.round,
  { ...NEUTRAL, ...input },
];
const holding = (
  live: Partial<Input> = {},
  bots: ForwardInputs["bots"] = planBots,
): ForwardInputs => ({ me: host, live: { ...NEUTRAL, ...live }, bots });
const body = (view: View, id = host) =>
  view.keepers.find((keeper) => keeper.id === id)!.body;

test("a whole tick played forward is the tick the fold produces, bots included, and the room is left alone", () => {
  const r = room(DEFAULT_TUNING, 2);
  const before = JSON.stringify(hookGame.view(r));
  const drawn = forward(r, 1, holding({ move: 1 }));
  assert.equal(JSON.stringify(hookGame.view(r)), before, "it uses a copy");
  foldTick(r, host, stream([press(r, { move: 1 })]));
  assert.deepEqual(drawn, hookGame.view(r));
  // Two ticks ahead, while the fold is late, is the tick after that.
  const two = forward(r, 2, holding({ move: 1 }));
  foldTick(r, host, stream([]));
  foldTick(r, host, stream([]));
  assert.deepEqual(two, hookGame.view(r));
});

test("a press shows on the local keeper at once, part of the way into the tick, and on nobody else", () => {
  const r = room();
  const still = forward(r, 1 / 3, holding()),
    pressed = forward(r, 1 / 3, holding({ move: 1 }));
  assert.ok(body(pressed).x > body(still).x, "one engine step already moves");
  assert.equal(body(pressed, guest).x, body(still, guest).x);
  // A fraction of an engine step is blended.
  const between = forward(r, 0.5, holding({ move: 1 })),
    next = forward(r, 2 / 3, holding({ move: 1 }));
  assert.ok(
    body(between).x > body(pressed).x && body(between).x < body(next).x,
  );
  assert.deepEqual(forward(r, 0, holding({ move: 1 })), hookGame.view(r));
  // A tapped jump leaves the ground before the room has folded it.
  assert.equal(body(forward(r, 0, holding())).grounded, true);
  assert.equal(body(forward(r, 1, holding({ jump: true }))).grounded, false);
});

test("the forward run never crosses a change of the contest's phase", () => {
  const r = room({ ...DEFAULT_TUNING, rules: "elimination" });
  while (
    r.simulation.contest.phase !== "countdown" ||
    r.simulation.contest.elapsed < COUNTDOWN_TICKS - 3
  )
    foldTick(r, host, stream([]));
  const folded = structuredClone(r);
  foldTick(folded, host, stream([]));
  assert.equal(folded.simulation.contest.phase, "active", "the fold starts");
  const drawn = forward(r, 1, holding());
  assert.ok(drawn.tick > r.simulation.tick, "the steps before it are played");
  assert.ok(drawn.tick < folded.simulation.tick);
  assert.equal(confirmed(drawn, hookGame.view(r)).contest.phase, "countdown");
});

test("the bots' plan is asked once per folded tick and revision, and leaves the minds it would have", () => {
  const r = room(DEFAULT_TUNING, 2, false);
  let asked = 0;
  const memo = memoBots((arena) => {
    asked++;
    return planBots(arena);
  });
  const exact = forward(r, 2, holding());
  for (let frame = 0; frame < 5; frame++)
    forward(r, 0.2 * frame, holding({}, memo(0)));
  assert.equal(asked, 1);
  // Late-fold frames play into a second tick: one more answer, not one per frame, and the same picture.
  for (let frame = 0; frame < 5; frame++)
    forward(r, 1.2 + 0.1 * frame, holding({}, memo(0)));
  assert.equal(asked, 2);
  assert.deepEqual(forward(r, 2, holding({}, memo(0))), exact);
  assert.equal(asked, 2);
  // A rollback replaced the room at the same tick: its answer is asked for again.
  forward(r, 0.5, holding({}, memo(1)));
  assert.equal(asked, 3);
});

test("outcomes are shown as the room folded them, while a keeper's own doing is shown as played forward", () => {
  const r = room();
  const folded = hookGame.view(r);
  const ahead = forward(r, 1, holding({ move: 1 }));
  // The forward run knocked the guest out, blew a bomb up and scored; the room has folded none of it.
  const guessed: View = {
    ...ahead,
    keepers: ahead.keepers.map((keeper) =>
      keeper.id === guest
        ? {
            ...keeper,
            cooldown: 0.5,
            tally: { ...keeper.tally, thrown: 3, bombed: 1 },
            body: { ...keeper.body, deaths: keeper.body.deaths + 1, x: 5 },
          }
        : keeper,
    ),
    blasts: [
      {
        tick: ahead.tick,
        id: 9,
        owner: host,
        kind: "plain",
        x: 1,
        y: 1,
        radius: 9,
      },
    ],
    knockouts: [
      { tick: ahead.tick, by: host, target: guest, x: 1, y: 1, cause: "bomb" },
    ],
  };
  const real: View = {
    ...folded,
    bombs: [
      {
        id: 9,
        owner: host,
        kind: "plain",
        x: 2,
        y: 2,
        vx: 0,
        vy: 0,
        fuse: 1,
        blast: 9,
      },
    ],
  };
  const drawn = confirmed(guessed, real);
  assert.deepEqual(drawn.blasts, []);
  assert.deepEqual(drawn.knockouts, []);
  assert.deepEqual(drawn.bombs, real.bombs, "the bomb waits for its blast");
  assert.deepEqual(body(drawn, guest), body(real, guest), "still standing");
  const keeper = drawn.keepers.find((each) => each.id === guest)!;
  assert.equal(keeper.tally.bombed, 0);
  assert.equal(keeper.tally.thrown, 3, "their throw is their own doing");
  assert.equal(keeper.cooldown, 0.5);
  // The local keeper moves as played forward, and the view's own body is its first keeper's.
  assert.deepEqual(body(drawn), body(ahead));
  assert.equal(drawn.x, body(ahead).x);
  assert.equal(drawn.contest, real.contest);
});

test("a folded event plays once on the drawn timeline, however far ahead the picture is", () => {
  const r = room();
  const latch = createEventLatch();
  const view = (tick: number, events: number[]): View => ({
    ...hookGame.view(r),
    tick,
    knockouts: events.map((at) => ({
      tick: at,
      by: host,
      target: guest,
      x: 0,
      y: 0,
      cause: "bomb" as const,
    })),
  });
  assert.deepEqual(latch(view(100, []), "m:1").knockouts, []);
  // The picture is at tick 106 when the room folds a knockout at tick 102: it is new to the scene, not old.
  const first = latch(view(106, [102]), "m:1");
  assert.equal(first.knockouts[0]!.tick, 106);
  // It keeps that tick while it is listed, so nothing plays it again.
  assert.equal(latch(view(108, [102]), "m:1").knockouts[0]!.tick, 106);
  // One that arrives while the drawn tick stands still is due on the next tick drawn.
  const late = latch(view(108, [102, 104]), "m:1");
  assert.deepEqual(
    late.knockouts.map((each) => each.tick),
    [106, 109],
  );
  // A new round starts again.
  assert.equal(latch(view(20, [19]), "m:2").knockouts[0]!.tick, 20);
});

test("the smoother hides a correction to another keeper and a bomb, and never touches the local keeper", () => {
  const r = room();
  const smoother = createSmoother();
  let now = 0;
  const base: View = {
    ...hookGame.view(r),
    bombs: [
      {
        id: 1,
        owner: guest,
        kind: "plain",
        x: 300,
        y: 300,
        vx: 0,
        vy: 0,
        fuse: 60,
        blast: 90,
      },
    ],
  };
  const show = (view: View, revision = 0, from = r) =>
    smoother.apply(view, revision, from, (now += 16), host);
  const shifted = (view: View, by: number): View => ({
    ...view,
    keepers: view.keepers.map((keeper) => ({
      ...keeper,
      body: { ...keeper.body, x: keeper.body.x + by },
    })),
    bombs: view.bombs.map((bomb) => ({ ...bomb, x: bomb.x + by })),
  });
  for (let i = 0; i < 3; i++) show(base);
  // A rollback moved everything 20 units: the local keeper snaps, the others start from where they were.
  const moved = shifted(base, 20);
  const after = show(moved, 1);
  assert.equal(body(after).x, body(moved).x);
  assert.ok(Math.abs(body(after, guest).x - body(base, guest).x) < 1e-6);
  assert.ok(Math.abs(after.bombs[0]!.x - base.bombs[0]!.x) < 1e-6);
  let last = after;
  for (let i = 0; i < 30; i++) last = show(moved, 1);
  assert.equal(body(last, guest).x, body(moved, guest).x);
  assert.equal(last.bombs[0]!.x, moved.bombs[0]!.x);
  // A new tick where the guest moved as drawn changes nothing; one where their logged input changed is absorbed.
  const next = structuredClone(r);
  foldTick(next, host, stream([]));
  assert.equal(body(show(moved, 1, next), guest).x, body(moved, guest).x);
  const turned = structuredClone(next);
  foldTick(turned, host, stream([], [press(next, { move: 1 })]));
  const jumped = shifted(moved, 30),
    hidden = show(jumped, 1, turned);
  assert.ok(
    body(hidden, guest).x < body(jumped, guest).x &&
      body(hidden, guest).x >= body(moved, guest).x,
    "the guest is eased towards where their new input puts them",
  );
  assert.equal(body(hidden).x, body(jumped).x);
  assert.equal(hidden.bombs[0]!.x, jumped.bombs[0]!.x, "no rollback: as drawn");
});
