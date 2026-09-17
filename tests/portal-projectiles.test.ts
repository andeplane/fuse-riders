import test from "node:test";
import assert from "node:assert/strict";
import {
  addPlayer,
  createGame,
  startMatch,
  step,
  COUNTDOWN_TICKS,
  RIDER_RADIUS,
  SLOT_COLORS,
  type BombState,
  type GameState,
  type InputIntent,
} from "../src/engine/game.js";
import { GUN_RADIUS } from "../src/engine/gun.js";
import { SHELL_SPEED } from "../src/engine/shell.js";
import {
  MAX_PORTAL_PAIRS,
  PORTAL_COOLDOWN_TICKS,
  type PortalPair,
} from "../src/engine/portal.js";
import { canonicalRoomState } from "../src/engine/apply-tick.js";
import { defaultRoomSettings } from "../src/engine/room-settings.js";
import {
  encodeGameState,
  decodeGameState,
} from "../src/engine/codec/checkpoint.js";
import { classicSettings } from "./fixtures/classic-settings.js";

const press: InputIntent = {
  left: false,
  right: false,
  bomb: true,
  bombCommands: [{ action: "press" }],
};
/** One tick of shell travel: `advanceShell` moves `vx / 20` per tick. */
const REACH = SHELL_SPEED / 20;
/** A shell meets a gate this far short of it, and leaves one unit further past the partner. */
const SHELL_EDGE = 4 + 14;
const GUN_EDGE = 4 + GUN_RADIUS;

/** Gates at x=300 and x=900, both mid-field, so a projectile crossing the first lands beside the second. */
const pair = (overrides: Partial<PortalPair> = {}): PortalPair => ({
  id: "gates",
  expiresAtTick: 10_000,
  gates: [
    { x: 300, y: 450, halfLength: 100 },
    { x: 900, y: 450, halfLength: 100 },
  ],
  ...overrides,
});

function scene() {
  const game = createGame("portal-projectiles", classicSettings(), 7);
  for (let slot = 0; slot < 4; slot++)
    addPlayer(game, {
      id: `p${slot}`,
      name: `P${slot}`,
      slot,
      color: SLOT_COLORS[slot]!,
    });
  startMatch(game);
  for (let tick = 0; tick < COUNTDOWN_TICKS; tick++) step(game, new Map());
  const [shooter, victim, bystander, spare] = [...game.players.values()];
  // Parked clear of both gates and of every ray these tests cast, unless a test moves them.
  Object.assign(shooter!, { x: 120, y: 450, angle: 0, trail: [] });
  Object.assign(victim!, { x: 1400, y: 100, angle: 0, trail: [] });
  Object.assign(bystander!, { x: 1400, y: 300, angle: 0, trail: [] });
  Object.assign(spare!, { x: 1400, y: 800, angle: 0, trail: [] });
  game.portalPairs = [pair()];
  // An open board: these tests place gates, rays and shells at exact coordinates, so no scenery stands in them.
  game.obstacles = [];
  game.nextPickupSpawnTick = game.tick + 10_000;
  return {
    game,
    shooter: shooter!,
    victim: victim!,
    bystander: bystander!,
    spare: spare!,
  };
}

function launchShell(
  game: GameState,
  overrides: Partial<BombState> = {},
): BombState {
  const bomb: BombState = {
    id: game.nextBombId++,
    ownerId: "p0",
    launchX: 270,
    launchY: 450,
    x: 270,
    y: 450,
    launchedTick: game.tick,
    placedTick: game.tick,
    landsAtTick: Number.MAX_SAFE_INTEGER,
    explodeAtTick: Number.MAX_SAFE_INTEGER,
    blastRange: 0,
    flightPath: [],
    shell: { vx: SHELL_SPEED, vy: 0 },
    ...overrides,
  };
  game.bombs.set(bomb.id, bomb);
  return bomb;
}

const wall = (x: number, y1 = 300, y2 = 600, tick = 0) => ({
  x1: x,
  y1,
  x2: x,
  y2,
  createdTick: tick,
  expiresAtTick: tick + 1000,
});

test("a shell leaves the partner gate carrying its speed and its remaining travel", () => {
  const { game } = scene();
  const shell = launchShell(game);
  step(game, new Map());
  // Entry 18 units short of x=300, exit 19 past x=900, the rest of the tick spent beyond it.
  const spent = (300 - SHELL_EDGE - 270) / REACH;
  assert.ok(
    Math.abs(shell.x - (919 + REACH * (1 - spent))) < 1e-9,
    `left the partner gate at ${shell.x}`,
  );
  assert.ok(Math.abs(shell.x - 929.5) < 1e-9);
  assert.equal(shell.y, 450);
  assert.equal(shell.shell!.vx, SHELL_SPEED);
  assert.equal(shell.shell!.vy, 0);
  assert.equal(shell.shell!.bounces, undefined, "a gate is not a bounce");
  assert.equal(
    shell.portalCooldownUntilTick,
    game.tick + PORTAL_COOLDOWN_TICKS,
  );
});

test("a shell travelling the other way enters the far gate and leaves beside the near one", () => {
  const { game } = scene();
  const shell = launchShell(game, {
    launchX: 930,
    x: 930,
    shell: { vx: -SHELL_SPEED, vy: 0 },
  });
  step(game, new Map());
  // Entry at 900 + 18, exit at 300 - 19, then the rest of the tick continuing left.
  const spent = (930 - (900 + SHELL_EDGE)) / REACH;
  assert.ok(
    Math.abs(shell.x - (281 - REACH * (1 - spent))) < 1e-9,
    `left the near gate at ${shell.x}`,
  );
  assert.equal(
    shell.shell!.vx,
    -SHELL_SPEED,
    "heading is preserved through the gate",
  );
});

test("entry height maps onto a partner of a different centre and length", () => {
  const { game } = scene();
  // Half as long and 150 units higher, so only a proportional mapping lands on 325.
  game.portalPairs = [
    pair({
      gates: [
        { x: 300, y: 450, halfLength: 100 },
        { x: 900, y: 300, halfLength: 50 },
      ],
    }),
  ];
  const shell = launchShell(game, { launchY: 500, y: 500 });
  step(game, new Map());
  assert.equal(
    shell.y,
    325,
    "half-way down the entry gate is half-way down its partner",
  );
  assert.ok(
    Math.abs(shell.x - 929.5) < 1e-9,
    "and it still came out beside the partner",
  );
});

test("teleporting past a rider never runs them down", () => {
  const { game, victim } = scene();
  // Directly on the line between the two gates, which the shell does not travel along.
  Object.assign(victim, { x: 600, y: 450, angle: -Math.PI / 2 });
  const shell = launchShell(game);
  step(game, new Map());
  assert.ok(Math.abs(shell.x - 929.5) < 1e-9, "the shell did make the jump");
  assert.equal(
    victim.alive,
    true,
    "the gap between gates is not ground it covered",
  );
});

test("a shell still kills what stands beyond the gate it came out of", () => {
  const { game, victim } = scene();
  Object.assign(victim, { x: 925, y: 450, angle: -Math.PI / 2 });
  const shell = launchShell(game);
  step(game, new Map());
  assert.equal(victim.alive, false);
  assert.equal(
    shell.portalCooldownUntilTick,
    game.tick + PORTAL_COOLDOWN_TICKS,
    "by way of the gate, not across the field",
  );
});

test("the cooldown refuses the tick before its deadline and allows the tick it falls on", () => {
  const { game } = scene();
  const shell = launchShell(game);
  step(game, new Map());
  const deadline = game.tick + PORTAL_COOLDOWN_TICKS;
  assert.equal(shell.portalCooldownUntilTick, deadline);
  // Aimed back at the partner gate from within reach of it: 930 - 22.5 crosses the contact edge at 918.
  const aimBack = () =>
    Object.assign(shell, {
      x: 930,
      y: 450,
      shell: { vx: -SHELL_SPEED, vy: 0 },
    });
  while (game.tick < deadline) {
    aimBack();
    step(game, new Map());
    if (game.tick >= deadline) break;
    assert.ok(
      Math.abs(shell.x - (930 - REACH)) < 1e-9,
      `refused at tick ${game.tick}, so it ran on: ${shell.x}`,
    );
    assert.equal(
      shell.portalCooldownUntilTick,
      deadline,
      "unchanged while refused",
    );
  }
  assert.equal(game.tick, deadline);
  assert.ok(shell.x < 300, `the deadline tick lets it through: ${shell.x}`);
  assert.equal(shell.portalCooldownUntilTick, deadline + PORTAL_COOLDOWN_TICKS);
});

test("a shell meets a gate that is only in its way after a bounce", () => {
  const { game, victim } = scene();
  // Starts clear of the gate on its far side, driven back into it by a trail inside the same tick.
  Object.assign(victim, {
    x: 1400,
    y: 100,
    trail: [wall(400, 300, 600, game.tick)],
  });
  const shell = launchShell(game, {
    launchX: 330,
    x: 330,
    shell: { vx: SHELL_SPEED * 6, vy: 0 },
  });
  step(game, new Map());
  assert.equal(shell.shell!.vx, -SHELL_SPEED * 6, "the trail turned it around");
  assert.equal(shell.shell!.bounces, 1, "and the bounce is counted once");
  // Reflected at 383, gate met at 318, so 17 of the tick's 135 units are left past the partner.
  assert.ok(
    Math.abs(shell.x - 864) < 1e-3,
    `then it took the gate it had been driven into: ${shell.x}`,
  );
  assert.equal(
    shell.portalCooldownUntilTick,
    game.tick + PORTAL_COOLDOWN_TICKS,
  );
});

test("a shell bouncing off a wall after the gate keeps both outcomes", () => {
  const { game } = scene();
  // Fast enough that the right wall arrives within the same tick as the gate.
  const shell = launchShell(game, { shell: { vx: SHELL_SPEED * 40, vy: 0 } });
  step(game, new Map());
  const right = 1600 - game.boundaryInset - 14;
  const spent = (300 - SHELL_EDGE - 270) / (REACH * 40);
  const travelled = REACH * 40 * (1 - spent);
  assert.equal(
    shell.shell!.vx,
    -SHELL_SPEED * 40,
    "the wall past the exit still turned it around",
  );
  assert.equal(shell.shell!.bounces, 1);
  assert.ok(
    Math.abs(shell.x - (right - (travelled - (right - 919)))) < 1e-6,
    `reflected off the far wall: ${shell.x}`,
  );
});

test("a trail contact landing exactly on the gate mouth is the gate's", () => {
  const { game, victim } = scene();
  // The trail's contact edge at 299 - 17 falls on the gate capsule's at 300 - 18, to the unit.
  Object.assign(victim, {
    x: 1400,
    y: 100,
    trail: [wall(299, 300, 600, game.tick)],
  });
  const shell = launchShell(game);
  step(game, new Map());
  assert.equal(
    shell.shell!.vx,
    SHELL_SPEED,
    "it did not reflect and leave the partner backwards",
  );
  assert.equal(
    shell.shell!.bounces,
    undefined,
    "and the tie was not also counted as a bounce",
  );
  assert.ok(
    Math.abs(shell.x - 929.5) < 1e-9,
    `through the gate as usual: ${shell.x}`,
  );
});

test("a shell carries its earlier bounces through a gate", () => {
  const { game } = scene();
  const shell = launchShell(game, {
    shell: { vx: SHELL_SPEED, vy: 0, bounces: 4 },
  });
  step(game, new Map());
  assert.ok(Math.abs(shell.x - 929.5) < 1e-9, "it went through");
  assert.equal(
    shell.shell!.bounces,
    4,
    "a gate neither counts as a bounce nor forgets the earlier ones",
  );
});

test("a shell ignores a gate whose exit is fouled, and takes the same gate without the obstruction", () => {
  const { game } = scene();
  const clear = launchShell(scene().game);
  assert.ok(clear, "control launched");
  // A foreign wall laid across the exit corridor; only the pair in use may hug an exit.
  game.portalPairs = [
    pair(),
    pair({
      id: "across",
      gates: [
        { x: 915, y: 450, halfLength: 100 },
        { x: 1400, y: 450, halfLength: 100 },
      ],
    }),
  ];
  const fouled = launchShell(game);
  step(game, new Map());
  assert.ok(
    Math.abs(fouled.x - (270 + REACH)) < 1e-9,
    `passed straight through: ${fouled.x}`,
  );
  assert.equal(fouled.portalCooldownUntilTick, undefined);

  const control = scene();
  const through = launchShell(control.game);
  step(control.game, new Map());
  assert.ok(
    Math.abs(through.x - 929.5) < 1e-9,
    "the identical launch does portal once the corridor is clear",
  );
});

test("a shell ignores a gate whose exit would fall outside the field", () => {
  const { game } = scene();
  // The partner sits hard against the right wall, so an exit beyond it has nowhere to land.
  game.portalPairs = [
    pair({
      gates: [
        { x: 300, y: 450, halfLength: 100 },
        { x: 1600 - game.boundaryInset - 2, y: 450, halfLength: 100 },
      ],
    }),
  ];
  const shell = launchShell(game);
  step(game, new Map());
  assert.ok(
    Math.abs(shell.x - (270 + REACH)) < 1e-9,
    `travelled on as though the gate were not there: ${shell.x}`,
  );
  assert.equal(shell.portalCooldownUntilTick, undefined);

  const control = scene();
  const through = launchShell(control.game);
  step(control.game, new Map());
  assert.ok(
    Math.abs(through.x - 929.5) < 1e-9,
    "the identical launch does portal when the partner has room",
  );
});

test("a gun ray comes out of the partner gate and kills there, one tracer per segment", () => {
  const { game, shooter, victim, bystander } = scene();
  Object.assign(shooter, { gunArmed: true });
  Object.assign(victim, { x: 1100, y: 450, angle: Math.PI });
  // Between the gates: behind the entry wall, not in front of the bullet.
  Object.assign(bystander, { x: 600, y: 450, angle: Math.PI });
  const result = step(game, new Map([["p0", press]]));
  assert.equal(victim.alive, false, "the shot carried on past the far gate");
  assert.equal(
    bystander.alive,
    true,
    "nothing between the gates was ever in the way",
  );
  const tracers = [...game.bombs.values()];
  assert.equal(
    tracers.length,
    2,
    "one straight line up to the gate, one away from its partner",
  );
  assert.equal(
    tracers[0]!.x,
    300 - GUN_EDGE,
    "the first segment ends at the gate",
  );
  assert.equal(tracers[1]!.launchX, 900 + GUN_EDGE + 1);
  assert.ok(
    Math.abs(tracers[1]!.x - victim.x) <= RIDER_RADIUS + GUN_RADIUS + 1e-9,
    `stopped at the head it found: ${tracers[1]!.x}`,
  );
  assert.equal(
    tracers[0]!.explodeAtTick,
    tracers[1]!.explodeAtTick,
    "both fade together",
  );
  assert.equal(game.shots.length, 1, "still one trigger pull");
  assert.deepEqual(
    game.shots[0]!.kills.map((kill) => kill.victimId),
    [victim.id],
  );
  assert.equal(
    result.events.filter((event) => event.type === "bombPlaced").length,
    1,
    "the trigger was pulled once",
  );
});

test("a body in front of a gate takes the shot instead of the gate", () => {
  const { game, shooter, victim, bystander } = scene();
  Object.assign(shooter, { gunArmed: true });
  // Standing short of the entry gate, so the bullet never reaches it.
  Object.assign(bystander, { x: 250, y: 450, angle: Math.PI });
  Object.assign(victim, { x: 1100, y: 450, angle: Math.PI });
  step(game, new Map([["p0", press]]));
  assert.equal(bystander.alive, false, "the nearer head wins");
  assert.equal(
    victim.alive,
    true,
    "and the ray never left through the partner gate",
  );
  assert.equal(game.bombs.size, 1, "no continuation tracer");

  // The same shot with nobody in front of the gate does reach the far rider, so the gate is live.
  const control = scene();
  Object.assign(control.shooter, { gunArmed: true });
  Object.assign(control.victim, { x: 1100, y: 450, angle: Math.PI });
  step(control.game, new Map([["p0", press]]));
  assert.equal(control.victim.alive, false);
  assert.equal(control.game.bombs.size, 2);
});

test("a gun ray cuts its hole past the gate, not between the gates", () => {
  const { game, shooter, victim, bystander } = scene();
  Object.assign(shooter, { gunArmed: true });
  Object.assign(bystander, {
    x: 1400,
    y: 300,
    trail: [wall(600, 300, 600, game.tick)],
  });
  Object.assign(victim, {
    x: 1100,
    y: 450,
    angle: Math.PI,
    trail: [wall(1000, 300, 600, game.tick)],
  });
  step(game, new Map([["p0", press]]));
  assert.equal(
    victim.alive,
    true,
    "their own body stopped the bullet short of their head",
  );
  assert.equal(
    bystander.trail.filter((segment) => segment.x1 === 600).length,
    1,
    "the trail between the gates is untouched",
  );
  assert.equal(
    victim.trail.filter((segment) => segment.x1 === 1000).length,
    2,
    "the trail past the gate is holed",
  );
});

test("a cycle of gates cannot hold a gun ray", () => {
  const { game, shooter } = scene();
  Object.assign(shooter, { gunArmed: true });
  // B throws the ray back to the left of A, so without spending a pair per ray this never ends.
  game.portalPairs = [
    pair({
      id: "a",
      gates: [
        { x: 300, y: 450, halfLength: 100 },
        { x: 900, y: 450, halfLength: 100 },
      ],
    }),
    pair({
      id: "b",
      gates: [
        { x: 1000, y: 450, halfLength: 100 },
        { x: 400, y: 450, halfLength: 100 },
      ],
    }),
  ];
  step(game, new Map([["p0", press]]));
  assert.equal(
    game.bombs.size,
    3,
    "one segment up to A, one from A to B, one from B to the wall",
  );
  assert.equal(game.shots.length, 1);
  assert.equal(
    [...game.players.values()].filter((player) => !player.alive).length,
    0,
  );
  assert.ok(game.portalPairs.length <= MAX_PORTAL_PAIRS);
});

test("a projectile transit is nobody's portal jump, and a continuation tracer is nobody's bomb", () => {
  const { game, shooter, victim } = scene();
  Object.assign(shooter, { gunArmed: true });
  Object.assign(victim, { x: 1100, y: 450, angle: Math.PI });
  const was = { ...game.matchStats.get("p0")! };
  launchShell(game);
  step(game, new Map([["p0", press]]));
  assert.equal(game.bombs.size, 3, "the shell plus both gun segments");
  const owner = game.matchStats.get("p0")!;
  assert.equal(
    owner.portalTransits,
    was.portalTransits,
    "a gate is a rider award, not a projectile one",
  );
  assert.equal(
    owner.bombsPlaced,
    was.bombsPlaced + 1,
    "one trigger pull, one placement",
  );
});

test("a hopping ray folds the same from a checkpoint decoded in another map order", () => {
  const { game, shooter, victim } = scene();
  Object.assign(shooter, { gunArmed: true });
  Object.assign(victim, { x: 1100, y: 450, angle: Math.PI });
  const shell = launchShell(game);
  step(game, new Map([["p0", press]]));
  assert.equal(typeof shell.portalCooldownUntilTick, "number");

  const encoded = encodeGameState(game);
  const restored = decodeGameState(encoded);
  assert.ok(restored);
  assert.equal(
    restored.bombs.get(shell.id)?.portalCooldownUntilTick,
    shell.portalCooldownUntilTick,
  );

  const reversed = decodeGameState(encoded);
  assert.ok(reversed);
  reversed.players = new Map([...reversed.players.entries()].reverse());
  reversed.bombs = new Map([...reversed.bombs.entries()].reverse());
  const fold = (state: GameState) => {
    for (let tick = 0; tick < 4; tick++) step(state, new Map());
    return canonicalRoomState({
      game: state,
      settings: defaultRoomSettings(),
      folds: new Map(),
      bots: new Set(),
    });
  };
  assert.deepEqual(
    fold(reversed),
    fold(restored),
    "map order cannot change where a hopping ray left things",
  );
});
