import test from "node:test";
import assert from "node:assert/strict";
import {
  addPlayer,
  createGame,
  startMatch,
  step,
  toSnapshot,
  ARENA_HEIGHT,
  ARENA_WIDTH,
  BOMB_FUSE_TICKS,
  INITIAL_BOUNDARY_INSET,
  OVERTIME_START_TICK,
  SLOT_COLORS,
  type GameState,
  type InputIntent,
  type PlayerState,
} from "../src/shared/game.js";
import { BOMB_FLIGHT_TICKS } from "../src/shared/bomb-launch.js";
import {
  chooseArenaMap,
  edgesOpen,
  type ArenaMapId,
} from "../src/shared/arena-map.js";
import {
  splitWrappedSegment,
  wrapCoordinate,
  wrapDelta,
  wrapImages,
} from "../src/shared/wrap.js";
import { defaultRoomSettings } from "../src/shared/room-settings.js";
import { BotController } from "../src/shared/bot-controller.js";
import { decodeGameState, encodeGameState } from "../src/online/checkpoint.js";
import { renderedSnapshot } from "../src/client/render-snapshot.js";
import { interpolateWorld } from "../src/online/prediction.js";
import { trailPaths } from "../src/client/phaser/trails.js";
import {
  crossScreenPoint,
  crossViews,
  edgeGhosts,
} from "../src/client/arena-views.js";

const neutral: InputIntent = { left: false, right: false, bomb: false };
const press: InputIntent = {
  ...neutral,
  bomb: true,
  bombCommands: [{ action: "press" }],
};
const release: InputIntent = {
  ...neutral,
  bombCommands: [{ action: "release" }],
};

/** A started round on the named map, riders parked well apart in the middle, and no drops of its own. */
function scene(map: ArenaMapId = "wrap", riders = 2): GameState {
  const game = createGame("edges", 11);
  game.settings = { ...defaultRoomSettings(), map };
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
  for (const player of game.players.values())
    Object.assign(player, {
      x: 800,
      y: 150 + player.slot * 150,
      angle: 0,
      trail: [],
    });
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
const run = (
  game: GameState,
  ticks: number,
  inputs = new Map<string, InputIntent>(),
): void => {
  for (let i = 0; i < ticks; i += 1) step(game, inputs);
};

test("wrap geometry folds coordinates, takes the short way round and names the images a box needs", () => {
  assert.equal(wrapCoordinate(1605, 1600), 5);
  assert.equal(wrapCoordinate(-5, 1600), 1595);
  assert.equal(
    wrapCoordinate(-1e-17, 1600),
    0,
    "a fold that rounds up to the far edge is the near one",
  );
  assert.equal(wrapDelta(1590, 1600), -10);
  assert.equal(wrapDelta(-1590, 1600), 10);
  assert.equal(wrapDelta(300, 1600), 300);
  assert.deepEqual(wrapImages(1600, 900, 100, 100, 200, 200), [
    { dx: 0, dy: 0 },
  ]);
  assert.deepEqual(wrapImages(1600, 900, -10, 100, 50, 200), [
    { dx: 0, dy: 0 },
    { dx: 1600, dy: 0 },
  ]);
  assert.equal(
    wrapImages(1600, 900, 1550, 850, 1650, 950).length,
    4,
    "a box over a corner shows up in all four",
  );
});

test("a segment across an edge splits into travel-ordered pieces that end and begin on opposite edges", () => {
  const pieces = splitWrappedSegment(
    { x1: 1596, y1: 400, x2: 1604, y2: 400, createdTick: 5, expiresAtTick: 99 },
    1600,
    900,
  );
  assert.deepEqual(
    pieces.map(({ x1, x2 }) => [x1, x2]),
    [
      [1596, 1600],
      [0, 4],
    ],
  );
  assert.ok(
    pieces.every(
      (piece) => piece.createdTick === 5 && piece.expiresAtTick === 99,
    ),
  );
  const backwards = splitWrappedSegment(
    { x1: 3, y1: 2, x2: -5, y2: -2, createdTick: 1, expiresAtTick: 9 },
    1600,
    900,
  );
  assert.equal(
    backwards.length,
    3,
    "through a corner: this board, the one beside it, the one diagonally across",
  );
  assert.deepEqual(
    [backwards[0]!.x1, backwards[0]!.y1],
    [3, 2],
    "starting where the rider was",
  );
  assert.deepEqual(
    [backwards.at(-1)!.x2, backwards.at(-1)!.y2],
    [1595, 898],
    "and ending where it is now",
  );
});

test("the wrap map starts with no walls, and a rider leaves one side to arrive on the other", () => {
  const game = scene();
  assert.equal(game.map, "wrap");
  assert.equal(game.boundaryInset, 0);
  assert.equal(edgesOpen(game), true);
  place(game, "p0", { x: 1590, y: 400, angle: 0 });
  run(game, 4);
  const crossed = rider(game);
  assert.equal(crossed.alive, true, "no wall to die on");
  assert.ok(
    crossed.x > 0 && crossed.x < 40,
    `came in from the left at ${crossed.x}`,
  );
  assert.equal(crossed.y, 400);
  const seam = crossed.trail.filter(
    (segment) => segment.x2 === ARENA_WIDTH || segment.x1 === 0,
  );
  assert.deepEqual(
    seam.map(({ x1, x2 }) => [x1 < 800, x2 < 800]),
    [
      [false, false],
      [true, true],
    ],
    "one piece up to the edge, one on from the opposite edge",
  );
  assert.ok(
    crossed.trail.every((segment) => Math.abs(segment.x2 - segment.x1) < 100),
    "no segment spans the board",
  );
  assert.equal(
    trailPaths(crossed.trail).length,
    2,
    "and the renderer never joins the two sides with a line",
  );
});

test("every other map keeps its walls: the same ride is fatal on classic and on cross", () => {
  for (const map of ["classic", "cross"] as const) {
    const game = scene(map);
    assert.equal(game.boundaryInset, INITIAL_BOUNDARY_INSET);
    assert.equal(edgesOpen(game), false);
    place(game, "p0", { x: 1560, y: 400, angle: 0 });
    const events = [];
    for (let i = 0; i < 6; i += 1) events.push(...step(game, new Map()).events);
    assert.ok(
      events.some(
        (event) =>
          event.type === "playerEliminated" &&
          event.playerId === "p0" &&
          event.cause === "wall",
      ),
      `${map} has a wall`,
    );
  }
});

test("cross is the classic arena move for move: only the drawing differs", () => {
  const play = (map: ArenaMapId) => {
    const game = scene(map, 3);
    const bots = new BotController();
    for (let i = 0; i < 200; i += 1)
      step(
        game,
        new Map(
          [...game.players.keys()].map((id) => [id, bots.input(game, id)]),
        ),
      );
    const { map: _map, ...rest } = toSnapshot(game);
    return rest;
  };
  assert.deepEqual(play("cross"), play("classic"));
});

test("a trail just past an open edge kills a rider crossing towards it", () => {
  const game = scene();
  // A wall of trail down the left edge, four units in; the rider approaches it from the right-hand side of the board.
  rider(game, "p1").trail = [
    {
      x1: 4,
      y1: 300,
      x2: 4,
      y2: 500,
      createdTick: game.tick - 40,
      expiresAtTick: game.tick + 400,
    },
  ];
  place(game, "p0", { x: 1585, y: 400, angle: 0 });
  const events = [];
  for (let i = 0; i < 6 && rider(game).alive; i += 1)
    events.push(...step(game, new Map()).events);
  assert.ok(
    events.some(
      (event) =>
        event.type === "playerEliminated" &&
        event.playerId === "p0" &&
        event.cause === "trail",
    ),
  );
  const dead = rider(game);
  assert.ok(
    (dead.x >= 0 && dead.x < 4) || dead.x > 1590,
    `the wreck is left at the contact, on the board: ${dead.x}`,
  );
});

test("two riders meeting head-on across an open edge ram each other", () => {
  const game = scene();
  place(game, "p0", { x: 1590, y: 400, angle: 0 });
  place(game, "p1", { x: 10, y: 400, angle: Math.PI });
  const events = [];
  for (let i = 0; i < 4; i += 1) events.push(...step(game, new Map()).events);
  const rammed = events
    .filter(
      (event) => event.type === "playerEliminated" && event.cause === "rider",
    )
    .map((event) => event.type === "playerEliminated" && event.playerId);
  assert.deepEqual(rammed.sort(), ["p0", "p1"]);
});

test("a bomb thrown at an open edge lands on the far side, and its blast reaches back through the edge", () => {
  const game = scene();
  place(game, "p0", { x: 1500, y: 400, angle: 0 });
  place(game, "p1", { x: 800, y: 800, angle: 0 });
  // The shortest lob there is, so the bomb comes down just past the edge with its blast still straddling it.
  step(game, new Map([["p0", press]]));
  step(game, new Map([["p0", release]]));
  const bomb = [...game.bombs.values()][0]!;
  assert.ok(
    bomb.x < bomb.blastRange,
    `landing folded onto the board, within a blast of the edge: ${bomb.x}`,
  );
  assert.ok(
    bomb.flightPath.at(-1)!.x > ARENA_WIDTH,
    "while the flight path stays one straight throw",
  );
  // Hold the target still next to the edge for the fuse: a rider parked at a standstill is not something the rules
  // allow, so it is put back each tick instead.
  let blasts: GameState["blasts"] = [];
  const events = [];
  for (
    let i = 0;
    i < BOMB_FUSE_TICKS + BOMB_FLIGHT_TICKS && !blasts.length;
    i += 1
  ) {
    place(game, "p0", { x: 800, y: 800, angle: 0 });
    // Just inside the right-hand edge, which the blast can only reach by coming back through the left one.
    place(game, "p1", {
      x: 1600 - (bomb.blastRange - bomb.x) + 30,
      y: 400,
      angle: Math.PI / 2,
    });
    events.push(...step(game, new Map()).events);
    blasts = game.blasts;
  }
  assert.equal(
    blasts.length,
    2,
    "one blast on the board, one image through the edge",
  );
  assert.deepEqual(
    blasts.map((blast) => blast.bombId),
    [bomb.id, bomb.id],
  );
  assert.deepEqual(
    blasts.map((blast) => Math.round(blast.circle.x - bomb.x)),
    [0, ARENA_WIDTH],
  );
  assert.ok(
    events.some(
      (event) =>
        event.type === "playerEliminated" &&
        event.playerId === "p1" &&
        event.cause === "explosion",
    ),
    "and it kills across the edge",
  );
  assert.equal(
    events.filter((event) => event.type === "explosion").length,
    1,
    "still one explosion",
  );
});

test("a shell flies through an open edge instead of bouncing, and still bounces off a trail waiting beyond it", () => {
  const fire = (game: GameState): void => {
    place(game, "p0", { x: 1500, y: 400, angle: 0, shellArmed: true });
    place(game, "p1", { x: 800, y: 800, angle: 0 });
    step(game, new Map([["p0", press]]));
    step(game, new Map([["p0", release]]));
  };
  const through = scene();
  fire(through);
  place(through, "p0", { x: 800, y: 100, angle: 0 });
  run(through, 6);
  const shell = [...through.bombs.values()].find(
    (bomb) => bomb.shell && !bomb.shell.gun,
  )!;
  assert.ok(shell.shell!.vx > 0, "never reflected");
  assert.ok(shell.x < 200, `and carried on from the left at ${shell.x}`);

  const blocked = scene();
  fire(blocked);
  place(blocked, "p0", { x: 800, y: 100, angle: 0 });
  rider(blocked, "p1").trail = [
    {
      x1: 6,
      y1: 300,
      x2: 6,
      y2: 500,
      createdTick: blocked.tick - 40,
      expiresAtTick: blocked.tick + 400,
    },
  ];
  run(blocked, 6);
  const bounced = [...blocked.bombs.values()].find(
    (bomb) => bomb.shell && !bomb.shell.gun,
  )!;
  assert.ok(bounced.shell!.vx < 0, "the trail past the edge turned it round");
  assert.ok(bounced.x > 1400, `back on the side it came from, at ${bounced.x}`);
});

test("a bullet carries on through an open edge and hits a rider beyond it, within one board of range", () => {
  const game = scene();
  place(game, "p0", { x: 1500, y: 400, angle: 0, gunArmed: true });
  place(game, "p1", { x: 100, y: 400, angle: Math.PI / 2 });
  const events = step(game, new Map([["p0", press]])).events;
  assert.ok(
    events.some(
      (event) =>
        event.type === "playerEliminated" &&
        event.playerId === "p1" &&
        event.cause === "explosion",
    ),
  );
  const tracers = [...game.bombs.values()].filter((bomb) => bomb.shell?.gun);
  assert.deepEqual(
    tracers.map((tracer) => [Math.round(tracer.launchX), Math.round(tracer.x)]),
    [
      [Math.round(rider(game).x), 1600],
      [0, Math.round(rider(game, "p1").x - 5)],
    ],
    "drawn as two straight legs, the second ending on the target",
  );

  const empty = scene();
  place(empty, "p0", { x: 800, y: 100, angle: 0, gunArmed: true });
  place(empty, "p1", { x: 800, y: 800, angle: 0 });
  step(empty, new Map([["p0", press]]));
  const legs = [...empty.bombs.values()].filter((bomb) => bomb.shell?.gun);
  const travelled = legs.reduce(
    (sum, leg) => sum + Math.abs(leg.x - leg.launchX),
    0,
  );
  assert.ok(
    Math.abs(travelled - ARENA_WIDTH) < 1e-6,
    `a ray that meets nothing stops after one board, not never: ${travelled}`,
  );
});

test("overtime brings the walls in from the very edge, and the round is an ordinary walled one from then on", () => {
  const game = scene();
  game.roundStartedTick = game.tick - OVERTIME_START_TICK - 40;
  place(game, "p0", { x: 800, y: 300, angle: 0 });
  place(game, "p1", { x: 800, y: 600, angle: 0 });
  step(game, new Map());
  assert.ok(
    game.boundaryInset > 0 && game.boundaryInset < INITIAL_BOUNDARY_INSET + 1,
    `walls start at the edge: ${game.boundaryInset}`,
  );
  assert.equal(edgesOpen(game), false);
  place(game, "p0", { x: 1560, y: 400, angle: 0 });
  const events = [];
  for (let i = 0; i < 6; i += 1) events.push(...step(game, new Map()).events);
  assert.ok(
    events.some(
      (event) =>
        event.type === "playerEliminated" &&
        event.playerId === "p0" &&
        event.cause === "wall",
    ),
  );
});

test("bots ride through open edges rather than turning away from them, and only combat can end the round", () => {
  const game = createGame("bots", 1);
  game.settings = { ...defaultRoomSettings(), map: "wrap" };
  for (let slot = 0; slot < 4; slot += 1)
    addPlayer(game, {
      id: `p${slot}`,
      name: `AI ${slot} · Hard`,
      slot,
      color: SLOT_COLORS[slot]!,
    });
  startMatch(game);
  const bots = new BotController();
  let crossings = 0;
  for (let i = 0; i < 460 && game.phase !== "roundOver"; i += 1) {
    const before = new Map(
      [...game.players.values()].map((player) => [
        player.id,
        { x: player.x, y: player.y },
      ]),
    );
    const { events } = step(
      game,
      new Map([...game.players.keys()].map((id) => [id, bots.input(game, id)])),
    );
    for (const event of events)
      if (event.type === "playerEliminated")
        assert.notEqual(
          event.cause,
          "wall",
          "open edges cannot eliminate bots",
        );
    for (const player of game.players.values())
      if (
        player.alive &&
        (Math.abs(player.x - before.get(player.id)!.x) > ARENA_WIDTH / 2 ||
          Math.abs(player.y - before.get(player.id)!.y) > ARENA_HEIGHT / 2)
      )
        crossings += 1;
    for (const player of game.players.values()) {
      assert.ok(
        player.x >= 0 &&
          player.x <= ARENA_WIDTH &&
          player.y >= 0 &&
          player.y <= ARENA_HEIGHT,
        `${player.id} stays on the board`,
      );
    }
  }
  // Combat can end the round earlier when detached trails remain hazardous longer.
  const survivors = [...game.players.values()].filter((player) => player.alive);
  if (game.phase === "roundOver")
    assert.equal(survivors.length, 1, "ordinary combat leaves a round winner");
  else
    assert.ok(survivors.length >= 2, "multiple riders keep the round running");
  assert.ok(crossings > 0, "and at least one of them used an edge");
});

test("a wrap round survives a checkpoint, and replays to the same state afterwards", () => {
  const game = scene("wrap", 3);
  const bots = new BotController();
  const drive = (state: GameState, ticks: number): void => {
    for (let i = 0; i < ticks; i += 1)
      step(
        state,
        new Map(
          [...state.players.keys()].map((id) => [id, bots.input(state, id)]),
        ),
      );
  };
  drive(game, 150);
  const restored = decodeGameState(encodeGameState(game));
  assert.ok(restored, "the checkpoint is accepted");
  drive(game, 100);
  drive(restored!, 100);
  assert.deepEqual(toSnapshot(restored!), toSnapshot(game));
});

test("rotation visits the walled maps and neither wrap nor cross", () => {
  const visited = new Set(
    Array.from({ length: 12 }, (_, round) =>
      chooseArenaMap("rotate", 5, round + 1),
    ),
  );
  assert.deepEqual([...visited].sort(), [
    "city",
    "classic",
    "desert",
    "forest",
  ]);
});

test("presentation follows a rider through the edge instead of sweeping it back across the board", () => {
  const game = scene();
  place(game, "p0", { x: 1597, y: 400, angle: 0 });
  const older = { ...toSnapshot(game), tick: game.tick, round: game.round };
  step(game, new Map());
  const newer = { ...toSnapshot(game), tick: game.tick, round: game.round };
  assert.ok(
    newer.players[0]!.x < 20,
    "the rider crossed between the two ticks",
  );
  const half = interpolateWorld(older, newer, 0.5).players[0]!;
  assert.ok(
    half.x > 1597 && half.x < 1605,
    `half way is half a step on, not mid-board: ${half.x}`,
  );
  const projected = renderedSnapshot(
    [
      { snapshot: older, matchId: "m", round: 1, receivedAt: 0 },
      { snapshot: newer, matchId: "m", round: 1, receivedAt: 50 },
    ],
    75,
  )!.players[0]!;
  assert.ok(
    projected.x > newer.players[0]!.x && projected.x < newer.players[0]!.x + 10,
    `projected forwards by part of a step: ${projected.x}`,
  );
});

test("the crossed view tiles the screen with four quarters of the world, each in the opposite corner", () => {
  const views = crossViews(1600, 900, 1001, 563);
  assert.equal(views.length, 4);
  assert.equal(
    views.reduce((area, view) => area + view.width * view.height, 0),
    1001 * 563,
    "no gap and no overlap, on an odd-sized canvas too",
  );
  const [topLeft, topRight, bottomLeft, bottomRight] = views;
  assert.deepEqual(
    [topLeft!.scrollX, topLeft!.scrollY],
    [800, 450],
    "the top-left of the screen shows the bottom-right of the world",
  );
  assert.deepEqual(
    [bottomRight!.scrollX, bottomRight!.scrollY],
    [0, 0],
    "and the bottom-right shows the top-left",
  );
  assert.deepEqual(
    [topRight!.x, topRight!.scrollX, bottomLeft!.y, bottomLeft!.scrollY],
    [topLeft!.width, 0, topLeft!.height, 0],
  );
  // The world's outer wall, at its corners and edges, lands on the middle of the screen: that is the cross.
  assert.deepEqual(crossScreenPoint(0, 0, 1600, 900), { x: 0.5, y: 0.5 });
  assert.deepEqual(
    crossScreenPoint(800, 450, 1600, 900),
    { x: 0, y: 0 },
    "and the middle of the world is at the screen corner",
  );
});

test("something near an open edge is drawn on both sides of it", () => {
  assert.deepEqual(edgeGhosts(1600, 900, 800, 450, 40), [{ dx: 0, dy: 0 }]);
  assert.deepEqual(edgeGhosts(1600, 900, 1590, 450, 40), [
    { dx: 0, dy: 0 },
    { dx: -1600, dy: 0 },
  ]);
  assert.equal(edgeGhosts(1600, 900, 5, 895, 40).length, 4);
});

test("a blast whose rim stops just short of an open edge still reaches a rider overhanging it from the far side", () => {
  const blastAt = (victimX: number): boolean => {
    const game = scene();
    place(game, "p0", { x: 800, y: 800, angle: 0 });
    place(game, "p1", { x: victimX, y: 380, angle: Math.PI / 2 });
    // Rim three units inside the left edge: nothing of the blast itself crosses, but a rider is seven units wide.
    game.bombs.set(99, {
      id: 99,
      ownerId: "p0",
      launchX: 0,
      launchY: 0,
      x: 103,
      y: 400,
      launchedTick: game.tick - 10,
      landsAtTick: game.tick - 4,
      flightPath: [],
      placedTick: game.tick - 10,
      explodeAtTick: game.tick + 1,
      blastRange: 100,
    });
    return step(game, new Map()).events.some(
      (event) =>
        event.type === "playerEliminated" &&
        event.playerId === "p1" &&
        event.cause === "explosion",
    );
  };
  assert.equal(blastAt(1598), true, "five units from the rim, across the edge");
  assert.equal(
    blastAt(1585),
    false,
    "eighteen units from it is out of reach either way",
  );
});

test("a bullet fired along an open edge hits a rider overhanging that edge from the far side", () => {
  const shotAt = (victimX: number): boolean => {
    const game = scene();
    place(game, "p0", { x: 1596, y: 100, angle: Math.PI / 2, gunArmed: true });
    place(game, "p1", { x: victimX, y: 500, angle: Math.PI / 2 });
    return step(game, new Map([["p0", press]])).events.some(
      (event) => event.type === "playerEliminated" && event.playerId === "p1",
    );
  };
  assert.equal(shotAt(2), true, "six units from the ray, across the edge");
  assert.equal(shotAt(30), false);
});

test("a rider hugging the edge when the walls come in is not killed by their arrival", () => {
  const game = scene();
  game.roundStartedTick = game.tick - OVERTIME_START_TICK;
  place(game, "p0", { x: 5, y: 300, angle: Math.PI / 2 });
  place(game, "p1", { x: 800, y: 300, angle: Math.PI / 2 });
  step(game, new Map());
  assert.equal(edgesOpen(game), false, "the walls are in");
  assert.equal(
    rider(game).alive,
    true,
    "and the lethal band is still narrower than where the rider legally was",
  );
  run(game, 12);
  assert.equal(
    rider(game).alive,
    false,
    "staying there is fatal within a second, as hugging a closing wall always is",
  );
});
