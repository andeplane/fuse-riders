import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTION,
  JOIN,
  BOT,
  PRESENCE,
  World,
  type RuntimeDependencies,
} from "fuse-netcode";
import {
  ballGame,
  createRoom,
  DEFAULT_SETTINGS,
  decodeRoom,
  encodeRoom,
  hashRoom,
  isEntry,
  parseSettings,
  foldTick,
  type BallEntry,
} from "../src/online/game.js";
import { BallRuntime } from "../src/online/runtime.js";
import type { BallView } from "../src/engine/view.js";
import { Controls, keyboardButton, gameplayKey } from "../src/app/controls.js";
import { effectAge, interpolate } from "../src/render/present.js";
import { ballBrosRegistration } from "../src/platform.js";
import { Audio } from "../src/app/audio.js";
import { createArena, COUNTDOWN, SUBSTEPS } from "../src/engine/state.js";

test("mute never opens audio and unsupported sound does not block controls", () => {
  let opened = 0;
  const audio = new Audio(true, () => {
    opened++;
    throw new Error("not supported");
  });
  audio.unlock();
  assert.equal(opened, 0);
  audio.play({ kind: "core", x: 0, y: 0, slot: 0 });
  audio.muted = false;
  audio.unlock();
  assert.equal(opened, 1);
  assert.equal(audio.muted, true);
  audio.destroy();
});

function replica() {
  const world = new World(
    ballGame,
    createRoom("lobby", DEFAULT_SETTINGS),
    "a",
    "a",
  );
  const log = world.stream("a", 1);
  world.stream("b", 1);
  log.append(1, [JOIN, "b", "Bea", 0, "robot", 1]);
  for (let i = 1; i < 5; i++)
    log.append(1, [BOT, "add", `bot-${i}`, `Bot ${i}`, i]);
  log.append(2, [ACTION, "start", "match"]);
  log.through = 300;
  return world;
}

test("late, duplicate and reordered controls converge through actual rollback", () => {
  const onTime = replica(),
    late = replica();
  const entries: BallEntry[] = [
    [1, 63, 0, "match", 1, 1, false],
    [2, 65, 0, "match", 0, -1, true],
    [3, 72, 0, "match", -1, 0, false],
    [4, 79, 0, "match", 0, 0, false],
  ];
  onTime.receive("b", entries, 4, 150, 150);
  onTime.advance(150);
  late.receive("b", [], 0, 62, 62);
  late.advance(80);
  late.receive("b", [entries[2]!, entries[3]!], 4, 150, 150);
  late.receive("b", [entries[0]!, entries[1]!, entries[1]!], 4, 150, 150);
  late.advance(150);
  assert.ok(late.rollbackTicks > 0);
  assert.equal(hashRoom(late.state), hashRoom(onTime.state));
  assert.deepEqual(late.view(), onTime.view());
});

test("a connected generation replacement releases old inputs before accepting the new page's inputs", () => {
  const room = createRoom("match", DEFAULT_SETTINGS);
  for (const [slot, id] of ["a", "b"].entries())
    room.seats.set(id, {
      id,
      name: id,
      slot,
      connected: true,
      generation: 1,
      bot: false,
      avatarId: "robot",
    });
  room.stage = "running";
  room.tick = 10;
  room.arena = createArena([...room.seats.values()]);
  room.arena.tick = COUNTDOWN;
  room.arena.formationStep = COUNTDOWN * SUBSTEPS;
  const base = room.arena.bases[1]!;
  base.steer = 1;
  base.radial = 1;
  const angle = base.angle,
    radius = base.radius;
  foldTick(
    room,
    "a",
    new Map([
      [
        "a",
        {
          generation: 1,
          entries: [[1, 11, PRESENCE, "b", true, 2] as BallEntry],
        },
      ],
      [
        "b",
        {
          generation: 2,
          entries: [[1, 11, 0, "old-match", 1, 1, true] as BallEntry],
          retired: [
            {
              generation: 1,
              entries: [[1, 11, 0, "match", 1, 1, true] as BallEntry],
            },
          ],
        },
      ],
    ]),
  );
  assert.equal(room.seats.get("b")!.connected, true);
  assert.equal(room.seats.get("b")!.generation, 2);
  assert.equal(base.angle, angle);
  assert.equal(base.radius, radius);
  assert.equal(base.steer, 0);
  assert.equal(base.radial, 0);
  foldTick(
    room,
    "a",
    new Map([
      [
        "b",
        {
          generation: 2,
          entries: [[2, 12, 0, "match", -1, -1, false] as BallEntry],
        },
      ],
    ]),
  );
  assert.equal(base.steer, -1);
  assert.equal(base.radial, -1);
});

test("a logged start cannot create a one-player arena", () => {
  const room = createRoom("lobby", DEFAULT_SETTINGS);
  room.seats.set("a", {
    id: "a",
    name: "Alice",
    slot: 0,
    connected: true,
    generation: 1,
    bot: false,
    avatarId: "robot",
  });
  foldTick(
    room,
    "a",
    new Map([
      [
        "a",
        {
          generation: 1,
          entries: [[1, 1, ACTION, "start", "bad"] as BallEntry],
        },
      ],
    ]),
  );
  assert.equal(room.stage, "lobby");
  assert.equal(room.arena, null);
  assert.equal(room.matchId, "lobby");
});

test("checkpoints validate complete state and reject corrupt geometry, owners, seats and settings atomically", () => {
  const world = replica();
  world.receive("b", [], 0, 150, 150);
  world.advance(150);
  const original = hashRoom(world.state),
    fields = encodeRoom(world.state);
  assert.deepEqual(decodeRoom(fields, 150), world.state);
  const corruptions: ((f: unknown[]) => void)[] = [
    (f) => (f[0] = ""),
    (f) => (f[1] = "between"),
    (f) => (f[2] = { display: false, rogue: 1 }),
    (f) => (f[4] = null),
    (f) => {
      const seats = f[3] as unknown[][];
      seats[0]![2] = 99;
    },
    (f) => {
      const arena = f[4] as unknown[];
      arena[0] = 99999;
    },
    (f) => {
      const arena = f[4] as unknown[];
      const balls = arena[5] as unknown[][];
      balls[0]![1] = NaN;
    },
    (f) => {
      const arena = f[4] as unknown[];
      const balls = arena[5] as unknown[][];
      balls[0]![5] = "missing";
    },
    (f) => {
      const arena = f[4] as unknown[];
      const bases = arena[4] as unknown[][];
      bases[0]![10] = [];
    },
    (f) => {
      const a = f[4] as unknown[];
      (a[4] as unknown[][])[0]![11] = 125;
    },
    (f) => {
      const a = f[4] as unknown[];
      (a[4] as unknown[][])[0]![11] = 87;
    },
    (f) => {
      const a = f[4] as unknown[];
      (a[4] as unknown[][])[0]![12] = 2;
    },
    (f) => {
      const a = f[4] as unknown[];
      const ball = (a[5] as unknown[][])[0]!;
      ball[1] = 950;
      ball[2] = 950;
    },
  ];
  for (const corrupt of corruptions) {
    const f = structuredClone(fields);
    corrupt(f);
    assert.equal(decodeRoom(f, 150), undefined);
    assert.equal(hashRoom(world.state), original);
  }
  assert.equal(parseSettings(null), undefined);
  assert.equal(isEntry([1, 1, 0, "match", 2, 0, true]), false);
  assert.equal(isEntry([1, 1, 0, "match", 0, 2, true]), false);
  assert.equal(isEntry([1, 1, 0, "match", 0, true]), false);
  assert.equal(isEntry([1, 1, JOIN, "__proto__", "No", 0, "robot", 1]), false);
  assert.equal(isEntry([1, 1, 0, "old", 0, 0, false]), true);
});

class Clock implements RuntimeDependencies {
  ms = 0;
  hiddenValue = false;
  callback?: () => void;
  visibility?: () => void;
  now = () => this.ms;
  hidden = () => this.hiddenValue;
  token = () => "solo-match";
  generation = () => 1;
  schedule(callback: () => void): () => void {
    this.callback = callback;
    return () => (this.callback = undefined);
  }
  onVisibilityChange(callback: () => void): () => void {
    this.visibility = callback;
    return () => (this.visibility = undefined);
  }
  advance(ms: number): void {
    for (let i = 0; i < ms; i += 10) {
      this.ms += 10;
      this.callback?.();
    }
  }
}
test("the shipped runtime starts five seats, releases held controls and resets on rematch", () => {
  const clock = new Clock();
  let current: BallView | undefined;
  const runtime = new BallRuntime(
    { ready() {}, event() {}, status() {}, state: (v) => (current = v) },
    { dependencies: clock },
  );
  runtime.start();
  clock.advance(300);
  assert.equal(current?.arena?.bases.length, 5);
  assert.equal(current?.arena?.bases.filter((b) => b.bot).length, 4);
  assert.equal(runtime.input(0, 1), true);
  assert.equal(runtime.input(0, 1), false);
  runtime.input(1, 1);
  clock.advance(250);
  const a = current!.arena!.bases[0]!.angle;
  runtime.cancel();
  clock.advance(150);
  const stopped = current!.arena!.bases[0]!.angle;
  const stoppedRadius = current!.arena!.bases[0]!.radius;
  clock.advance(250);
  assert.equal(current!.arena!.bases[0]!.angle, stopped);
  assert.equal(current!.arena!.bases[0]!.radius, stoppedRadius);
  assert.notEqual(a, Math.PI / 2);
  runtime.input(-1, -1);
  clock.advance(100);
  clock.hiddenValue = true;
  clock.visibility?.();
  clock.advance(100);
  clock.hiddenValue = false;
  clock.visibility?.();
  clock.advance(200);
  const resumed = current!.arena!.bases[0]!.angle;
  const resumedRadius = current!.arena!.bases[0]!.radius;
  clock.advance(200);
  assert.equal(current!.arena!.bases[0]!.angle, resumed);
  assert.equal(current!.arena!.bases[0]!.radius, resumedRadius);
  runtime.command({ type: "action", action: "lobby" });
  clock.advance(100);
  runtime.command({ type: "action", action: "start" });
  clock.advance(200);
  assert.ok(current!.arena!.bases.every((b) => b.blocks.every((k) => k.alive)));
  runtime.stop();
  assert.equal(clock.callback, undefined);
});

test("control aggregation preserves other pointers, cancellation never fires and keyboard repeats do not launch", () => {
  assert.equal(gameplayKey("KeyD", false, true), "right");
  assert.equal(gameplayKey("KeyW", false, true), "outward");
  assert.equal(gameplayKey("Space", false, true), undefined);
  assert.equal(gameplayKey("KeyD", true, false), undefined);
  const sent: [number, number, boolean][] = [],
    controls = new Controls((s, r, l) => sent.push([s, r, l]));
  controls.press("a", "left");
  controls.press("touch", "left");
  controls.release("a");
  assert.equal(controls.steering, -1);
  controls.press("d", "right");
  assert.equal(controls.steering, 0);
  controls.press("w", "outward");
  controls.press("touch-out", "outward");
  controls.release("w");
  assert.equal(controls.radial, 1);
  controls.press("s", "inward");
  assert.equal(controls.radial, 0);
  controls.release("touch-out");
  assert.equal(controls.radial, -1);
  controls.press("space", "launch");
  controls.press("space", "launch");
  assert.equal(sent.filter((s) => s[2]).length, 1);
  controls.cancel();
  assert.deepEqual(sent.at(-1), [0, 0, false]);
  controls.release("gone");
  assert.equal(keyboardButton("KeyA"), "left");
  assert.equal(keyboardButton("KeyD"), "right");
  assert.equal(keyboardButton("Space"), "launch");
  assert.equal(keyboardButton("KeyS"), "inward");
  assert.equal(keyboardButton("ArrowUp"), "outward");
  assert.equal(keyboardButton("ArrowDown"), "inward");
});

test("presentation never interpolates across a match and unranked registration refuses reports", () => {
  assert.equal(effectAge(100, 101, 320), 0);
  assert.equal(effectAge(421, 101, 320), 1);
  const world = replica();
  world.receive("b", [], 0, 50, 50);
  world.advance(10);
  const a = ballGame.view(world.state);
  world.advance(11);
  const b = ballGame.view(world.state);
  assert.equal(interpolate(undefined, b, 10.5), b);
  assert.deepEqual(interpolate(a, { ...b, matchId: "new" }, 10.5), {
    ...b,
    matchId: "new",
  });
  const before = structuredClone(b);
  a.arena!.bases[0]!.radius = 88;
  a.arena!.bases[0]!.x -= 4;
  a.arena!.bases[0]!.y -= 2;
  b.arena!.bases[0]!.radius = 124;
  const middle = interpolate(a, b, 10.5).arena!.bases[0]!;
  assert.equal(middle.radius, 106);
  assert.equal(middle.x, (a.arena!.bases[0]!.x + b.arena!.bases[0]!.x) / 2);
  assert.equal(middle.y, (a.arena!.bases[0]!.y + b.arena!.bases[0]!.y) / 2);
  b.arena!.bases[0]!.radius = before.arena!.bases[0]!.radius;
  interpolate(a, b, 10.5);
  assert.deepEqual(b, before);
  assert.equal(ballBrosRegistration.parseStats({}, 1), undefined);
  assert.equal(ballBrosRegistration.isBot("bot-1"), true);
  assert.equal(ballBrosRegistration.isBot("solo"), false);
});
