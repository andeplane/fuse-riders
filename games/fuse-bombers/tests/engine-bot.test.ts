import test from "node:test";
import assert from "node:assert/strict";
import {
  createMatch,
  createRound,
  FIRE,
  LEFT,
  segmentHit,
  step,
  TICK_HZ,
  type BotDifficulty,
  type RoundConfig,
  type RoundState,
} from "../src/engine/index.js";
import { circleOverlapsSolid } from "../src/engine/grid.js";
import { buildTempleGrid, TEMPLE_FLYWAY } from "../src/engine/temple-map.js";
import { fingerprint, playOut } from "./engine-helpers.js";

// Bots inside the round: `RoundConfig.bots` names the seats the engine plays,
// and each bot's memory lives in `state.bots`. These pin that bots fly and
// fight, keep off rock, are ordered by difficulty, stay cheap, and that a clone
// (what rollback restores) carries everything a bot remembers.

const botRound = (seed: number, ...kinds: BotDifficulty[]): RoundConfig => ({
  seed,
  playerCount: kinds.length,
  bots: kinds.map((difficulty, id) => ({ id, difficulty })),
});
const nobody = () => [];
const gap = ({ castles: [a, b] }: RoundState) =>
  Math.hypot(a!.x - b!.x, a!.y - b!.y);

test("bot seats are validated, and what held says for them is ignored", () => {
  // prettier-ignore
  const bad = [{}, [{ id: 2, difficulty: "easy" }], [{ id: -1, difficulty: "easy" }], [{ id: 0.5, difficulty: "hard" }],
    [{ id: 0, difficulty: "easy" }, { id: 0, difficulty: "hard" }], [{ id: 1, difficulty: "insane" }], [{ id: 1 }], [null]];
  for (const bots of bad) {
    const config = { seed: 1, playerCount: 2, bots } as unknown as RoundConfig;
    assert.throws(() => createRound(config), RangeError, JSON.stringify(bots));
    assert.throws(() => createMatch(config), RangeError, JSON.stringify(bots));
  }
  // prettier-ignore
  const a = createRound({ seed: 3, playerCount: 3, bots: [{ id: 2, difficulty: "hard" }, { id: 0, difficulty: "easy" }] });
  assert.deepEqual(
    a.bots.map((m) => m.id + m.difficulty),
    ["0easy", "2hard"],
  );
  const b = structuredClone(a);
  for (let i = 0; i < 900; i++) {
    step(a, [0, LEFT, 0]);
    step(b, [FIRE | LEFT, LEFT, NaN]);
  }
  assert.ok(a.castles[0]!.stats.volleys > 0, "the bot seats played");
  assert.equal(fingerprint(b), fingerprint(a));
});

test("bots fly at each other from across the map, fire and hit", () => {
  for (const seed of [5, 6]) {
    const s = createRound(botRound(seed, "normal", "normal"));
    const start = gap(s);
    let closest = start;
    while (!s.result && s.tick < 60 * TICK_HZ) {
      step(s);
      closest = Math.min(closest, gap(s));
    }
    assert.ok(start > 1500 && closest < 800, `${start} px, closest ${closest}`);
    for (const c of s.castles)
      assert.ok(c.stats.volleys > 3 && c.stats.damageDealt > 0, `${c.id}`);
  }
});

test("bots keep off rock: they seldom touch it and never hug it for long", () => {
  for (const seed of [1, 2, 3]) {
    const s = createRound(
      botRound(seed, "hard", "normal", "easy", "hard", "normal", "easy"),
    );
    const streak = s.castles.map(() => 0);
    let [touching, flying, longest] = [0, 0, 0];
    while (!s.result) {
      step(s);
      for (const c of s.castles) {
        if (!c.alive) continue;
        flying++;
        const touch = circleOverlapsSolid(s.terrain, c.x, c.y, 32);
        streak[c.id] = touch ? streak[c.id]! + 1 : 0;
        if (touch) touching++;
        longest = Math.max(longest, streak[c.id]!);
      }
    }
    assert.ok(touching / flying < 0.02, `seed ${seed}: ${touching}/${flying}`);
    assert.ok(longest < TICK_HZ, `seed ${seed}: ${longest} ticks on rock`);
  }
});

test("hard bots beat easy bots in most seeded duels", () => {
  let hardWins = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const hard = seed % 2; // swap seats every round
    const kinds: BotDifficulty[] = hard ? ["easy", "hard"] : ["hard", "easy"];
    const s = playOut(botRound(seed, ...kinds), nobody);
    if (s.result?.winner === hard) hardWins++;
  }
  assert.ok(hardWins >= 9, `hard won only ${hardWins}/12`);
});

test("bots press only when loaded: every press fires a volley or drops a bomb", () => {
  for (const kind of ["easy", "normal", "hard"] as const) {
    let presses = 0;
    const s = createRound(botRound(8, kind, kind, kind, kind));
    while (!s.result) {
      const before = [...s.lastHeld];
      step(s);
      for (const [id, bits] of s.lastHeld.entries())
        if (bits & FIRE && !(before[id]! & FIRE)) presses++;
    }
    let fired = 0;
    for (const c of s.castles) fired += c.stats.volleys + c.stats.ghostBombs;
    assert.ok(presses > 20, `${kind}: ${presses} presses`);
    assert.equal(fired, presses, `${kind}: a press did not fire`);
  }
});

test("rollback: a clone taken mid-round, bot memory and all, continues bit for bit", () => {
  // A human steers seat 0 by a script; the engine plays the other three.
  const config: RoundConfig = {
    seed: 77,
    playerCount: 4,
    bots: [1, 2, 3].map((id) => ({ id, difficulty: "hard" as const })),
  };
  const script = (s: RoundState) => [
    ((s.tick >> 6) & 15) | (s.tick % 50 ? 0 : FIRE),
  ];
  const s = createRound(config);
  const clones: RoundState[] = [];
  let pending = false;
  while (s.tick < 3600 && !s.result) {
    // Odd ticks across the round, and the first a bot waits to press (mid-plan).
    const waiting: boolean =
      !pending && s.bots.some((m) => m.pressTick > s.tick);
    if (s.tick % 613 === 101 || waiting) clones.push(structuredClone(s));
    pending ||= waiting;
    step(s, script(s));
  }
  assert.ok(pending && clones.length >= 4);
  assert.deepEqual(JSON.parse(JSON.stringify(s.bots)), s.bots, "plain data");
  for (const c of clones) {
    const from = c.tick;
    while (c.tick < s.tick) step(c, script(c));
    assert.equal(fingerprint(c), fingerprint(s), `replayed from tick ${from}`);
  }
});

test("cost: six hard bots flying and fighting stay far under a millisecond a step", () => {
  const s = createRound(botRound(3, ...Array<BotDifficulty>(6).fill("hard")));
  const start = performance.now();
  while (!s.result) step(s);
  const perStep = (performance.now() - start) / s.tick;
  // About 0.06 ms on a desktop (preview/step-cost.ts); this only catches a runaway.
  assert.ok(perStep < 2, `${perStep.toFixed(3)} ms a step`);
});

test("the flyway: open sky with room, each point in sight of the next along a gunship-wide lane", () => {
  const grid = buildTempleGrid();
  for (const [i, a] of TEMPLE_FLYWAY.entries()) {
    const b = TEMPLE_FLYWAY[(i + 1) % TEMPLE_FLYWAY.length]!;
    assert.ok(!circleOverlapsSolid(grid, a.x, a.y, 100), `point ${i}`);
    const [dx, dy] = [b.x - a.x, b.y - a.y];
    const d = Math.hypot(dx, dy);
    for (const side of [-40, 0, 40]) {
      const [ox, oy] = [(-dy / d) * side, (dx / d) * side];
      const hit = segmentHit(grid, a.x + ox, a.y + oy, b.x + ox, b.y + oy);
      assert.equal(hit, null, `point ${i} to the next`);
    }
  }
});
