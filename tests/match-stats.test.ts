import assert from "node:assert/strict";
import test from "node:test";
import {
  beginMatchParticipant,
  finalizeMatchStatsRound,
  recordBombExploded,
  recordBombPlaced,
  recordDeath,
  recordEarlyExit,
  recordPickup,
  recordPortalTransit,
  recordSurvivalTick,
  snapshotMatchStats,
  type MatchStatsState,
} from "../src/shared/match-stats.js";

const identity = (id: string, slot: number) => ({
  id,
  name: id.toUpperCase(),
  slot,
  color: `color-${slot}`,
});

test("records authoritative actions and returns detached snapshots", () => {
  const stats: MatchStatsState = new Map();
  beginMatchParticipant(stats, identity("a", 0));
  beginMatchParticipant(stats, identity("b", 1));
  recordSurvivalTick(stats, "a", 7.5, true, true);
  recordBombPlaced(stats, "a");
  recordBombExploded(stats, "a");
  recordPickup(stats, "a", "power");
  recordPickup(stats, "a", "star");
  recordPickup(stats, "a", "beer");
  recordPickup(stats, "a", "triple");
  recordPickup(stats, "a", "five");
  recordPickup(stats, "a", "orbitShield");
  recordPickup(stats, "a", "portal");
  recordPortalTransit(stats, "a");
  recordDeath(stats, "b", "explosion", "a");
  recordEarlyExit(stats, "b");
  finalizeMatchStatsRound(stats, ["a", "b"], "a");

  const snapshot = snapshotMatchStats(stats);
  const { combat, ...basic } = snapshot[0]!;
  assert.equal(combat?.kills.unknown, 1);
  assert.deepEqual(basic, {
    playerId: "a",
    name: "A",
    slot: 0,
    color: "color-0",
    roundsPlayed: 1,
    roundWins: 1,
    matchScoreUnits: 0,
    roundsDrawn: 0,
    matchPlacement: 1,
    survivalTicks: 1,
    longestSurvivalTicks: 1,
    distanceUnits: 7.5,
    bombsPlaced: 1,
    bombsExploded: 1,
    eliminations: 1,
    deathsByCause: { wall: 0, trail: 0, explosion: 0, rider: 0 },
    pickupsCollected: 7,
    powerPickups: 1,
    starPickups: 1,
    beerPickups: 1,
    inkPickups: 0,
    triplePickups: 1,
    fivePickups: 1,
    targetPickups: 0,
    shieldPickups: 1,
    portalPickups: 1,
    portalTransits: 1,
    invulnerableTicks: 1,
    wallBounces: 1,
    earlyExits: 0,
  });
  assert.equal(snapshot[1]!.deathsByCause.explosion, 1);
  snapshot[1]!.deathsByCause.explosion = 99;
  assert.equal(stats.get("b")!.deathsByCause.explosion, 1);
});

test("tracks round draws, longest survival and competition-ranked win ties", () => {
  const stats: MatchStatsState = new Map();
  for (let slot = 0; slot < 4; slot += 1)
    beginMatchParticipant(stats, identity(String(slot), slot));
  recordSurvivalTick(stats, "0", 1, false, false);
  finalizeMatchStatsRound(stats, ["0", "1", "2", "3"]);
  beginMatchParticipant(stats, {
    ...identity("0", 3),
    name: "Renamed",
    color: "new",
  });
  beginMatchParticipant(stats, identity("1", 1));
  beginMatchParticipant(stats, identity("2", 2));
  beginMatchParticipant(stats, identity("3", 0));
  recordSurvivalTick(stats, "0", 1, false, false);
  recordSurvivalTick(stats, "0", 1, false, false);
  finalizeMatchStatsRound(stats, ["0", "1", "2", "3"], "0");
  beginMatchParticipant(stats, identity("1", 1));
  finalizeMatchStatsRound(stats, ["0", "1", "2", "3"], "1");

  const snapshot = snapshotMatchStats(stats);
  assert.deepEqual(
    snapshot.map(({ playerId, matchPlacement }) => [playerId, matchPlacement]),
    [
      ["1", 1],
      ["0", 1],
      ["3", 3],
      ["2", 3],
    ],
  );
  const zero = snapshot.find((entry) => entry.playerId === "0")!;
  assert.equal(zero.name, "Renamed");
  assert.equal(zero.longestSurvivalTicks, 2);
  assert.equal(zero.roundsDrawn, 1);
});

test("recorders called mid-tick tolerate a missing rider and a bad distance; a contradictory round is still rejected", () => {
  const stats: MatchStatsState = new Map();
  beginMatchParticipant(stats, identity("a", 0));
  // A throw here would abandon a tick half-way (#253 C8): the tick is counted and the distance that is not one is dropped.
  recordSurvivalTick(stats, "a", -1, false, false);
  recordSurvivalTick(stats, "a", Number.NaN, true, true);
  recordSurvivalTick(stats, "a", 2.5, false, false);
  assert.deepEqual(
    [
      stats.get("a")!.survivalTicks,
      stats.get("a")!.distanceUnits,
      stats.get("a")!.invulnerableTicks,
      stats.get("a")!.wallBounces,
    ],
    [3, 2.5, 1, 1],
  );
  const before = structuredClone(stats);
  recordSurvivalTick(stats, "missing", 1, false, false);
  recordBombPlaced(stats, "missing");
  recordBombExploded(stats, "missing");
  recordPickup(stats, "missing", "star");
  recordPortalTransit(stats, "missing");
  recordEarlyExit(stats, "missing");
  assert.deepEqual(stats, before, "an unseated rider is not counted");
  // The victim's death still counts when its killer is unknown, and a known killer is still credited with an unknown victim.
  recordDeath(stats, "a", "wall", "missing");
  assert.equal(stats.get("a")!.deathsByCause.wall, 1);
  assert.equal(stats.get("a")!.eliminations, 0);
  recordDeath(stats, "missing", "explosion", "a", "bomb");
  assert.equal(stats.get("a")!.eliminations, 1);
  assert.equal(stats.get("a")!.combat!.kills.bomb, 1);
  assert.equal(stats.has("missing"), false);
  finalizeMatchStatsRound(stats, ["a", "missing"], "a");
  assert.equal(stats.get("a")!.roundsPlayed, 1);
  assert.throws(() => finalizeMatchStatsRound(stats, ["a", "a"]), /unique ids/);
  assert.throws(
    () => finalizeMatchStatsRound(stats, ["a"], "missing"),
    /winner must be/,
  );
});

test("never credits self deaths and updates an existing participant identity", () => {
  const stats: MatchStatsState = new Map();
  beginMatchParticipant(stats, identity("a", 0));
  recordDeath(stats, "a", "trail", "a");
  beginMatchParticipant(stats, {
    id: "a",
    name: "New",
    slot: 2,
    color: "pink",
  });
  const entry = snapshotMatchStats(stats)[0]!;
  assert.equal(entry.eliminations, 0);
  assert.equal(entry.deathsByCause.trail, 1);
  assert.deepEqual([entry.name, entry.slot, entry.color], ["New", 2, "pink"]);
});

test("combat keeps human and AI attribution separate and snapshots detached", () => {
  const stats: MatchStatsState = new Map();
  for (const [slot, id] of ["a", "b", "bot:1"].entries())
    beginMatchParticipant(stats, identity(id, slot));
  recordDeath(stats, "bot:1", "explosion", "a", "shell");
  recordDeath(stats, "b", "trail", "a");
  recordDeath(stats, "a", "explosion", "bot:1", "bomb");
  recordDeath(stats, "a", "wall");
  recordDeath(stats, "a", "trail", "a");
  finalizeMatchStatsRound(stats, ["a", "b", "bot:1"], "a", [
    { playerId: "a", name: "A", place: 1, scoreUnits: 60 },
  ]);
  const a = snapshotMatchStats(stats).find((p) => p.playerId === "a")!;
  assert.equal(a.combat!.versus.human.kills.trail, 1);
  assert.equal(a.combat!.versus.ai.kills.shell, 1);
  assert.equal(a.combat!.versus.ai.deaths.bomb, 1);
  assert.equal(a.combat!.selfDeaths, 1);
  assert.deepEqual(a.combat!.victims, { "bot:1": 1, b: 1 });
  assert.deepEqual(a.combat!.killers, { "bot:1": 1 });
  assert.equal(a.combat!.roundPlaces[0], 1);
  a.combat!.victims.b = 50;
  assert.equal(stats.get("a")!.combat!.victims.b, 1);
});
