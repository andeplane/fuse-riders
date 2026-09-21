import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTION,
  JOIN,
  BOT,
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
  type BallEntry,
} from "../src/online/game.js";
import { BallRuntime } from "../src/online/runtime.js";
import type { BallView } from "../src/engine/view.js";
import { Controls, keyboardButton } from "../src/app/controls.js";
import { effectAge, interpolate } from "../src/render/present.js";
import { ballBrosRegistration } from "../src/platform.js";
import { Audio } from "../src/app/audio.js";

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
    [1, 63, 0, "match", 1, false],
    [2, 65, 0, "match", 0, true],
    [3, 72, 0, "match", -1, false],
    [4, 79, 0, "match", 0, false],
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
      const balls = arena[4] as unknown[][];
      balls[0]![1] = NaN;
    },
    (f) => {
      const arena = f[4] as unknown[];
      const balls = arena[4] as unknown[][];
      balls[0]![5] = "missing";
    },
    (f) => {
      const arena = f[4] as unknown[];
      const bases = arena[3] as unknown[][];
      bases[0]![10] = [];
    },
  ];
  for (const corrupt of corruptions) {
    const f = structuredClone(fields);
    corrupt(f);
    assert.equal(decodeRoom(f, 150), undefined);
    assert.equal(hashRoom(world.state), original);
  }
  assert.equal(parseSettings(null), undefined);
  assert.equal(isEntry([1, 1, 0, "match", 2, true]), false);
  assert.equal(isEntry([1, 1, JOIN, "__proto__", "No", 0, "robot", 1]), false);
  assert.equal(isEntry([1, 1, 0, "old", 0, false]), true);
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
  runtime.input(1);
  clock.advance(250);
  const a = current!.arena!.bases[0]!.angle;
  runtime.cancel();
  clock.advance(150);
  const stopped = current!.arena!.bases[0]!.angle;
  clock.advance(250);
  assert.equal(current!.arena!.bases[0]!.angle, stopped);
  assert.notEqual(a, Math.PI / 2);
  runtime.input(-1);
  clock.advance(100);
  clock.hiddenValue = true;
  clock.visibility?.();
  clock.advance(100);
  clock.hiddenValue = false;
  clock.visibility?.();
  clock.advance(200);
  const resumed = current!.arena!.bases[0]!.angle;
  clock.advance(200);
  assert.equal(current!.arena!.bases[0]!.angle, resumed);
  runtime.command({ type: "action", action: "lobby" });
  clock.advance(100);
  runtime.command({ type: "action", action: "start" });
  clock.advance(200);
  assert.ok(current!.arena!.bases.every((b) => b.blocks.every((k) => k.alive)));
  runtime.stop();
  assert.equal(clock.callback, undefined);
});

test("control aggregation preserves other pointers, cancellation never fires and keyboard repeats do not launch", () => {
  const sent: [number, boolean][] = [],
    controls = new Controls((s, l) => sent.push([s, l]));
  controls.press("a", "left");
  controls.press("touch", "left");
  controls.release("a");
  assert.equal(controls.steering, -1);
  controls.press("d", "right");
  assert.equal(controls.steering, 0);
  controls.press("w", "launch");
  controls.press("w", "launch");
  assert.equal(sent.filter((s) => s[1]).length, 1);
  controls.cancel();
  assert.deepEqual(sent.at(-1), [0, false]);
  controls.release("gone");
  assert.equal(keyboardButton("KeyA"), "left");
  assert.equal(keyboardButton("KeyD"), "right");
  assert.equal(keyboardButton("Space"), "launch");
  assert.equal(keyboardButton("KeyS"), undefined);
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
  interpolate(a, b, 10.5);
  assert.deepEqual(b, before);
  assert.equal(ballBrosRegistration.parseStats({}, 1), undefined);
  assert.equal(ballBrosRegistration.isBot("bot-1"), true);
  assert.equal(ballBrosRegistration.isBot("solo"), false);
});
