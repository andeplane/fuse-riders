import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createBot,
  createRound,
  gridHash,
  isLoaded,
  step,
  type BotDifficulty,
  type RoundState,
} from "../src/engine/index.js";
import { buildTempleGrid } from "../src/engine/temple-map.js";
import { fingerprint, playOut } from "./engine-helpers.js";

// Complements tests/architecture.test.ts (imports and engine-dependent Math): the engine must not reach for
// ambient nondeterminism either. Randomness comes from the seeded RNG, time from the fixed step.

const engineDir = fileURLToPath(new URL("../src/engine", import.meta.url));

function engineFiles(dir = engineDir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return engineFiles(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

test("the engine uses no wall clock, Math.random or DOM globals", () => {
  const banned = [
    /Math\.random/,
    /\bDate\b/,
    /\bperformance\./,
    /\bwindow\./,
    /\bdocument\./,
    /\bsetTimeout\b/,
    /\brequestAnimationFrame\b/,
  ];
  const files = engineFiles();
  assert.ok(files.length > 0);
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const pattern of banned) {
      assert.doesNotMatch(source, pattern, `${file} uses ${pattern}`);
    }
  }
});

test("same seed and inputs give the same round; different seeds differ", () => {
  const script = (s: RoundState) =>
    s.castles.map((c) => isLoaded(c) && (s.tick + c.id * 7) % 11 === 0);
  const a = createRound({ seed: 1234, playerCount: 5 });
  const b = createRound({ seed: 1234, playerCount: 5 });
  assert.equal(fingerprint(a), fingerprint(b));
  for (let i = 0; i < 4000; i++) {
    step(a, script(a));
    step(b, script(b));
  }
  assert.equal(fingerprint(a), fingerprint(b));
  assert.ok(
    a.rockets.length > 0 || a.castles.some((c) => c.stats.rocketsFired > 0),
  );

  const c = createRound({ seed: 1235, playerCount: 5 });
  assert.notEqual(
    fingerprint(c),
    fingerprint(createRound({ seed: 1234, playerCount: 5 })),
  );
});

test("a cloned round replays identically", () => {
  const script = (s: RoundState) => s.castles.map((c) => isLoaded(c));
  const a = createRound({ seed: 77, playerCount: 4 });
  for (let i = 0; i < 1500; i++) step(a, script(a));
  const b = structuredClone(a);
  for (let i = 0; i < 1500; i++) {
    step(a, script(a));
    step(b, script(b));
  }
  assert.equal(fingerprint(b), fingerprint(a));
});

test("a full bot round on the temple replays bit for bit: same result, same carved grid", () => {
  const kinds: BotDifficulty[] = ["hard", "easy", "normal", "hard"];
  const play = () => {
    const bots = kinds.map((difficulty, playerId) =>
      createBot({ difficulty, playerId, seed: 5 }),
    );
    return playOut({ seed: 2026, playerCount: kinds.length }, (s) =>
      bots.map((bot) => bot(s)),
    );
  };
  const [a, b] = [play(), play()];
  assert.ok(a.result);
  assert.deepEqual(b.result, a.result);
  assert.equal(gridHash(b.terrain), gridHash(a.terrain));
  assert.notEqual(gridHash(a.terrain), gridHash(buildTempleGrid()), "carved");
  assert.equal(fingerprint(b), fingerprint(a));
});
