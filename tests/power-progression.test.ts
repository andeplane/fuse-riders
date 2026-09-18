import test from "node:test";
import assert from "node:assert/strict";
import {
  POWER_TUNING as tuning,
  MAX_POWER_PICKUPS,
  MAX_BOARD_PICKUPS,
  powerBlastRadius,
  powerReloadTicks,
  powerTrailLifetimeTicks,
} from "../src/shared/power-progression.js";
import {
  BOMB_FUSE_TICKS,
  COUNTDOWN_TICKS,
  SLOT_COLORS,
  addPlayer,
  createGame,
  eliminatePlayer,
  startMatch,
  startNextRound,
  step,
  toSnapshot,
  type InputIntent,
} from "../src/shared/game.js";
import {
  decodeGameState,
  encodeGameState,
  MAX_CHECKPOINT_TRAILS,
} from "../src/online/checkpoint.js";
import { defaultRoomSettings } from "../src/shared/room-settings.js";
import { reloadRemaining } from "../src/client/reload-ring.js";

function playing() {
  const game = createGame("power-test", 725);
  for (let slot = 0; slot < 2; slot++)
    addPlayer(game, {
      id: `p${slot}`,
      name: `P${slot}`,
      slot,
      color: SLOT_COLORS[slot]!,
    });
  startMatch(game);
  for (let i = 0; i < COUNTDOWN_TICKS; i++) step(game, new Map());
  Object.assign(game.players.get("p0")!, {
    x: 400,
    y: 400,
    angle: 0,
    trail: [],
  });
  Object.assign(game.players.get("p1")!, {
    x: 1200,
    y: 700,
    angle: Math.PI,
    trail: [],
  });
  game.nextPickupSpawnTick = Number.MAX_SAFE_INTEGER;
  return game;
}
const fire = new Map<string, InputIntent>([
  [
    "p0",
    {
      left: false,
      right: false,
      bomb: false,
      bombCommands: [{ action: "press" }, { action: "release" }],
    },
  ],
]);

test("trail capacity starts at eight seconds and grows by two seconds per diamond up to the ceiling", () => {
  assert.equal(powerTrailLifetimeTicks(0), 160);
  assert.equal(powerTrailLifetimeTicks(4), 320);
  assert.equal(powerTrailLifetimeTicks(8), 480);
  for (let count = 1; count <= 21; count++) {
    assert.equal(
      powerTrailLifetimeTicks(count) - powerTrailLifetimeTicks(count - 1),
      40,
    );
  }
  assert.equal(powerTrailLifetimeTicks(21), 1000);
  assert.equal(powerTrailLifetimeTicks(22), tuning.maxTrailLifetimeTicks);
  assert.equal(powerTrailLifetimeTicks(23), tuning.maxTrailLifetimeTicks);
  assert.equal(
    powerTrailLifetimeTicks(MAX_POWER_PICKUPS),
    tuning.maxTrailLifetimeTicks,
  );
});

test("a saturated trail grows immediately with each collected diamond and expires at the extended deadline", () => {
  const game = playing(),
    player = game.players.get("p0")!;
  for (const rider of game.players.values())
    rider.invulnerableUntilTick = game.tick + 300;
  for (let i = 0; i < 160; i++) step(game, new Map());
  assert.equal(player.trail.length, 160);
  const expired = player.trail[0]!,
    retained = player.trail[1]!;
  const originalDeadline = retained.expiresAtTick;
  for (let i = 0; i < 2; i++) {
    game.pickups = [
      {
        id: game.nextPickupId++,
        type: "power",
        x: player.x,
        y: player.y,
        expiresAtTick: game.tick + 100,
      },
    ];
    step(game, new Map());
  }
  assert.equal(player.powerPickups, 2);
  assert.equal(
    player.trail.length,
    161,
    "only the segment expired before collection is lost",
  );
  assert.ok(
    !player.trail.some(
      (segment) => segment.createdTick === expired.createdTick,
    ),
  );
  assert.equal(player.trail[0]!.expiresAtTick, originalDeadline + 80);
  assert.equal(player.trail.at(-1)!.expiresAtTick, game.tick + 240);
  const restored = decodeGameState(encodeGameState(game));
  assert.ok(restored);
  while (game.tick < originalDeadline + 79) {
    assert.deepEqual(step(restored, new Map()), step(game, new Map()));
  }
  assert.equal(player.trail.length, 240);
  assert.equal(player.trail[0]!.createdTick, retained.createdTick);
  assert.deepEqual(step(restored, new Map()), step(game, new Map()));
  assert.ok(
    !player.trail.some(
      (segment) => segment.createdTick === retained.createdTick,
    ),
  );
  assert.equal(encodeGameState(restored), encodeGameState(game));
});

test("an extended trail remains a collision obstacle past its old expiry", () => {
  const game = playing(),
    player = game.players.get("p0")!,
    other = game.players.get("p1")!;
  player.trail = [
    {
      x1: 900,
      y1: 500,
      x2: 1000,
      y2: 500,
      createdTick: game.tick - 158,
      expiresAtTick: game.tick + 2,
    },
  ];
  game.pickups = [
    {
      id: game.nextPickupId++,
      type: "power",
      x: player.x,
      y: player.y,
      expiresAtTick: game.tick + 100,
    },
  ];
  step(game, new Map());
  Object.assign(other, {
    x: 950,
    y: 487,
    angle: Math.PI / 2,
    invulnerableUntilTick: 0,
    trail: [],
  });
  const result = step(game, new Map());
  assert.equal(other.alive, false);
  assert.ok(
    result.events.some(
      (event) =>
        event.type === "playerEliminated" &&
        event.playerId === other.id &&
        event.cause === "trail",
    ),
  );
});

test("trail growth resets with the round and does not extend an eliminated rider", () => {
  const game = playing(),
    player = game.players.get("p0")!;
  game.pickups = Array.from({ length: 3 }, () => ({
    id: game.nextPickupId++,
    type: "power" as const,
    x: player.x,
    y: player.y,
    expiresAtTick: game.tick + 100,
  }));
  step(game, new Map());
  assert.equal(player.trail.at(-1)!.expiresAtTick, game.tick + 280);
  eliminatePlayer(game, player.id);
  const deadTrail = structuredClone(player.trail);
  step(game, new Map());
  assert.deepEqual(player.trail, deadTrail);
  while (game.tick < game.phaseEndsAtTick!) step(game, new Map());
  startNextRound(game);
  assert.equal(player.powerPickups, 0);
  assert.equal(player.trail.length, 0);
  for (let i = 0; i < COUNTDOWN_TICKS; i++) step(game, new Map());
  assert.equal(player.trail.at(-1)!.expiresAtTick, game.tick + 160);
});

test("maximum progression keeps a long-running trail within the checkpoint budget", () => {
  const game = playing(),
    player = game.players.get("p0")!;
  for (const rider of game.players.values())
    rider.invulnerableUntilTick = game.tick + 1600;
  player.powerPickups = MAX_POWER_PICKUPS;
  for (let i = 0; i < tuning.maxTrailLifetimeTicks + 5; i++)
    step(game, new Map());
  assert.equal(player.trail.length, tuning.maxTrailLifetimeTicks);
  assert.ok(player.trail.length <= MAX_CHECKPOINT_TRAILS);
  const deadline = player.trail[1]!.expiresAtTick;
  game.pickups = [
    {
      id: game.nextPickupId++,
      type: "power",
      x: player.x,
      y: player.y,
      expiresAtTick: game.tick + 100,
    },
  ];
  step(game, new Map());
  assert.equal(
    player.trail[0]!.expiresAtTick,
    deadline,
    "the resource ceiling cannot be extended by more pickups",
  );
  assert.equal(player.powerPickups, MAX_POWER_PICKUPS);
  assert.ok(decodeGameState(encodeGameState(game)));
});

test("every pickup improves blast strength with diminishing returns and bounded reload", () => {
  assert.equal(powerBlastRadius(0), tuning.baseBlastRadius);
  assert.equal(powerReloadTicks(0), tuning.baseReloadTicks);
  assert.equal(powerBlastRadius(tuning.halfStrengthPickups), 135);
  assert.equal(powerReloadTicks(tuning.halfStrengthPickups), 30);
  let previousGain = Infinity;
  for (let count = 1; count <= 100; count++) {
    const gain = powerBlastRadius(count) - powerBlastRadius(count - 1);
    assert.ok(
      gain > 0 && gain < previousGain,
      `pickup ${count} adds a smaller positive blast gain`,
    );
    assert.ok(powerReloadTicks(count) <= powerReloadTicks(count - 1));
    previousGain = gain;
  }
  assert.ok(
    powerReloadTicks(1) < tuning.baseReloadTicks,
    "the very first pickup improves reload",
  );
  assert.ok(powerBlastRadius(MAX_POWER_PICKUPS) < tuning.maxBlastRadius);
  assert.ok(powerReloadTicks(MAX_POWER_PICKUPS) >= tuning.minReloadTicks);
  assert.equal(powerReloadTicks(0), BOMB_FUSE_TICKS);
  assert.equal(powerReloadTicks(MAX_POWER_PICKUPS), 20);
});

test("default and upgraded ordinary shots can fire again on the explosion tick, never while a volley is live", () => {
  for (const count of [0, 1, tuning.halfStrengthPickups, MAX_POWER_PICKUPS]) {
    const game = playing(),
      player = game.players.get("p0")!;
    player.powerPickups = count;
    player.extraBombs = 1;
    step(game, fire);
    const firstBombs = [...game.bombs.values()];
    assert.equal(firstBombs.length, 2);
    const restored = decodeGameState(encodeGameState(game));
    assert.ok(restored);
    while (game.tick < firstBombs[0]!.explodeAtTick - 1) {
      assert.deepEqual(step(restored, fire), step(game, fire));
      assert.equal(
        game.nextBombId,
        3,
        "reload completion cannot bypass the live volley",
      );
      assert.equal(player.bombChargeStartedTick, undefined);
    }
    const result = step(game, fire);
    assert.deepEqual(step(restored, fire), result);
    assert.deepEqual(
      result.events
        .filter((event) => event.type === "explosion")
        .map((event) => event.bombId),
      firstBombs.map((bomb) => bomb.id),
    );
    assert.equal(
      result.events.filter((event) => event.type === "bombPlaced").length,
      2,
    );
    assert.equal(
      game.nextBombId,
      5,
      "the next volley launches on the same tick the first explodes",
    );
    assert.equal(encodeGameState(restored), encodeGameState(game));
  }
});

test("each pickup improves a shot; shortened fuses allow firing at the upgraded reload deadline", () => {
  for (const count of [
    0,
    1,
    2,
    3,
    4,
    5,
    tuning.halfStrengthPickups,
    MAX_POWER_PICKUPS,
  ]) {
    const game = playing(),
      player = game.players.get("p0")!;
    for (const rider of game.players.values())
      rider.invulnerableUntilTick = game.tick + 100;
    player.powerPickups = count;
    player.fuseLevel = 2;
    step(game, fire);
    const firstBombId = game.nextBombId;
    const bomb = [...game.bombs.values()][0]!;
    assert.equal(bomb.blastRange, powerBlastRadius(count));
    assert.equal(bomb.explodeAtTick - bomb.launchedTick, 20);
    const ticks = powerReloadTicks(count);
    const snapshot = {
      ...toSnapshot(game),
      tick: game.tick,
      round: game.round,
    };
    assert.equal(reloadRemaining(snapshot.players[0]!, snapshot), 1);
    for (let i = 0; i < ticks - 1; i++) step(game, fire);
    assert.equal(game.nextBombId, firstBombId, "early presses cannot fire");
    assert.equal(player.bombReadyAtTick, game.tick + 1);
    step(game, fire);
    assert.equal(
      game.nextBombId,
      firstBombId + 1,
      "fires exactly at readiness",
    );
  }
});

test("power and a running reload restore and replay exactly; the ring uses the launch duration", () => {
  const game = playing(),
    player = game.players.get("p0")!;
  player.powerPickups = 4;
  step(game, fire);
  game.pickups = [
    {
      id: game.nextPickupId++,
      type: "power",
      x: player.x,
      y: player.y,
      expiresAtTick: game.tick + 100,
    },
  ];
  step(game, new Map());
  assert.equal(player.powerPickups, 5);
  const snapshot = { ...toSnapshot(game), tick: game.tick, round: game.round };
  assert.equal(
    reloadRemaining(snapshot.players[0]!, snapshot),
    (powerReloadTicks(4) - 1) / powerReloadTicks(4),
  );
  const restored = decodeGameState(encodeGameState(game));
  assert.ok(restored);
  for (let i = 0; i < 20; i++) {
    step(game, new Map());
    step(restored, new Map());
  }
  assert.equal(encodeGameState(restored), encodeGameState(game));
});

test("checkpoint accepts a full board and rejects malformed progression", () => {
  const game = playing();
  game.pickups = Array.from({ length: MAX_BOARD_PICKUPS }, (_, i) => ({
    id: i + 1,
    type: "power",
    x: 100 + i * 30,
    y: 100,
    expiresAtTick: game.tick + 100,
  }));
  game.nextPickupId = MAX_BOARD_PICKUPS + 2;
  assert.ok(decodeGameState(encodeGameState(game)));
  game.pickups.push({
    id: MAX_BOARD_PICKUPS + 1,
    type: "power",
    x: 100,
    y: 200,
    expiresAtTick: game.tick + 100,
  });
  assert.equal(decodeGameState(encodeGameState(game)), undefined);
  game.pickups = [];
  const player = game.players.get("p0")!;
  for (const invalid of [-1, 0.5, MAX_POWER_PICKUPS + 1, NaN]) {
    player.powerPickups = invalid;
    assert.equal(decodeGameState(encodeGameState(game)), undefined);
  }
  player.powerPickups = 0;
  for (const invalid of [0, 0.5, tuning.baseReloadTicks + 1]) {
    player.reloadDurationTicks = invalid;
    assert.equal(decodeGameState(encodeGameState(game)), undefined);
  }
});

test("abundant spawning still respects a room with all drops disabled", () => {
  const game = playing();
  game.settings = { ...defaultRoomSettings(), weights: {} };
  game.nextPickupSpawnTick = game.tick;
  for (let i = 0; i < 100; i++) step(game, new Map());
  assert.equal(game.pickups.length, 0);
});

test("a newly joined lobby rider can be restored before any round initializes it", () => {
  const game = createGame("power-lobby");
  addPlayer(game, { id: "p0", name: "P0", slot: 0, color: SLOT_COLORS[0]! });
  assert.equal(
    game.players.get("p0")!.reloadDurationTicks,
    tuning.baseReloadTicks,
  );
  const restored = decodeGameState(encodeGameState(game));
  assert.ok(restored);
  assert.equal(encodeGameState(restored), encodeGameState(game));
});

test("several pickups collected together all improve a shot on the same tick", () => {
  const game = playing(),
    player = game.players.get("p0")!;
  const count = 11;
  game.pickups = Array.from({ length: count }, () => ({
    id: game.nextPickupId++,
    type: "power",
    x: player.x,
    y: player.y,
    expiresAtTick: game.tick + 100,
  }));
  step(game, fire);
  assert.equal(player.powerPickups, count);
  assert.equal(
    [...game.bombs.values()][0]!.blastRange,
    powerBlastRadius(count),
  );
  assert.equal(player.reloadDurationTicks, powerReloadTicks(count));
  assert.equal(game.matchStats.get(player.id)!.powerPickups, count);
});
