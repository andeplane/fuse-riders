import { writeFile } from "node:fs/promises";
import { cpus, platform, arch } from "node:os";
import { performance } from "node:perf_hooks";
import {
  advance,
  createMatch,
  candidateVector,
  traceShot,
  UNIT,
  WINDS,
  RULES,
  type Match,
} from "fuse-birds-game";

const make = (seed: number, count: number) =>
  createMatch(
    "map-check",
    seed,
    Array.from({ length: count }, (_, i) => ({
      id: `p${i}`,
      name: `Bird ${i}`,
    })),
  );
const times: number[] = [];
const maps: {
  seed: number;
  count: number;
  phase: Match["phase"];
  attempt: number;
  work: number;
  ticks: number;
}[] = [];
for (let seed = 1; seed <= 100; seed++)
  for (const count of [2, 3, 4, 5]) {
    const state = make(seed, count);
    while (state.phase === "preparing" && state.tick < 1000) {
      const start = performance.now();
      advance(state);
      times.push(performance.now() - start);
    }
    maps.push({
      seed,
      count,
      phase: state.phase,
      attempt: state.preparation.attempt,
      work: state.preparation.work,
      ticks: state.tick,
    });
  }
const empty = make(1, 2);
empty.terrain.bits.fill(0);
const missing: {
  x: number;
  targetX: number;
  y: number;
  targetY: number;
  wind: number;
}[] = [];
let rangeCases = 0;
for (const x of [10, 256, 768, 1280, 1526])
  for (const targetX of [10, 256, 768, 1280, 1526])
    for (const y of [329, 500, 698])
      for (const targetY of [329, 500, 698])
        for (const wind of WINDS) {
          if (x === targetX && y === targetY) continue;
          rangeCases++;
          const from = { ...empty.players[0]!, x: x * UNIT, y: y * UNIT },
            to = { ...empty.players[1]!, x: targetX * UNIT, y: targetY * UNIT };
          let hit = false;
          for (let candidate = 0; candidate < 201 && !hit; candidate++) {
            const vector = candidateVector(from, to, wind, candidate);
            if (vector)
              hit = traceShot(
                empty.terrain,
                [from, to],
                from,
                vector,
                wind,
                to.id,
              ).hit;
          }
          if (!hit) missing.push({ x, targetX, y, targetY, wind });
        }
times.sort((a, b) => a - b);
const report = {
  rules: RULES,
  command: "pnpm exec tsx scripts/fuse-birds-map-check.ts",
  runtime: process.version,
  device: { platform: platform(), arch: arch(), cpu: cpus()[0]?.model },
  mapCount: maps.length,
  failures: maps.filter((m) => m.phase !== "aiming"),
  retries: maps.filter((m) => m.attempt > 0).length,
  fallbacks: maps.filter((m) => m.attempt === 4).length,
  maxWork: Math.max(...maps.map((m) => m.work)),
  preparationTickMs: {
    p50: times[Math.floor(times.length * 0.5)],
    p95: times[Math.floor(times.length * 0.95)],
    max: times.at(-1),
  },
  rangeCases,
  noWitnessInCandidateCatalog: missing,
  maps,
  limits:
    "Timing is Node on this machine, not a physical phone. Missing catalog witnesses require investigation; this incomplete search is not proof that all legal vectors fail. It excludes terrain cover and post-destruction escape.",
};
await writeFile(
  "/tmp/fuse-birds-map-check.json",
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify(
    { ...report, maps: undefined, noWitnessInCandidateCatalog: missing.length },
    null,
    2,
  ),
);
if (report.failures.length || missing.length) process.exitCode = 1;
