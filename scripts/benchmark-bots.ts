import { performance } from "node:perf_hooks";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { BotController } from "../src/engine/bot-controller.js";
import {
  createGame,
  addPlayer,
  startMatch,
  step,
  SLOT_COLORS,
} from "../src/engine/game.js";
import { classicSettings } from "../tests/fixtures/classic-settings.js";
const results = [];
for (const trailsPerRider of [0, 160, 800]) {
  const game = createGame("bot-benchmark", classicSettings());
  for (let slot = 0; slot < 5; slot++)
    addPlayer(game, {
      id: slot ? "bot:" + slot : "human",
      name: "Rider " + slot,
      slot,
      color: SLOT_COLORS[slot]!,
    });
  startMatch(game);
  for (let tick = 0; tick < 60; tick++) step(game, new Map());
  for (const [slot, player] of [...game.players.values()].entries()) {
    player.trail = Array.from({ length: trailsPerRider }, (_, i) => ({
      x1: 40 + (i % 40) * 38,
      y1: 40 + Math.floor(i / 40) * 38 + slot,
      x2: 54 + (i % 40) * 38,
      y2: 46 + Math.floor(i / 40) * 38 + slot,
      createdTick: 0,
      expiresAtTick: 2000,
    }));
  }
  const controller = new BotController(),
    samples = [];
  for (let i = 0; i < 550; i++) {
    game.tick++;
    const before = performance.now();
    for (let slot = 1; slot < 5; slot++) controller.input(game, "bot:" + slot);
    const elapsed = performance.now() - before;
    if (i >= 50) samples.push(elapsed);
  }
  const ordered = [...samples].sort((a, b) => a - b),
    at = (p: number) => ordered[Math.floor((ordered.length - 1) * p)]!;
  results.push({
    trailsPerRider,
    totalTrails: trailsPerRider * 5,
    bots: 4,
    samples,
    p50Ms: at(0.5),
    p95Ms: at(0.95),
    p99Ms: at(0.99),
    maxMs: Math.max(...samples),
  });
}
await mkdir("artifacts", { recursive: true });
const report = {
  revision: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  controllerSha256: createHash("sha256")
    .update(
      await readFile(
        new URL("../src/engine/bot-controller.ts", import.meta.url),
      ),
    )
    .digest("hex"),
  date: new Date().toISOString(),
  environment: `${process.platform}/${process.arch} ${process.version}`,
  method:
    "Four deterministic AI control decisions per sample over a fixed five-rider arena, 50 warmups + 500 samples per trail workload; no simulation, rendering, network or physical phone timing included.",
  results,
};
await writeFile(
  "artifacts/bot-benchmark.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    { ...report, results: results.map(({ samples, ...summary }) => summary) },
    null,
    2,
  ),
);
