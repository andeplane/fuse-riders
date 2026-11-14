import test from "node:test";
import assert from "node:assert/strict";
import { ROOM_CAPACITY, slotLabel } from "../src/app/room-model.js";
import {
  FRESH_STEER,
  QUEEN_HINT,
  ROLE_LEGEND,
  SOLO_SETUP_TRIES,
  SOLO_SLOT_KEY,
  WORKER_HINT,
  readSoloSlot,
  roleHint,
  soloSetup,
  writeSoloSlot,
  type SlotStore,
  type SoloRoom,
  type SoloSetup,
  type SoloSteer,
} from "../src/app/solo-seat.js";

/** A typed stand-in for `localStorage`: what the page writes and nothing else. */
function slotStore(initial: Record<string, string> = {}): SlotStore & {
  readonly writes: number;
  value(): string | undefined;
} {
  const kept = new Map(Object.entries(initial));
  let writes = 0;
  return {
    getItem: (key) => kept.get(key) ?? null,
    setItem(key, value) {
      writes++;
      kept.set(key, value);
    },
    get writes() {
      return writes;
    },
    value: () => kept.get(SOLO_SLOT_KEY),
  };
}
/**
 * The page's opening, frame by frame: the room starts a match on its own, each action is applied, and the walk
 * stops when the page stops steering. Returns the actions asked for, in order, and where the player ended up.
 */
function opening(
  remembered: number | undefined,
  options: { refuseSeat?: boolean } = {},
): { actions: SoloSetup[]; room: SoloRoom; steer: SoloSteer } {
  // fuse-netcode opens a solo room mid-match with this device in the first slot.
  const room: SoloRoom = { stage: "running", slot: 0 };
  let steer = FRESH_STEER;
  const actions: SoloSetup[] = [];
  for (let frame = 0; frame < SOLO_SETUP_TRIES + 5 && !steer.done; frame++) {
    const step = soloSetup(room, remembered, steer);
    steer = step.steer;
    actions.push(step.action);
    if (step.action === "lobby") room.stage = "lobby";
    else if (step.action === "seat" && !options.refuseSeat)
      room.slot = remembered ?? room.slot;
  }
  return { actions, room, steer };
}

test("a solo room opens on the lobby, not mid-match in the first slot", () => {
  const fresh = opening(undefined);
  assert.deepEqual(fresh.actions, ["lobby", "none"]);
  assert.deepEqual(fresh.room, { stage: "lobby", slot: 0 });
  assert.equal(fresh.steer.done, true, "then the player is in charge");
});

test("the role chosen last on this device is taken again", () => {
  const back = opening(4);
  assert.deepEqual(back.actions, ["lobby", "seat", "none"]);
  assert.deepEqual(back.room, { stage: "lobby", slot: 4 });
  // Already in the remembered slot: nothing to ask for.
  assert.deepEqual(opening(0).actions, ["lobby", "none"]);
});

test("the page stops steering for good once the player has the room", () => {
  const { steer } = opening(3);
  for (const stage of ["lobby", "running", "between", "over"] as const) {
    const step = soloSetup({ stage, slot: 1 }, 3, steer);
    assert.equal(step.action, "none", stage);
    assert.equal(step.steer, steer, "and nothing changes");
  }
});

test("a seat the room will not give cannot hold the player in the lobby", () => {
  const stuck = opening(5, { refuseSeat: true });
  assert.equal(stuck.steer.done, true, "the opening gives up");
  assert.ok(
    stuck.actions.length <= SOLO_SETUP_TRIES + 1,
    `${stuck.actions.length} tries is bounded`,
  );
  assert.equal(stuck.actions.at(-1), "none", "and lets the player play");
});

test("only a slot the player asked for is remembered", () => {
  const store = slotStore();
  assert.equal(readSoloSlot(store), undefined, "no choice yet");
  writeSoloSlot(store, 3);
  assert.equal(store.value(), "3");
  assert.equal(readSoloSlot(store), 3);
  // Nothing outside the six slots is a choice, so nothing is written.
  for (const bad of [-1, ROOM_CAPACITY, 1.5, Number.NaN]) {
    writeSoloSlot(store, bad);
    assert.equal(store.value(), "3", `${bad} is not a slot`);
  }
  assert.equal(store.writes, 1, "one write, for the one real choice");
  // A value that is not a slot any more is read as no choice rather than trusted.
  for (const junk of ["", "queen", "9", "-2", "2.5"])
    assert.equal(
      readSoloSlot(slotStore({ [SOLO_SLOT_KEY]: junk })),
      undefined,
      junk,
    );
});

test("every slot says what its role does, where the player chooses", () => {
  assert.equal(roleHint(0), QUEEN_HINT);
  assert.equal(roleHint(1), QUEEN_HINT);
  for (const slot of [2, 3, 4, 5]) assert.equal(roleHint(slot), WORKER_HINT);
  for (let slot = 0; slot < ROOM_CAPACITY; slot++)
    assert.ok(
      slotLabel(slot).includes(roleHint(slot).toUpperCase()),
      slotLabel(slot),
    );
  // The fuller lines beside the slots answer the question a Queen asked: how do I ride the snail?
  assert.equal(ROLE_LEGEND.length, 2);
  assert.match(ROLE_LEGEND[0]!, /^QUEEN/);
  assert.match(ROLE_LEGEND[0]!, /cannot carry berries or ride the snail/);
  assert.match(ROLE_LEGEND[1]!, /^WORKER/);
  assert.match(ROLE_LEGEND[1]!, /carries berries, rides the snail/);
});
