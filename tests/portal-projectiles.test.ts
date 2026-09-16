import test from 'node:test';
import assert from 'node:assert/strict';
import { addPlayer, createGame, startMatch, step, COUNTDOWN_TICKS, RIDER_RADIUS, SLOT_COLORS, type BombState, type GameState, type InputIntent } from '../src/shared/game.js';
import { GUN_RADIUS } from '../src/shared/gun.js';
import { SHELL_SPEED } from '../src/shared/shell.js';
import { PORTAL_COOLDOWN_TICKS, type PortalPair } from '../src/shared/portal.js';
import { encodeGameState, decodeGameState } from '../src/online/checkpoint.js';

const press: InputIntent = { left: false, right: false, bomb: true, bombCommands: [{ action: 'press' }] };

/** Gates at x=300 and x=900, both mid-field, so a projectile crossing the first lands beside the second. */
const pair = (overrides: Partial<PortalPair> = {}): PortalPair => ({
  id: 'gates', expiresAtTick: 10_000,
  gates: [{ x: 300, y: 450, halfLength: 100 }, { x: 900, y: 450, halfLength: 100 }], ...overrides,
});

function scene() {
  const game = createGame('portal-projectiles', 7);
  for (let slot = 0; slot < 4; slot++) addPlayer(game, { id: `p${slot}`, name: `P${slot}`, slot, color: SLOT_COLORS[slot]! });
  startMatch(game);
  for (let tick = 0; tick < COUNTDOWN_TICKS; tick++) step(game, new Map());
  const [shooter, victim, bystander, spare] = [...game.players.values()];
  // Parked far from both gates and from every ray these tests cast, unless a test moves them.
  Object.assign(shooter!, { x: 120, y: 450, angle: 0, trail: [] });
  Object.assign(victim!, { x: 1400, y: 100, angle: 0, trail: [] });
  Object.assign(bystander!, { x: 1400, y: 300, angle: 0, trail: [] });
  Object.assign(spare!, { x: 1400, y: 800, angle: 0, trail: [] });
  game.portalPairs = [pair()];
  game.nextPickupSpawnTick = game.tick + 10_000;
  return { game, shooter: shooter!, victim: victim!, bystander: bystander!, spare: spare! };
}

/** A shell 12 units short of the first gate's contact edge, travelling right at one tick's reach. */
function launchShell(game: GameState, overrides: Partial<BombState> = {}): BombState {
  const bomb: BombState = {
    id: game.nextBombId++, ownerId: 'p0', launchX: 270, launchY: 450, x: 270, y: 450,
    launchedTick: game.tick, placedTick: game.tick, landsAtTick: Number.MAX_SAFE_INTEGER,
    explodeAtTick: Number.MAX_SAFE_INTEGER, blastRange: 0, flightPath: [],
    shell: { vx: SHELL_SPEED, vy: 0 }, ...overrides,
  };
  game.bombs.set(bomb.id, bomb);
  return bomb;
}

test('a shell leaves the partner gate carrying its speed and its remaining travel', () => {
  const { game } = scene();
  const shell = launchShell(game);
  step(game, new Map());
  // Entry 18 units short of x=300, exit 19 past x=900, the rest of the tick spent beyond it.
  assert.ok(Math.abs(shell.x - 929.5) < 1e-9, `left the partner gate at ${shell.x}`);
  assert.equal(shell.y, 450);
  assert.equal(shell.shell!.vx, SHELL_SPEED);
  assert.equal(shell.shell!.vy, 0);
  assert.equal(shell.shell!.bounces, undefined, 'a gate is not a bounce');
  assert.equal(shell.portalCooldownUntilTick, game.tick + PORTAL_COOLDOWN_TICKS);
});

test('a shell keeps its entry height as a proportion of the partner gate', () => {
  const { game } = scene();
  const shell = launchShell(game, { launchY: 500, y: 500 });
  step(game, new Map());
  assert.equal(shell.y, 500, 'half-length is equal on both gates, so the offset carries over unchanged');
});

test('teleporting past a rider never runs him down', () => {
  const { game, victim } = scene();
  // Directly on the line between the two gates, which the shell does not travel along.
  Object.assign(victim, { x: 600, y: 450, angle: -Math.PI / 2 });
  launchShell(game);
  step(game, new Map());
  assert.equal(victim.alive, true, 'the gap between gates is not ground the shell covered');
});

test('a shell still kills what stands beyond the gate it came out of', () => {
  const { game, victim } = scene();
  Object.assign(victim, { x: 925, y: 450, angle: -Math.PI / 2 });
  launchShell(game);
  step(game, new Map());
  assert.equal(victim.alive, false);
});

test('the cooldown stops a gate pair holding a shell in a loop', () => {
  const { game } = scene();
  const shell = launchShell(game);
  step(game, new Map());
  const entered = game.tick;
  assert.equal(shell.portalCooldownUntilTick, entered + PORTAL_COOLDOWN_TICKS);
  // Aim it back at the partner gate it just left; the cooldown has to refuse the return trip.
  Object.assign(shell, { x: 960, y: 450, shell: { vx: -SHELL_SPEED, vy: 0 } });
  step(game, new Map());
  assert.ok(Math.abs(shell.x - 937.5) < 1e-9, `travelled on rather than jumping back: ${shell.x}`);
  assert.equal(shell.portalCooldownUntilTick, entered + PORTAL_COOLDOWN_TICKS, 'unchanged while cooling down');
});

test('a shell bouncing off a wall in the same tick it portals keeps both outcomes', () => {
  const { game } = scene();
  // The right wall sits at 1600 - inset - 14; exiting at 919 and running right reaches it inside the tick.
  const shell = launchShell(game, { shell: { vx: SHELL_SPEED * 40, vy: 0 } });
  step(game, new Map());
  assert.equal(shell.shell!.vx, -SHELL_SPEED * 40, 'the wall past the exit still turned it around');
  assert.equal(shell.shell!.bounces, 1);
  assert.ok(shell.x < 1600 - game.boundaryInset, 'inside the field');
});

test('a shell ignores a gate whose exit is fouled by another pair', () => {
  const { game } = scene();
  // A foreign wall laid across the exit corridor; only the pair in use may hug an exit.
  game.portalPairs = [pair(), pair({ id: 'across', gates: [{ x: 915, y: 450, halfLength: 100 }, { x: 1400, y: 450, halfLength: 100 }] })];
  const shell = launchShell(game);
  step(game, new Map());
  assert.ok(Math.abs(shell.x - 292.5) < 1e-9, `passed straight through: ${shell.x}`);
  assert.equal(shell.portalCooldownUntilTick, undefined);
});

test('a gun ray comes out of the partner gate and kills there, leaving one tracer per segment', () => {
  const { game, shooter, victim, bystander } = scene();
  Object.assign(shooter, { gunArmed: true });
  Object.assign(victim, { x: 1100, y: 450, angle: Math.PI });
  // Between the gates: this rider is behind the entry wall, not in front of the bullet.
  Object.assign(bystander, { x: 600, y: 450, angle: Math.PI });
  step(game, new Map([['p0', press]]));
  assert.equal(victim.alive, false, 'the shot carried on past the far gate');
  assert.equal(bystander.alive, true, 'nothing between the gates was ever in the way');
  const tracers = [...game.bombs.values()];
  assert.equal(tracers.length, 2, 'one straight line up to the gate, one away from its partner');
  assert.ok(Math.abs(tracers[0]!.x - 294) < 1e-9, `first segment ends at the gate: ${tracers[0]!.x}`);
  assert.equal(tracers[1]!.launchX, 907);
  assert.ok(Math.abs(tracers[1]!.x - victim.x) <= RIDER_RADIUS + GUN_RADIUS + 1e-9, `stopped at the head it found: ${tracers[1]!.x}`);
  assert.equal(game.shots.length, 1, 'still one trigger pull');
  assert.deepEqual(game.shots[0]!.kills.map(kill => kill.victimId), [victim.id]);
});

test('a gun ray stops at the first thing past the gate it came out of', () => {
  const { game, shooter, victim } = scene();
  Object.assign(shooter, { gunArmed: true });
  Object.assign(victim, { x: 1100, y: 450, angle: Math.PI,
    trail: [{ x1: 1000, y1: 300, x2: 1000, y2: 600, createdTick: game.tick, expiresAtTick: game.tick + 100 }] });
  step(game, new Map([['p0', press]]));
  assert.equal(victim.alive, true, 'their own body stopped the bullet short of their head');
  const holed = victim.trail.filter(segment => segment.x1 === 1000);
  assert.equal(holed.length, 2, 'the hole is cut past the gate, where the bullet actually landed');
});

test('gates facing each other cannot hold a gun ray in a loop', () => {
  const { game, shooter } = scene();
  Object.assign(shooter, { gunArmed: true });
  // Three pairs strung across the field, each one aimed into the next.
  game.portalPairs = [
    pair({ id: 'a', gates: [{ x: 300, y: 450, halfLength: 100 }, { x: 700, y: 450, halfLength: 100 }] }),
    pair({ id: 'b', gates: [{ x: 760, y: 450, halfLength: 100 }, { x: 1100, y: 450, halfLength: 100 }] }),
    pair({ id: 'c', gates: [{ x: 1160, y: 450, halfLength: 100 }, { x: 1400, y: 450, halfLength: 100 }] }),
  ];
  step(game, new Map([['p0', press]]));
  assert.ok(game.bombs.size <= 4, `one tracer per hop and no more: ${game.bombs.size}`);
  assert.equal(game.shots.length, 1);
  assert.equal([...game.players.values()].filter(player => !player.alive).length, 0);
});

test('a checkpoint carries a shell\'s own portal cooldown', () => {
  const { game } = scene();
  const shell = launchShell(game);
  step(game, new Map());
  assert.equal(typeof shell.portalCooldownUntilTick, 'number');
  const restored = decodeGameState(encodeGameState(game));
  assert.ok(restored);
  assert.equal(restored.bombs.get(shell.id)?.portalCooldownUntilTick, shell.portalCooldownUntilTick);
});
