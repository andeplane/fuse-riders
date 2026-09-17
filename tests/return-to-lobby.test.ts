import assert from "node:assert/strict";
import test from "node:test";
import {
  createGame,
  addPlayer,
  startMatch,
  step,
  COUNTDOWN_TICKS,
  returnToLobby,
  toView,
  type GamePhase,
} from "../src/engine/game.ts";
for (const phase of [
  "lobby",
  "countdown",
  "playing",
  "roundOver",
  "matchOver",
] satisfies GamePhase[]) {
  test(`return to lobby from ${phase} clears match state without inventing session points`, () => {
    const game = createGame("before");
    for (let slot = 0; slot < 3; slot++)
      addPlayer(game, {
        id: `p${slot}`,
        name: `P${slot}`,
        slot,
        color: "#fff",
      });
    startMatch(game);
    for (let i = 0; i < COUNTDOWN_TICKS; i++) step(game, new Map());
    game.phase = phase;
    game.round = 4;
    game.phaseEndsAtTick = 900;
    game.roundStartedTick = 100;
    game.roundWinnerId = "p0";
    game.matchWinnerId = "p0";
    game.players.get("p2")!.connected = false;
    const player = game.players.get("p0")!;
    player.avatarId = "dragon";
    player.roundWins = 2;
    player.targetBombArmed = true;
    player.fiveShotArmed = true;
    player.bombChargeStartedTick = game.tick;
    player.bombTarget = { x: 1, y: 2 };
    player.invulnerableUntilTick = 999;
    player.inkUntilTick = 999;
    game.pickups = [
      { id: 1, type: "star", x: 200, y: 300, expiresAtTick: 999 },
    ];
    game.portalPairs = [
      {
        id: "old",
        gates: [
          { x: 200, y: 200, halfLength: 60 },
          { x: 600, y: 600, halfLength: 60 },
        ],
        expiresAtTick: 999,
      },
    ];
    game.blasts = [
      {
        bombId: 1,
        ownerId: "p0",
        circle: { x: 300, y: 300, radius: 150 },
        expiresAtTick: 999,
      },
    ];
    game.leaderboard.get("p0")!.totalScoreUnits = 300;
    const ledger = structuredClone([...game.leaderboard]);
    returnToLobby(game, "after");
    assert.equal(game.phase, "lobby");
    assert.equal(game.matchId, "after");
    assert.equal(game.tick, 0);
    assert.equal(game.round, 1);
    assert.deepEqual([...game.leaderboard], ledger);
    assert.deepEqual([...game.players.keys()], ["p0", "p1"]);
    assert.equal(game.players.get("p0")!.avatarId, "dragon");
    assert.equal(game.matchStats.size, 0);
    assert.equal(game.roundParticipants.size, 0);
    assert.equal(game.roundPlacements.length, 0);
    assert.deepEqual(game.portalPairs, []);
    assert.deepEqual(game.gravityFields, []);
    assert.equal(game.roundWinnerId, undefined);
    assert.equal(game.matchWinnerId, undefined);
    assert.equal(game.roundStartedTick, undefined);
    assert.equal(game.phaseEndsAtTick, undefined);
    const snapshot = toView(game);
    assert.deepEqual(snapshot.bombs, []);
    assert.deepEqual(snapshot.blasts, []);
    assert.deepEqual(snapshot.pickups, []);
    assert.ok(
      snapshot.players.every(
        (p) =>
          p.connected &&
          !p.alive &&
          p.roundWins === 0 &&
          !p.targetBombArmed &&
          !p.fiveShotArmed &&
          p.bombTarget === undefined &&
          p.bombChargeStartedTick === undefined &&
          p.invulnerableUntilTick === 0 &&
          p.inkUntilTick === 0 &&
          p.trail.length === 0 &&
          !p.waitingForNextRound,
      ),
    );
    startMatch(game);
    assert.equal(game.phase, "countdown");
    assert.equal(game.matchId, "after");
  });
}
test("empty party can return to lobby and invalid scope is rejected before mutation", () => {
  const game = createGame("before");
  assert.throws(() => returnToLobby(game, ""));
  assert.equal(game.matchId, "before");
  returnToLobby(game, "empty");
  assert.equal(game.phase, "lobby");
  assert.equal(game.players.size, 0);
});
