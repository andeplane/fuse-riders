import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTION,
  JOIN,
  LEAVE,
  PRESENCE,
  ROLLBACK_TICKS,
  STALL_TICKS,
  SnapshotAssembler,
  StreamLog,
  World,
  decodePacket,
  decodeSnapshot,
  encodePacket,
  encodeSnapshot,
  packMessage,
  unpackMessage,
  type Packet,
} from "../src/index.js";
import {
  ADD,
  MARK,
  counterGame,
  hashCounter,
  type CounterEntry,
  type CounterEvent,
  type CounterRoom,
  type CounterSettings,
  type CounterView,
} from "./fixtures/counter-game.js";

type CounterWorld = World<
  CounterRoom,
  CounterEntry,
  CounterView,
  CounterEvent,
  CounterSettings
>;
/** A running room: the creator `a` seats `a` and `b` at tick 1 and starts at tick 2. */
function running(self = "a"): CounterWorld {
  const world = new World(
    counterGame,
    counterGame.createRoom("m1", { target: 1000 }),
    "a",
    self,
  );
  const a = world.stream("a", 1);
  world.stream("b", 1);
  a.append(1, [JOIN, "a", "A", 0, "fox", 1]);
  a.append(1, [JOIN, "b", "B", 1, "fox", 1]);
  a.append(2, [ACTION, "start", "m1"]);
  return world;
}
const heard = (world: CounterWorld, id: string, through: number) =>
  world.receive(id, [], world.streams.get(id)!.lastSeq, through, through);

test("a late entry rolls the world back and re-simulates it to the state an on-time replica reached, emitting each event once", () => {
  const onTime = running(),
    late = running();
  // `b` adds 5 at tick 10. The on-time replica has it before simulating tick 10; the late one only at tick 30.
  const entry: CounterEntry = [1, 10, ADD, 5];
  assert.equal(onTime.receive("b", [entry], 1, 30, 30).status, "accepted");
  onTime.streams.get("a")!.through = 30;
  onTime.advance(30);
  late.streams.get("a")!.through = 30;
  assert.equal(heard(late, "b", 9).status, "accepted");
  const before = late.advance(30);
  assert.equal(late.tick, 30, "speculation runs past b's completeness");
  assert.deepEqual(before.events, []);
  const result = late.receive("b", [entry], 1, 30, 30);
  assert.equal(result.status, "accepted");
  assert.equal(
    result.rollbackTicks,
    30 - 8,
    "from the newest snapshot before tick 10",
  );
  assert.deepEqual(
    result.events.map(({ event, tick, matchId, round }) => ({
      event,
      tick,
      matchId,
      round,
    })),
    [
      {
        event: { type: "add", id: "b", amount: 5 },
        tick: 20,
        matchId: "m1",
        round: 1,
      },
    ],
    "stamped with the game's clock, two steps per log tick",
  );
  assert.equal(hashCounter(late.state), hashCounter(onTime.state));
  assert.equal(late.hashAt(28), onTime.hashAt(28));
  // The same packet again: nothing new, no second rollback, no second event.
  const again = late.receive("b", [entry], 1, 30, 30);
  assert.equal(again.rollbackTicks, 0);
  assert.deepEqual(again.events, []);
  assert.equal(late.rollbacks, 1);
  assert.equal(late.view()[0]!.logTick, 30);
  assert.equal(late.view()[0]!.tick, 60);
  assert.equal(late.view()[0]!.matchId, "m1");
  assert.equal(late.confirmedGameTick(), 60);
});

test("the stall rule keeps speculation inside the rollback window, and a member's completeness promise binds", () => {
  const world = running();
  world.streams.get("a")!.through = 200;
  assert.equal(
    world.stallBound().tick,
    Infinity,
    "nobody is seated before tick 1",
  );
  world.advance(2);
  heard(world, "b", 5);
  assert.equal(world.stallBound().tick, 5 + STALL_TICKS);
  assert.equal(world.stallBound().waitingFor, "B");
  assert.equal(world.advance(200).waitingFor, "B");
  assert.equal(world.tick, 5 + STALL_TICKS);
  // Speculation never outruns the rollback window, so b's next entry can still be folded in where it belongs.
  assert.ok(world.tick - 6 < ROLLBACK_TICKS);
  assert.equal(
    world.receive("b", [[1, 5, ADD, 1]], 1, 60, 60).refusal,
    "violation",
    "b promised tick 5 was complete",
  );
  const late = world.receive("b", [[1, 6, ADD, 1]], 1, 60, 60);
  assert.equal(late.status, "accepted");
  assert.equal(late.rollbackTicks, world.tick - 4);

  // A logged absence ahead of the world lifts the wait from that tick on, before the world reaches it.
  const other = running();
  other.streams.get("a")!.append(20, [PRESENCE, "b", false, 1]);
  other.streams.get("a")!.through = 200;
  other.advance(2);
  assert.equal(other.stallBound().tick, 20 + STALL_TICKS);
  other.advance(200);
  assert.equal(other.state.seats.get("b")?.connected, false);
  assert.equal(other.stallBound().tick, Infinity);
  const leaving = running();
  leaving.streams.get("a")!.through = 2;
  leaving.advance(2);
  leaving.streams.get("a")!.append(12, [LEAVE, "b"]);
  assert.equal(leaving.stallBound().tick, 12 + STALL_TICKS);
});

test("streams refuse gaps past their window, repair by nack, ignore duplicates and refuse a conflicting duplicate", () => {
  const own = new StreamLog(counterGame, 1);
  for (let tick = 1; tick <= 8; tick++) own.append(tick, [ADD, 1]);
  own.through = 8;
  const replica = new StreamLog(counterGame, 1);
  const all = [...own.entries.values()];
  // Reordered: the newest entries arrive first and wait behind the gap.
  const late = replica.receive(all.slice(4), 8, 8, 8, 8);
  assert.equal(late.status, "accepted");
  assert.equal(replica.gap, true);
  assert.equal(replica.firstMissing(), 1);
  assert.equal(
    replica.completeThrough(),
    4,
    "complete only before the first waiting entry",
  );
  const repair = own.repairEntries(replica.firstMissing()!);
  assert.deepEqual(
    repair.map((entry) => entry[0]),
    [1, 2, 3, 4, 5, 6],
  );
  const repaired = replica.receive(repair, 8, 8, 8, 8);
  assert.equal(repaired.status, "accepted");
  assert.equal(replica.gap, false);
  assert.deepEqual(
    repaired.added.map((entry) => entry[0]),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );
  // Duplicated: nothing new.
  assert.deepEqual(replica.receive(all.slice(0, 2), 8, 8, 8, 8).added, []);
  // A different entry under a seq already held is no honest client's.
  assert.deepEqual(replica.receive([[3, 3, ADD, 9]], 8, 8, 8, 8), {
    status: "invalid",
    added: [],
    refusal: "violation",
  });
  // Too far ahead of anything a nack could repair: out of reach, and only a snapshot catches it up.
  assert.equal(replica.receive([], 8 + 5000, 8, 8, 8).refusal, "window");
  assert.equal(replica.ahead, true);
  assert.equal(
    replica.receive([[1, 1, 99, 1]], 8, 8, 8, 8).refusal,
    "violation",
    "the game's isEntry is the wire boundary",
  );
});

test("ordinals strictly increase along a stream and are never reused after a rebase", () => {
  const own = new StreamLog(counterGame, 1);
  own.append(1, [MARK, 1]);
  own.append(2, [ADD, 1]);
  own.append(3, [MARK, 4]);
  assert.equal(own.latestOrdinal(), 4);
  assert.throws(() => own.append(4, [MARK, 4]), /Reused ordinal/);
  assert.throws(() => own.append(2, [ADD, 1]), /Invalid own entry/);
  const replica = new StreamLog(counterGame, 1);
  assert.equal(
    replica.receive(
      [
        [1, 1, MARK, 3],
        [2, 2, MARK, 2],
      ],
      2,
      2,
      2,
      2,
    ).refusal,
    "violation",
  );
  const base = own.baseAt(2);
  assert.deepEqual(base, { seq: 2, tick: 2, ordinal: 1 });
  const rebased = new StreamLog(counterGame, 1, base);
  assert.equal(
    rebased.receive(own.entriesAfter(base.seq, 2), 3, 3, 3, 2).status,
    "accepted",
    "an ordinal after the base is not a reuse",
  );
  own.through = 10;
  own.prune(3);
  assert.equal(
    own.baseAt(5).ordinal,
    4,
    "a pruned ordinal still bounds later bases",
  );
});

test("packets carry any game's entries, and the game's isEntry is the boundary", () => {
  const packet: Packet<CounterEntry> = {
    room: 7,
    from: "a",
    generation: 1,
    through: 9,
    lastSeq: 2,
    entries: [
      [1, 4, ADD, 3],
      [2, 5, JOIN, "b", "B", 1, "robot", 2],
    ],
    sentAt: 1,
    echoSentAt: 0,
    echoHeld: 0,
    clockTick: 9.5,
    hash: [8, "0123456789abcdef"],
  };
  const bytes = encodePacket(packet);
  assert.deepEqual(decodePacket(counterGame, bytes), { packet });
  assert.equal(
    decodePacket({ isEntry: (raw): raw is never => false }, bytes),
    undefined,
  );
});

test("a snapshot carries the game's fields between rules and streams, and any tampering is refused before anything is installed", () => {
  const source = running();
  source.receive("b", [[1, 20, MARK, 2]], 1, 40, 40);
  source.streams.get("a")!.through = 40;
  source.advance(40);
  source.streams.get("a")!.append(41, [ADD, 7]);
  const chunks = encodeSnapshot(source, 9);
  assert.equal(chunks[0]!.rules, "counter-3");
  const assembler = new SnapshotAssembler(counterGame, 9);
  let complete: { tick: number; bytes: Uint8Array } | undefined;
  for (const chunk of chunks) complete = assembler.accept(chunk);
  assert.ok(complete);
  const message = unpackMessage(complete.bytes) as unknown[];
  assert.equal(
    message.length,
    5 + 5,
    "rules, room, tick, three leading game fields, streams, hash, two trailing game fields",
  );
  assert.ok(Array.isArray(message[6]), "the streams follow the leading fields");
  assert.match(String(message[7]), /^[0-9a-f]{16}$/, "then the hash");
  const decoded = decodeSnapshot(counterGame, complete.bytes, 9)!;
  assert.equal(
    hashCounter(decoded.state),
    hashCounter(source.servable().state),
  );
  assert.deepEqual(
    decoded.streams.map(({ id, seq, ordinal, entries }) => [
      id,
      seq,
      ordinal,
      entries.length,
    ]),
    [
      ["a", 3, 0, 1],
      ["b", 1, 2, 0],
    ],
  );

  const copy = new World(counterGame, decoded.state, "a", "b");
  for (const stream of decoded.streams) {
    const log = copy.stream(stream.id, stream.generation, {
      seq: stream.seq,
      tick: complete.tick,
      ordinal: stream.ordinal,
    });
    log.receive(
      stream.entries,
      stream.entries.at(-1)?.[0] ?? stream.seq,
      60,
      60,
      complete.tick,
    );
  }
  for (const world of [source, copy]) {
    world.streams.get("a")!.through = 60;
    world.streams.get("b")!.through = 60;
    world.advance(60);
  }
  assert.equal(hashCounter(copy.state), hashCounter(source.state));

  const tamper = (edit: (fields: unknown[]) => void) => {
    const fields = structuredClone(message);
    edit(fields);
    return decodeSnapshot(counterGame, packMessage(fields), 9);
  };
  assert.ok(
    tamper(() => {}),
    "the untouched message decodes",
  );
  assert.equal(
    tamper((fields) => {
      (fields[8] as Record<string, number>).a = 999;
    }),
    undefined,
    "a state its hash does not match",
  );
  assert.equal(
    tamper((fields) => (fields[0] = "counter-4")),
    undefined,
  );
  assert.equal(
    tamper((fields) => (fields[1] = 10)),
    undefined,
    "another room",
  );
  assert.equal(
    tamper((fields) => (fields[2] = 41)),
    undefined,
    "a tick its clock cannot belong to",
  );
  assert.equal(
    tamper((fields) => fields.splice(4, 1)),
    undefined,
    "a missing game field",
  );
  assert.equal(
    tamper((fields) => {
      (fields[6] as unknown[][])[1]![4] = [[1, 1, 99, 0]];
    }),
    undefined,
    "a stream entry its game refuses",
  );
  assert.equal(
    tamper((fields) => {
      const streams = fields[6] as unknown[][];
      streams.push(structuredClone(streams[0]!));
    }),
    undefined,
    "the same stream twice",
  );
  assert.equal(
    decodeSnapshot(counterGame, new Uint8Array([0xc1]), 9),
    undefined,
  );
  assert.equal(
    new SnapshotAssembler(counterGame, 9).accept({
      ...chunks[0],
      rules: "counter-4",
    }),
    undefined,
  );
});

test("a step budget paces catch-up and rollback re-runs, and history never goes backwards outside the world", () => {
  const paced = running(),
    reference = running();
  for (const world of [paced, reference]) world.streams.get("a")!.through = 40;
  heard(paced, "b", 9);
  heard(reference, "b", 9);
  reference.advance(30);
  // Two steps per log tick: a window of 8 steps runs four log ticks.
  paced.refill(8);
  paced.advance(30);
  assert.equal(paced.tick, 4);
  assert.equal(paced.steps, 8);
  for (let pass = 0; pass < 20 && paced.tick < 30; pass++) {
    paced.refill(8);
    paced.advance(30);
  }
  assert.equal(paced.tick, 30);
  assert.equal(hashCounter(paced.state), hashCounter(reference.state));

  // A late entry at tick 10: the re-run is owed, and until it finishes the world still shows tick 30.
  const entry: CounterEntry = [1, 10, ADD, 5];
  paced.refill(8);
  const late = paced.receive("b", [entry], 1, 40, 40);
  assert.equal(late.status, "accepted");
  assert.equal(paced.settled, false);
  assert.equal(paced.tick, 30);
  assert.equal(paced.view()[0]!.logTick, 30);
  assert.deepEqual(
    late.events,
    [],
    "held until the re-run reaches the tick the world had",
  );
  const events: CounterEvent[] = [];
  for (let pass = 0; pass < 20 && !paced.settled; pass++) {
    paced.refill(8);
    events.push(...paced.advance(30).events.map(({ event }) => event));
  }
  assert.ok(paced.settled);
  assert.deepEqual(events, [{ type: "add", id: "b", amount: 5 }]);
  reference.receive("b", [entry], 1, 40, 40);
  assert.equal(hashCounter(paced.state), hashCounter(reference.state));
});
