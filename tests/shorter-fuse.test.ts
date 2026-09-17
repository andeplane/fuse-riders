import test from "node:test";
import assert from "node:assert/strict";
import {
  BOMB_FUSE_TICKS,
  COUNTDOWN_TICKS,
  SLOT_COLORS,
  addPlayer,
  bombFuseTicks,
  createGame,
  startMatch,
  startNextRound,
  step,
  toSnapshot,
  type InputIntent,
  type PickupType,
} from "../src/shared/game.js";
import {
  powerBlastRadius,
  powerReloadTicks,
} from "../src/shared/power-progression.js";
import { GUN_TRACER_TICKS } from "../src/shared/gun.js";
import { decodeGameState, encodeGameState } from "../src/online/checkpoint.js";
import {
  defaultRoomSettings,
  parseRoomSettings,
  roomPickup,
} from "../src/shared/room-settings.js";

function playing() {
  const game = createGame("shorter-fuse", 725);
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
    invulnerableUntilTick: 10000,
  });
  Object.assign(game.players.get("p1")!, {
    x: 1200,
    y: 700,
    angle: Math.PI,
    trail: [],
    invulnerableUntilTick: 10000,
  });
  game.nextPickupSpawnTick = Number.MAX_SAFE_INTEGER;
  return game;
}
const commands = (...actions: ("press" | "release" | "cancel")[]) =>
  new Map<string, InputIntent>([
    [
      "p0",
      {
        left: false,
        right: false,
        bomb: false,
        bombCommands: actions.map((action) => ({ action })),
      },
    ],
  ]);
const fire = commands("press", "release");
function collect(game: ReturnType<typeof playing>, ...types: PickupType[]) {
  const rider = game.players.get("p0")!;
  game.pickups = types.map((type) => ({
    id: game.nextPickupId++,
    type,
    x: rider.x,
    y: rider.y,
    expiresAtTick: game.tick + 100,
  }));
}

test("Fuse stacks twice, applies on the collection tick, explodes exactly on time and resets next round", () => {
  const game = playing(),
    rider = game.players.get("p0")!;
  assert.equal(rider.fuseLevel, 0);
  assert.equal(bombFuseTicks(), BOMB_FUSE_TICKS);
  assert.equal(bombFuseTicks(-1), 40);
  assert.equal(bombFuseTicks(3), 20);
  for (const duration of [30, 20, 20]) {
    collect(game, "stopwatch");
    step(game, fire);
    const bomb = [...game.bombs.values()][0]!;
    assert.equal(bomb.explodeAtTick - bomb.launchedTick, duration);
    assert.equal(
      toSnapshot(game).players[0]!.fuseLevel,
      duration === 30 ? 1 : 2,
    );
    assert.equal(rider.reloadDurationTicks, powerReloadTicks(0));
    while (game.tick < bomb.explodeAtTick - 1) step(game, new Map());
    assert.ok(game.bombs.has(bomb.id));
    step(game, new Map());
    assert.equal(game.bombs.has(bomb.id), false);
    assert.ok(game.blasts.some((blast) => blast.bombId === bomb.id));
    while (game.tick < rider.bombReadyAtTick) step(game, new Map());
  }
  assert.equal(rider.fuseLevel, 2);
  game.phase = "roundOver";
  game.phaseEndsAtTick = game.tick;
  startNextRound(game);
  assert.equal(rider.fuseLevel, 0);
});

test("collecting Fuse leaves launched bombs and active reloads unchanged", () => {
  const game = playing(),
    rider = game.players.get("p0")!;
  step(game, fire);
  const bomb = [...game.bombs.values()][0]!,
    readyAt = rider.bombReadyAtTick;
  collect(game, "stopwatch", "stopwatch");
  step(game, new Map());
  assert.equal(rider.fuseLevel, 2);
  assert.equal(bomb.explodeAtTick - bomb.launchedTick, 40);
  assert.equal(rider.bombReadyAtTick, readyAt);
  assert.equal(rider.powerPickups, 0);
});

test("held and cancelled input preserves Fuse; shortened volleys retain Power", () => {
  for (const temporary of ["triple", "five"] as const) {
    const game = playing(),
      rider = game.players.get("p0")!;
    step(game, commands("press"));
    collect(game, "stopwatch");
    step(game, commands("cancel"));
    assert.equal(rider.fuseLevel, 1);
    assert.equal(game.bombs.size, 0);
    step(game, commands("press"));
    collect(game, "stopwatch", "extraBomb", "power", temporary);
    step(game, commands("release"));
    const bombs = [...game.bombs.values()];
    assert.equal(bombs.length, temporary === "triple" ? 4 : 6);
    assert.ok(
      bombs.every(
        (bomb) =>
          bomb.explodeAtTick - bomb.launchedTick === 20 &&
          bomb.blastRange === powerBlastRadius(1),
      ),
    );
    assert.equal(rider.reloadDurationTicks, powerReloadTicks(1));
  }
});

test("Shell and Gun retain their projectile/tracer lifetimes", () => {
  for (const special of ["shell", "gun"] as const) {
    const game = playing(),
      rider = game.players.get("p0")!;
    collect(game, "stopwatch", "stopwatch", special);
    step(game, fire);
    assert.equal(rider.fuseLevel, 2);
    const bomb = [...game.bombs.values()][0]!;
    assert.equal(
      bomb.explodeAtTick,
      special === "shell"
        ? Number.MAX_SAFE_INTEGER
        : game.tick + GUN_TRACER_TICKS,
    );
  }
});

test("checkpoint recovery retains Fuse during charging and replays explosions exactly", () => {
  const game = playing();
  collect(game, "stopwatch", "stopwatch", "extraBomb", "gravity");
  step(game, commands("press"));
  const restored = decodeGameState(encodeGameState(game));
  assert.ok(restored);
  for (let tick = 0; tick < 110; tick++) {
    const inputs =
      tick === 0 || tick === 90
        ? commands("release")
        : tick === 80
          ? commands("press")
          : new Map<string, InputIntent>();
    assert.deepEqual(step(restored, inputs), step(game, inputs));
    assert.equal(encodeGameState(restored), encodeGameState(game));
  }
});

test("checkpoint rejects invalid or missing Fuse levels; settings enable and configure the pickup", () => {
  const game = playing(),
    rider = game.players.get("p0")!;
  for (const invalid of [-1, 0.5, 3, NaN]) {
    rider.fuseLevel = invalid;
    assert.equal(decodeGameState(encodeGameState(game)), undefined);
  }
  rider.fuseLevel = 0;
  const valid = encodeGameState(game);
  assert.equal(
    decodeGameState(valid.replace(/"fuseLevel":0,/g, "")),
    undefined,
  );
  assert.ok(decodeGameState(valid));
  const settings = defaultRoomSettings();
  assert.equal(settings.weights.stopwatch, 160);
  assert.deepEqual(parseRoomSettings(settings), settings);
  assert.equal(roomPickup(0.5, { stopwatch: 1 }), "stopwatch");
  assert.equal(roomPickup(0.5, { stopwatch: 0 }), undefined);
});
