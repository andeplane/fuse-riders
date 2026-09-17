import assert from "node:assert/strict";
import test from "node:test";
import {
  SHOTS_REPORTED_KEY,
  createFunnel,
  type FunnelDevice,
  type FunnelView,
} from "../src/online/funnel.js";
import { createMemoryStorage } from "../src/client/safe-storage.js";
import { BOT_ID_PREFIX } from "../src/shared/bot-controller.js";
import { defaultRoomSettings } from "../src/shared/room-settings.js";
import type { DecidedRound, RoundShot } from "../src/shared/shot-log.js";

interface Sent {
  event: string;
  properties: Record<string, unknown> | undefined;
}

function harness(storage = createMemoryStorage()) {
  const sent: Sent[] = [];
  let clock = 1_000_000;
  const funnel = createFunnel(
    (event, properties) => sent.push({ event, properties }),
    { now: () => clock, storage },
  );
  return {
    sent,
    storage,
    funnel,
    advance: (ms: number) => {
      clock += ms;
    },
    names: () => sent.map((entry) => entry.event),
  };
}

const BOT = `${BOT_ID_PREFIX}1`;
const riders = (...ids: string[]) =>
  ids.map((id) => ({ id, avatarId: `avatar-${id}` }));

const view = (overrides: Partial<FunnelView> = {}): FunnelView => ({
  matchId: "m1",
  phase: "lobby",
  round: 0,
  tick: 0,
  players: riders("me", "you", BOT),
  matchStats: [],
  ...overrides,
});

const rules = defaultRoomSettings();
const device = (overrides: Partial<FunnelDevice> = {}): FunnelDevice => ({
  playerId: "me",
  host: true,
  confirmedTick: 0,
  rules,
  ...overrides,
});

const pull = (
  shot: number,
  shooterId: string,
  kills: RoundShot["kills"] = [],
): RoundShot => ({
  shot,
  shooterId,
  weapon: "bomb",
  elapsed: 20,
  bombs: 1,
  power: 0,
  extraBombs: 0,
  fuseLevel: 0,
  grip: false,
  kills,
});

test("a seat is reported once per funnel, on the first frame that shows this device's rider", () => {
  const { funnel, sent, names } = harness();
  funnel.onFrame(view({ players: riders("you") }), device({ playerId: "" }));
  funnel.onFrame(view({ players: riders("you") }), device());
  assert.deepEqual(
    names(),
    [],
    "no seat yet: a spectator, then a rider id the room does not list",
  );
  for (let frame = 0; frame < 20; frame++) funnel.onFrame(view(), device());
  assert.deepEqual(sent, [
    {
      event: "Seat Taken",
      properties: { avatarId: "avatar-me", playerCount: 3 },
    },
  ]);
  // Leaving the seat and taking it again is still the same funnel.
  funnel.onFrame(view({ players: riders("you") }), device());
  funnel.onFrame(view(), device());
  assert.deepEqual(names(), ["Seat Taken"]);
});

test("a match start fires once per match id on round 1's countdown, and counts matches", () => {
  const { funnel, sent, names } = harness();
  const spectator = device({ playerId: "", host: false });
  for (let frame = 0; frame < 5; frame++)
    funnel.onFrame(
      view({ phase: "countdown", round: 1, tick: frame }),
      spectator,
    );
  assert.deepEqual(sent, [
    {
      event: "Match Started",
      properties: {
        matchNumber: 1,
        playerCount: 3,
        botCount: 1,
        mode: rules.mode,
        match: rules.match,
        matchLength: rules.length,
        powerupTypes: Object.values(rules.weights).filter((w) => w > 0).length,
        host: false,
      },
    },
  ]);
  // Every round opens with its own countdown; only round 1 is a match start.
  funnel.onFrame(view({ phase: "playing", round: 1 }), spectator);
  funnel.onFrame(view({ phase: "countdown", round: 2 }), spectator);
  assert.deepEqual(names(), ["Match Started"]);
  // A rematch takes a fresh match id.
  funnel.onFrame(
    view({ matchId: "m2", phase: "countdown", round: 1 }),
    spectator,
  );
  assert.equal(sent[1]!.properties!.matchNumber, 2);
  assert.equal(sent.length, 2);
});

test("a device that joins mid-match reports no start, and rules that arrive without weights report zero powerups", () => {
  const { funnel, sent, names } = harness();
  funnel.onFrame(
    view({ phase: "countdown", round: 3 }),
    device({ playerId: "" }),
  );
  assert.deepEqual(names(), []);
  const { weights: _weights, ...weightless } = rules;
  funnel.onFrame(
    view({ phase: "countdown", round: 1 }),
    device({ playerId: "", rules: weightless }),
  );
  assert.equal(sent[0]!.properties!.powerupTypes, 0);
});

test("a decided round's kills and misses go out once it is confirmed, once, and are remembered across a reload", () => {
  const storage = createMemoryStorage();
  const first = harness(storage);
  const decided: DecidedRound = {
    matchId: "m1",
    round: 2,
    tick: 500,
    shots: [
      pull(1, "me", [{ victimId: BOT, elapsed: 60 }]),
      pull(2, "me"),
      pull(3, "you"),
    ],
  };
  const frame = view({ phase: "roundOver", round: 2, decidedRound: decided });
  first.funnel.onFrame(frame, device({ playerId: "", confirmedTick: 600 }));
  first.funnel.onFrame(frame, device({ confirmedTick: 499 }));
  assert.deepEqual(
    first.names(),
    ["Seat Taken"],
    "not while the decision is speculative, and not by a device without a rider",
  );
  for (let repeat = 0; repeat < 20; repeat++)
    first.funnel.onFrame(frame, device({ confirmedTick: 500 }));
  assert.deepEqual(first.names(), ["Seat Taken", "Kill", "Miss"]);
  assert.deepEqual(first.sent[1]!.properties, {
    weapon: "bomb",
    round: 2,
    secondsIntoRound: 1,
    bombs: 1,
    power: 0,
    extraBombs: 0,
    fuseLevel: 0,
    grip: false,
    riders: 3,
    bots: 1,
    victimBot: true,
    shotKills: 1,
    firstKillOfShot: true,
    secondsToKill: 2,
  });
  assert.equal(storage.getItem(SHOTS_REPORTED_KEY), "m1:2:me");

  // A reload is a new funnel over the same storage: the round is not sent again, the next one is.
  const reloaded = harness(storage);
  reloaded.funnel.onFrame(frame, device({ confirmedTick: 500 }));
  assert.deepEqual(reloaded.names(), ["Seat Taken"]);
  reloaded.funnel.onFrame(
    view({
      phase: "roundOver",
      round: 3,
      decidedRound: { ...decided, round: 3, tick: 900 },
    }),
    device({ confirmedTick: 900 }),
  );
  assert.deepEqual(reloaded.names(), ["Seat Taken", "Kill", "Miss"]);
});

test("storage that forgets everything still reports a round only once per funnel", () => {
  const forgetful = {
    getItem: () => null,
    setItem: () => {},
  };
  const { funnel, names } = harness({ ...createMemoryStorage(), ...forgetful });
  const frame = view({
    phase: "roundOver",
    round: 1,
    decidedRound: { matchId: "m1", round: 1, tick: 10, shots: [pull(1, "me")] },
  });
  for (let repeat = 0; repeat < 5; repeat++)
    funnel.onFrame(frame, device({ confirmedTick: 10 }));
  assert.deepEqual(names(), ["Miss", "Seat Taken"]);
});

test("a match end fires once per recap, only after the closing pause, with a duration only for a match it saw begin", () => {
  const { funnel, sent, names, advance } = harness();
  const spectator = device({ playerId: "" });
  funnel.onFrame(view({ phase: "countdown", round: 1 }), spectator);
  advance(61_400);
  const over = { phase: "matchOver", round: 5, phaseEndsAtTick: 1000 };
  funnel.onFrame(view({ ...over, tick: 999 }), spectator);
  assert.deepEqual(
    names(),
    ["Match Started"],
    "the final-round pause is still showing the arena",
  );
  for (let tick = 1000; tick < 1020; tick++)
    funnel.onFrame(view({ ...over, tick }), spectator);
  assert.deepEqual(names(), ["Match Started", "Match Ended"]);
  assert.deepEqual(sent[1]!.properties, {
    playerCount: 0,
    botCount: 0,
    humanCount: 0,
    rounds: 0,
    played: false,
    durationSeconds: 61,
  });

  // Back through the lobby and into a rematch this device only sees the end of: reported again, with no duration.
  funnel.onFrame(view({ matchId: "m2", phase: "lobby" }), spectator);
  funnel.onFrame(view({ matchId: "m2", ...over, tick: 1000 }), spectator);
  assert.deepEqual(names(), ["Match Started", "Match Ended", "Match Ended"]);
  assert.equal("durationSeconds" in sent[2]!.properties!, false);
});

test("a rematch that skips the lobby is a new recap because its pause ends at a different tick", () => {
  const { funnel, names } = harness();
  const spectator = device({ playerId: "" });
  funnel.onFrame(
    view({ phase: "matchOver", tick: 1000, phaseEndsAtTick: 1000 }),
    spectator,
  );
  funnel.onFrame(
    view({ phase: "matchOver", tick: 1000, phaseEndsAtTick: 1000 }),
    spectator,
  );
  funnel.onFrame(
    view({
      matchId: "m2",
      phase: "matchOver",
      tick: 2400,
      phaseEndsAtTick: 2400,
    }),
    spectator,
  );
  // No phaseEndsAtTick at all reads as "the pause is over".
  funnel.onFrame(
    view({ matchId: "m3", phase: "matchOver", tick: 5 }),
    spectator,
  );
  assert.deepEqual(names(), ["Match Ended", "Match Ended", "Match Ended"]);
});

test("one frame reports in a fixed order: started, shots, seat, ended", () => {
  const { funnel, names } = harness();
  funnel.onFrame(
    view({
      phase: "countdown",
      round: 1,
      decidedRound: {
        matchId: "m0",
        round: 4,
        tick: 1,
        shots: [pull(1, "me")],
      },
    }),
    device({ confirmedTick: 1 }),
  );
  assert.deepEqual(names(), ["Match Started", "Miss", "Seat Taken"]);
});

test("a malformed frame costs an event, never the render callback it runs in", () => {
  const sent: string[] = [];
  const funnel = createFunnel(
    (event) => {
      sent.push(event);
      if (event === "Seat Taken") throw new Error("transport exploded");
    },
    { now: () => 1, storage: createMemoryStorage() },
  );
  assert.doesNotThrow(() => funnel.onFrame(view(), device()));
  assert.deepEqual(sent, ["Seat Taken"]);
});
