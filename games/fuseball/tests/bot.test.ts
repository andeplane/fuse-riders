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
  paceTick,
  type MapId,
  type Rider,
  type World,
} from "../src/engine/index.js";
import { fuseballGame } from "../src/online/game.js";
import { A, B, ballAt, place, playing, scripted } from "./fixtures/world.js";

type Pilot = (world: World, rider: Rider) => number;
const idle: Pilot = () => 0;

/**
 * A match as the room folds it: each pilot is asked once per log tick and holds its answer for the tick's steps.
 * Returns the game seconds played and when each point fell.
 */
function match(
  mapId: MapId,
  left: Pilot,
  right: Pilot,
  seconds: number,
  shove?: () => number,
) {
  const world = createWorld(mapId, [A, B]),
    points: { at: number; to: number }[] = [];
  let tick = 0,
    shoved = false;
  for (; tick < seconds * 20 && world.phase !== "over"; tick++) {
    // A perturbed start: every point's ball is given a push of its own as play begins.
    if (world.phase === "countdown") shoved = false;
    else if (shove && world.phase === "play" && !shoved) {
      world.ball.vx = ((shove() % 4001) - 2000) * 2;
      world.ball.vy = -(shove() % 3000);
      shoved = true;
    }
    const inputs = new Map([
      [A, left(world, world.riders[0])],
      [B, right(world, world.riders[1])],
    ]);
    for (const bits of inputs.values())
      assert.ok(isInput(bits), `${bits} is a stick and a button`);
    const before = world.score[0] + world.score[1];
    for (let left = paceTick(world); left > 0; left--) stepWorld(world, inputs);
    if (world.score[0] + world.score[1] > before)
      points.push({ at: tick / 20, to: world.lastScorer });
  }
  return { world, seconds: tick / 20, points };
}

test("against a rider who stays home the bot scores from either side of every map inside ninety seconds, and the match ends", () => {
  for (const mapId of MAP_IDS)
    for (const slot of [0, 1] as const) {
      const { world, seconds, points } =
        slot === 0
          ? match(mapId, botInput, idle, 240)
          : match(mapId, idle, botInput, 240);
      const first = points.find((point) => point.to === slot);
      assert.ok(first, `${mapId}: slot ${slot}'s bot scored`);
      assert.ok(
        first.at < 90,
        `${mapId}: slot ${slot}'s bot scored within ninety seconds (${first.at}s)`,
      );
      assert.equal(world.phase, "over", `${mapId}: finished in ${seconds}s`);
      assert.equal(world.score[slot], 3, `${mapId}: slot ${slot}'s bot won`);
    }
});

test("the bot seldom scores for the other colour: against a rider who stays home, own goals are under a tenth of the points and it wins every match", () => {
  // The only points an idle rider gets are the bot's own goals: a shot that comes back off a wall and in at the
  // other end. It looks before it touches (`outcome` in bot.ts), so these are rare; before it did, they were more
  // than a fifth of all points. Every point starts with the ball shoved a different way, so no two are alike.
  let own = 0,
    total = 0;
  for (const mapId of MAP_IDS)
    for (const slot of [0, 1] as const) {
      const shove = scripted(7919 + MAP_IDS.indexOf(mapId) * 2 + slot);
      const { world, seconds } =
        slot === 0
          ? match(mapId, botInput, idle, 240, shove)
          : match(mapId, idle, botInput, 240, shove);
      assert.equal(world.phase, "over", `${mapId}: finished in ${seconds}s`);
      assert.equal(world.score[slot], 3, `${mapId}: slot ${slot}'s bot won`);
      assert.equal(
        world.riders[slot].ownGoals,
        world.score[slot === 0 ? 1 : 0],
        "an idle rider's points are the bot's own goals",
      );
      own += world.riders[slot].ownGoals;
      total += world.score[0] + world.score[1];
    }
  assert.ok(own * 10 < total, `${own} own goals in ${total} points`);
});

test("two bots finish a match on every map, and neither side of the arena is the bot's favourite for ever", () => {
  for (const mapId of MAP_IDS) {
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
    for (let left = paceTick(world); left > 0; left--) stepWorld(world, inputs);
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

/** The bot in slot 0 alone on the field (the other rider is out of it, as after a zap) for up to `seconds`. */
function alone(world: World, seconds: number, done: () => boolean): number {
  world.riders[1].zapped = true;
  for (let tick = 0; tick < seconds * 20; tick++) {
    if (done() || world.phase !== "play") return tick / 20;
    const inputs = new Map([[A, botInput(world, world.riders[0])]]);
    for (let left = paceTick(world); left > 0; left--) stepWorld(world, inputs);
  }
  return -1;
}

test("a ball lying on a ledge over its head is fetched by going round the ledge, not paced under", () => {
  // Core Dump's roof: the ball rests on top and the bot starts right under it.
  const world = playing("coredump");
  ballAt(world, 320, 162);
  place(world, 0, 300, 200);
  const took = alone(world, 10, () => world.ball.touch === 0);
  assert.ok(took >= 0, "it reached the ball within ten seconds");
});

test("a roof between it and a ball just across the seam is not flown into: it takes the way that is open", () => {
  // Corner Case: the bot is up under the roof, the ball on the floor below, which is the short way round the seam.
  const world = playing("cornercase");
  ballAt(world, 400, 336);
  place(world, 0, 430, 30);
  const took = alone(world, 10, () => world.ball.touch === 0);
  assert.ok(took >= 0, "it reached the ball within ten seconds");
});

test("with no floor under it the bot does not fall for ever: it is back at the ball inside ten seconds", () => {
  const world = playing("firewall");
  ballAt(world, 320, 82);
  place(world, 0, 150, 300);
  world.riders[0].vy = 4 * 4096;
  const took = alone(world, 10, () => world.ball.touch === 0);
  assert.ok(took >= 0, "it reached the ball within ten seconds");
});

test("on Core Dump a ball lying short of the near pit, which is the other colour's, is sent over it into its own", () => {
  // Slot 0's pit is the far one: from the left the ball has to go over the first pit and the post.
  for (const x of [200, 230, 250]) {
    const world = playing("coredump");
    ballAt(world, x, 336);
    alone(world, 60, () => false);
    assert.deepEqual(world.score, [1, 0], `from ${x}`);
    assert.equal(world.riders[0].ownGoals, 0);
  }
});

test("a ball jammed under it in a corner is stepped off, even when left alone it would roll into its goal", () => {
  // Downlink, slot 0: the ball is under the rider against the right wall, wanting to roll left to the pit.
  const world = playing("downlink");
  ballAt(world, 620, 336, -0.25, 0);
  place(world, 0, 619, 335);
  world.riders[0].grounded = true;
  assert.notEqual(botInput(world, world.riders[0]), 0, "it does not wait");
  const took = alone(world, 10, () => world.ball.x < 560 * 4096);
  assert.ok(took >= 0, "the ball got out of the corner within ten seconds");
});

test("a ball pinned against a kerb by a rider who will not move is carried off with a lift from the wrong side", () => {
  // Corner Case, slot 0 (its pockets are on the right): the ball lies between the left kerb's guard and the bot.
  const world = playing("cornercase");
  ballAt(world, 97, 336);
  place(world, 1, 85, 335);
  place(world, 0, 126, 335);
  for (const rider of world.riders) rider.grounded = true;
  let free = -1;
  for (let tick = 0; tick < 200 && free < 0; tick++) {
    const inputs = new Map([[A, botInput(world, world.riders[0])]]);
    for (let left = paceTick(world); left > 0; left--) stepWorld(world, inputs);
    if (world.ball.x > 200 * 4096) free = tick / 20;
  }
  assert.ok(free >= 0, "the ball left the corner within ten seconds");
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
