import test from "node:test";
import assert from "node:assert/strict";
import {
  DOUBLES,
  JUMP,
  LEFT,
  RIGHT,
  createWorld,
  decodeWorld,
  encodeWorld,
  stepWorld,
  type World,
} from "../src/engine/index.js";
import { headTop } from "../src/engine/step.js";
import * as T from "../src/engine/tuning.js";

/**
 * Stacking: a blob that comes down on a teammate's head stands there, is carried with it, and jumps higher off it.
 * Slots 0 and 2 are the left side's two blobs throughout.
 */
const IDS = ["a", "b", "c", "d"] as const;
const doubles = (): World => createWorld(IDS, "rally", 77);
function hold(world: World, count: number, inputs: readonly number[]): void {
  for (let i = 0; i < count; i++) stepWorld(world, inputs);
}
/** The feet's height above the sand, px. */
const up = (world: World, slot: number): number =>
  (world.blobs[slot]!.y - T.BLOB_FLOOR) / T.HU;
/** The left side's blobs, slot 2 dropped onto slot 0's head `offset` px off its centre and left to land. */
function stacked(offset = 0): World {
  const world = doubles();
  const low = world.blobs[0]!,
    high = world.blobs[2]!;
  low.x = 400;
  high.x = low.x + offset;
  high.air = true;
  high.y = T.BLOB_FLOOR + 120 * T.HU;
  hold(world, 60, [0, 0, 0, 0]);
  return world;
}
/** The highest slot `slot`'s feet get over the next `count` steps with `inputs` held. */
function apex(world: World, slot: number, inputs: readonly number[]): number {
  let best = 0;
  for (let i = 0; i < 400; i++) {
    stepWorld(world, inputs);
    best = Math.max(best, up(world, slot));
  }
  return best;
}

test("a blob coming down on a teammate's head stands on it", () => {
  const world = stacked();
  const low = world.blobs[0]!,
    high = world.blobs[2]!;
  assert.equal(high.on, 0);
  assert.equal(high.air, false);
  assert.equal(high.y, low.y + headTop(low) * T.HU);
  assert.equal(high.x, low.x, "and is not pushed off");
  assert.equal(low.y, T.BLOB_FLOOR);
  // It stays there for as long as nobody moves.
  hold(world, 600, [0, 0, 0, 0]);
  assert.equal(high.on, 0);
});

test("a landing needs the centre within reach of the head; further out the blob slides off", () => {
  const near = stacked(T.STACK_REACH);
  assert.equal(near.blobs[2]!.on, 0);
  const far = stacked(T.STACK_REACH + 4);
  const low = far.blobs[0]!,
    high = far.blobs[2]!;
  assert.equal(high.on, -1);
  assert.equal(high.y, T.BLOB_FLOOR, "down on the sand");
  assert.ok(Math.abs(high.x - low.x) >= 2 * T.BLOB_HALF, "side by side");
});

test("a rising blob never lands: it has to come down onto the head", () => {
  const world = doubles();
  const low = world.blobs[0]!,
    high = world.blobs[2]!;
  low.x = 400;
  high.x = 400 - 2 * T.BLOB_HALF;
  // Jumping straight up against a standing teammate and pressing into it: shoved, never on top while rising.
  for (let i = 0; i < 40; i++) {
    stepWorld(world, [0, 0, RIGHT | JUMP, 0]);
    if (high.vy > 0) assert.equal(high.on, -1);
  }
});

test("the blob on top is carried with the one below, and each step of it", () => {
  const world = stacked(10);
  const low = world.blobs[0]!,
    high = world.blobs[2]!;
  hold(world, 40, [RIGHT, 0, 0, 0]);
  assert.equal(low.x, 400 + 40 * T.RUN_SPEED, "the one below is not slowed");
  assert.equal(high.x - low.x, 10, "carried, keeping its place on the head");
  assert.equal(high.on, 0);
  hold(world, 40, [LEFT, 0, 0, 0]);
  assert.equal(high.x - low.x, 10);
  // Up and down with it too: the one below jumps and the rider's feet stay on its head.
  let rose = 0;
  for (let i = 0; i < 200; i++) {
    stepWorld(world, [i < 30 ? JUMP : 0, 0, 0, 0]);
    assert.equal(high.y, low.y + headTop(low) * T.HU);
    assert.equal(high.on, 0);
    rose = Math.max(rose, up(world, 0));
  }
  assert.ok(rose > 100, "the one below did jump");
  assert.equal(low.air, false);
});

test("the blob on top walks on the head and falls off past its edge", () => {
  const world = stacked();
  const low = world.blobs[0]!,
    high = world.blobs[2]!;
  hold(world, T.STACK_REACH / T.RUN_SPEED, [0, 0, RIGHT, 0]);
  assert.equal(high.x - low.x, T.STACK_REACH);
  assert.equal(high.on, 0, "still on, at the edge");
  stepWorld(world, [0, 0, RIGHT, 0]);
  assert.equal(high.on, -1);
  assert.equal(high.air, true);
  hold(world, 120, [0, 0, 0, 0]);
  assert.equal(high.y, T.BLOB_FLOOR);
  assert.equal(low.x, 400, "the one below was not shoved");
});

test("a blob is left behind when the net stops it and the one below walks on", () => {
  const world = stacked();
  const low = world.blobs[0]!,
    high = world.blobs[2]!;
  low.x = DOUBLES.blobMax[0] - 20;
  high.x = DOUBLES.blobMax[0];
  hold(world, 60, [LEFT, 0, RIGHT, 0]);
  assert.equal(high.on, -1);
  assert.equal(high.x, DOUBLES.blobMax[0]);
});

test("a jump off a head is one and a half times a jump off the sand", () => {
  const sand = apex(doubles(), 2, [0, 0, JUMP, 0]);
  const world = stacked();
  const head = up(world, 2);
  assert.equal(head, 90);
  const top = apex(world, 2, [0, 0, JUMP, 0]);
  // It jumps again every time it comes back down on the head (the trampoline), no higher each time.
  assert.ok(sand > 255 && sand < 270, `off the sand ${sand}`);
  const rise = top - head;
  assert.ok(rise > 1.45 * sand && rise < 1.55 * sand, `off the head ${rise}`);
  assert.ok(top > 470 && top < 485, `feet ${top} px up`);
  const again = apex(world, 2, [0, 0, JUMP, 0]);
  assert.ok(again <= top, "the boost does not build up");
});

test("jumping off the head leaves the stack, and landing on the sand ends the boost", () => {
  const world = stacked();
  const high = world.blobs[2]!;
  stepWorld(world, [0, 0, JUMP, 0]);
  assert.equal(high.on, -1);
  assert.equal(high.air, true);
  assert.equal(high.vy, T.STACK_JUMP_SPEED - T.BLOB_GRAVITY);
  // Jump away sideways, land on the sand: the next jump is an ordinary one.
  hold(world, 400, [0, 0, LEFT, 0]);
  assert.equal(high.y, T.BLOB_FLOOR);
  stepWorld(world, [0, 0, JUMP, 0]);
  assert.equal(high.vy, T.JUMP_SPEED - T.BLOB_GRAVITY);
});

test("the one below jumping at the top of its own jump launches the rider from there", () => {
  const world = stacked();
  let best = 0;
  for (let i = 0; i < 500; i++) {
    const low = world.blobs[0]!;
    // The rider jumps as the one below starts to come down.
    stepWorld(world, [JUMP, 0, low.air && low.vy <= 0 ? JUMP : 0, 0]);
    best = Math.max(best, up(world, 2));
  }
  assert.ok(best > 700 && best < 760, `feet ${best} px up`);
  assert.ok(T.BLOB_FLOOR + best * T.HU < T.BLOB_CEILING);
});

test("three a side, a tower of three is carried whole", () => {
  const world = createWorld(["a", "b", "c", "d", "e", "f"], "rally", 9);
  const [base, , mid, , top] = world.blobs;
  base!.x = mid!.x = top!.x = 500;
  mid!.air = top!.air = true;
  mid!.y = T.BLOB_FLOOR + 120 * T.HU;
  top!.y = T.BLOB_FLOOR + 260 * T.HU;
  hold(world, 80, [0, 0, 0, 0, 0, 0]);
  assert.equal(mid!.on, 0);
  assert.equal(top!.on, 2);
  assert.equal(up(world, 4), 180);
  hold(world, 50, [RIGHT, 0, 0, 0, 0, 0]);
  assert.deepEqual([base!.x, mid!.x, top!.x], [650, 650, 650]);
  // The middle one jumps off: the top one goes with it, the base stays.
  stepWorld(world, [0, 0, JUMP, 0, 0, 0]);
  assert.equal(mid!.on, -1);
  assert.equal(top!.on, 2);
  assert.equal(top!.y, mid!.y + headTop(mid!) * T.HU);
});

test("blobs on opposite sides never stack: the net keeps them apart", () => {
  const world = doubles();
  const left = world.blobs[0]!,
    right = world.blobs[1]!;
  left.x = DOUBLES.blobMax[0];
  right.x = DOUBLES.blobMin[1];
  assert.ok(right.x - left.x > 2 * T.BLOB_HALF);
  for (let i = 0; i < 600; i++) {
    stepWorld(world, [RIGHT | (i % 90 < 30 ? JUMP : 0), LEFT | JUMP, 0, 0]);
    assert.equal(left.on, -1);
    assert.equal(right.on, -1);
  }
});

test("both blobs of a stack touch the ball on the side's shared count", () => {
  const world = stacked();
  const low = world.blobs[0]!;
  world.phase = "rally";
  const ball = world.ball;
  ball.live = true;
  ball.x = low.x * T.BU;
  ball.y = (100 + 90 + 90 + 60) * T.BU;
  ball.prevX = ball.x;
  ball.prevY = ball.y;
  ball.vx = 0;
  ball.vy = -40;
  const hits = world.hitCounter;
  hold(world, 40, [0, 0, 0, 0]);
  assert.equal(world.hitCounter, hits + 1, "the rider's head played it");
  assert.equal(world.blobs[2]!.hits, 1);
  assert.equal(low.touches, 1);
  assert.equal(world.blobs[2]!.touches, 1);
});

test("a stack survives the checkpoint, and a tampered one is refused", () => {
  const world = stacked(7);
  hold(world, 13, [RIGHT | JUMP, 0, 0, 0]);
  assert.equal(world.blobs[2]!.on, 0);
  const fields = encodeWorld(world);
  assert.deepEqual(decodeWorld(structuredClone(fields)), world);
  const blobAt = fields.length - 4 + 2;
  const tamper = (change: (blob: unknown[]) => void) => {
    const copy = structuredClone(fields);
    change(copy[blobAt] as unknown[]);
    return decodeWorld(copy);
  };
  assert.equal(
    tamper((blob) => (blob[5] = 2)),
    undefined,
    "on itself",
  );
  assert.equal(
    tamper((blob) => (blob[5] = 1)),
    undefined,
    "on an opponent",
  );
  assert.equal(
    tamper((blob) => (blob[5] = 5)),
    undefined,
    "on nobody",
  );
  assert.equal(
    tamper((blob) => (blob[4] = 1)),
    undefined,
    "on a head and in the air",
  );
  assert.equal(
    tamper((blob) => (blob[5] = -1)),
    undefined,
    "standing in mid air",
  );
});

test("king of the court, a stack is taken apart when a team walks off", () => {
  const world = createWorld(
    ["a", "b", "c", "d", "e", "f"],
    "rally",
    5,
    "2v2v2",
  );
  const mates = world.blobs
    .map((blob, slot) => ({ blob, slot }))
    .filter(
      ({ blob, slot }) => blob.side === 0 && slot % 3 === world.onCourt[0],
    );
  const [low, high] = mates;
  high!.blob.x = low!.blob.x;
  high!.blob.air = true;
  high!.blob.y = T.BLOB_FLOOR + 120 * T.HU;
  hold(world, 60, [0, 0, 0, 0, 0, 0]);
  assert.equal(high!.blob.on, low!.slot);
  // The ball drops on their side: they lose the rally and walk off at the next serve.
  world.phase = "rally";
  world.ball.live = true;
  world.ball.x = 100 * T.BU;
  world.ball.y = T.BALL_FLOOR + 40;
  world.ball.vy = -60;
  hold(world, T.DEAD_STEPS + 20, [0, 0, 0, 0, 0, 0]);
  assert.equal(world.phase, "serve");
  assert.ok(world.blobs.every((blob) => blob.on === -1));
  assert.ok(decodeWorld(encodeWorld(world)));
});
