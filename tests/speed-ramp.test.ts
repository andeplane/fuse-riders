import assert from "node:assert/strict";
import test from "node:test";
import {
  COUNTDOWN_TICKS,
  NITRO_SPEED,
  OVERTIME_START_TICK,
  RIDER_SPEED,
  RIDER_TURN_RATE,
  SLOT_COLORS,
  SPEED_RAMP_MAX,
  TICK_HZ,
  addPlayer,
  createGame,
  roundSpeedMultiplier,
  startMatch,
  startNextRound,
  step,
  toView,
  type GameState,
} from "../src/engine/game.js";
import {
  decodeGameState,
  encodeGameState,
} from "../src/engine/codec/checkpoint.js";
import { presentWorld } from "../src/render/time/present.js";
import { classicSettings } from "./fixtures/classic-settings.js";
import { setDeadlines, setEffect } from "./fixtures/rider-state.ts";

function playing(seed = 31, pickups = false): GameState {
  const game = createGame("speed-ramp", classicSettings(), seed);
  for (let slot = 0; slot < 2; slot++)
    addPlayer(game, {
      id: `p${slot}`,
      name: `P${slot}`,
      slot,
      color: SLOT_COLORS[slot]!,
    });
  startMatch(game);
  while (game.phase === "countdown") step(game, new Map());
  if (!pickups) game.nextPickupSpawnTick = Number.MAX_SAFE_INTEGER;
  return game;
}
/** Park both riders in open space so a measured tick can never collide, then report p0's stride and turn for that tick. */
function measure(
  game: GameState,
  controls = { left: true, right: false, bomb: false },
) {
  for (const player of game.players.values())
    Object.assign(player, {
      x: 400 + player.slot * 600,
      y: 450,
      angle: 0,
      trail: [],
    });
  const rider = game.players.get("p0")!;
  step(game, new Map([["p0", controls]]));
  assert.equal(rider.alive, true);
  return {
    distance: Math.hypot(rider.x - 400, rider.y - 450),
    turn: Math.PI * 2 - rider.angle,
  };
}

test("the round speed multiplier climbs linearly from normal to the maximum when overtime begins, then holds", () => {
  assert.equal(roundSpeedMultiplier(-5), 1);
  assert.equal(roundSpeedMultiplier(0), 1);
  assert.equal(roundSpeedMultiplier(OVERTIME_START_TICK / 2), 1.25);
  assert.equal(roundSpeedMultiplier(OVERTIME_START_TICK), SPEED_RAMP_MAX);
  assert.equal(roundSpeedMultiplier(OVERTIME_START_TICK * 10), SPEED_RAMP_MAX);
});

test("riders travel faster as the round goes on, with turning circles kept the same size", () => {
  const game = playing();
  const early = measure(game);
  assert.ok(
    Math.abs(early.distance - RIDER_SPEED / TICK_HZ) < 0.01,
    `an opening stride is about normal: ${early.distance}`,
  );
  game.roundStartedTick = game.tick - OVERTIME_START_TICK / 2 + 1;
  const middle = measure(game);
  assert.ok(
    Math.abs(middle.distance - (RIDER_SPEED / TICK_HZ) * 1.25) < 1e-9,
    `halfway to overtime is a quarter faster: ${middle.distance}`,
  );
  game.roundStartedTick = game.tick - OVERTIME_START_TICK;
  const late = measure(game);
  assert.ok(
    Math.abs(late.distance - (RIDER_SPEED / TICK_HZ) * SPEED_RAMP_MAX) < 1e-9,
  );
  assert.ok(
    Math.abs(late.turn - (RIDER_TURN_RATE / TICK_HZ) * SPEED_RAMP_MAX) < 1e-9,
    "steering speeds up with the rider",
  );
  for (const sample of [early, middle])
    assert.ok(
      Math.abs(sample.distance / sample.turn - late.distance / late.turn) <
        1e-6,
      "the turn radius never changes",
    );
});

test("a Nitro stacks on top of the full ramp", () => {
  const game = playing();
  game.roundStartedTick = game.tick - OVERTIME_START_TICK;
  setDeadlines(game.players.get("p0")!, "nitro", [game.tick + 10]);
  const boosted = measure(game);
  assert.ok(
    Math.abs(
      boosted.distance - (RIDER_SPEED / TICK_HZ) * SPEED_RAMP_MAX * NITRO_SPEED,
    ) < 1e-9,
    `${boosted.distance}`,
  );
  assert.ok(
    Math.abs(boosted.turn - (RIDER_TURN_RATE / TICK_HZ) * SPEED_RAMP_MAX) <
      1e-9,
    "Nitro widens turns; only the ramp speeds steering",
  );
});

test("a local rider shown ahead late in the round lands where the next simulated tick puts it", () => {
  const game = playing();
  game.roundStartedTick = game.tick - OVERTIME_START_TICK / 2;
  for (const player of game.players.values())
    Object.assign(player, {
      x: 400 + player.slot * 600,
      y: 450,
      angle: 0,
      trail: [],
    });
  const controls = { left: true, right: false };
  const shown = presentWorld(
    undefined,
    { ...toView(game), tick: game.tick, round: game.round },
    game.tick,
    { id: "p0", controls, lead: 1 },
  ).players.find((p) => p.id === "p0")!;
  step(game, new Map([["p0", { ...controls, bomb: false }]]));
  const simulated = game.players.get("p0")!;
  assert.ok(
    Math.hypot(shown.x - simulated.x, shown.y - simulated.y) < 1e-9,
    `lead ${shown.x},${shown.y} vs tick ${simulated.x},${simulated.y}`,
  );
  assert.ok(Math.abs(shown.angle - simulated.angle) < 1e-9);
});

test("the next round starts at normal speed again", () => {
  const game = playing();
  game.roundStartedTick = game.tick - OVERTIME_START_TICK;
  assert.ok(measure(game).distance > (RIDER_SPEED / TICK_HZ) * 1.4);
  game.phase = "roundOver";
  game.phaseEndsAtTick = game.tick;
  startNextRound(game);
  for (let tick = 0; tick < COUNTDOWN_TICKS; tick++) step(game, new Map());
  assert.equal(game.phase, "playing");
  assert.ok(Math.abs(measure(game).distance - RIDER_SPEED / TICK_HZ) < 0.01);
});

test("a checkpoint restored mid-ramp replays the original world tick for tick", () => {
  const game = playing(31, true);
  // Invulnerable riders keep the round going, so the comparison covers hundreds of ticks of changing speed.
  for (const player of game.players.values())
    setEffect(player, "star", 100_000);
  const weave = (tick: number) =>
    new Map([
      ["p0", { left: tick % 40 < 20, right: false, bomb: false }],
      ["p1", { left: false, right: tick % 50 < 20, bomb: false }],
    ]);
  for (let tick = 0; tick < 400; tick++) step(game, weave(tick));
  const restored = decodeGameState(encodeGameState(game))!;
  assert.ok(restored, "the mid-ramp checkpoint is valid");
  for (let tick = 0; tick < 200; tick++) {
    step(game, weave(tick + 7));
    step(restored, weave(tick + 7));
  }
  assert.equal(encodeGameState(restored), encodeGameState(game));
  assert.equal(game.phase, "playing");
  assert.ok(
    roundSpeedMultiplier(game.tick - game.roundStartedTick!) > 1.2,
    "the comparison ran well into the ramp",
  );
});
