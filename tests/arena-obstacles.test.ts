import test from "node:test";
import assert from "node:assert/strict";
import {
  addPlayer,
  createGame,
  startMatch,
  startNextRound,
  step,
  toSnapshot,
  OVERTIME_START_TICK,
  PICKUP_RADIUS,
  RIDER_OBSTACLE_RADIUS,
  RIDER_RADIUS,
  SLOT_COLORS,
  TRAIL_WIDTH,
  type GameState,
  type InputIntent,
  type PlayerState,
} from "../src/shared/game.js";
import { BOMB_FLIGHT_TICKS } from "../src/shared/bomb-launch.js";
import {
  ARENA_MAPS,
  MAX_OBSTACLES,
  OBSTACLE_HIT_SCALE,
  OBSTACLE_KINDS,
  obstacleBlocksPath,
  obstacleDistanceSquared,
  obstacleHitbox,
  obstacleTouchesCircle,
  type Obstacle,
} from "../src/shared/arena-map.js";
import { defaultRoomSettings } from "../src/shared/room-settings.js";
import { BotController } from "../src/shared/bot-controller.js";
import { decodeGameState, encodeGameState } from "../src/online/checkpoint.js";

const neutral: InputIntent = { left: false, right: false, bomb: false };
const press: InputIntent = {
  ...neutral,
  bomb: true,
  bombCommands: [{ action: "press" }],
};
const boulder = (overrides: Partial<Obstacle> = {}): Obstacle => ({
  id: 1,
  kind: "rock",
  x: 700,
  y: 450,
  halfWidth: 60,
  halfHeight: 60,
  ...overrides,
});
/** Where a rider heading +x first touches an obstacle: its hitbox's near face, less the rider's own contact radius. */
const touchX = (obstacle: Obstacle): number =>
  obstacle.x - obstacleHitbox(obstacle).halfWidth - RIDER_OBSTACLE_RADIUS;

/** A started round with whatever scenery the test asks for, and no drops of its own. */
function scene(
  obstacles: Obstacle[] = [boulder()],
  riders = 2,
  matchId = "obstacles",
): GameState {
  const game = createGame(matchId, 11);
  for (let slot = 0; slot < riders; slot += 1)
    addPlayer(game, {
      id: `p${slot}`,
      name: `P${slot}`,
      slot,
      color: SLOT_COLORS[slot]!,
    });
  startMatch(game);
  while (game.phase === "countdown") step(game, new Map());
  game.nextPickupSpawnTick = Number.MAX_SAFE_INTEGER;
  game.obstacles = obstacles;
  for (const player of game.players.values())
    Object.assign(player, {
      x: 300,
      y: 450 + player.slot * 300,
      angle: 0,
      trail: [],
    });
  return game;
}
const rider = (game: GameState, id = "p0"): PlayerState =>
  game.players.get(id)!;
/** Ticks until the named rider is out, or `limit` if it survives. */
function ticksToDeath(game: GameState, limit = 70, id = "p0"): number {
  for (let tick = 1; tick <= limit; tick += 1) {
    step(game, new Map());
    if (!rider(game, id).alive) return tick;
  }
  return limit;
}

test("a rider that rides into scenery dies against its face, not inside it", () => {
  const game = scene();
  const events = [];
  for (let tick = 0; tick < 70 && rider(game).alive; tick += 1)
    events.push(...step(game, new Map()).events);
  const dead = rider(game);
  assert.equal(dead.alive, false, "the rock stopped the rider");
  assert.ok(
    events.some(
      (event) =>
        event.type === "playerEliminated" &&
        event.playerId === "p0" &&
        event.cause === "wall",
    ),
    "a crash is reported like any other solid contact",
  );
  // Stopped exactly where it first touched: the near face of the rock's hitbox, at the rider's own contact radius
  // from it. Anything later in the step is the crash being resolved somewhere inside the rock.
  assert.ok(
    Math.abs(dead.x - touchX(boulder())) < 1e-6,
    `stopped at ${dead.x}, not at the face`,
  );
  assert.equal(dead.y, 450, "and on the line it was riding");
  assert.ok(
    Math.sqrt(
      obstacleDistanceSquared(
        obstacleHitbox(game.obstacles[0]!),
        dead.x,
        dead.y,
      ),
    ) <=
      RIDER_OBSTACLE_RADIUS + 1e-6,
  );
  const wreck = dead.trail.at(-1)!;
  assert.ok(
    Math.abs(wreck.x2 - dead.x) < 1e-6,
    "the trail it laid reaches the crash and stops there",
  );
});

test("a rider that only brushes a crown rides on, and one that meets its solid part does not", () => {
  // The footprint's corner is floor: the crown drawn there is an ellipse, and the line along y = 450 - 26 crosses
  // the footprint without ever coming within a head's width of the crown's solid middle.
  const tree = (): Obstacle =>
    boulder({ kind: "tree", halfWidth: 28, halfHeight: 28 });
  const graze = scene([tree()]);
  Object.assign(rider(graze), { y: 450 - 26 });
  assert.equal(ticksToDeath(graze), 70, "through the corner of the footprint");
  assert.ok(ticksToDeath(scene([tree()])) < 70, "but not through the trunk");
});

test("every hitbox sits inside what is drawn, and a crown's inside its ellipse", () => {
  for (const kind of OBSTACLE_KINDS) {
    const scale = OBSTACLE_HIT_SCALE[kind];
    assert.ok(scale > 0.5 && scale < 1, `${kind} kills with ${scale}`);
  }
  // The corner of the hitbox is the furthest it reaches; on a crown that corner must not leave the ellipse.
  for (const kind of ["tree", "bush"] as const)
    assert.ok(2 * OBSTACLE_HIT_SCALE[kind] ** 2 <= 1, `${kind} corner`);
});

test("a rider steering past scenery is unharmed, and the same line with the rock is fatal", () => {
  assert.equal(
    ticksToDeath(scene([boulder({ y: 700 })])),
    70,
    "a rock off the line never touches this rider",
  );
  assert.ok(
    ticksToDeath(scene()) < 70,
    "the same ride into a rock on the line ends it",
  );
});

test("invulnerable riders ride straight through scenery", () => {
  const game = scene();
  rider(game).invulnerableUntilTick = game.tick + 200;
  assert.equal(ticksToDeath(game, 70), 70, "a star rider is unharmed");
  assert.ok(
    rider(game).x > 700 + 60,
    "and comes out the far side rather than bouncing off it",
  );
});

test("a shielded rider is turned away from the scenery it crashed into", () => {
  const game = scene();
  const survivor = rider(game);
  survivor.shielded = true;
  // Up to the crash and a little past it. Riding back down its own trail afterwards is fatal like any other
  // trail, so this stops once the shield has been spent rather than waiting for that.
  for (let tick = 0; tick < 70 && survivor.shielded; tick += 1)
    step(game, new Map());
  assert.equal(survivor.alive, true, "the shield absorbed the crash");
  assert.equal(survivor.shielded, false, "and was spent doing it");
  assert.ok(
    Math.abs(Math.cos(survivor.angle) + 1) < 1e-6,
    "it came away facing back down the lane it arrived on",
  );
  assert.ok(
    survivor.x < touchX(boulder()) + 1e-6,
    "and stopped at the rock rather than inside it",
  );
  step(game, new Map());
  assert.ok(survivor.x < touchX(boulder()), "and rides away from it");
});

test("scenery further along the step never steals the kill from the trail that stopped the rider first", () => {
  // `wall` outranks `trail`, and unlike the boundary an obstacle can be met anywhere along a step. A rock the
  // rider would only have reached later in the tick must not turn a credited trail kill into an uncredited crash.
  // One step of about 7.5 units from x=640 meets the trail at x=648.5 first and the face of the rock's hitbox at
  // x=649 after it, so both contacts fall inside this very tick and only their order can tell them apart.
  const crash = (withRock: boolean) => {
    const game = scene(
      withRock
        ? [boulder({ x: 703, y: 450, halfWidth: 60, halfHeight: 60 })]
        : [],
    );
    const victim = rider(game),
      owner = rider(game, "p1");
    Object.assign(victim, { x: 640, y: 450, angle: 0, trail: [] });
    Object.assign(owner, {
      x: 200,
      y: 100,
      angle: 0,
      trail: [
        {
          x1: 648.5,
          y1: 300,
          x2: 648.5,
          y2: 600,
          createdTick: game.tick - 5,
          expiresAtTick: game.tick + 500,
        },
      ],
    });
    const events = step(game, new Map()).events;
    return {
      game,
      victim,
      cause: events.flatMap((event) =>
        event.type === "playerEliminated" ? [event.cause] : [],
      )[0],
    };
  };
  // The fixture is only meaningful if the rock is genuinely in reach of this step: without the trail, it kills.
  const rockOnly = scene([
    boulder({ x: 703, y: 450, halfWidth: 60, halfHeight: 60 }),
  ]);
  Object.assign(rider(rockOnly), { x: 640, y: 450, angle: 0, trail: [] });
  Object.assign(rider(rockOnly, "p1"), { x: 200, y: 100, angle: 0, trail: [] });
  step(rockOnly, new Map());
  assert.equal(
    rider(rockOnly).alive,
    false,
    "the rock is inside this step's travel",
  );
  const open = crash(false);
  assert.equal(
    open.cause,
    "trail",
    "the fixture does kill on the trail when nothing else is near",
  );
  const rocky = crash(true);
  assert.equal(
    rocky.cause,
    "trail",
    "and the rock a step further on does not take it over",
  );
  assert.equal(
    rocky.game.matchStats.get("p1")?.eliminations,
    open.game.matchStats.get("p1")?.eliminations,
    "the trail owner keeps the kill",
  );
  assert.equal(rocky.game.matchStats.get("p0")?.deathsByCause.trail, 1);
  assert.ok(
    Math.abs(rocky.victim.x - open.victim.x) < 1e-9,
    "and the wreck is left where the trail stopped it",
  );
});

test("a shield absorbing a blast still stands the rider against the scenery it hit that tick", () => {
  // The blast outranks the crash as a cause, but the rider reached the rock: leaving it inside would let it ride
  // the interior out under its shield grace and die in there.
  const game = scene([
    boulder({ x: 700, y: 450, halfWidth: 60, halfHeight: 60 }),
  ]);
  const survivor = rider(game);
  Object.assign(survivor, {
    x: touchX(boulder()) - 4,
    y: 450,
    angle: 0,
    shielded: true,
  });
  // A shell rather than a bomb: any blast big enough to reach a rider standing this close to a rock would clear
  // the rock as well, and a shell kills under the same `explosion` cause without touching the scenery.
  game.bombs.set(1, {
    id: 1,
    ownerId: "p1",
    launchX: 620,
    launchY: 560,
    x: 620,
    y: 478,
    launchedTick: game.tick - 10,
    placedTick: game.tick - 10,
    landsAtTick: Number.MAX_SAFE_INTEGER,
    explodeAtTick: Number.MAX_SAFE_INTEGER,
    blastRange: 0,
    flightPath: [],
    shell: { vx: 0, vy: -450 },
  });
  step(game, new Map());
  assert.deepEqual(
    game.obstacles.map((obstacle) => obstacle.id),
    [1],
    "the rock is still standing, so this is about the crash",
  );
  assert.equal(survivor.alive, true, "the shield absorbed it");
  assert.equal(survivor.shielded, false);
  assert.ok(
    survivor.x <= touchX(boulder()) + 1e-6,
    `left at ${survivor.x}, inside the rock`,
  );
  assert.ok(
    Math.abs(Math.cos(survivor.angle) + 1) < 1e-6,
    "and turned away from the face it hit",
  );
  // Through the grace ticks and out the other side of them, still clear of the rock.
  for (let tick = 0; tick < 12; tick += 1) step(game, new Map());
  assert.ok(
    survivor.alive,
    "it did not die inside the scenery once the grace ran out",
  );
});

test("a blast clears the scenery it covers and leaves the rest standing", () => {
  const game = scene([
    boulder(),
    boulder({ id: 2, x: 1100, y: 200, halfWidth: 40, halfHeight: 40 }),
  ]);
  const shooter = rider(game);
  Object.assign(shooter, { x: 560, y: 450, angle: 0 });
  step(game, new Map([["p0", press]]));
  step(
    game,
    new Map([
      ["p0", { ...neutral, bombCommands: [{ action: "release" as const }] }],
    ]),
  );
  const bomb = [...game.bombs.values()][0]!;
  Object.assign(bomb, {
    x: 700,
    y: 450,
    landsAtTick: game.tick + 1,
    explodeAtTick: game.tick + 1,
    blastRange: 120,
  });
  shooter.invulnerableUntilTick = game.tick + 20; // the shooter's own survival is not what this measures
  step(game, new Map());
  assert.deepEqual(
    game.obstacles.map((obstacle) => obstacle.id),
    [2],
    "the rock in the blast is gone, the distant one stands",
  );
  assert.equal(
    toSnapshot(game).obstacles.length,
    1,
    "and the board every device draws agrees",
  );
});

test("the scenery a blast just cleared cannot still kill the rider driving through it", () => {
  // A wide rock with the bomb tucked against its far side, so the blast never reaches the rider arriving at the near
  // face. Without the bomb that same tick is fatal, which is what makes this a test of ordering.
  const wall = () => boulder({ x: 680, halfWidth: 80 });
  const approach = (withBomb: boolean): GameState => {
    const game = scene([wall()]);
    Object.assign(rider(game), { x: touchX(wall()) - 3, y: 450, angle: 0 });
    if (withBomb)
      game.bombs.set(1, {
        id: 1,
        ownerId: "p1",
        launchX: 760,
        launchY: 450,
        x: 760,
        y: 450,
        launchedTick: game.tick - BOMB_FLIGHT_TICKS,
        placedTick: game.tick - BOMB_FLIGHT_TICKS,
        landsAtTick: game.tick,
        explodeAtTick: game.tick + 1,
        blastRange: 60,
        flightPath: [{ x: 760, y: 450, angle: 0 }],
      });
    step(game, new Map());
    return game;
  };
  assert.equal(
    rider(approach(false)).alive,
    false,
    "the rock is in the way on this very tick",
  );
  const cleared = approach(true);
  assert.deepEqual(cleared.obstacles, [], "the blast cleared the rock");
  assert.equal(
    rider(cleared).alive,
    true,
    "and the rider that reached it on the same tick rode through",
  );
});

test("a shell bounces off scenery instead of passing through it", () => {
  const game = scene([boulder({ x: 900, halfWidth: 80, halfHeight: 200 })]);
  const shooter = rider(game);
  Object.assign(shooter, { x: 300, y: 450, angle: 0, shellArmed: true });
  step(game, new Map([["p0", press]]));
  step(
    game,
    new Map([
      ["p0", { ...neutral, bombCommands: [{ action: "release" as const }] }],
    ]),
  );
  const shell = [...game.bombs.values()].find((bomb) => bomb.shell)!;
  assert.ok(shell.shell!.vx > 0, "launched toward the rock");
  for (let tick = 0; tick < 30 && game.bombs.has(shell.id); tick += 1) {
    step(game, new Map());
    const live = game.bombs.get(shell.id);
    if (!live) break;
    assert.ok(
      !obstacleTouchesCircle(game.obstacles[0]!, live.x, live.y, 1),
      "never inside the rock",
    );
    if (live.shell!.vx < 0) {
      assert.ok(live.x < 900 - 80, "it turned around on the near face");
      return;
    }
  }
  assert.fail("the shell never bounced off the rock");
});

test("a gun ray stops at scenery and cannot shoot through it", () => {
  const covered = scene(
    [boulder({ x: 700, halfWidth: 40, halfHeight: 200 })],
    2,
  );
  Object.assign(rider(covered), { x: 300, y: 450, angle: 0, gunArmed: true });
  Object.assign(rider(covered, "p1"), {
    x: 1100,
    y: 450,
    angle: Math.PI,
    trail: [],
  });
  step(covered, new Map([["p0", press]]));
  assert.equal(rider(covered, "p1").alive, true, "the rock took the bullet");
  const tracer = [...covered.bombs.values()].find((bomb) => bomb.shell?.gun)!;
  assert.ok(
    tracer.x <= 700 - 40 + 1e-6 && tracer.x > 600,
    `the tracer ends at the rock, at ${tracer.x}`,
  );

  const open = scene([], 2);
  Object.assign(rider(open), { x: 300, y: 450, angle: 0, gunArmed: true });
  Object.assign(rider(open, "p1"), {
    x: 1100,
    y: 450,
    angle: Math.PI,
    trail: [],
  });
  step(open, new Map([["p0", press]]));
  assert.equal(
    rider(open, "p1").alive,
    false,
    "the same shot down an open lane kills",
  );
});

test("pickups never drop against scenery", () => {
  const game = scene([
    boulder({ x: 800, y: 450, halfWidth: 400, halfHeight: 250 }),
  ]);
  // Parked in a corner and unkillable: this is about where drops land, not about surviving the board.
  for (const player of game.players.values()) {
    Object.assign(player, {
      x: 90,
      y: 90,
      angle: 0,
      trail: [],
      invulnerableUntilTick: Number.MAX_SAFE_INTEGER,
    });
  }
  let dropped = 0;
  for (let attempt = 0; attempt < 400; attempt += 1) {
    game.nextPickupSpawnTick = game.tick + 1;
    step(game, new Map());
    for (const pickup of game.pickups) {
      dropped += 1;
      assert.ok(
        !obstacleTouchesCircle(
          game.obstacles[0]!,
          pickup.x,
          pickup.y,
          PICKUP_RADIUS,
        ),
        `a pickup landed on the rock at ${pickup.x},${pickup.y}`,
      );
    }
    game.pickups = [];
  }
  assert.ok(
    dropped > 5,
    "the arena still had room to drop pickups outside the rock",
  );
});

test("portal gates are never laid across scenery", () => {
  let opened = 0;
  for (let seed = 1; seed <= 30; seed += 1) {
    const game = scene(
      [boulder({ x: 800, y: 450, halfWidth: 340, halfHeight: 300 })],
      2,
      `portal-${seed}`,
    );
    game.randomState = seed;
    const collector = rider(game);
    Object.assign(collector, {
      x: 200,
      y: 200,
      angle: 0,
      invulnerableUntilTick: game.tick + 50,
    });
    game.pickups = [
      {
        id: 1,
        type: "portal",
        x: 205,
        y: 200,
        expiresAtTick: Number.MAX_SAFE_INTEGER,
      },
    ];
    step(game, new Map());
    for (const pair of game.portalPairs) {
      opened += 1;
      for (const gate of pair.gates) {
        assert.ok(
          !obstacleBlocksPath(
            game.obstacles[0]!,
            gate.x,
            gate.y - gate.halfLength,
            gate.x,
            gate.y + gate.halfLength,
            RIDER_RADIUS,
          ),
          `a gate crossed the rock at ${gate.x}`,
        );
      }
    }
  }
  assert.ok(opened > 5, "gates still open on a board with a large obstacle");
});

test("the closing overtime walls crush the scenery they reach", () => {
  const game = scene([
    boulder({ x: 60, y: 450, halfWidth: 30, halfHeight: 30 }),
    boulder({ id: 2 }),
  ]);
  for (const player of game.players.values())
    player.invulnerableUntilTick = Number.MAX_SAFE_INTEGER;
  game.roundStartedTick = game.tick - OVERTIME_START_TICK;
  for (let tick = 0; tick < 100; tick += 1) step(game, new Map());
  assert.deepEqual(
    game.obstacles.map((obstacle) => obstacle.id),
    [2],
    "the rock by the wall is gone, the middle one stands",
  );
});

test("every round lays a board that leaves each rider a clear start", () => {
  for (const riders of [2, 3, 5])
    for (let seed = 1; seed <= 25; seed += 1) {
      const game = createGame(`spawn-${riders}-${seed}`, seed);
      game.settings = defaultRoomSettings(); // a room's default: rotate through the scenery maps
      for (let slot = 0; slot < riders; slot += 1)
        addPlayer(game, {
          id: `p${slot}`,
          name: `P${slot}`,
          slot,
          color: SLOT_COLORS[slot]!,
        });
      startMatch(game);
      while (game.phase === "countdown") step(game, new Map());
      assert.ok(
        game.obstacles.length > 0,
        `${game.map} at seed ${seed} laid no scenery`,
      );
      for (const player of game.players.values()) {
        for (const obstacle of game.obstacles) {
          assert.ok(
            !obstacleTouchesCircle(
              obstacle,
              player.x,
              player.y,
              RIDER_RADIUS + TRAIL_WIDTH,
            ),
            `${player.id} started on top of scenery on ${game.map} seed ${seed}`,
          );
        }
      }
      // Nobody is killed by the board itself in the seconds it takes to pick a line.
      for (let tick = 0; tick < 30; tick += 1) step(game, new Map());
      assert.equal(
        [...game.players.values()].filter((player) => player.alive).length,
        riders,
        `${game.map} at seed ${seed} killed a rider driving straight off the line`,
      );
    }
});

test("the room setting picks the board, and rotate gives each round a different one", () => {
  for (const map of ARENA_MAPS) {
    const game = createGame(`fixed-${map}`, 4);
    game.settings = { ...defaultRoomSettings(), map };
    for (let slot = 0; slot < 2; slot += 1)
      addPlayer(game, {
        id: `p${slot}`,
        name: `P${slot}`,
        slot,
        color: SLOT_COLORS[slot]!,
      });
    startMatch(game);
    assert.equal(game.map, map);
    assert.equal(
      game.obstacles.length > 0,
      ["desert", "forest", "city"].includes(map),
      `${map} scenery`,
    );
  }
  const game = createGame("rotating", 4);
  game.settings = { ...defaultRoomSettings(), map: "rotate" };
  for (let slot = 0; slot < 2; slot += 1)
    addPlayer(game, {
      id: `p${slot}`,
      name: `P${slot}`,
      slot,
      color: SLOT_COLORS[slot]!,
    });
  startMatch(game);
  const played = [game.map];
  for (let round = 0; round < 2; round += 1) {
    game.players.get("p1")!.alive = false;
    while (game.phase !== "roundOver") step(game, new Map());
    game.tick = game.phaseEndsAtTick!;
    startNextRound(game);
    played.push(game.map);
  }
  assert.equal(
    new Set(played).size,
    played.length,
    `rotate repeated a map: ${played.join(", ")}`,
  );
});

test("the board travels in snapshots and checkpoints, and a controller is not sent one", () => {
  const game = scene([boulder(), boulder({ id: 2, x: 1200, y: 300 })]);
  const snapshot = toSnapshot(game);
  assert.equal(snapshot.map, game.map);
  assert.deepEqual(
    snapshot.obstacles.map((obstacle) => obstacle.id),
    [1, 2],
  );
  snapshot.obstacles[0]!.x = -500;
  assert.equal(
    game.obstacles[0]!.x,
    700,
    "the snapshot is a copy, not the board itself",
  );

  const restored = decodeGameState(encodeGameState(game));
  assert.deepEqual(
    restored?.obstacles,
    game.obstacles,
    "a checkpoint carries the board",
  );
  assert.equal(restored?.map, game.map);
  const corrupt = (
    edit: (obstacles: Record<string, unknown>[]) => void,
  ): GameState | undefined => {
    const data = JSON.parse(encodeGameState(game)) as {
      obstacles: Record<string, unknown>[];
    };
    edit(data.obstacles);
    return decodeGameState(JSON.stringify(data));
  };
  assert.equal(
    corrupt((obstacles) => {
      obstacles[1]!.id = obstacles[0]!.id;
    }),
    undefined,
    "duplicate ids are rejected",
  );
  assert.equal(
    corrupt((obstacles) => {
      obstacles[0]!.kind = "castle";
    }),
    undefined,
    "an unknown kind is rejected",
  );
  assert.equal(
    corrupt((obstacles) => {
      obstacles[0]!.x = 1590;
    }),
    undefined,
    "an obstacle hanging out of the arena is rejected",
  );
  assert.equal(
    corrupt((obstacles) => {
      while (obstacles.length <= MAX_OBSTACLES)
        obstacles.push({ ...obstacles[0]!, id: obstacles.length + 1 });
    }),
    undefined,
    "a board larger than the cap is rejected",
  );
  assert.ok(
    corrupt((obstacles) => {
      obstacles.pop();
    }),
    "a smaller board still restores",
  );
});

test("bots ride around scenery instead of into it", () => {
  const controller = new BotController();
  let survived = 0;
  for (let seed = 1; seed <= 12; seed += 1) {
    const game = createGame(`bot-map-${seed}`, seed);
    game.settings = defaultRoomSettings(); // a room's default: rotate through the scenery maps
    addPlayer(game, {
      id: "bot:1",
      name: "AI Rider · Hard",
      slot: 0,
      color: SLOT_COLORS[0]!,
    });
    addPlayer(game, {
      id: "bot:2",
      name: "AI Other · Hard",
      slot: 1,
      color: SLOT_COLORS[1]!,
    });
    startMatch(game);
    while (game.phase === "countdown") step(game, new Map());
    assert.ok(game.obstacles.length > 0);
    for (let tick = 0; tick < 120 && game.phase === "playing"; tick += 1) {
      step(
        game,
        new Map(
          [...game.players.keys()].map((id) => [
            id,
            controller.input(game, id),
          ]),
        ),
      );
    }
    if (game.players.get("bot:1")!.alive) survived += 1;
  }
  assert.ok(survived >= 10, `hard bots survived only ${survived} of 12 boards`);
});

test("a rider whose immunity lapses inside scenery is let out of it instead of dying on the spot", () => {
  const game = scene([boulder({ halfWidth: 100 })]);
  rider(game).invulnerableUntilTick = game.tick + 45; // runs out with the rider deep inside the rock
  const survived = ticksToDeath(game, 90);
  assert.equal(survived, 90, "it rides out the far side");
  assert.ok(rider(game).x > 800);
  const other = scene([
    boulder({ halfWidth: 100 }),
    boulder({ id: 2, x: 1000 }),
  ]);
  rider(other).invulnerableUntilTick = other.tick + 45;
  assert.ok(
    ticksToDeath(other, 120) < 120,
    "and the next rock along is as solid as ever",
  );
});

test("a shield spent on a trail in front of scenery still turns the rider away from the scenery", () => {
  const game = scene([boulder({ x: 660 })]);
  // p0 rides right from x=300; the trail stands just before the rock's near face at x=600.
  rider(game, "p1").trail = [
    {
      x1: 590,
      y1: 300,
      x2: 590,
      y2: 600,
      createdTick: game.tick - 40,
      expiresAtTick: game.tick + 4000,
    },
  ];
  Object.assign(rider(game), { x: 570, shielded: true });
  assert.equal(
    ticksToDeath(game, 30),
    30,
    "the grace ticks are not spent riding into the rock",
  );
});

test("a shell fired from inside scenery flies out of it rather than rattling between its walls", () => {
  const game = scene([boulder()]);
  Object.assign(rider(game), {
    x: 700,
    y: 450,
    shellArmed: true,
    invulnerableUntilTick: game.tick + 200,
  });
  step(game, new Map([["p0", press]]));
  step(
    game,
    new Map([["p0", { ...neutral, bombCommands: [{ action: "release" }] }]]),
  );
  for (let tick = 0; tick < 10; tick += 1) step(game, new Map());
  const shell = [...game.bombs.values()].find(
    (bomb) => bomb.shell && !bomb.shell.gun,
  )!;
  assert.ok(shell.x > 800, `left the rock behind: ${shell.x}`);
  assert.equal(shell.shell!.bounces ?? 0, 0);
});

test("a game without room settings, as on the LAN, keeps the classic arena", () => {
  const game = createGame("lan", 4);
  for (let slot = 0; slot < 2; slot += 1)
    addPlayer(game, {
      id: `p${slot}`,
      name: `P${slot}`,
      slot,
      color: SLOT_COLORS[slot]!,
    });
  startMatch(game);
  assert.equal(game.map, "classic");
  assert.deepEqual(game.obstacles, []);
});
