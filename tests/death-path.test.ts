import assert from "node:assert/strict";
import test from "node:test";
import {
  addPlayer,
  createGame,
  startMatch,
  step,
  COUNTDOWN_TICKS,
  type GameState,
  type InputIntent,
} from "../src/engine/game.ts";
import { INSTANT_DEATHS_COMMIT_PER_RIDER } from "../src/engine/sim/phases/commit-deaths.ts";
import { classicSettings } from "./fixtures/classic-settings.ts";

const NEUTRAL: InputIntent = { left: false, right: false, bomb: false };

function playing(riders: number): GameState {
  const game = createGame("death-path", classicSettings());
  for (let slot = 0; slot < riders; slot++)
    addPlayer(game, { id: `p${slot}`, name: `P${slot}`, slot, color: "#fff" });
  startMatch(game);
  for (let tick = 0; tick < COUNTDOWN_TICKS; tick++) step(game, new Map());
  assert.equal(game.phase, "playing");
  return game;
}

function detachedIds(game: GameState, id: string): number[] {
  return [
    ...new Set(
      game.players
        .get(id)!
        .trail.flatMap((segment) =>
          segment.detached ? [segment.detached.id] : [],
        ),
    ),
  ];
}

const PRESS: InputIntent = {
  ...NEUTRAL,
  bomb: true,
  bombCommands: [{ action: "press" }],
};

/**
 * Pins the value of INSTANT_DEATHS_COMMIT_PER_RIDER and that Gun kills commit in seat order; it no longer tells the two
 * settings apart. Two Guns fire in one tick: p0 shoots p2
 * and p1 shoots p3. Each victim's death detaches its trail into debris, and the pieces take ids from one counter in
 * seat order: p2's wreck first, then p3's. Target Bomb, removed in `fuse-p2p-39`, also burnt trails in this pass, and
 * that is what once made the per-rider commit matter; with bullets alone both settings number the pieces alike.
 */
test("instant kills in one tick detach their wrecks in seat order", () => {
  assert.equal(INSTANT_DEATHS_COMMIT_PER_RIDER, true);
  const game = playing(4);
  game.obstacles = [];
  game.nextPickupSpawnTick = game.tick + 1000;
  const [first, second, firstVictim, secondVictim] = [
    "p0",
    "p1",
    "p2",
    "p3",
  ].map((id) => game.players.get(id)!);
  const tick = game.tick;
  Object.assign(first!, {
    x: 200,
    y: 300,
    angle: 0,
    trail: [],
    gunArmed: true,
  });
  Object.assign(second!, {
    x: 200,
    y: 600,
    angle: 0,
    trail: [],
    gunArmed: true,
  });
  // Each victim's trail runs away from the bullet's line, so only the head is hit.
  for (const [victim, y] of [
    [firstVictim!, 300],
    [secondVictim!, 600],
  ] as const) {
    Object.assign(victim, { x: 900, y, angle: Math.PI });
    victim.trail = [
      {
        x1: 900,
        y1: y - 200,
        x2: 900,
        y2: y - 40,
        createdTick: tick,
        expiresAtTick: tick + 1000,
      },
    ];
  }
  const nextPiece = game.nextTrailPieceId;

  const { events } = step(
    game,
    new Map<string, InputIntent>([
      ["p0", PRESS],
      ["p1", PRESS],
    ]),
  );

  assert.deepEqual(
    events.filter((event) => event.type === "playerEliminated"),
    [
      { type: "playerEliminated", playerId: "p2", cause: "explosion" },
      { type: "playerEliminated", playerId: "p3", cause: "explosion" },
    ],
  );
  const firstWreck = detachedIds(game, "p2"),
    secondWreck = detachedIds(game, "p3");
  assert.ok(firstWreck.length > 0 && secondWreck.length > 0);
  assert.ok(
    Math.max(...firstWreck) < Math.min(...secondWreck),
    `seat 2's wreck (${firstWreck}) is numbered before seat 3's (${secondWreck})`,
  );
  assert.deepEqual(
    [...firstWreck, ...secondWreck].sort((a, b) => a - b),
    Array.from(
      { length: firstWreck.length + secondWreck.length },
      (_, index) => nextPiece + index,
    ),
    "nothing else took a piece id this tick",
  );
});

test("a sweep death and an instant death are recorded the same way", () => {
  // Sweep: p1 rides into a fuse blast from p0's bomb, which explodes before anyone moves.
  const swept = playing(2);
  const sweptVictim = swept.players.get("p1")!;
  Object.assign(swept.players.get("p0")!, { x: 300, y: 700, angle: 0 });
  Object.assign(sweptVictim, { x: 1000, y: 450, angle: 0, trail: [] });
  swept.shots.push({
    shot: 1,
    shooterId: "p0",
    weapon: "bomb",
    elapsed: 0,
    bombs: 1,
    power: 0,
    extraBombs: 0,
    fuseLevel: 0,
    rangeLevel: 0,
    grip: false,
    kills: [],
  });
  swept.nextBombId = 2;
  swept.bombs.set(1, {
    id: 1,
    ownerId: "p0",
    launchX: 300,
    launchY: 700,
    x: 1000,
    y: 450,
    launchedTick: swept.tick - 40,
    placedTick: swept.tick - 40,
    landsAtTick: swept.tick - 30,
    explodeAtTick: swept.tick + 1,
    blastRange: 90,
    flightPath: [],
    shot: 1,
  });
  const sweptEvents = step(swept, new Map()).events;

  // Instant: p0's Gun hits p1's head on the tick it is pressed.
  const instant = playing(2);
  instant.obstacles = [];
  Object.assign(instant.players.get("p0")!, {
    x: 300,
    y: 450,
    angle: 0,
    trail: [],
    gunArmed: true,
  });
  Object.assign(instant.players.get("p1")!, {
    x: 1000,
    y: 450,
    angle: Math.PI,
    trail: [],
  });
  const instantEvents = step(
    instant,
    new Map<string, InputIntent>([["p0", PRESS]]),
  ).events;

  for (const [game, events, weapon] of [
    [swept, sweptEvents, "bomb"],
    [instant, instantEvents, "gun"],
  ] as const) {
    assert.deepEqual(
      events.filter((event) => event.type === "playerEliminated"),
      [{ type: "playerEliminated", playerId: "p1", cause: "explosion" }],
    );
    const victim = game.players.get("p1")!;
    assert.equal(victim.alive, false);
    assert.equal(game.roundParticipants.get("p1")!.eliminatedAtTick, game.tick);
    const died = game.matchStats.get("p1")!,
      killed = game.matchStats.get("p0")!;
    assert.equal(died.deathsByCause.explosion, 1);
    assert.equal(died.combat!.deaths[weapon], 1);
    assert.deepEqual(died.combat!.killers, { p0: 1 });
    assert.equal(killed.eliminations, 1);
    assert.equal(killed.combat!.kills[weapon], 1);
    assert.deepEqual(killed.combat!.victims, { p1: 1 });
    const shot = game.shots.find((entry) => entry.weapon === weapon)!;
    assert.deepEqual(
      shot.kills.map((kill) => kill.victimId),
      ["p1"],
    );
  }
});
