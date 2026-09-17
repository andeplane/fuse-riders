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
} from "../src/shared/game.ts";
import { INSTANT_DEATHS_COMMIT_PER_RIDER } from "../src/shared/sim/phases/commit-deaths.ts";

const NEUTRAL: InputIntent = { left: false, right: false, bomb: false };

function playing(riders: number): GameState {
  const game = createGame("death-path");
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

/**
 * Pins INSTANT_DEATHS_COMMIT_PER_RIDER. A Target Bomb goes off on the tick it is released. p1 (seat 1) is inside the
 * blast with its whole trail just outside it, so the only trail pieces p1 gets this tick are the ones its death
 * detaches; p2 (seat 2) is far away with the middle of its trail inside the blast, so the burn detaches its tail.
 * Both draw piece ids from one counter. Committed per rider, p1's wreck is numbered before p2's burn; committed after
 * the whole pass, as the sweep's deaths are, the numbers would swap — and they are state every replica compares.
 */
test("an instant kill's wreck takes its trail-piece ids before a later rider's trail is burnt", () => {
  assert.equal(INSTANT_DEATHS_COMMIT_PER_RIDER, true);
  const game = playing(3);
  const [shooter, victim, bystander] = ["p0", "p1", "p2"].map((id) =>
    game.players.get(id)!,
  );
  const tick = game.tick;
  const forever = tick + 1000;
  Object.assign(shooter!, { x: 300, y: 700, angle: 0, trail: [] });
  shooter!.targetBombArmed = true;
  shooter!.bombChargeStartedTick = tick;
  // 67 from the blast's centre and riding across it: inside the 63 + 7 that kills, outside the 63 + 3 that burns trail.
  Object.assign(victim!, { x: 1067, y: 446.25, angle: Math.PI / 2 });
  victim!.trail = [
    {
      x1: 1067,
      y1: 246.25,
      x2: 1067,
      y2: 446.25,
      createdTick: tick,
      expiresAtTick: forever,
    },
  ];
  Object.assign(bystander!, { x: 1200, y: 420, angle: 0 });
  bystander!.trail = [800, 900, 1000, 1100].map((x, index) => ({
    x1: x,
    y1: 420,
    x2: x + 100,
    y2: 420,
    createdTick: tick - 3 + index,
    expiresAtTick: forever,
  }));
  const nextPiece = game.nextTrailPieceId;

  const { events } = step(
    game,
    new Map<string, InputIntent>([
      [
        "p0",
        {
          ...NEUTRAL,
          bombCommands: [{ action: "release", aim: { x: 0.625, y: 0.5 } }],
        },
      ],
    ]),
  );

  assert.deepEqual(
    events.filter((event) => event.type === "playerEliminated"),
    [{ type: "playerEliminated", playerId: "p1", cause: "explosion" }],
  );
  assert.equal(bystander!.alive, true);
  const wreck = detachedIds(game, "p1"),
    burnt = detachedIds(game, "p2");
  assert.ok(wreck.length > 0, "the wreck's trail became debris");
  assert.ok(burnt.length > 0, "the blast cut the bystander's tail loose");
  assert.deepEqual(
    [...wreck, ...burnt].sort((a, b) => a - b),
    Array.from(
      { length: wreck.length + burnt.length },
      (_, index) => nextPiece + index,
    ),
    "nothing else took a piece id this tick",
  );
  assert.ok(
    Math.max(...wreck) < Math.min(...burnt),
    `the wreck (${wreck}) is numbered before the later rider's burn (${burnt})`,
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

  // Instant: p1 stands where p0's Target Bomb lands on the tick it is released.
  const instant = playing(2);
  const shooter = instant.players.get("p0")!;
  Object.assign(shooter, { x: 300, y: 700, angle: 0 });
  shooter.targetBombArmed = true;
  shooter.bombChargeStartedTick = instant.tick;
  Object.assign(instant.players.get("p1")!, {
    x: 1000,
    y: 450,
    angle: 0,
    trail: [],
  });
  const instantEvents = step(
    instant,
    new Map<string, InputIntent>([
      [
        "p0",
        {
          ...NEUTRAL,
          bombCommands: [{ action: "release", aim: { x: 0.625, y: 0.5 } }],
        },
      ],
    ]),
  ).events;

  for (const [game, events, weapon] of [
    [swept, sweptEvents, "bomb"],
    [instant, instantEvents, "target"],
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
