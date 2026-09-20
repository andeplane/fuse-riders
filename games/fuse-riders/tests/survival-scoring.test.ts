import assert from "node:assert/strict";
import test from "node:test";
import {
  addPlayer,
  createGame,
  eliminatePlayer,
  removePlayer,
  resetMatch,
  startMatch,
  startNextRound,
  step,
  toView,
  COUNTDOWN_TICKS,
  RIDER_COLORS,
  type GameState,
} from "../src/engine/game.js";
import {
  defaultRoomSettings,
  loadRoomSettings,
  parseRoomSettings,
} from "../src/engine/room-settings.js";
import { POINT_UNIT, rankRound } from "../src/engine/leaderboard.js";
import {
  decodeGameState,
  encodeGameState,
} from "../src/engine/codec/checkpoint.js";
import {
  beginMatchParticipant,
  finalizeMatchStatsRound,
  snapshotMatchStats,
  type MatchStatsState,
} from "../src/engine/match-stats.js";
import { classicSettings } from "./fixtures/classic-settings.js";

function match(count: number, length = 3): GameState {
  const game = createGame("survival-scoring", classicSettings(), 42);
  game.settings = { ...defaultRoomSettings(), length, weights: {} };
  for (let slot = 0; slot < count; slot++)
    addPlayer(game, {
      id: `p${slot}`,
      name: `P${slot}`,
      slot,
      color: RIDER_COLORS[slot]!,
    });
  startMatch(game);
  for (let tick = 0; tick < COUNTDOWN_TICKS; tick++) step(game, new Map());
  return game;
}
function finish(game: GameState, deaths: string[]): void {
  assert.equal(game.phase, "playing");
  for (const id of deaths) {
    eliminatePlayer(game, id);
    step(game, new Map());
  }
}
function next(game: GameState): void {
  game.tick = game.phaseEndsAtTick!;
  startNextRound(game);
  for (let tick = 0; tick < COUNTDOWN_TICKS; tick++) step(game, new Map());
}

test("consistent survival beats more round wins, ignores session history, and restores/replays exactly", () => {
  const game = match(4);
  game.leaderboard.get("p1")!.totalScoreUnits = 1000 * POINT_UNIT;
  finish(game, ["p2", "p3", "p0"]);
  next(game);
  finish(game, ["p3", "p1", "p0"]);
  next(game);
  const restored = decodeGameState(encodeGameState(game));
  assert.ok(restored);
  for (const copy of [game, restored]) finish(copy, ["p1", "p2", "p0"]);
  assert.deepEqual(
    JSON.parse(encodeGameState(restored)),
    JSON.parse(encodeGameState(game)),
  );
  assert.equal(game.phase, "matchOver");
  assert.equal(game.matchWinnerId, "p0");
  assert.deepEqual(
    toView(game).matchStats.map((entry) => [
      entry.playerId,
      entry.matchScoreUnits / POINT_UNIT,
      entry.roundWins,
      entry.matchPlacement,
    ]),
    [
      ["p0", 6, 0, 1],
      ["p1", 5, 1, 2],
      ["p2", 5, 1, 2],
      ["p3", 5, 1, 2],
    ],
  );
  assert.equal(game.leaderboard.get("p0")!.matchWins, 1);
  // The clock still runs after the match, and with it the view's tick and the pace it states for a next step; nothing else may move.
  const timeless = (view: ReturnType<typeof toView>) => ({
    ...view,
    tick: 0,
    players: view.players.map((player) => ({ ...player, speed: 0, turn: 0 })),
  });
  const frozen = timeless(toView(game));
  step(game, new Map());
  assert.deepEqual(
    timeless(toView(game)),
    frozen,
    "post-match ticks never add more points",
  );
  resetMatch(game, "new-match");
  assert.ok(
    toView(game).players.every(
      (player) => player.matchScoreUnits === 0 && player.roundScoreUnits === 0,
    ),
  );
  assert.equal(game.leaderboard.get("p0")!.totalScoreUnits, 6 * POINT_UNIT);
});

test("a departed points leader stays in the match standings and late joiners get no retroactive score", () => {
  const game = match(3, 2);
  finish(game, ["p2", "p1"]);
  removePlayer(game, "p0");
  addPlayer(game, { id: "late", name: "Late", slot: 0, color: RIDER_COLORS[0] });
  assert.equal(
    toView(game).players.find((player) => player.id === "late")!
      .matchScoreUnits,
    0,
  );
  next(game);
  eliminatePlayer(game, "p1");
  eliminatePlayer(game, "p2");
  eliminatePlayer(game, "late");
  step(game, new Map());
  assert.equal(game.matchWinnerId, "p0");
  assert.equal(game.leaderboard.get("p0")!.matchWins, 1);
  assert.equal(toView(game).matchStats[0]!.name, "P0");
  assert.equal(game.matchStats.get("late")!.roundsPlayed, 1);
});

test("points ties break on round wins, while equal points and wins share placement", () => {
  const stats: MatchStatsState = new Map();
  for (let slot = 0; slot < 3; slot++)
    beginMatchParticipant(stats, {
      id: `p${slot}`,
      name: `P${slot}`,
      slot,
      color: RIDER_COLORS[slot]!,
    });
  // Three survival points can come from a win or three second places.
  for (let round = 0; round < 3; round++)
    finalizeMatchStatsRound(
      stats,
      ["p0", "p1", "p2"],
      round === 0 ? "p0" : undefined,
      [
        {
          playerId: "p0",
          name: "P0",
          place: round === 0 ? 1 : 3,
          scoreUnits: round === 0 ? 3 * POINT_UNIT : 0,
        },
        { playerId: "p1", name: "P1", place: 2, scoreUnits: POINT_UNIT },
        { playerId: "p2", name: "P2", place: 2, scoreUnits: POINT_UNIT },
      ],
    );
  assert.deepEqual(
    snapshotMatchStats(stats).map((entry) => [
      entry.playerId,
      entry.matchScoreUnits,
      entry.matchPlacement,
    ]),
    [
      ["p0", 180, 1],
      ["p1", 180, 2],
      ["p2", 180, 2],
    ],
  );
});

test("all lobby sizes award zero for first death and N including the winner bonus", () => {
  for (let count = 2; count <= 5; count++) {
    const result = rankRound(
      Array.from({ length: count }, (_, index) => ({
        id: String(index),
        name: String(index),
        eliminatedAtTick: index === count - 1 ? undefined : index,
      })),
    );
    assert.equal(result[0]!.scoreUnits, count * POINT_UNIT);
    assert.equal(result.at(-1)!.scoreUnits, 0);
  }
  const tied = rankRound([
    { id: "a", name: "A", eliminatedAtTick: 1 },
    { id: "b", name: "B", eliminatedAtTick: 2 },
    { id: "c", name: "C", eliminatedAtTick: 2 },
  ]);
  assert.deepEqual(
    tied.map((entry) => entry.scoreUnits),
    [60, 60, 0],
    "last simultaneous deaths get no win bonus",
  );
});

test("new rooms default to five rounds and saved win-format preferences migrate without accepting old wire settings", () => {
  const settings = defaultRoomSettings();
  assert.equal(settings.match, "rounds");
  assert.equal(settings.length, 5);
  const old = {
    ...settings,
    match: "wins",
    length: 3,
    weights: {},
    chainReaction: false,
  };
  assert.equal(parseRoomSettings(old), undefined);
  assert.deepEqual(loadRoomSettings({ getItem: () => JSON.stringify(old) }), {
    ...old,
    match: "rounds",
    length: 5,
    weights: settings.weights, // a save with no key for a pickup takes that pickup's default
  });
  assert.equal(parseRoomSettings({ ...settings, length: 3 })?.length, 3);
});

test("checkpoint score validation rejects missing, negative, fractional and impossible match totals", () => {
  const game = match(2);
  finish(game, ["p1"]);
  const original = encodeGameState(game);
  for (const value of [undefined, -1, 1.5, 61, 999999, "120"]) {
    const corrupt: unknown = JSON.parse(original, (key, current: unknown) =>
      key === "matchScoreUnits" ? value : current,
    );
    assert.equal(
      decodeGameState(JSON.stringify(corrupt)),
      undefined,
      `score ${String(value)}`,
    );
    assert.equal(
      encodeGameState(game),
      original,
      "rejection leaves healthy state unchanged",
    );
  }
});

test("the match winner and recap agree when points tie and round wins decide", () => {
  const game = match(4);
  finish(game, ["p2", "p3", "p1"]);
  next(game);
  finish(game, ["p3", "p0", "p1"]);
  next(game);
  finish(game, ["p2", "p0", "p1"]);
  assert.equal(game.matchWinnerId, "p0");
  assert.equal(game.roundWinnerId, "p3");
  assert.deepEqual(
    toView(game)
      .matchStats.slice(0, 2)
      .map((entry) => [
        entry.playerId,
        entry.matchScoreUnits / POINT_UNIT,
        entry.roundWins,
        entry.matchPlacement,
      ]),
    [
      ["p0", 6, 1, 1],
      ["p1", 6, 0, 2],
    ],
  );
});
