// Generation replacement and completeness cases from the second adversarial review of the P2P pull request (#180):
// each failed on add1e90 and pins the fix. Public World/StreamLog/snapshot APIs only; no private fields, timers or network.
import test from "node:test";
import assert from "node:assert/strict";
import {
  World,
  encodeSnapshot,
  decodeSnapshot,
  SnapshotAssembler,
  PACKET_ENTRIES,
} from "fuse-netcode";
import {
  fuseGame,
  type FuseWorld,
  type FuseSnapshot,
} from "../src/online/fuse-game.js";
import { createRoomState, hashRoomState } from "../src/engine/apply-tick.js";
import { defaultRoomSettings } from "../src/engine/room-settings.js";
import {
  JOIN,
  ACTION,
  STEER,
  PRESENCE,
  PRESS,
  RELEASE,
} from "../src/engine/input-log.js";

function room(ids = ["creator", "guest"]) {
  const world = new World(
    fuseGame,
    createRoomState("m", defaultRoomSettings()),
    "creator",
    "creator",
  );
  for (const id of ids) world.stream(id, 1);
  const creator = world.streams.get("creator")!;
  ids.forEach((id, slot) => creator.append(1, [JOIN, id, id, slot, "fox", 1]));
  creator.append(2, [ACTION, "start", "m"]);
  return world;
}
function heartbeat(world: FuseWorld, id: string, through: number) {
  const stream = world.streams.get(id)!;
  assert.equal(
    world.receive(id, [], stream.lastSeq, through, through).status,
    "accepted",
  );
}
function snapshotCopy(source: FuseWorld) {
  const assembler = new SnapshotAssembler(fuseGame, 42);
  let decoded: FuseSnapshot | undefined;
  for (const chunk of encodeSnapshot(source, 42)) {
    const complete = assembler.accept(chunk);
    if (complete) decoded = decodeSnapshot(fuseGame, complete.bytes, 42);
  }
  assert.ok(decoded, "snapshot decodes");
  const copy = new World(fuseGame, decoded.state, "creator", "copy");
  for (const stream of decoded.streams) {
    const log = copy.stream(stream.id, stream.generation, {
      seq: stream.seq,
      tick: copy.tick,
      ordinal: stream.ordinal,
    });
    for (
      let offset = 0;
      offset < stream.entries.length;
      offset += PACKET_ENTRIES
    ) {
      const part = stream.entries.slice(offset, offset + PACKET_ENTRIES);
      assert.equal(
        log.receive(part, part.at(-1)![0], copy.tick, copy.tick + 60, copy.tick)
          .status,
        "accepted",
      );
    }
  }
  return copy;
}

test("generation transition: a returning creator applies its new management stream", () => {
  const world = room();
  world.streams.get("creator")!.append(68, [STEER, 1]);
  for (const id of world.streams.keys()) heartbeat(world, id, 100);
  world.advance(70);
  const fresh = world.stream("creator", 2, { seq: 0, tick: 70 });
  fresh.append(71, [PRESENCE, "creator", true, 2]);
  fresh.append(71, [STEER, 2]);
  heartbeat(world, "creator", 100);
  world.advance(72);
  assert.equal(
    world.state.folds.get("creator")!.generation,
    2,
    "new PRESENCE must apply; actual generation remains 1",
  );
  assert.equal(world.state.folds.get("creator")!.flags, 2);
});

test("generation transition: guest input on the PRESENCE tick is applied", () => {
  const world = room();
  world.streams.get("guest")!.append(68, [STEER, 1]);
  for (const id of world.streams.keys()) heartbeat(world, id, 100);
  world.advance(70);
  const fresh = world.stream("guest", 2, { seq: 0, tick: 70 });
  world.streams.get("creator")!.append(71, [PRESENCE, "guest", true, 2]);
  fresh.append(71, [STEER, 2]);
  heartbeat(world, "guest", 100);
  world.advance(72);
  assert.equal(world.state.folds.get("guest")!.generation, 2);
  assert.equal(
    world.state.folds.get("guest")!.flags,
    2,
    "new-generation steering at the presence tick must apply; actual flags are 0",
  );
});

test("snapshot replay includes the retired generation between baseline and replacement", () => {
  const source = room(["creator", "guest", "other"]);
  source.streams.get("guest")!.append(68, [STEER, 1]);
  heartbeat(source, "creator", 100);
  heartbeat(source, "guest", 100);
  heartbeat(source, "other", 64);
  source.advance(70);
  source.stream("guest", 2, { seq: 0, tick: 70 });
  heartbeat(source, "guest", 100);
  source.streams.get("creator")!.append(72, [PRESENCE, "guest", true, 2]);
  source.advance(74);
  assert.equal(source.servable().tick, 64);
  const copy = snapshotCopy(source);
  copy.advance(74);
  assert.equal(copy.tick, source.tick);
  assert.equal(
    hashRoomState(copy.state),
    hashRoomState(source.state),
    "snapshot replay must retain the old generation steering at tick 68",
  );
});

test("snapshot completeness accounts for a missing entry sharing the last contiguous tick", () => {
  const source = room();
  heartbeat(source, "creator", 100);
  source.receive(
    "guest",
    [
      [1, 72, STEER, 1],
      [3, 80, RELEASE, 1],
    ],
    3,
    90,
    90,
  );
  source.advance(84);
  const copy = snapshotCopy(source);
  assert.ok(
    copy.tick < 72,
    `served ${copy.tick}: a missing entry may share the last contiguous tick, so 72 is not complete`,
  );
  const repaired = source.receive("guest", [[2, 72, PRESS, 1]], 3, 90, 90);
  assert.equal(repaired.status, "accepted");
  const repairedCopy = copy.receive("guest", [[2, 72, PRESS, 1]], 3, 90, 90);
  assert.equal(
    repairedCopy.status,
    "accepted",
    "the source repairs the press, but its snapshot recipient rejects it as unrepairable",
  );
  copy.advance(84);
  assert.equal(hashRoomState(copy.state), hashRoomState(source.state));
});

test("snapshot completeness must not fall back to speculative state after heartbeat history is lost", () => {
  const source = room(["creator", "guest", "other"]);
  for (const id of source.streams.keys()) heartbeat(source, id, 65);
  source.advance(65);
  heartbeat(source, "creator", 80);
  heartbeat(source, "other", 80);
  source.receive("guest", [[2, 80, STEER, 0]], 2, 80, 80);
  source.advance(75);
  assert.equal(
    source.completeTick(),
    65,
    "the heartbeats confirmed 65 before the gap opened",
  );
  assert.ok(source.servable().tick <= 65);
  const copy = snapshotCopy(source);
  assert.equal(
    source.receive("guest", [[1, 70, STEER, 1]], 2, 80, 80).status,
    "accepted",
  );
  assert.equal(
    copy.receive("guest", [[1, 70, STEER, 1]], 2, 80, 80).status,
    "accepted",
    "source repairs missing tick 70, but its speculative tick-75 snapshot cannot",
  );
});
