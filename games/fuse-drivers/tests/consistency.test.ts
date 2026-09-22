import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTION,
  BOT,
  JOIN,
  PACKET_ENTRIES,
  PRESENCE,
  World,
  type WorldReceive,
} from "fuse-netcode";
import {
  CONTROLS,
  createRoom,
  fuseDriversGame,
  hashRoom,
  packControls,
  type FuseDriversEntry,
  type FuseDriversEvent,
  type FuseDriversRoom,
  type FuseDriversSettings,
  type FuseDriversView,
} from "../src/game/index.js";
import { NEUTRAL_INPUT, type TruckInput } from "../src/game/sim/input.js";
import { defined } from "./fixtures/defined.js";
import {
  SETTINGS,
  addBot,
  drive,
  fold,
  runTo,
  started,
  type Bodies,
} from "./fixtures/fuseDrivers.js";

type FuseDriversWorld = World<
  FuseDriversRoom,
  FuseDriversEntry,
  FuseDriversView,
  FuseDriversEvent,
  FuseDriversSettings
>;

/** Long enough for the countdown, a rocket start and a few hundred ticks of driving. */
const TICKS = 320;
/** Past every scripted tick and past the stall bound at `TICKS`, so nothing waits on `b`. */
const THROUGH = TICKS + 80;

/** One control change a seat logs: everything a replica needs to fold it, whichever way it is fed in. */
interface Press {
  tick: number;
  who: "a" | "b";
  input: Partial<TruckInput>;
}

/**
 * The log both replicas fold: two seats steering their trucks over a whole race, with two bots driving themselves
 * alongside. A seat logs only when its controls change, so a press holds until the next one for that seat.
 */
const SCRIPT: readonly Press[] = [
  { tick: 6, who: "a", input: { nitro: true } },
  { tick: 8, who: "b", input: { nitro: true } },
  { tick: 62, who: "a", input: {} },
  { tick: 64, who: "b", input: {} },
  { tick: 150, who: "a", input: { left: true } },
  { tick: 156, who: "b", input: { left: true } },
  { tick: 170, who: "a", input: { left: true, nitro: true } },
  { tick: 176, who: "b", input: { left: true, item: true } },
  { tick: 190, who: "a", input: {} },
  { tick: 196, who: "b", input: {} },
  { tick: 230, who: "a", input: { left: true } },
  { tick: 236, who: "b", input: { left: true } },
  { tick: 250, who: "a", input: { left: true, brake: true } },
  { tick: 256, who: "b", input: { right: true } },
  { tick: 270, who: "a", input: {} },
  { tick: 276, who: "b", input: {} },
  { tick: 310, who: "a", input: { left: true } },
  { tick: 316, who: "b", input: { left: true } },
];
const pressTicks = [...new Set(SCRIPT.map((press) => press.tick))].sort(
  (a, b) => a - b,
);
const pressesOf = (who: "a" | "b"): readonly Press[] =>
  SCRIPT.filter((press) => press.who === who);

/** A seat's press as an entry of its own stream. */
const entry = (seq: number, { tick, input }: Press): FuseDriversEntry => [
  seq,
  tick,
  CONTROLS,
  packControls({ ...NEUTRAL_INPUT, ...input }),
];

/** A replica with no netcode at all: `foldTick`, one log tick after another, straight through to `TICKS`. */
function foldedRoom(): FuseDriversRoom {
  const room = started(SETTINGS, [addBot("bot:1", 2), addBot("bot:2", 3)]);
  for (const tick of pressTicks) {
    runTo(room, tick - 1);
    const bodies: Record<string, unknown[][]> = {};
    for (const press of SCRIPT)
      if (press.tick === tick)
        (bodies[press.who] ??= []).push(drive(press.input));
    fold(room, bodies satisfies Bodies);
  }
  runTo(room, TICKS);
  return room;
}

/** The same room seated and started the way `started()` does it, but held by the speculative world. */
function worldRoom(): FuseDriversWorld {
  const world: FuseDriversWorld = new World(
    fuseDriversGame,
    createRoom("m0", SETTINGS),
    "a",
    "a",
  );
  const creator = world.stream("a", 1);
  world.stream("b", 1);
  creator.append(1, [JOIN, "a", "Ada", 0, "fox", 1]);
  creator.append(1, [JOIN, "b", "Bo", 1, "cat", 1]);
  creator.append(1, addBot("bot:1", 2));
  creator.append(1, addBot("bot:2", 3));
  creator.append(2, [PRESENCE, "a", true, 1]);
  creator.append(2, [PRESENCE, "b", true, 1]);
  creator.append(3, [ACTION, "start", "m1"]);
  for (const press of pressesOf("a"))
    creator.append(press.tick, drive(press.input));
  creator.through = THROUGH;
  return world;
}

/** Feeds `b`'s presses the way the transport does: packets of at most `PACKET_ENTRIES`, in order. */
function deliver(
  world: FuseDriversWorld,
  presses: readonly Press[],
  from: number,
): WorldReceive<FuseDriversEntry, FuseDriversEvent>[] {
  const entries = presses.map((press, index) => entry(from + index, press));
  const results: WorldReceive<FuseDriversEntry, FuseDriversEvent>[] = [];
  for (let at = 0; at < entries.length; at += PACKET_ENTRIES) {
    const part = entries.slice(at, at + PACKET_ENTRIES);
    const last = defined(part.at(-1));
    results.push(world.receive("b", part, last[0], last[1], last[1]));
  }
  return results;
}

const raceText = (room: FuseDriversRoom): string =>
  JSON.stringify(defined(room.race, "race"));
/** How far a truck has come, in laps and checkpoints. */
const progress = (room: FuseDriversRoom, slot: number): number =>
  defined(defined(room.race, "race").trucks[slot], "truck").progress;

test("two replicas folding the same log independently land on byte-identical rooms", () => {
  const one = foldedRoom(),
    two = foldedRoom();
  assert.equal(one.tick, TICKS);
  assert.equal(hashRoom(one), hashRoom(two));
  assert.equal(raceText(one), raceText(two));
  // Bot memory rides in the room, so two replicas that agree must agree on how the bots drove too.
  assert.equal(JSON.stringify(one.bots), JSON.stringify(two.bots));
  assert.deepEqual(one.controls, two.controls);
  assert.deepEqual(one.grid, ["a", "b", "bot:1", "bot:2"]);

  // And the race those bytes describe is a real one: four trucks, well past the countdown, all of them driving.
  const race = defined(one.race, "race");
  assert.equal(race.phase, "racing");
  assert.ok(race.tick > race.countdownEndTick + 300, "a few hundred ticks in");
  assert.equal(race.trucks.length, 4);
  for (const slot of [0, 1, 2, 3])
    assert.ok(
      progress(one, slot) >= 1,
      `truck ${String(slot)} drove past a checkpoint`,
    );
  assert.ok(
    progress(one, 2) > progress(one, 0),
    "and the bots drove a race of their own out in front",
  );
});

test("the netcode's world folds that log into the very same bytes as a plain fold does", () => {
  const plain = foldedRoom();
  const world = worldRoom();
  deliver(world, pressesOf("b"), 1);
  world.receive("b", [], pressesOf("b").length, THROUGH, THROUGH);
  world.advance(TICKS);
  assert.equal(world.tick, TICKS);
  assert.equal(hashRoom(world.state), hashRoom(plain));
  assert.equal(raceText(world.state), raceText(plain));
  assert.equal(JSON.stringify(world.state.bots), JSON.stringify(plain.bots));
});

test("a replica that rolled back through the race ends on the same bytes as one that never did", () => {
  const plain = foldedRoom();
  const presses = pressesOf("b");
  // The packet carrying b's fifth press never arrives; the replica speculates the 40 ticks it may past it.
  const held = 4;
  const early = presses.slice(0, held),
    late = presses.slice(held);
  const lateTick = defined(late[0]).tick;

  const world = worldRoom();
  deliver(world, early, 1);
  world.receive("b", [], held, lateTick - 1, lateTick - 1);
  world.advance(TICKS);
  assert.equal(
    world.tick,
    lateTick - 1 + 40,
    "the stall bound held it 40 ticks past b's promise",
  );
  assert.notEqual(
    hashRoom(world.state),
    hashRoom(plain),
    "it drove b's truck on stale controls",
  );

  // The missing presses arrive at the very edge of the rollback window, and history is re-simulated from the
  // first of them: a replica may speculate exactly `ROLLBACK_TICKS` past a promise and still take the repair.
  const repaired = defined(deliver(world, late, held + 1)[0]);
  assert.equal(repaired.status, "accepted");
  assert.ok(repaired.rollbackTicks > 0, "the repair rolled the world back");
  world.receive("b", [], presses.length, THROUGH, THROUGH);
  world.advance(TICKS);

  assert.equal(world.tick, TICKS);
  assert.equal(hashRoom(world.state), hashRoom(plain));
  assert.equal(raceText(world.state), raceText(plain));
  assert.equal(JSON.stringify(world.state.bots), JSON.stringify(plain.bots));
  // Every retained tick agrees too, not only the newest one.
  const straight = worldRoom();
  deliver(straight, presses, 1);
  straight.receive("b", [], presses.length, THROUGH, THROUGH);
  straight.advance(TICKS);
  for (let tick = TICKS - 40; tick <= TICKS; tick += 4)
    assert.equal(
      world.hashAt(tick),
      straight.hashAt(tick),
      `tick ${String(tick)}`,
    );
});
