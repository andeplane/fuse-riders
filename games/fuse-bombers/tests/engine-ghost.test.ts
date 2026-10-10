import test from "node:test";
import assert from "node:assert/strict";
import {
  DOWN,
  FIRE,
  LEFT,
  TICK_HZ,
  UP,
  WORLD_HEIGHT,
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
  held,
  openWorld,
  placeGate,
  playOut,
  type Inputs,
} from "./engine-helpers.js";

// Ghost bombers: eliminated players fly a blimp from above their wreck, through rock, and drop bombs.

function run(
  state: RoundState,
  ticks: number,
  inputs: (s: RoundState) => Inputs = () => [],
): TickEvent[] {
  const all: TickEvent[] = [];
  for (let i = 0; i < ticks && !state.result; i++)
    all.push(...step(state, held(inputs(state))));
  return all;
}

/** Everyone mashes fire: pressed on every other tick, so each press is a rising edge. */
const mash = (s: RoundState) => s.castles.map(() => s.tick % 2 === 0);

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
  return { s, events, ghost: s.ghosts.find((g) => g.owner === 1) };
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

test("ghosts fly on the held directions, through rock, to the world's edge; let go, they coast as ghostPositionAt says", () => {
  const { s, ghost } = withGhost();
  assert.ok(ghost);
  const [x, y] = [ghost.x, ghost.y];
  run(s, 30, () => [0, LEFT | UP]);
  assert.ok(ghost.x < x - 40 && ghost.y < y - 40 && ghost.thrust === 5);
  const coast = ghostPositionAt(ghost, 120);
  run(s, 120);
  assert.deepEqual(
    [ghost.x, ghost.y, ghost.vx, ghost.vy],
    [coast.x, coast.y, 0, 0],
  );
  // Straight down through the middle of the temple, to the bottom edge.
  Object.assign(ghost, { x: WORLD_WIDTH / 2, y: 100 });
  let inRock = 0;
  for (let i = 0; i < TICK_HZ * 14; i++) {
    run(s, 1, () => [0, DOWN]);
    if (solidAt(s.terrain, ghost.x, ghost.y)) inRock++;
  }
  assert.ok(inRock > 60, `${inRock} ticks in rock`);
  assert.ok(ghost.y < WORLD_HEIGHT && ghost.y > WORLD_HEIGHT - 25);
});

test("pressing drops one bomb per reload; it lands where predictGhostBomb says, also coasting", () => {
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
  // Thrown sideways (toward the temple), the blimp coasts 10 ticks and drops: from there, with its velocity.
  ghost.vx = -200;
  const predicted = predictGhostBomb(s, 1, 10);
  assert.ok(predicted);
  run(s, 10);
  const [x, vx] = [ghost.x, ghost.vx];
  const dropped = only(step(s, [0, FIRE]).slice(), "ghost-bomb-dropped");
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0]?.x, x);
  const bomb = s.rockets.find((r) => r.id === dropped[0]?.rocketId);
  assert.ok(bomb?.ghost && bomb.vx === vx && !bomb.bomb);
  assert.ok(ghost.reloadTicks > 0);
  const events = run(s, 400, (st) => [0, st.tick % 2 === 0]);
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
  // A band of indestructible rock round the blimp, as in the temple's hall.
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
  const events = run(s, 90, (st) => [0, st.tick % 2 === 0]);
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
  step(s);
  const dropped = only(step(s, [0, FIRE]).slice(), "ghost-bomb-dropped");
  assert.equal(dropped.length, 1);
  assert.equal(s.castles[1]?.stats.ghostBombs, 1);
});

test("predictGhostBomb is null exactly at the ticks the coasting blimp is inside rock", () => {
  const { s, ghost } = withGhost(23);
  assert.ok(ghost);
  // Rock across the blimp's coast (about 90 px from 260 px/s), so it flies into it and out again.
  ghost.vx = 260;
  fillRect(s.terrain, ghost.x + 25, ghost.y - 30, ghost.x + 55, ghost.y + 30);
  let inRock = 0;
  let open = 0;
  for (let k = 0; k <= 120; k++) {
    const p = ghostPositionAt(ghost, k);
    const blocked = solidAt(s.terrain, p.x, p.y);
    if (blocked) inRock++;
    else open++;
    assert.equal(predictGhostBomb(s, 1, k) === null, blocked, `tick +${k}`);
  }
  assert.ok(inRock > 5 && open > 20, `${inRock} in rock, ${open} in the open`);
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
  const after = run(s, 600, mash);
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
  // (Bots do not steer yet, so their ghosts hover above the wreck and seldom drop; the mashing below drops.)
  assert.equal(fingerprint(a), fingerprint(b));

  // Everyone mashes their button: castles fire and ghosts drop whenever loaded (a short first reload, so they do
  // before mashing ends the round; a blimp inside rock waits until it is out).
  const c = createRound({
    seed: 32,
    playerCount: 5,
    tuning: { ghostFirstReload: 1 },
  });
  while (c.ghosts.length < 2 && !c.result) step(c, held(mash(c)));
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
  // Bots do not steer yet, so their ghosts hover where they appear and seldom hit; once bots fly, ghosts should
  // again deal a small share (it was over 0.5 % when they drifted across the map).
  assert.ok(share < 0.25, `ghost damage share ${share}`);
});

test("ghost bombs bypass the rocket cap, so a loaded press always drops", () => {
  const { s, ghost } = withGhost(23, { maxRockets: 40, splitReserve: 0 });
  assert.ok(ghost);
  while (!isGhostLoaded(ghost, s.terrain)) step(s);
  // Fill the cap with rockets that leave the arena during the same step.
  while (s.rockets.length < s.tuning.maxRockets)
    addRocket(s, { owner: 0, x: -1000, y: 100 });
  const dropped = only(step(s, [0, FIRE]).slice(), "ghost-bomb-dropped");
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
  // The rocket strikes on the first step, which is also a fresh press.
  const events = step(s, [0, FIRE, 0]).slice();
  assert.equal(only(events, "castle-destroyed").length, 1);
  assert.equal(only(events, "ghost-bomb-dropped").length, 0);
  const ghost = ghostOf(s, 1);
  assert.ok(ghost && !isGhostLoaded(ghost, s.terrain));
  // Mashing through the first reload drops nothing until the ghost is loaded.
  let drops = 0;
  while (!isGhostLoaded(ghost, s.terrain))
    drops += only(
      run(s, 1, (st) => [0, st.tick % 2 === 0]),
      "ghost-bomb-dropped",
    ).length;
  assert.equal(drops, 0);
  step(s);
  assert.equal(
    only(step(s, [0, FIRE]).slice(), "ghost-bomb-dropped").length,
    1,
  );
});
