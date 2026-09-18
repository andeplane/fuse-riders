import assert from "node:assert/strict";
import test from "node:test";
import {
  AIM_SLOW_FLOOR,
  AIM_SLOW_MAX_TICKS,
  AIM_SLOW_RAMP_TICKS,
  AIM_SLOW_SPEED,
  SLOT_COLORS,
  SNAIL_SPEED,
  addPlayer,
  aimSlowMultiplier,
  createGame,
  eliminatePlayer,
  riderMotionStep,
  startMatch,
  startNextRound,
  step,
  toSnapshot,
  type GameState,
  type InputIntent,
} from "../src/shared/game.js";
import { presentWorld } from "../src/online/prediction.js";
import { decodeGameState, encodeGameState } from "../src/online/checkpoint.js";

// Holding the bomb button eases the rider down to AIM_SLOW_SPEED to steady the aim, for at most a second, and eases
// them back up afterwards. `control` is the same game with nobody aiming: the round's own speed ramp cancels out.
const NEUTRAL: InputIntent = { left: false, right: false, bomb: false };
const PRESS: InputIntent = { ...NEUTRAL, bombCommands: [{ action: "press" }] };
const RELEASE: InputIntent = {
  ...NEUTRAL,
  bombCommands: [{ action: "release" }],
};
const CANCEL: InputIntent = {
  ...NEUTRAL,
  bombCommands: [{ action: "cancel" }],
};

function playing(seed = 7) {
  const game = createGame("aim", seed);
  for (let slot = 0; slot < 2; slot += 1)
    addPlayer(game, {
      id: `p${slot}`,
      name: `P${slot}`,
      slot,
      color: SLOT_COLORS[slot]!,
    });
  startMatch(game);
  while (game.phase === "countdown") step(game, new Map());
  game.nextPickupSpawnTick = Number.MAX_SAFE_INTEGER;
  game.obstacles = [];
  for (const player of game.players.values())
    Object.assign(player, {
      x: 100,
      y: 300 + player.slot * 300,
      angle: 0,
      trail: [],
    });
  return game;
}
/** p0's stride on the next tick as a fraction of p1's, who never aims. */
function ratio(game: GameState, input: InputIntent = NEUTRAL): number {
  const [aimer, plain] = [game.players.get("p0")!, game.players.get("p1")!];
  const before = [aimer.x, plain.x];
  step(game, new Map([["p0", input]]));
  return (aimer.x - before[0]!) / (plain.x - before[1]!);
}
const close = (actual: number, expected: number, message: string) =>
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `${message}: ${actual} vs ${expected}`,
  );

test("the eased multiplier runs from full speed to the slow speed without a jump", () => {
  assert.equal(aimSlowMultiplier(0), 1);
  assert.equal(aimSlowMultiplier(AIM_SLOW_RAMP_TICKS), AIM_SLOW_SPEED);
  let largest = 0;
  for (let level = 1; level <= AIM_SLOW_RAMP_TICKS; level += 1) {
    const drop = aimSlowMultiplier(level - 1) - aimSlowMultiplier(level);
    assert.ok(drop > 0, "every step is slower than the one before");
    largest = Math.max(largest, drop);
  }
  assert.ok(
    largest < (1 - AIM_SLOW_SPEED) / 2,
    "no single tick takes even half of the change",
  );
  assert.equal(
    aimSlowMultiplier(AIM_SLOW_RAMP_TICKS / 2),
    (1 + AIM_SLOW_SPEED) / 2,
    "the ease is symmetric about its midpoint",
  );
  const stepAt = (level: number) =>
    aimSlowMultiplier(level - 1) - aimSlowMultiplier(level);
  const middle = stepAt(Math.ceil(AIM_SLOW_RAMP_TICKS / 2));
  assert.ok(
    stepAt(1) < middle && stepAt(AIM_SLOW_RAMP_TICKS) < middle,
    "it starts and ends gently: the change is quickest in the middle",
  );
});

test("a held bomb eases the rider down, holds, and lets go after a second even if the button does not", () => {
  const game = playing();
  close(ratio(game, PRESS), 1, "the press tick itself moves at full speed");
  for (let held = 1; held <= AIM_SLOW_MAX_TICKS; held += 1)
    close(
      ratio(game),
      aimSlowMultiplier(Math.min(held, AIM_SLOW_RAMP_TICKS)),
      `held tick ${held}`,
    );
  assert.notEqual(
    game.players.get("p0")!.bombChargeStartedTick,
    undefined,
    "the button is still down",
  );
  for (let past = 1; past <= AIM_SLOW_RAMP_TICKS; past += 1)
    close(
      ratio(game),
      aimSlowMultiplier(AIM_SLOW_RAMP_TICKS - past),
      `tick ${past} past the cap`,
    );
  close(ratio(game), 1, "and full speed from then on");
  assert.equal(game.players.get("p0")!.aimSlowTicks, 0);
});

test("a short charge dips and recovers smoothly from wherever release found it", () => {
  for (const end of [RELEASE, CANCEL]) {
    const game = playing();
    ratio(game, PRESS);
    close(ratio(game), aimSlowMultiplier(1), "first held tick");
    close(ratio(game), aimSlowMultiplier(2), "second held tick");
    close(
      ratio(game, end),
      aimSlowMultiplier(3),
      "the ending tick moves before it lets go",
    );
    close(ratio(game), aimSlowMultiplier(2), "recovering");
    close(ratio(game), aimSlowMultiplier(1), "recovering");
    close(ratio(game), 1, "recovered");
  }
});

test("a fresh press during the recovery eases back down from where the recovery had got to", () => {
  const game = playing();
  ratio(game, PRESS);
  ratio(game);
  ratio(game);
  close(ratio(game, CANCEL), aimSlowMultiplier(3), "the cancelling tick");
  close(ratio(game, PRESS), aimSlowMultiplier(2), "one tick of recovery");
  close(ratio(game), aimSlowMultiplier(3), "and down again, with no jump");
});

test("cancelling into a fresh press buys no more slowdown: the second is a budget that refills only with the button up", () => {
  const game = playing();
  const aimer = game.players.get("p0")!;
  const AGAIN: InputIntent = {
    ...NEUTRAL,
    bombCommands: [{ action: "cancel" }, { action: "press" }],
  };
  ratio(game, PRESS);
  for (let held = 1; held < AIM_SLOW_MAX_TICKS; held += 1) ratio(game);
  close(ratio(game, AGAIN), AIM_SLOW_SPEED, "the last tick of the budget");
  assert.equal(aimer.bombChargeStartedTick, game.tick, "a brand-new charge");
  for (let past = 1; past <= AIM_SLOW_RAMP_TICKS; past += 1)
    close(
      ratio(game, past === 3 ? AGAIN : NEUTRAL),
      aimSlowMultiplier(AIM_SLOW_RAMP_TICKS - past),
      `tick ${past} past the cap eases back regardless`,
    );
  for (let tick = 0; tick < AIM_SLOW_MAX_TICKS; tick += 1)
    close(ratio(game), 1, "held for another second at full speed");

  // Five ticks with the button up earn five ticks of slowdown, and no more.
  ratio(game, CANCEL);
  for (let up = 1; up < 5; up += 1) ratio(game);
  close(ratio(game, PRESS), 1, "the fifth tick up is the press tick");
  for (let held = 1; held <= 5; held += 1)
    close(ratio(game), aimSlowMultiplier(held), `earned tick ${held}`);
  close(ratio(game), aimSlowMultiplier(4), "spent again: easing back");
  assert.equal(aimer.aimSlowSpentTicks, AIM_SLOW_MAX_TICKS);
});

test("aiming under three Snails stays survivable: the slowdown stops at the floor", () => {
  const game = playing();
  const aimer = game.players.get("p0")!;
  aimer.snailUntilTicks = [1e6, 1e6, 1e6];
  const floor = SNAIL_SPEED ** 3;
  assert.equal(
    floor,
    AIM_SLOW_FLOOR,
    "three Snails are the pace the floor keeps",
  );
  close(ratio(game, PRESS), floor, "snailed, not yet aiming");
  for (
    let held = 1;
    held <= AIM_SLOW_MAX_TICKS + AIM_SLOW_RAMP_TICKS;
    held += 1
  )
    close(ratio(game), floor, "aiming takes nothing more");
  assert.equal(
    aimer.alive,
    true,
    "and the rider never catches their own trail",
  );

  aimer.snailUntilTicks = [1e6];
  aimer.aimSlowSpentTicks = 0;
  aimer.aimSlowTicks = AIM_SLOW_RAMP_TICKS - 1;
  close(
    ratio(game),
    SNAIL_SPEED * AIM_SLOW_SPEED,
    "above the floor they stack",
  );
});

test("a gun fires on the press and never slows its rider", () => {
  const game = playing();
  const shooter = game.players.get("p0")!;
  shooter.gunArmed = true;
  ratio(game, PRESS);
  assert.equal(game.bombs.size, 1, "the press fired the bullet");
  assert.equal(shooter.bombChargeStartedTick, undefined, "and left no charge");
  for (let tick = 0; tick < 4; tick += 1)
    close(ratio(game), 1, "no charge, no slowdown");
});

test("steering keeps its rate while aiming: the slowdown tightens the circle, like a Snail", () => {
  const game = playing();
  const [aimer, plain] = [game.players.get("p0")!, game.players.get("p1")!];
  const LEFT: InputIntent = { ...NEUTRAL, left: true };
  let [aimed, ridden] = [0, 0];
  for (let tick = 0; tick <= AIM_SLOW_RAMP_TICKS + 2; tick += 1) {
    const before = [aimer.x, aimer.y, plain.x, plain.y] as const;
    step(
      game,
      new Map([
        ["p0", tick === 0 ? { ...PRESS, left: true } : LEFT],
        ["p1", LEFT],
      ]),
    );
    aimed += Math.hypot(aimer.x - before[0], aimer.y - before[1]);
    ridden += Math.hypot(plain.x - before[2], plain.y - before[3]);
  }
  assert.equal(aimer.aimSlowTicks, AIM_SLOW_RAMP_TICKS);
  assert.equal(aimer.angle, plain.angle, "both riders turned exactly as far");
  assert.ok(aimed < ridden * 0.8, "on a shorter arc");

  const slowed = riderMotionStep(aimer, game.tick + 1, game.roundStartedTick);
  const full = riderMotionStep(plain, game.tick + 1, game.roundStartedTick);
  assert.equal(slowed.turn, full.turn);
  assert.equal(slowed.distance, full.distance * AIM_SLOW_SPEED);
});

test("the slowdown is cleared by a new round and survives a checkpoint mid-ease", () => {
  const game = playing();
  ratio(game, PRESS);
  ratio(game);
  ratio(game);
  const restored = decodeGameState(encodeGameState(game));
  assert.ok(restored, "a game easing into a slowdown is a valid checkpoint");
  for (let tick = 0; tick < 4; tick += 1) {
    step(game, new Map());
    step(restored, new Map());
    assert.equal(restored.players.get("p0")!.x, game.players.get("p0")!.x);
  }
  for (const [field, max] of [
    ["aimSlowTicks", AIM_SLOW_RAMP_TICKS],
    ["aimSlowSpentTicks", AIM_SLOW_MAX_TICKS],
  ] as const)
    for (const bad of [max + 1, -1, 1.5]) {
      const data = JSON.parse(encodeGameState(game)) as {
        players: { $map: [string, Record<string, number>][] };
      };
      data.players.$map[0]![1][field] = bad;
      assert.equal(
        decodeGameState(JSON.stringify(data)),
        undefined,
        `${field} ${bad}`,
      );
    }

  assert.ok(game.players.get("p0")!.aimSlowTicks > 0);
  assert.ok(game.players.get("p0")!.aimSlowSpentTicks > 0);
  eliminatePlayer(game, "p1");
  while (game.phase === "playing") step(game, new Map()); // the round ends inside step, not on elimination
  game.tick = game.phaseEndsAtTick!;
  startNextRound(game);
  assert.equal(game.players.get("p0")!.aimSlowTicks, 0);
  assert.equal(game.players.get("p0")!.aimSlowSpentTicks, 0);
});

test("the local rider's predicted lead uses the slowed stride", () => {
  const game = playing();
  ratio(game, PRESS);
  ratio(game);
  ratio(game);
  const snapshot = { ...toSnapshot(game), tick: game.tick, round: game.round };
  const shown = presentWorld(undefined, snapshot, snapshot.tick, {
    id: "p0",
    controls: NEUTRAL,
    lead: 1,
  });
  step(game, new Map());
  const rider = game.players.get("p0")!,
    view = shown.players.find((player) => player.id === "p0")!;
  assert.deepEqual([view.x, view.y], [rider.x, rider.y]);
  assert.equal(view.trail.length, snapshot.players[0]!.trail.length + 1);
});
