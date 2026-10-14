import test from "node:test";
import assert from "node:assert/strict";
import {
  createMatch,
  createRound,
  FIRE,
  GUNSHIP_FLIGHT,
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

// Bots inside the round (`RoundConfig.bots`, memory in `state.bots`): they fly and fight, keep off rock, are ordered
// by difficulty, stay cheap, and a clone (what rollback restores) carries everything a bot remembers.

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
    [{ id: 0, difficulty: "easy" }, { id: 0, difficulty: "hard" }], [{ id: 1, difficulty: "insane" }], [{ id: 1 }], [null],
    Array(1)];
  for (const bots of bad) {
    const config = { seed: 1, playerCount: 2, bots } as unknown as RoundConfig;
    assert.throws(() => createRound(config), RangeError, JSON.stringify(bots));
    assert.throws(() => createMatch(config), RangeError, JSON.stringify(bots));
  }
  // prettier-ignore
  const a = createRound({ seed: 3, playerCount: 4, bots: [{ id: 2, difficulty: "hard" }, { id: 0, difficulty: "easy" },
    { id: 3, difficulty: "normal" }], tuning: { castleHp: [0, 0, 0, 0, 40] } });
  assert.deepEqual(
    a.bots.map((m) => m.id + m.difficulty),
    ["0easy", "2hard", "3normal"],
  );
  const b = structuredClone(a);
  while (!a.result) {
    step(a, [0, LEFT, 0]);
    step(b, [FIRE | LEFT, LEFT, NaN, 31]);
  }
  const flew = a.ghosts.some((g) => g.owner !== 1 && g.spawnTick < a.tick - 60);
  assert.ok(flew, "a bot's ghost flew");
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
  const rim = GUNSHIP_FLIGHT.shape.radius + 2; // rock this near the hull centre touches it
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
        const touch = circleOverlapsSolid(s.terrain, c.x, c.y, rim);
        streak[c.id] = touch ? streak[c.id]! + 1 : 0;
        if (touch) touching++;
        longest = Math.max(longest, streak[c.id]!);
      }
    }
    assert.ok(touching / flying < 0.02, `seed ${seed}: ${touching}/${flying}`);
    assert.ok(longest < TICK_HZ, `seed ${seed}: ${longest} ticks on rock`);
  }
});

test("better bots beat worse ones in most seeded duels", () => {
  const pairs = [
    ["hard", "easy"],
    ["normal", "easy"],
    ["hard", "normal"],
  ] as const;
  for (const [better, worse] of pairs) {
    let wins = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const seat = seed % 2; // swap seats every round
      const s = playOut(
        botRound(seed, ...(seat ? [worse, better] : [better, worse])),
        nobody,
      );
      if (s.result?.winner === seat) wins++;
    }
    assert.ok(wins >= 9, `${better} beat ${worse} only ${wins}/12`);
  }
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

test("cost: six hard bots flying and fighting stay cheap (a runaway check, not a benchmark)", () => {
  const s = createRound(botRound(3, ...Array<BotDifficulty>(6).fill("hard")));
  const start = process.cpuUsage();
  while (!s.result) step(s);
  const elapsed = process.cpuUsage(start);
  const perStep = (elapsed.user + elapsed.system) / 1000 / s.tick;
  // About 0.05 ms a step on a desktop (preview/step-cost.ts); 2 ms only catches a runaway.
  // Count this process's work, including runtime/coverage overhead, rather than time waiting
  // for a CPU while other test workers run. The synchronous loop cannot hide work in a wait.
  assert.ok(perStep < 2, `${perStep.toFixed(3)} CPU ms a step`);
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
