import test from "node:test";
import assert from "node:assert/strict";
import {
  TICK_HZ,
  WORLD_WIDTH,
  castleCenter,
  createBot,
  createRound,
  ghostOf,
  ghostPositionAt,
  isGhostLoaded,
  predictGhostBomb,
  solidAt,
  step,
  type BotDifficulty,
  type RoundState,
  type TickEvent,
  type Tuning,
} from "../src/engine/index.js";
import { fillRect } from "../src/engine/grid.js";
import {
  addRocket,
  clearSky,
  fingerprint,
  openWorld,
  placeGate,
  playOut,
} from "./engine-helpers.js";

// Ghost bombers: eliminated players fly a blimp above their wreck, across the world and through rock, and drop bombs.

function run(
  state: RoundState,
  ticks: number,
  inputs: (s: RoundState) => boolean[] = () => [],
): TickEvent[] {
  const all: TickEvent[] = [];
  for (let i = 0; i < ticks && !state.result; i++)
    all.push(...step(state, inputs(state)));
  return all;
}

const only = <T extends TickEvent["type"]>(events: TickEvent[], type: T) =>
  events.filter((e): e is Extract<TickEvent, { type: T }> => e.type === type);

/** A 3-player round with castle 1 destroyed by a rocket from castle 0; returns its ghost. */
function withGhost(seed = 21, tuning: Partial<Tuning> = {}) {
  const s = createRound({ seed, playerCount: 3, tuning });
  clearSky(s);
  const victim = s.castles[1];
  assert.ok(victim);
  victim.hp = 1;
  const c = castleCenter(victim);
  addRocket(s, { owner: 0, x: c.x, y: c.y - 40, vy: 600 });
  const events = run(s, 10);
  return { s, events, ghost: ghostOf(s, 1) };
}

test("a destroyed castle's owner becomes a ghost above the wreck", () => {
  const { s, events, ghost } = withGhost();
  const spawned = only(events, "ghost-spawned");
  assert.equal(spawned.length, 1);
  assert.ok(ghost);
  assert.equal(spawned[0]?.owner, 1);
  assert.ok(Math.abs((spawned[0]?.x ?? 0) - (s.castles[1]?.x ?? 0)) < 1);
  const wreck = s.castles[1]?.y ?? 0;
  assert.equal(
    ghost.y,
    Math.max(s.tuning.ghostMargin, wreck - s.tuning.ghostRise),
  );
  assert.ok(ghost.reloadTicks > 0 && !isGhostLoaded(ghost, s.terrain));
  assert.equal(s.ghosts.length, 1);
  assert.equal(s.result, null, "ghosts do not end or win the round");

  const off = withGhost(21, { ghosts: false });
  assert.equal(off.ghost, undefined);
  assert.equal(only(off.events, "ghost-spawned").length, 0);
});

test("ghosts drift at constant speed and bounce between the edges", () => {
  const { s, ghost } = withGhost();
  assert.ok(ghost);
  let flips = 0;
  let dir = Math.sign(ghost.vx);
  for (let i = 0; i < TICK_HZ * 70; i++) {
    step(s);
    const p = ghostPositionAt(ghost, s.tick);
    assert.ok(Math.abs(p.x - ghost.x) < 1e-6 && p.vx === ghost.vx);
    assert.ok(ghost.x >= ghost.minX - 1e-9 && ghost.x <= ghost.maxX + 1e-9);
    if (Math.sign(ghost.vx) !== dir) flips++;
    dir = Math.sign(ghost.vx);
  }
  assert.ok(ghost.minX > 0 && ghost.maxX < WORLD_WIDTH);
  assert.ok(flips >= 2, `flips ${flips}`);
});

test("pressing drops one bomb per reload; it lands where predictGhostBomb says", () => {
  const { s, ghost } = withGhost(23);
  assert.ok(ghost);
  assert.equal(
    only(
      run(s, 1, () => [false, true]),
      "ghost-bomb-dropped",
    ).length,
    0,
  );
  while (!isGhostLoaded(ghost, s.terrain)) step(s);
  const predicted = predictGhostBomb(s, 1);
  assert.ok(predicted);
  const [x, vx] = [ghost.x, ghost.vx];
  const dropped = only(step(s, [false, true]).slice(), "ghost-bomb-dropped");
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0]?.x, x);
  const bomb = s.rockets.find((r) => r.id === dropped[0]?.rocketId);
  assert.ok(bomb?.ghost && bomb.vx === vx && !bomb.bomb);
  assert.ok(ghost.reloadTicks > 0);
  const events = run(s, 400, () => [false, true]);
  assert.equal(only(events, "ghost-bomb-dropped").length >= 1, true);
  const hit = only(events, "ghost-bomb-hit").find(
    (e) => e.rocketId === bomb.id,
  );
  assert.ok(hit, "the bomb blew up");
  assert.ok(Math.abs(hit.x - predicted.impact.x) < 1, `${hit.x} vs predicted`);
  assert.equal(
    s.castles[1]?.stats.ghostBombs,
    1 + only(events, "ghost-bomb-dropped").length,
  );
});

test("a ghost inside rock cannot drop: it stays unloaded, nothing blows up at the drop point, and the press waits", () => {
  const { s, ghost } = withGhost(23);
  assert.ok(ghost);
  // A band of indestructible rock along the blimp's whole flight line, as in the temple's hall.
  const band = [0, ghost.y - 40, WORLD_WIDTH, ghost.y + 40] as const;
  fillRect(s.terrain, ...band, "hard");
  while (ghost.reloadTicks > 0) step(s);
  assert.ok(solidAt(s.terrain, ghost.x, ghost.y));
  assert.equal(ghost.reloadTicks, 0, "reloaded by the clock");
  assert.equal(isGhostLoaded(ghost, s.terrain), false, "but inside rock");
  assert.equal(predictGhostBomb(s, 1), null, "so there is no drop to predict");

  // Mashing the button drops nothing (so no bomb blows up on the spot and no reload is spent).
  const version = s.terrain.version;
  const rockets = s.rockets.length;
  const events = run(s, 90, () => [false, true]);
  assert.equal(only(events, "ghost-bomb-dropped").length, 0);
  assert.equal(only(events, "ghost-bomb-hit").length, 0);
  assert.equal(only(events, "crater").length, 0);
  assert.equal(s.terrain.version, version);
  assert.equal(s.rockets.length, rockets);
  assert.equal(ghost.reloadTicks, 0);
  assert.equal(s.castles[1]?.stats.ghostBombs, 0);

  // Out of the rock, the same press drops, from the open air.
  fillRect(s.terrain, ...band, "air");
  assert.equal(isGhostLoaded(ghost, s.terrain), true);
  assert.ok(predictGhostBomb(s, 1));
  const dropped = only(step(s, [false, true]).slice(), "ghost-bomb-dropped");
  assert.equal(dropped.length, 1);
  assert.equal(s.castles[1]?.stats.ghostBombs, 1);
});

test("predictGhostBomb is null exactly at the ticks the blimp is inside rock", () => {
  const { s, ghost } = withGhost(23);
  assert.ok(ghost);
  // Rock over a stretch of the flight line ahead of the blimp, so it flies in and out of it.
  const ahead = ghost.x + Math.sign(ghost.vx) * 300;
  const [x0, x1] = [Math.min(ahead, ahead + 400), Math.max(ahead, ahead + 400)];
  fillRect(s.terrain, x0, ghost.y - 30, x1, ghost.y + 30, "rock");
  let inRock = 0;
  let open = 0;
  for (let k = 0; k <= 600; k += 3) {
    const p = ghostPositionAt(ghost, s.tick + k);
    const blocked = solidAt(s.terrain, p.x, p.y);
    if (blocked) inRock++;
    else open++;
    assert.equal(predictGhostBomb(s, 1, k) === null, blocked, `tick +${k}`);
  }
  assert.ok(inRock > 20 && open > 20, `${inRock} in rock, ${open} in the open`);
});

test("ghost bombs hit castles and carve craters, but gates and crates ignore them", () => {
  const s = createRound({ seed: 24, playerCount: 3 });
  clearSky(s);
  openWorld(s);
  const t = s.tuning;
  const target = s.castles[2];
  assert.ok(target);
  s.castles[1]!.alive = false;
  const c = castleCenter(target);
  // A gate and a crate in the way.
  placeGate(s, c.x, c.y - 200, 10);
  s.crates.push({
    id: 998,
    card: "unit",
    x: c.x,
    y: c.y - 300,
    baseY: c.y - 300,
    bobPhase: 0,
    radius: 20,
    spawnTick: 0,
  });
  addRocket(s, { owner: 1, ghost: true, x: c.x, y: c.y - 400, vy: 60 });
  const events = run(s, 120);
  assert.equal(only(events, "gate-split").length, 0);
  assert.equal(only(events, "crate-taken").length, 0);
  const hit = only(events, "ghost-bomb-hit");
  assert.equal(hit.length, 1);
  assert.deepEqual(hit[0]?.castleIds, [2]);
  assert.equal(hit[0]?.damage, t.ghostBombDamage);
  assert.equal(target.hp, target.maxHp - t.ghostBombDamage);
  assert.equal(s.castles[1]?.stats.ghostDamage, t.ghostBombDamage);
  assert.equal(s.castles[1]?.stats.damageDealt, t.ghostBombDamage);

  // On rock away from everyone: a ghost-sized crater, no damage.
  fillRect(s.terrain, 700, 1000, 900, 1100, "rock");
  const version = s.terrain.version;
  addRocket(s, { owner: 1, ghost: true, x: 800, y: 60, vy: 60 });
  const ground = run(s, 200);
  const crater = only(ground, "crater")[0];
  assert.equal(crater?.radius, t.ghostCraterRadius);
  assert.ok(s.terrain.version > version);
  const miss = only(ground, "ghost-bomb-hit")[0];
  assert.ok(miss && Math.abs(miss.x - crater.x) < 1e-9);
});

test("ghosts cannot win: the last castle standing wins while ghosts fly", () => {
  const { s } = withGhost(25);
  const last = s.castles[2];
  assert.ok(last);
  last.hp = 1;
  const c = castleCenter(last);
  addRocket(s, { owner: 0, x: c.x, y: c.y - 40, vy: 600 });
  run(s, 10);
  assert.equal(s.result?.winner, 0);
  assert.equal(s.result?.reason, "last-standing");
  assert.equal(s.ghosts.length, 2);
  const after = run(s, 600, () => [true, true, true]);
  assert.equal(
    only(after, "ghost-bomb-dropped").length,
    0,
    "no drops after the round",
  );
});

function bots(seed: number, kinds: readonly BotDifficulty[]) {
  const all = kinds.map((difficulty, playerId) =>
    createBot({ difficulty, playerId, seed }),
  );
  return (s: RoundState) => all.map((bot) => bot(s));
}

test("ghost rounds are deterministic and replay from a clone", () => {
  const kinds: BotDifficulty[] = ["hard", "normal", "easy", "hard"];
  const a = playOut({ seed: 31, playerCount: 4 }, bots(31, kinds));
  const b = playOut({ seed: 31, playerCount: 4 }, bots(31, kinds));
  assert.ok(
    a.castles.some((c) => c.stats.ghostBombs > 0),
    "no ghost dropped",
  );
  assert.equal(fingerprint(a), fingerprint(b));

  // Everyone mashes their button: castles fire and ghosts drop whenever loaded (a short first reload, so they do
  // before mashing ends the round; a blimp inside rock waits until it is out).
  const mash = (st: RoundState) => st.castles.map(() => true);
  const c = createRound({
    seed: 32,
    playerCount: 5,
    tuning: { ghostFirstReload: 1 },
  });
  while (c.ghosts.length < 2 && !c.result) step(c, mash(c));
  assert.equal(c.result, null);
  const d = structuredClone(c);
  run(c, 1200, mash);
  run(d, 1200, mash);
  assert.ok(c.castles.some((k) => k.stats.ghostBombs > 0));
  assert.equal(fingerprint(d), fingerprint(c));
});

test("balance: bot rounds with ghosts end in similar time and ghosts do not dominate", () => {
  const kinds: BotDifficulty[] = [
    "normal",
    "hard",
    "easy",
    "normal",
    "hard",
    "easy",
  ];
  const lengths = { on: [] as number[], off: [] as number[] };
  let ghost = 0;
  let total = 0;
  // Until gunships fly, most rounds end in sudden death, so this is a smoke check more than a balance measure.
  for (const players of [3, 5]) {
    for (const seed of [1, 2]) {
      for (const on of [true, false]) {
        const s = playOut(
          { seed, playerCount: players, tuning: { ghosts: on } },
          bots(seed, kinds.slice(0, players)),
        );
        assert.ok(
          s.result && s.result.tick < s.maxTicks,
          `${players}p seed ${seed} hit the hard stop`,
        );
        (on ? lengths.on : lengths.off).push(s.result.tick / TICK_HZ);
        if (!on) continue;
        for (const c of s.castles) {
          ghost += c.stats.ghostDamage;
          total += c.stats.damageDealt;
        }
      }
    }
  }
  const median = (xs: number[]) =>
    [...xs].sort((a, b) => a - b)[xs.length >> 1] ?? 0;
  const [on, off] = [median(lengths.on), median(lengths.off)];
  assert.ok(
    on <= off * 1.1 && on >= off * 0.6,
    `median ${on}s with ghosts vs ${off}s without`,
  );
  const share = ghost / total;
  assert.ok(share > 0.005 && share < 0.25, `ghost damage share ${share}`);
});

test("ghost bombs bypass the rocket cap, so a loaded press always drops", () => {
  const { s, ghost } = withGhost(23, { maxRockets: 40, splitReserve: 0 });
  assert.ok(ghost);
  while (!isGhostLoaded(ghost, s.terrain)) step(s);
  // Fill the cap with rockets that leave the arena during the same step.
  while (s.rockets.length < s.tuning.maxRockets)
    addRocket(s, { owner: 0, x: -1000, y: 100 });
  const dropped = only(step(s, [false, true]).slice(), "ghost-bomb-dropped");
  assert.equal(dropped.length, 1);
  assert.ok(s.rockets.some((r) => r.id === dropped[0]?.rocketId && r.ghost));
  assert.equal(s.castles[1]?.stats.ghostBombs, 1);
});

test("ghost bombs landing after the round emit no ghost-bomb-hit or damage", () => {
  const { s } = withGhost(25);
  const last = s.castles[2];
  const winner = s.castles[0];
  assert.ok(last && winner);
  last.hp = 1;
  const lc = castleCenter(last);
  addRocket(s, { owner: 0, x: lc.x, y: lc.y - 40, vy: 600 });
  run(s, 10);
  assert.equal(s.phase, "over");
  const hp = winner.hp;
  const wc = castleCenter(winner);
  // One bomb straight onto the winner, one onto rock away from everyone.
  openWorld(s);
  fillRect(s.terrain, 700, 1000, 900, 1100, "rock");
  addRocket(s, { owner: 1, ghost: true, x: wc.x, y: wc.y - 40, vy: 600 });
  addRocket(s, { owner: 1, ghost: true, x: 800, y: 60, vy: 60 });
  const after: TickEvent[] = [];
  for (let i = 0; i < 200; i++) after.push(...step(s));
  assert.equal(only(after, "ghost-bomb-hit").length, 0);
  assert.equal(only(after, "hit").length, 0);
  assert.ok(only(after, "crater").length >= 1, "the aftermath still craters");
  assert.equal(winner.hp, hp);
  assert.equal(s.castles[1]?.stats.ghostDamage, 0);
});

test("two castles destroyed on the same tick each get exactly one ghost", () => {
  const s = createRound({ seed: 26, playerCount: 4 });
  clearSky(s);
  for (const id of [1, 2]) {
    const c = s.castles[id];
    assert.ok(c);
    c.hp = 1;
    const p = castleCenter(c);
    // Castle 1 takes two rockets on the killing tick.
    for (let k = 0; k < (id === 1 ? 2 : 1); k++)
      addRocket(s, { owner: 0, x: p.x, y: p.y - 40, vy: 600 });
  }
  const events = run(s, 10);
  const destroyed = only(events, "castle-destroyed");
  assert.deepEqual(destroyed.map((e) => e.castleId).sort(), [1, 2]);
  assert.equal(destroyed[0]?.tick, destroyed[1]?.tick);
  const spawned = only(events, "ghost-spawned");
  assert.deepEqual(spawned.map((e) => e.owner).sort(), [1, 2]);
  assert.ok(spawned.every((e) => e.tick === destroyed[0]?.tick));
  assert.deepEqual(s.ghosts.map((g) => g.owner).sort(), [1, 2]);
  assert.equal(s.result, null);
});

test("a castle killed by a sudden-death bomb gets a ghost", () => {
  const s = createRound({ seed: 27, playerCount: 3 });
  clearSky(s);
  const victim = s.castles[1];
  assert.ok(victim);
  victim.hp = 1;
  const c = castleCenter(victim);
  addRocket(s, { owner: -1, bomb: true, x: c.x, y: c.y - 40, vy: 600 });
  const events = run(s, 10);
  const destroyed = only(events, "castle-destroyed");
  assert.equal(destroyed.length, 1);
  assert.equal(destroyed[0]?.by, -1);
  assert.deepEqual(
    only(events, "ghost-spawned").map((e) => e.owner),
    [1],
  );
  assert.ok(ghostOf(s, 1));
});

test("a press on the tick of death does not drop a ghost bomb", () => {
  const s = createRound({ seed: 21, playerCount: 3 });
  clearSky(s);
  const victim = s.castles[1];
  assert.ok(victim);
  victim.hp = 1;
  const c = castleCenter(victim);
  addRocket(s, { owner: 0, x: c.x, y: c.y - 40, vy: 600 });
  const press = () => [false, true, false];
  let events: readonly TickEvent[] = [];
  for (let i = 0; i < 10 && !ghostOf(s, 1); i++) events = step(s, press());
  assert.equal(only(events.slice(), "castle-destroyed").length, 1);
  assert.equal(only(events.slice(), "ghost-bomb-dropped").length, 0);
  const ghost = ghostOf(s, 1);
  assert.ok(ghost && !isGhostLoaded(ghost, s.terrain));
  // Mashing through the first reload drops nothing until the ghost is loaded.
  let drops = 0;
  while (!isGhostLoaded(ghost, s.terrain))
    drops += only(step(s, press()).slice(), "ghost-bomb-dropped").length;
  assert.equal(drops, 0);
  assert.equal(only(step(s, press()).slice(), "ghost-bomb-dropped").length, 1);
});
