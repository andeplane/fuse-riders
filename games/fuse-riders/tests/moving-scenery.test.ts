import test from "node:test";
import assert from "node:assert/strict";
import {
  addPlayer,
  createGame,
  eliminatePlayer,
  startMatch,
  startNextRound,
  step,
  toView,
  ARENA_HEIGHT,
  ARENA_WIDTH,
  OVERTIME_START_TICK,
  RIDER_SPEED,
  RIDER_COLORS,
  SPAWN_CORRIDOR_LENGTH,
  SPAWN_CORRIDOR_RADIUS,
  TICK_HZ,
  type GameState,
  type InputIntent,
  type PlayerState,
} from "../src/engine/game.js";
import {
  ARENA_MAPS,
  MAX_OBSTACLES,
  edgesOpen,
  initialBoundaryInset,
  mapHasScenery,
  mapWraps,
  obstacleBlocksPath,
  obstacleIsPermanent,
  type ArenaMapId,
  type Obstacle,
} from "../src/engine/arena-map.js";
import {
  CROSS_WALL_HALF_THICKNESS,
  DRIFT_VELOCITY,
  TRAIN_CAR_HALF_SIZE,
  TRAIN_CAR_SPACING,
  advanceScenery,
  fixedScenery,
  trackLength,
  trackPose,
  type Track,
} from "../src/engine/scenery-motion.js";
import {
  MAX_CARS,
  MAX_LAID_TRAINS,
  MAX_TRACK_POINTS,
  MAX_TRACKS,
  MAX_TRAINS,
  MIN_CARS,
  MIN_LINES,
  MIN_TRAINS,
  RAIL_GRID,
  TRAIN_HEADWAY,
  TRAIN_SPEEDS,
  layRailway,
  railwayCars,
  trackKeepsClear,
  type Railway,
} from "../src/engine/railway.js";
import { segmentDistanceSquared } from "../src/engine/geometry.js";
import { defaultRoomSettings } from "../src/engine/room-settings.js";
import { BotController } from "../src/engine/bot-controller.js";
import {
  decodeGameState,
  encodeGameState,
} from "../src/engine/codec/checkpoint.js";
import { interpolateWorld } from "../src/render/time/present.js";
import {
  obstacleParts,
  trackDecoration,
  TRACK_GAUGE,
  TRAIN_LIVERIES,
} from "../src/render/arena-maps.js";
import { eliminationLine } from "../src/client/arena-announcer.js";
import { classicSettings } from "./fixtures/classic-settings.js";
import { setDeadlines } from "./fixtures/rider-state.ts";

const neutral: InputIntent = { left: false, right: false, bomb: false };
/** A Gun fires on release; a tap is the press and its release arriving in one tick. */
const tap: InputIntent = {
  left: false,
  right: false,
  bomb: false,
  bombCommands: [{ action: "press" }, { action: "release" }],
};

/** A chamfered rectangle of track, clockwise on screen from the top-left corner along the top straight. */
const loop = (
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  chamfer: number,
): Track => ({
  points: [
    { x: minX + chamfer, y: minY },
    { x: maxX - chamfer, y: minY },
    { x: maxX, y: minY + chamfer },
    { x: maxX, y: maxY - chamfer },
    { x: maxX - chamfer, y: maxY },
    { x: minX + chamfer, y: maxY },
    { x: minX, y: maxY - chamfer },
    { x: minX, y: minY + chamfer },
  ],
});
/**
 * The railway the scenario tests ride against, so a test can put a rider where it knows a train will be: an outer
 * loop near the walls with two trains the same way round, and an inner loop with one train the other way.
 */
const FIXED_RAILWAY: Railway = {
  tracks: [loop(160, 150, 1440, 750, 48), loop(600, 360, 1000, 540, 32)],
  trains: [
    { track: 0, cars: 5, speed: 4, start: 3400 },
    { track: 0, cars: 4, speed: 4, start: 1550 },
    { track: 1, cars: 3, speed: -3, start: 60 },
  ],
};

/**
 * A started round on the named map, its drops off; riders are placed by each test. A trains round runs on
 * `FIXED_RAILWAY` unless `laid` asks for the railway the round laid itself.
 */
function scene(
  map: ArenaMapId,
  riders = 2,
  seed = 11,
  laid = false,
): GameState {
  const game = createGame(`scenery-${map}`, classicSettings(), seed);
  game.settings = { ...defaultRoomSettings(), map };
  for (let slot = 0; slot < riders; slot += 1)
    addPlayer(game, {
      id: `p${slot}`,
      name: `P${slot}`,
      slot,
      color: RIDER_COLORS[slot]!,
    });
  startMatch(game);
  if (map === "trains" && !laid) {
    game.tracks = FIXED_RAILWAY.tracks.map((track) => ({
      points: track.points.map((point) => ({ ...point })),
    }));
    game.obstacles = railwayCars(FIXED_RAILWAY, 1);
  }
  while (game.phase === "countdown") step(game, new Map());
  game.nextPickupSpawnTick = Number.MAX_SAFE_INTEGER;
  return game;
}
const rider = (game: GameState, id = "p0"): PlayerState =>
  game.players.get(id)!;
const place = (
  game: GameState,
  id: string,
  pose: Partial<PlayerState>,
): void => {
  Object.assign(rider(game, id), { trail: [], ...pose });
};
/** Runs ticks and returns the eliminations they reported, in order. */
const run = (
  game: GameState,
  ticks: number,
  inputs = new Map<string, InputIntent>(),
): { playerId: string; cause: string }[] => {
  const deaths: { playerId: string; cause: string }[] = [];
  for (let i = 0; i < ticks; i += 1)
    for (const event of step(game, inputs).events)
      if (event.type === "playerEliminated")
        deaths.push({ playerId: event.playerId, cause: event.cause });
  return deaths;
};
const movers = (game: GameState): Obstacle[] =>
  game.obstacles.filter((obstacle) => obstacle.motion !== undefined);
const close = (a: number, b: number, tolerance = 1e-6): boolean =>
  Math.abs(a - b) <= tolerance;

test("the new maps are named, opt-in, and say what stands on them and whether their edges wrap", () => {
  assert.ok((ARENA_MAPS as readonly string[]).includes("drift"));
  assert.ok((ARENA_MAPS as readonly string[]).includes("trains"));
  assert.deepEqual(
    ARENA_MAPS.filter(mapWraps),
    ["wrap", "drift"],
    "the drifting cross is the wrapping board with a cross on it",
  );
  assert.deepEqual(ARENA_MAPS.filter(mapHasScenery), [
    "desert",
    "forest",
    "city",
    "drift",
    "trains",
  ]);
  assert.equal(initialBoundaryInset("drift", 20), 0);
  assert.equal(initialBoundaryInset("trains", 20), 20);
  assert.ok(edgesOpen({ map: "drift", boundaryInset: 0 }));
  assert.ok(!edgesOpen({ map: "trains", boundaryInset: 0 }));
  assert.ok(obstacleIsPermanent({ kind: "wall" }));
  assert.ok(obstacleIsPermanent({ kind: "train" }));
  assert.ok(!obstacleIsPermanent({ kind: "rock" }));
});

test("a track is walked by distance: its corners fall where its points are, its length closes the loop", () => {
  const outer = FIXED_RAILWAY.tracks[0]!;
  const straight = 1440 - 160 - 2 * 48,
    side = 750 - 150 - 2 * 48,
    chamfer = Math.hypot(48, 48);
  assert.ok(close(trackLength(outer), 2 * straight + 2 * side + 4 * chamfer));
  const start = trackPose(outer, 0);
  assert.deepEqual(
    [start.x, start.y, start.dx, start.dy],
    [208, 150, 1, 0],
    "along 0 is the first point, heading along the top straight",
  );
  const corner = trackPose(outer, straight);
  assert.deepEqual([corner.x, corner.y], [1392, 150]);
  const down = trackPose(outer, straight + chamfer + 10);
  assert.ok(close(down.x, 1440) && close(down.y, 198 + 10));
  assert.deepEqual([down.dx, down.dy], [0, 1], "the right side runs down");
  const wrapped = trackPose(outer, trackLength(outer));
  assert.ok(close(wrapped.x, 208, 1e-9) && close(wrapped.y, 150, 1e-9));
  for (const track of FIXED_RAILWAY.tracks)
    for (let along = 0; along < trackLength(track); along += 37) {
      const pose = trackPose(track, along);
      assert.ok(close(Math.hypot(pose.dx, pose.dy), 1), "unit tangent");
      assert.ok(
        pose.x >= 0 &&
          pose.x <= ARENA_WIDTH &&
          pose.y >= 0 &&
          pose.y <= ARENA_HEIGHT,
      );
    }
});

test("a railway's cars stand on their tracks, each train head first with a car spacing between its cars", () => {
  const cars = railwayCars(FIXED_RAILWAY, 1);
  assert.equal(
    cars.length,
    FIXED_RAILWAY.trains.reduce((sum, train) => sum + train.cars, 0),
  );
  assert.deepEqual(
    cars.map((car) => car.id),
    cars.map((_, index) => index + 1),
    "ids continue from the first id given",
  );
  FIXED_RAILWAY.trains.forEach((train, index) => {
    const own = cars.filter(
      (car) => car.motion?.kind === "rail" && car.motion.train === index,
    );
    assert.equal(own.length, train.cars);
    const track = FIXED_RAILWAY.tracks[train.track]!;
    const length = trackLength(track);
    own.forEach((car, position) => {
      assert.equal(car.kind, "train");
      assert.equal(car.halfWidth, TRAIN_CAR_HALF_SIZE);
      assert.equal(car.halfHeight, TRAIN_CAR_HALF_SIZE);
      const motion = car.motion!;
      assert.equal(motion.kind, "rail");
      if (motion.kind !== "rail") return;
      assert.equal(motion.speed, train.speed);
      assert.equal(motion.track, train.track);
      const pose = trackPose(track, motion.along);
      assert.ok(close(car.x, pose.x) && close(car.y, pose.y), "on the rails");
      // Each car stands one spacing behind the one before it, in the direction the train runs.
      const behind = train.speed < 0 ? -1 : 1;
      const expected =
        (((train.start - position * TRAIN_CAR_SPACING * behind) % length) +
          length) %
        length;
      assert.ok(close(motion.along, expected), `car ${position} spacing`);
    });
    assert.ok(
      own.every((car, index) => index === 0 || car.id > own[index - 1]!.id),
      "the locomotive has the lowest id of its train",
    );
  });
});

/** The shortest way round a loop of `length` between two distances along it. */
const apart = (a: number, b: number, length: number): number => {
  const gap = Math.abs(a - b) % length;
  return Math.min(gap, length - gap);
};
const segments = (track: Track) =>
  track.points.map((from, index) => ({
    from,
    to: track.points[(index + 1) % track.points.length]!,
  }));

test("every trains round lays its own railway: winding loops a cell apart, clear of every start, with five to seven fast trains", () => {
  const layouts = new Set<string>();
  let winding = 0,
    rounds = 0;
  for (let seed = 1; seed <= 30; seed += 1)
    for (let riders = 2; riders <= 5; riders += 1) {
      const game = scene("trains", riders, seed, true);
      rounds += 1;
      const { tracks } = game;
      layouts.add(JSON.stringify(tracks));
      assert.ok(
        tracks.length >= MIN_LINES && tracks.length <= MAX_TRACKS,
        `${tracks.length} lines`,
      );
      if (tracks.some((track) => track.points.length > 8)) winding += 1;
      // Where riders actually start, read from the started round: nobody moves during the countdown, so each rider
      // still stands on its spawn with the corridor ahead of it that the sampled maps keep clear.
      const corridors = [...game.players.values()].map((player) => ({
        x1: player.x,
        y1: player.y,
        x2: player.x + Math.cos(player.angle) * SPAWN_CORRIDOR_LENGTH,
        y2: player.y + Math.sin(player.angle) * SPAWN_CORRIDOR_LENGTH,
        radius: SPAWN_CORRIDOR_RADIUS,
      }));
      tracks.forEach((track, index) => {
        assert.ok(track.points.length <= MAX_TRACK_POINTS);
        assert.ok(
          track.points.every(
            (point) =>
              point.x >= RAIL_GRID.x &&
              point.x <=
                RAIL_GRID.x + RAIL_GRID.columns * RAIL_GRID.cellWidth &&
              point.y >= RAIL_GRID.y &&
              point.y <= RAIL_GRID.y + RAIL_GRID.rows * RAIL_GRID.cellHeight,
          ),
          "on the grid, well inside the walls",
        );
        assert.ok(
          trackKeepsClear(track, corridors),
          `line ${index} of seed ${seed} runs through a start of ${riders}`,
        );
        // One simple loop: no rail touches another but the two it joins.
        const own = segments(track);
        own.forEach((a, i) =>
          own.forEach((b, j) => {
            const gap = Math.abs(i - j);
            if (gap <= 1 || gap === own.length - 1) return;
            assert.ok(
              segmentDistanceSquared(
                a.from.x,
                a.from.y,
                a.to.x,
                a.to.y,
                b.from.x,
                b.from.y,
                b.to.x,
                b.to.y,
              ) > 0,
              `line ${index} of seed ${seed} crosses itself`,
            );
          }),
        );
        // Lines never come close enough for cars on two of them to touch.
        for (const other of tracks.slice(index + 1))
          for (const a of own)
            for (const b of segments(other))
              assert.ok(
                segmentDistanceSquared(
                  a.from.x,
                  a.from.y,
                  a.to.x,
                  a.to.y,
                  b.from.x,
                  b.from.y,
                  b.to.x,
                  b.to.y,
                ) >=
                  (2 * TRAIN_CAR_HALF_SIZE) ** 2 * 2,
                `two lines of seed ${seed} close in on each other`,
              );
      });
      const cars = movers(game);
      assert.ok(cars.length <= MAX_OBSTACLES);
      for (const player of game.players.values())
        for (const car of cars)
          assert.ok(
            !obstacleBlocksPath(
              car,
              player.x,
              player.y,
              player.x + Math.cos(player.angle) * SPAWN_CORRIDOR_LENGTH,
              player.y + Math.sin(player.angle) * SPAWN_CORRIDOR_LENGTH,
              SPAWN_CORRIDOR_RADIUS,
            ),
            `car ${car.id} stands across the start of ${player.id} of ${riders}`,
          );
      const trains = new Map<number, Obstacle[]>();
      for (const car of cars) {
        if (car.motion?.kind !== "rail") assert.fail("a car");
        trains.set(car.motion.train, [
          ...(trains.get(car.motion.train) ?? []),
          car,
        ]);
        const pose = trackPose(tracks[car.motion.track]!, car.motion.along);
        assert.ok(close(car.x, pose.x) && close(car.y, pose.y), "on the rails");
      }
      assert.ok(
        trains.size >= MIN_TRAINS && trains.size <= MAX_LAID_TRAINS,
        `${trains.size} trains`,
      );
      assert.deepEqual(
        [...trains.keys()].sort((a, b) => a - b),
        [...trains.keys()].map((_, index) => index),
      );
      for (const own of trains.values())
        assert.ok(own.length >= MIN_CARS && own.length <= MAX_CARS);
      const rail = (car: Obstacle) =>
        car.motion?.kind === "rail" ? car.motion : assert.fail("a car");
      tracks.forEach((track, index) => {
        const line = cars.filter((car) => rail(car).track === index);
        assert.ok(line.length > 0, `line ${index} has a train`);
        const speeds = new Set(line.map((car) => rail(car).speed));
        assert.equal(speeds.size, 1, "a line's trains run together");
        assert.ok(TRAIN_SPEEDS.includes(Math.abs([...speeds][0]!)));
        // Trains on a line keep their headway, so they never close on one another.
        const length = trackLength(track);
        for (const a of line)
          for (const b of line)
            if (rail(a).train !== rail(b).train)
              assert.ok(
                apart(rail(a).along, rail(b).along, length) >=
                  TRAIN_HEADWAY - 1e-9,
                `trains ${rail(a).train} and ${rail(b).train} too close`,
              );
      });
    }
  assert.ok(
    layouts.size >= rounds - 2,
    `${layouts.size} railways in ${rounds} rounds`,
  );
  assert.ok(
    winding >= rounds * 0.9,
    `only ${winding} of ${rounds} rounds have a line with more than four corners`,
  );

  // The railway is the stream's: the same match lays the same one, and the next round lays another.
  const again = scene("trains", 3, 7, true),
    twin = scene("trains", 3, 7, true);
  assert.deepEqual(twin.tracks, again.tracks);
  assert.deepEqual(twin.obstacles, again.obstacles);
  const first = JSON.stringify(again.tracks);
  eliminatePlayer(again, "p1");
  eliminatePlayer(again, "p2");
  for (let tick = 0; tick < 2000 && again.phase !== "roundOver"; tick += 1)
    step(again, new Map());
  assert.equal(again.phase, "roundOver");
  while (again.tick < again.phaseEndsAtTick!) step(again, new Map());
  startNextRound(again);
  assert.equal(again.round, 2);
  assert.notEqual(JSON.stringify(again.tracks), first, "a new railway");
  assert.ok(movers(again).length > 0);
});

test("a board with no room for a winding line still gets a railway, on the sidings no start ever reaches", () => {
  // Every cell of the grid is inside a capsule, so no line can grow anywhere.
  const everywhere = [{ x1: 0, y1: 450, x2: 1600, y2: 450, radius: 600 }];
  const railway = layRailway(() => 0.5, everywhere);
  assert.equal(railway.tracks.length, 2);
  assert.ok(
    railway.tracks.every((track) => track.points.length === 8),
    "two plain loops",
  );
  assert.ok(railway.trains.length >= MIN_TRAINS);
  assert.ok(railway.trains.length <= MAX_TRAINS);
  // The furthest any spawn corridor reaches from the centre is its far end: the spawn ring's radius and the corridor
  // run at right angles. The sidings keep a car clear of that and of the corridor's own radius.
  const reach =
    Math.hypot(0.28 * ARENA_HEIGHT, SPAWN_CORRIDOR_LENGTH) +
    SPAWN_CORRIDOR_RADIUS +
    Math.hypot(TRAIN_CAR_HALF_SIZE, TRAIN_CAR_HALF_SIZE);
  for (const track of railway.tracks)
    for (let along = 0; along < trackLength(track); along += 4) {
      const pose = trackPose(track, along);
      assert.ok(
        Math.abs(pose.x - ARENA_WIDTH / 2) > reach,
        "beyond every corridor",
      );
    }
});

test("the drifting cross starts on the board's edges as two walls that span it, each sliding along its own normal", () => {
  const walls = fixedScenery("drift", ARENA_WIDTH, ARENA_HEIGHT, 3);
  assert.equal(walls.length, 2);
  const t = CROSS_WALL_HALF_THICKNESS;
  assert.deepEqual(walls[0], {
    id: 3,
    kind: "wall",
    x: ARENA_WIDTH / 2,
    y: t,
    halfWidth: ARENA_WIDTH / 2,
    halfHeight: t,
    motion: { kind: "bounce", vx: 0, vy: DRIFT_VELOCITY.vy },
  });
  assert.deepEqual(walls[1], {
    id: 4,
    kind: "wall",
    x: t,
    y: ARENA_HEIGHT / 2,
    halfWidth: t,
    halfHeight: ARENA_HEIGHT / 2,
    motion: { kind: "bounce", vx: DRIFT_VELOCITY.vx, vy: 0 },
  });
  assert.deepEqual(fixedScenery("classic", ARENA_WIDTH, ARENA_HEIGHT, 1), []);
  assert.deepEqual(fixedScenery("wrap", ARENA_WIDTH, ARENA_HEIGHT, 1), []);
});

test("a bouncing piece is turned back by the edges with its whole rectangle kept on the board, like the screensaver logo", () => {
  const wall: Obstacle = {
    id: 1,
    kind: "wall",
    x: 1593,
    y: 450,
    halfWidth: 6,
    halfHeight: 450,
    motion: { kind: "bounce", vx: 2.4, vy: 0 },
  };
  advanceScenery(wall, ARENA_WIDTH, ARENA_HEIGHT, []);
  assert.ok(
    close(wall.x, 1594 - 1.4),
    "the overshoot past the edge comes back",
  );
  assert.deepEqual(wall.motion, { kind: "bounce", vx: -2.4, vy: 0 });
  assert.equal(wall.y, 450, "a piece as tall as the board is pinned");
  for (let tick = 0; tick < 2000; tick += 1) {
    advanceScenery(wall, ARENA_WIDTH, ARENA_HEIGHT, []);
    assert.ok(
      wall.x - wall.halfWidth >= 0 && wall.x + wall.halfWidth <= ARENA_WIDTH,
    );
  }
  // Two thousand steps later it is still at 2.4 a tick one way or the other: a reversal only changes the sign.
  assert.ok(
    Math.abs(wall.motion!.kind === "bounce" ? wall.motion.vx : 0) === 2.4,
    "the speed is kept through every reversal",
  );
  // A step longer than the room it bounces in (nothing a map defines) is turned back and held at the edge rather
  // than reflected out the other side: whatever a checkpoint admits, the piece stays on the board.
  const wide: Obstacle = {
    id: 2,
    kind: "wall",
    x: 800,
    y: 450,
    halfWidth: 799,
    halfHeight: 450,
    motion: { kind: "bounce", vx: 50, vy: 0 },
  };
  for (let tick = 0; tick < 20; tick += 1) {
    advanceScenery(wide, ARENA_WIDTH, ARENA_HEIGHT, []);
    assert.ok(
      wide.x - wide.halfWidth >= 0 && wide.x + wide.halfWidth <= ARENA_WIDTH,
      `an overlong step is held on the board on tick ${tick}`,
    );
  }
});

test("during a round the cars advance along their loops every tick, keep their id order, and only while the round is in play", () => {
  const game = scene("trains");
  const before = movers(game).map((car) => ({
    ...car,
    motion: { ...car.motion! },
  }));
  assert.equal(before.length, 12);
  const ticks = 50;
  run(game, ticks);
  const after = movers(game);
  assert.deepEqual(
    after.map((car) => car.id),
    before.map((car) => car.id),
    "movers stay in id order",
  );
  after.forEach((car, index) => {
    const motion = car.motion!,
      was = before[index]!.motion!;
    if (motion.kind !== "rail" || was.kind !== "rail") assert.fail("a car");
    const track = game.tracks[motion.track]!;
    const length = trackLength(track);
    const expected =
      (((was.along + was.speed * ticks) % length) + length) % length;
    assert.ok(
      close(motion.along, expected, 1e-6),
      `car ${car.id} advanced ${ticks} steps`,
    );
    const pose = trackPose(track, motion.along);
    assert.ok(
      close(car.x, pose.x) && close(car.y, pose.y),
      "still on the rails",
    );
  });
  const lobby = createGame("still", classicSettings(), 1);
  lobby.settings = { ...defaultRoomSettings(), map: "trains" };
  addPlayer(lobby, { id: "p0", name: "P0", slot: 0, color: RIDER_COLORS[0]! });
  addPlayer(lobby, { id: "p1", name: "P1", slot: 1, color: RIDER_COLORS[1]! });
  startMatch(lobby);
  const parked = movers(lobby).map((car) => car.x + car.y);
  step(lobby, new Map());
  assert.equal(lobby.phase, "countdown");
  assert.deepEqual(
    movers(lobby).map((car) => car.x + car.y),
    parked,
    "trains wait for the countdown like everyone else",
  );
});

test("a rider that crosses the rails in front of a train dies against the car; the rails themselves are only paint", () => {
  // Three riders, so the first death does not end the round under the second rider.
  const game = scene("trains", 3);
  const head = movers(game).find(
    (car) => car.motion?.kind === "rail" && car.motion.train === 0,
  )!;
  // The outer loop's first train is climbing its left side. Ride at it across its track from the outside.
  place(game, "p0", { x: head.x - 80, y: head.y - 50, angle: 0 });
  // The other rider crosses the top straight where no train is: a level crossing with nothing coming.
  place(game, "p1", { x: 800, y: 100, angle: Math.PI / 2 });
  place(game, "p2", { x: 1200, y: 450, angle: 0 });
  const deaths = run(game, 20);
  assert.deepEqual(deaths, [{ playerId: "p0", cause: "wall" }]);
  const wreck = rider(game, "p0");
  assert.ok(!wreck.alive);
  assert.ok(
    movers(game).some((car) =>
      obstacleBlocksPath(car, wreck.x, wreck.y, wreck.x, wreck.y, 4),
    ),
    "the rider stopped against a car",
  );
  assert.ok(rider(game, "p1").alive, "the rails do not kill");
  assert.ok(rider(game, "p1").y > 200, "and do not stop a rider either");
  const line = eliminationLine(
    { type: "playerEliminated", playerId: "p0", cause: "wall" },
    [{ id: "p0", name: "P0" }],
    "p1",
    "trains",
  );
  assert.equal(line, "P0 crashed");
});

test("a car that runs into a rider standing still kills it, and the rider dies where the car reached it", () => {
  const game = scene("trains");
  const head = movers(game).find(
    (car) => car.motion?.kind === "rail" && car.motion.train === 0,
  )!;
  // Riders always move, so the nearest thing to standing still is a rider under three Snails crawling straight up
  // the line ahead of the train, which closes on it at four units a tick to its one.
  place(game, "p0", { x: head.x, y: head.y - 120, angle: -Math.PI / 2 });
  setDeadlines(rider(game, "p0"), "snail", [
    game.tick + 1000,
    game.tick + 1000,
    game.tick + 1000,
  ]);
  place(game, "p1", { x: 1200, y: 450, angle: 0 });
  const deaths = run(game, 60);
  assert.deepEqual(deaths, [{ playerId: "p0", cause: "wall" }]);
  const wreck = rider(game, "p0");
  assert.ok(
    movers(game).some((car) =>
      obstacleBlocksPath(car, wreck.x, wreck.y, wreck.x, wreck.y, 4),
    ),
    "the rider died where the car reached it",
  );
});

test("a shell reflects off a car as it does off a rock, and a shield turns a rider back from one", () => {
  const game = scene("trains", 3);
  for (const car of movers(game))
    if (car.motion?.kind === "rail") car.motion.speed = 0; // parked, so the car itself does not move onto anything
  const car = movers(game)[0]!;
  place(game, "p0", {
    x: car.x - 120,
    y: car.y,
    angle: 0,
    armed: ["shell"],
    bombReadyAtTick: 0,
  });
  place(game, "p1", { x: 1200, y: 450, angle: 0 });
  place(game, "p2", { x: 1200, y: 700, angle: 0 });
  step(game, new Map([["p0", tap]]));
  const shell = () => [...game.bombs.values()].find((bomb) => bomb.shell)!;
  assert.ok(shell().shell!.vx > 0, "launched at the car");
  // Tick by tick up to the bounce: left to fly on, the shell comes straight back at the rider that fired it.
  let reflected = false;
  for (let tick = 0; tick < 12 && !reflected; tick += 1) {
    run(game, 1);
    reflected = shell().shell!.vx < 0;
  }
  assert.ok(reflected, "reflected off the car");
  assert.equal(shell().shell!.bounces, 1);
  assert.ok(rider(game, "p0").alive, "the rider has not reached the car yet");
  game.bombs.delete(shell().id);

  place(game, "p0", { x: car.x - 60, y: car.y, angle: 0, shielded: true });
  const deaths = run(game, 8);
  assert.deepEqual(deaths, []);
  const bounced = rider(game, "p0");
  assert.ok(!bounced.shielded, "the shield was spent");
  assert.ok(
    Math.abs(Math.abs(bounced.angle) - Math.PI) < 1e-6,
    "turned straight back from the face it hit",
  );
  assert.ok(
    bounced.x < car.x - TRAIN_CAR_HALF_SIZE,
    "and standing outside the car",
  );
});

test("on the drifting cross a shield also turns a rider back from the wall met through an edge, and the horizontal wall kills through the top", () => {
  const game = scene("drift");
  const upright = movers(game).find(
    (wall) => wall.halfHeight > wall.halfWidth,
  )!;
  upright.x = ARENA_WIDTH - CROSS_WALL_HALF_THICKNESS;
  upright.motion = { kind: "bounce", vx: 0, vy: 0 };
  place(game, "p0", { x: 8, y: 300, angle: Math.PI, shielded: true });
  place(game, "p1", { x: 800, y: 700, angle: 0 });
  assert.deepEqual(run(game, 3), []);
  const bounced = rider(game, "p0");
  assert.ok(!bounced.shielded && bounced.alive);
  assert.ok(Math.abs(bounced.angle) < 1e-6, "turned back the way it came");
  assert.ok(bounced.x > 8, "riding away from the edge again");

  const flat = scene("drift");
  const across = movers(flat).find((wall) => wall.halfWidth > wall.halfHeight)!;
  across.y = ARENA_HEIGHT - CROSS_WALL_HALF_THICKNESS; // hugging the bottom edge
  across.motion = { kind: "bounce", vx: 0, vy: 0 };
  place(flat, "p0", { x: 300, y: 8, angle: -Math.PI / 2 });
  place(flat, "p1", { x: 800, y: 700, angle: 0 });
  assert.deepEqual(run(flat, 3), [{ playerId: "p0", cause: "wall" }]);
});

test("neither a blast nor the closing overtime walls remove a train, while ordinary scenery beside it goes", () => {
  const game = scene("trains");
  place(game, "p0", { x: 800, y: 450, angle: 0 });
  place(game, "p1", { x: 800, y: 300, angle: 0 });
  const car = movers(game)[0]!;
  game.obstacles.push({
    id: 99,
    kind: "rock",
    x: car.x,
    y: car.y + 70,
    halfWidth: 20,
    halfHeight: 20,
  });
  game.bombs.set(7, {
    id: 7,
    ownerId: "p1",
    launchX: 800,
    launchY: 300,
    x: car.x,
    y: car.y + 30,
    launchedTick: game.tick - 10,
    landsAtTick: game.tick,
    explodeAtTick: game.tick + 1,
    blastRange: 90,
    flightPath: [],
  });
  step(game, new Map());
  assert.ok(game.blasts.length > 0, "the bomb went off");
  assert.ok(
    !game.obstacles.some((piece) => piece.id === 99),
    "the rock is gone",
  );
  assert.equal(movers(game).length, 12, "every car stands");

  const overtime = scene("trains");
  overtime.roundStartedTick = overtime.tick - OVERTIME_START_TICK - 600;
  overtime.obstacles.push({
    id: 98,
    kind: "crate",
    x: 100,
    y: 450,
    halfWidth: 15,
    halfHeight: 15,
  });
  place(overtime, "p0", { x: 800, y: 450, angle: 0 });
  place(overtime, "p1", { x: 800, y: 350, angle: 0 });
  step(overtime, new Map());
  assert.ok(overtime.boundaryInset > 300, "the walls are well in");
  assert.ok(
    !overtime.obstacles.some((piece) => piece.id === 98),
    "the crate is crushed",
  );
  assert.equal(
    movers(overtime).length,
    12,
    "the trains run on under the walls",
  );
});

test("on the drifting cross a rider riding out through an edge dies on the wall just inside the far side", () => {
  const game = scene("drift");
  assert.ok(edgesOpen(game), "the edges are open");
  const upright = movers(game).find(
    (wall) => wall.halfHeight > wall.halfWidth,
  )!;
  upright.x = ARENA_WIDTH - CROSS_WALL_HALF_THICKNESS; // hugging the right edge
  upright.motion = { kind: "bounce", vx: 0, vy: 0 }; // and parked there for the test
  place(game, "p0", { x: 8, y: 300, angle: Math.PI });
  place(game, "p1", { x: 800, y: 700, angle: 0 });
  const deaths = run(game, 3);
  assert.deepEqual(deaths, [{ playerId: "p0", cause: "wall" }]);
  assert.ok(
    rider(game, "p0").x < 4 || rider(game, "p0").x > 1596,
    "stopped at the edge, against the wall",
  );

  const control = scene("drift");
  const parked = movers(control).find(
    (wall) => wall.halfHeight > wall.halfWidth,
  )!;
  parked.x = 800;
  parked.motion = { kind: "bounce", vx: 0, vy: 0 };
  place(control, "p0", { x: 8, y: 300, angle: Math.PI });
  place(control, "p1", { x: 800, y: 700, angle: 0 });
  assert.deepEqual(
    run(control, 3),
    [],
    "with the wall elsewhere the edge is open",
  );
  assert.ok(rider(control, "p0").x > 1570, "the rider came round the far side");
});

test("a bullet fired across an open edge stops at the wall on the far side, and flies on when nothing is there", () => {
  const shots = (wallX: number): { count: number; ends: number[] } => {
    const game = scene("drift");
    const upright = movers(game).find(
      (wall) => wall.halfHeight > wall.halfWidth,
    )!;
    upright.x = wallX;
    upright.motion = { kind: "bounce", vx: 0, vy: 0 };
    place(game, "p0", {
      x: 20,
      y: 300,
      angle: Math.PI,
      armed: ["gun"],
      bombReadyAtTick: 0,
    });
    place(game, "p1", { x: 800, y: 700, angle: 0 });
    step(game, new Map([["p0", tap]]));
    const tracers = game.tracers;
    return { count: tracers.length, ends: tracers.map((bomb) => bomb.x) };
  };
  const blocked = shots(ARENA_WIDTH - CROSS_WALL_HALF_THICKNESS);
  assert.equal(blocked.count, 1, "one leg: the wall is right behind the edge");
  assert.ok(
    blocked.ends[0]! > 0 && blocked.ends[0]! < 20,
    `stopped short of the edge at ${blocked.ends[0]}`,
  );
  const through = shots(800);
  assert.equal(
    through.count,
    2,
    "the ray carries on from the far edge until the wall in the middle",
  );
  assert.ok(
    through.ends[1]! > 800 && through.ends[1]! < 830,
    `stopped at the wall at ${through.ends[1]}`,
  );
});

test("the cross keeps wandering through overtime, and a round on it ends the way a wrap round does", () => {
  const game = scene("drift");
  place(game, "p0", { x: 800, y: 450, angle: 0 });
  place(game, "p1", { x: 800, y: 300, angle: 0 });
  const [horizontal] = movers(game);
  const y0 = horizontal!.y;
  run(game, 10);
  assert.ok(
    close(horizontal!.y, y0 + 10 * DRIFT_VELOCITY.vy),
    "the cross drifts from the first tick",
  );
  game.roundStartedTick = game.tick - OVERTIME_START_TICK;
  run(game, 40);
  assert.ok(!edgesOpen(game), "overtime closed the edges");
  assert.ok(
    close(horizontal!.y, y0 + 50 * DRIFT_VELOCITY.vy),
    "and the cross carries on",
  );
  assert.equal(movers(game).length, 2);
});

test("a checkpoint carries movers exactly, restores them where they were, and refuses a car off its loop or on the wrong map", () => {
  const game = scene("trains");
  place(game, "p0", { x: 800, y: 450, angle: 0 });
  place(game, "p1", { x: 800, y: 300, angle: Math.PI });
  run(game, 37);
  const restored = decodeGameState(encodeGameState(game));
  assert.ok(restored, "a trains round decodes");
  assert.deepEqual(restored.obstacles, game.obstacles);
  assert.deepEqual(
    toView(restored).tracks,
    game.tracks,
    "the railway travels with the checkpoint and the view draws it",
  );
  run(game, 60);
  run(restored, 60);
  assert.deepEqual(
    restored.obstacles,
    game.obstacles,
    "the restored trains run on in step",
  );

  const drift = scene("drift");
  run(drift, 5);
  assert.deepEqual(
    decodeGameState(encodeGameState(drift))?.obstacles,
    drift.obstacles,
    "walls that span the board are admitted",
  );

  const corrupt = (
    edit: (data: {
      map: string;
      obstacles: Record<string, unknown>[];
      tracks: { points: { x: number; y: number }[] }[];
    }) => void,
  ) => {
    const data = JSON.parse(encodeGameState(game)) as {
      map: string;
      obstacles: Record<string, unknown>[];
      tracks: { points: { x: number; y: number }[] }[];
    };
    edit(data);
    return decodeGameState(JSON.stringify(data));
  };
  const outer = trackLength(game.tracks[0]!);
  assert.equal(
    corrupt((data) => {
      (data.obstacles[0]!.motion as Record<string, unknown>).along = outer + 1;
    }),
    undefined,
    "a car past the end of its loop",
  );
  assert.equal(
    corrupt((data) => {
      (data.obstacles[0]!.motion as Record<string, unknown>).track = 7;
    }),
    undefined,
    "a track past the bound",
  );
  assert.equal(
    corrupt((data) => {
      (data.obstacles[0]!.motion as Record<string, unknown>).track = 2;
    }),
    undefined,
    "a track the round's railway does not have",
  );
  assert.equal(
    corrupt((data) => {
      data.tracks[0]!.points[0]!.x = ARENA_WIDTH;
    }),
    undefined,
    "a rail that would carry a car off the board",
  );
  assert.equal(
    corrupt((data) => {
      data.tracks[1]!.points = data.tracks[1]!.points.slice(0, 2);
    }),
    undefined,
    "a loop of two points",
  );
  assert.equal(
    corrupt((data) => {
      data.tracks[1]!.points = data.tracks[1]!.points.map(() => ({
        x: 500,
        y: 500,
      }));
    }),
    undefined,
    "a loop with no length to run along",
  );
  assert.equal(
    corrupt((data) => {
      data.tracks = [...data.tracks, ...data.tracks, ...data.tracks];
    }),
    undefined,
    "more lines than a railway holds",
  );
  assert.equal(
    corrupt((data) => {
      data.map = "classic";
      data.obstacles = [];
    }),
    undefined,
    "a railway belongs to the trains map",
  );
  assert.equal(
    corrupt((data) => {
      (data.obstacles[0]!.motion as Record<string, unknown>).speed = 1e9;
    }),
    undefined,
    "a speed nothing runs at",
  );
  assert.equal(
    corrupt((data) => {
      (data.obstacles[0]!.motion as Record<string, unknown>).kind = "fly";
    }),
    undefined,
    "a motion the engine has no step for",
  );
  assert.equal(
    corrupt((data) => {
      data.map = "classic";
    }),
    undefined,
    "rail cars belong to the trains map",
  );
  assert.equal(
    corrupt((data) => {
      data.obstacles[0]!.kind = "rock";
    }),
    undefined,
    "only walls and trains move",
  );
  assert.equal(
    corrupt((data) => {
      data.obstacles.push({
        id: 97,
        kind: "wall",
        x: 800,
        y: 450,
        halfWidth: 20,
        halfHeight: 20,
      });
    }),
    undefined,
    "a wall stands only on the drifting cross",
  );
  const driftData = JSON.parse(encodeGameState(drift)) as {
    obstacles: Record<string, unknown>[];
  };
  (driftData.obstacles[1]!.motion as Record<string, unknown>).vx = 1590;
  assert.equal(
    decodeGameState(JSON.stringify(driftData)),
    undefined,
    "a bounce step longer than the room it bounces in",
  );
  assert.equal(
    corrupt((data) => {
      data.obstacles[0]!.halfWidth = ARENA_WIDTH / 2;
    }),
    undefined,
    "only a wall may span the board",
  );
  assert.ok(
    corrupt((data) => {
      delete data.obstacles[0]!.motion;
    }),
    "a car that lost its motion is still a valid, if parked, piece",
  );
});

test("bots on the drifting cross see the wall waiting just past the edge and turn away from it", () => {
  const controller = new BotController();
  let survived = 0;
  for (let seed = 1; seed <= 6; seed += 1) {
    const game = createGame(`bot-drift-${seed}`, classicSettings(), seed);
    game.settings = { ...defaultRoomSettings(), map: "drift" };
    addPlayer(game, {
      id: "bot:1",
      name: "AI Rider · Hard",
      slot: 0,
      color: RIDER_COLORS[0]!,
    });
    addPlayer(game, {
      id: "bot:2",
      name: "AI Other · Hard",
      slot: 1,
      color: RIDER_COLORS[1]!,
    });
    startMatch(game);
    while (game.phase === "countdown") step(game, new Map());
    game.nextPickupSpawnTick = Number.MAX_SAFE_INTEGER;
    const upright = movers(game).find(
      (wall) => wall.halfHeight > wall.halfWidth,
    )!;
    upright.x = CROSS_WALL_HALF_THICKNESS;
    upright.motion = { kind: "bounce", vx: 0, vy: 0 };
    // Straight at the right edge, with the wall waiting a step past it on the far side.
    place(game, "bot:1", { x: 1480, y: 450 + seed * 20, angle: 0 });
    place(game, "bot:2", { x: 400, y: 800, angle: Math.PI });
    for (let tick = 0; tick < 40 && game.phase === "playing"; tick += 1)
      step(
        game,
        new Map(
          [...game.players.keys()].map((id) => [
            id,
            controller.input(game, id),
          ]),
        ),
      );
    if (game.players.get("bot:1")!.alive) survived += 1;
  }
  assert.equal(
    survived,
    6,
    `bots rode into the wall beyond the edge on ${6 - survived} of 6 boards`,
  );
});

test("between two ticks a screen slides a mover to where it is going, and leaves standing scenery where it is", () => {
  const game = scene("trains");
  game.obstacles.push({
    id: 99,
    kind: "rock",
    x: 500,
    y: 500,
    halfWidth: 20,
    halfHeight: 20,
  });
  place(game, "p0", { x: 800, y: 450, angle: 0 });
  place(game, "p1", { x: 800, y: 300, angle: 0 });
  const older = toView(game);
  step(game, new Map());
  const newer = toView(game);
  const half = interpolateWorld(older, newer, 0.5);
  const car = (view: typeof older) =>
    view.obstacles.find((piece) => piece.id === 1)!;
  assert.ok(close(car(half).x, (car(older).x + car(newer).x) / 2));
  assert.ok(close(car(half).y, (car(older).y + car(newer).y) / 2));
  assert.notDeepEqual(
    [car(older).x, car(older).y],
    [car(newer).x, car(newer).y],
    "the car moved",
  );
  const rock = half.obstacles.find((piece) => piece.id === 99)!;
  assert.deepEqual([rock.x, rock.y], [500, 500]);
  assert.deepEqual(half.tracks, game.tracks);
});

test("a car is drawn in its train's livery inside its footprint whichever way it faces, and the rails sit either side of the line", () => {
  const car: Obstacle = {
    id: 5,
    kind: "train",
    x: 400,
    y: 300,
    halfWidth: TRAIN_CAR_HALF_SIZE,
    halfHeight: TRAIN_CAR_HALF_SIZE,
    motion: { kind: "rail", track: 0, along: 0, speed: 4, train: 1 },
  };
  for (let eighth = 0; eighth < 8; eighth += 1)
    for (const role of [
      { head: true, tail: false },
      { head: false, tail: true },
      { head: false, tail: false },
    ]) {
      const angle = (eighth * Math.PI) / 4;
      const parts = obstacleParts(car, "trains", {
        dx: Math.cos(angle),
        dy: Math.sin(angle),
        ...role,
      });
      assert.ok(
        parts.some((part) => part.color === TRAIN_LIVERIES[1]!.body),
        "the second train is yellow",
      );
      assert.equal(
        parts.some((part) => part.color === "#fff7c2"),
        role.head,
        "a headlight on the locomotive",
      );
      assert.equal(
        parts.some((part) => part.color === "#ff3b30"),
        role.tail,
        "a tail light on the last car",
      );
      for (const part of parts.slice(1)) {
        assert.equal(part.shape, "rect");
        if (part.shape !== "rect") continue;
        assert.ok(
          part.x >= car.x - car.halfWidth - 1e-9 &&
            part.x + part.width <= car.x + car.halfWidth + 1e-9,
          `inside across, facing ${eighth}/8`,
        );
        assert.ok(
          part.y >= car.y - car.halfHeight - 1e-9 &&
            part.y + part.height <= car.y + car.halfHeight + 1e-9,
          `inside down, facing ${eighth}/8`,
        );
      }
    }
  const decoration = trackDecoration(FIXED_RAILWAY.tracks[0]!);
  assert.equal(
    decoration.rails.length,
    2 * FIXED_RAILWAY.tracks[0]!.points.length,
  );
  const topStraight = decoration.rails.filter(
    (rail) => rail.y1 === rail.y2 && rail.x2 > rail.x1,
  );
  assert.deepEqual(
    topStraight.map((rail) => rail.y1).sort((a, b) => a - b),
    [150 - TRACK_GAUGE / 2, 150 + TRACK_GAUGE / 2],
    "one rail each side of the top straight",
  );
  assert.ok(
    decoration.sleepers.length > 200 && decoration.sleepers.length < 300,
  );
  assert.deepEqual(
    trackDecoration(FIXED_RAILWAY.tracks[0]!),
    decoration,
    "stable between frames",
  );
  assert.equal(
    Math.max(...TRAIN_SPEEDS),
    RIDER_SPEED / TICK_HZ,
    "the fastest express keeps pace with a rider at the start of a round",
  );
  assert.equal(TRAIN_LIVERIES.length, MAX_TRAINS, "a livery for every train");
  assert.equal(
    new Set(TRAIN_LIVERIES.map((livery) => livery.body)).size,
    MAX_TRAINS,
    "no two trains of a round look alike",
  );
});
