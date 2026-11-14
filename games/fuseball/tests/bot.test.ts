import test from "node:test";
import assert from "node:assert/strict";
import {
  BTN,
  MAP_IDS,
  botInput,
  createWorld,
  encodeWorld,
  isInput,
  mirrored,
  stepWorld,
  stepsPerTick,
  type MapId,
  type Rider,
  type World,
} from "../src/engine/index.js";
import { fuseballGame } from "../src/online/game.js";
import { A, B, ballAt, place, playing } from "./fixtures/world.js";

type Pilot = (world: World, rider: Rider) => number;
const idle: Pilot = () => 0;
/** The arenas the bot is held to a result on; the four newer ones join once it can play them. */
const BOT_MAPS = MAP_IDS.slice(0, 3);

/**
 * A match as the room folds it: each pilot is asked once per log tick and holds its answer for the tick's steps.
 * Returns the game seconds played and when each point fell.
 */
function match(mapId: MapId, left: Pilot, right: Pilot, seconds: number) {
  const world = createWorld(mapId, [A, B]),
    points: { at: number; to: number }[] = [];
  let tick = 0;
  for (; tick < seconds * 20 && world.phase !== "over"; tick++) {
    const inputs = new Map([
      [A, left(world, world.riders[0])],
      [B, right(world, world.riders[1])],
    ]);
    for (const bits of inputs.values())
      assert.ok(isInput(bits), `${bits} is a stick and a button`);
    const before = world.score[0] + world.score[1];
    for (let left = stepsPerTick(world); left > 0; left--)
      stepWorld(world, inputs);
    if (world.score[0] + world.score[1] > before)
      points.push({ at: tick / 20, to: world.lastScorer });
  }
  return { world, seconds: tick / 20, points };
}

test("against a rider who stays home the bot scores on every map, from either side, and wins inside four minutes", () => {
  for (const mapId of BOT_MAPS)
    for (const slot of [0, 1] as const) {
      const { world, seconds, points } =
        slot === 0
          ? match(mapId, botInput, idle, 240)
          : match(mapId, idle, botInput, 240);
      const first = points.find((point) => point.to === slot);
      assert.ok(first, `${mapId}: slot ${slot}'s bot scored`);
      assert.ok(
        first.at < 60,
        `${mapId}: slot ${slot}'s bot scored within a minute (${first.at}s)`,
      );
      assert.equal(world.phase, "over", `${mapId}: finished in ${seconds}s`);
      assert.equal(world.score[slot], 3, `${mapId}: slot ${slot}'s bot won`);
    }
});

test("two bots finish a match on every map, and neither side of the arena is the bot's favourite for ever", () => {
  for (const mapId of BOT_MAPS) {
    const { world, seconds, points } = match(mapId, botInput, botInput, 300);
    assert.equal(world.phase, "over", `${mapId}: finished in ${seconds}s`);
    assert.ok(points.length >= 3);
  }
});

test("the bot answers from the world alone: the same world, the same bits, and nothing in the world changes", () => {
  const world = playing("halo");
  for (let tick = 0; tick < 400; tick++) {
    const before = JSON.stringify(encodeWorld(world));
    const bits = world.riders.map((rider) => botInput(world, rider));
    assert.equal(JSON.stringify(encodeWorld(world)), before, "read only");
    assert.deepEqual(
      world.riders.map((rider) => botInput(world, rider)),
      bits,
    );
    const inputs = new Map([
      [A, bits[0]!],
      [B, bits[1]!],
    ]);
    for (let left = stepsPerTick(world); left > 0; left--)
      stepWorld(world, inputs);
  }
});

test("the bot holds nothing while there is nothing to play: countdown, celebration, zapped", () => {
  const world = createWorld("gridlock", [A, B]);
  assert.equal(botInput(world, world.riders[0]), 0, "countdown");
  while (world.phase === "countdown") stepWorld(world, new Map());
  world.riders[0].zapped = true;
  assert.equal(botInput(world, world.riders[0]), 0, "zapped");
  world.riders[0].zapped = false;
  world.ball.live = false;
  assert.equal(botInput(world, world.riders[0]), 0, "no ball");
  world.ball.live = true;
  world.phase = "zap";
  assert.equal(botInput(world, world.riders[0]), 0, "celebration");
});

test("the two sides are mirror images: on a mirrored world each bot holds the other's bits mirrored, when both attend", () => {
  // Step 0 of play is inside a spell both sides attend.
  const world = playing("gridlock");
  ballAt(world, 250, 300, 1, -1);
  place(world, 0, 200, 320);
  place(world, 1, 440, 320);
  const left = botInput(world, world.riders[0]);
  // The same picture seen in a mirror: the ball and its speed flipped, the riders in each other's places.
  ballAt(world, 390, 300, -1, -1);
  const right = botInput(world, world.riders[1]);
  assert.notEqual(left, 0);
  assert.equal(right, mirrored(left));
});

test("a ball already falling into its goal is left alone, and a touch that would be an own goal is pulled out of", () => {
  // Downlink, slot 0: its pit is the right-hand shaft. A ball dropping into it needs no help.
  const world = playing("downlink");
  ballAt(world, 480, 300, 0, 1);
  place(world, 0, 440, 280);
  assert.equal(botInput(world, world.riders[0]), 0);
  // The same ball over the other pit is one to chase.
  ballAt(world, 160, 250, 0, 0);
  place(world, 0, 300, 250);
  assert.notEqual(botInput(world, world.riders[0]), 0);
});

test("a pinned ball is lifted, and two bots take turns at it", () => {
  const world = playing("downlink");
  ballAt(world, 320, 336);
  place(world, 0, 302, 335);
  place(world, 1, 338, 335);
  for (const rider of world.riders) {
    rider.grounded = true;
    rider.prev = 0;
  }
  const lifts = world.riders.map(
    (rider) => (botInput(world, rider) & BTN) !== 0,
  );
  assert.deepEqual(
    lifts.filter(Boolean).length,
    1,
    "one of the two lifts on this tick",
  );
});

test("the room's bot seats are folded with the engine's bot", () => {
  // The online layer looks the bot up on the engine: with one exported, a solo match is not against a statue.
  const room = fuseballGame.createRoom("m", {
    display: false,
    mapId: "gridlock",
  });
  room.seats.set("me", {
    id: "me",
    name: "Me",
    slot: 0,
    avatarId: "robot",
    connected: true,
    bot: false,
    generation: 1,
  });
  room.seats.set("bot:1", {
    id: "bot:1",
    name: "Volta",
    slot: 1,
    avatarId: "robot",
    connected: true,
    bot: true,
  });
  room.stage = "running";
  room.world = createWorld("gridlock", ["me", "bot:1"]);
  room.roster = [
    { id: "me", name: "Me", slot: 0, bot: false },
    { id: "bot:1", name: "Volta", slot: 1, bot: true },
  ];
  const tick = fuseballGame.createTicker();
  const start = room.world.riders[1].x;
  for (let i = 0; i < 100; i++) tick(room, "me", new Map());
  assert.notEqual(room.world.riders[1].x, start, "the bot moved");
});
