import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import {
  RULES,
  createMatch,
  hashState,
  neighbors,
  step,
  type Command,
  type MapDefinition,
  type World,
} from "../games/neural-defence/src/engine/index.ts";

const SEED = 0x4e445030;
const TICKS = 820;
const PLAYERS = ["a", "b", "c", "d"] as const;
const FIRST_CELLS = [10, 11, 50, 51] as const;
const map: MapDefinition = {
  schemaVersion: 1,
  id: "benchmark-8x8",
  width: 8,
  height: 8,
  layout: "odd-r",
  cells: Array.from({ length: 64 }, (_, i) =>
    i === 27
      ? { terrain: "deposit", resourceKind: "biomass" }
      : i === 36
        ? { terrain: "deposit", resourceKind: "insight" }
        : { terrain: "open" },
  ),
  spawns: [9, 12, 49, 52].map((cellIndex, slot) => ({ slot, cellIndex })),
};
const roster = PLAYERS.map((id, slot) => ({ id, slot }));
const initial = () => createMatch(map, { matchId: "phase0-benchmark" }, roster);

function random(seed: number): () => number {
  let state = seed;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function checkParticles(world: World): void {
  assert.ok(world.particles.length <= PLAYERS.length * RULES.particleCount);
  for (const player of world.players) {
    const count = world.particles.filter((p) => p.ownerId === player.id).length;
    assert.equal(count, player.alive ? RULES.particleCount : 0);
  }
}

function run(recorded?: readonly (readonly Command[])[]) {
  let world = initial();
  const nextRandom = random(SEED);
  const commandsByTick: Command[][] = [];
  const eventCounts: Record<string, number> = {};
  let commandsSent = 0;
  let peakParticles = world.particles.length;
  const started = performance.now();
  for (let tick = 1; tick <= TICKS; tick++) {
    const commands: Command[] = recorded ? [...recorded[tick - 1]!] : [];
    if (!recorded) {
      for (const [i, id] of PLAYERS.entries()) {
        const player = world.players.find((p) => p.id === id)!;
        if (!player.alive) continue;
        const issue = (action: Command["action"]) => {
          commands.push({
            playerId: id,
            sequence:
              player.sequence +
              1 +
              commands.filter((c) => c.playerId === id).length,
            matchId: world.matchId,
            action,
          });
        };
        if (tick === 1)
          issue({
            type: "queueConstruction",
            cell: FIRST_CELLS[i]!,
            kind: "neuron",
          });
        if (tick === 401)
          issue({ type: "startResearch", research: "excitation" });
        if (tick >= 160 && tick % 80 === 0) {
          const owned = world.structures.filter(
            (s) => s.ownerId === id && s.kind === "neuron",
          );
          if (owned.length)
            issue({
              type: "setPriority",
              cell: owned[Math.floor(nextRandom() * owned.length)]!.cell,
              weight: 3,
            });
        }
        if (tick >= 241 && (tick - 241) % 160 === 0) {
          const occupied = new Set(world.structures.map((s) => s.cell));
          for (const p of world.players)
            for (const job of p.queue) occupied.add(job.cell);
          const candidates = [
            ...new Set(
              world.structures
                .filter((s) => s.ownerId === id)
                .flatMap((s) => neighbors(map, s.cell)),
            ),
          ].filter(
            (cell) =>
              map.cells[cell]?.terrain === "open" && !occupied.has(cell),
          );
          if (candidates.length)
            issue({
              type: "queueConstruction",
              cell: candidates[Math.floor(nextRandom() * candidates.length)]!,
              kind: "neuron",
            });
        }
      }
    }
    commandsByTick.push(commands);
    commandsSent += commands.length;
    world = step(world, commands);
    checkParticles(world);
    peakParticles = Math.max(peakParticles, world.particles.length);
    for (const outcome of world.outcomes)
      eventCounts[outcome.type] = (eventCounts[outcome.type] ?? 0) + 1;
  }
  return {
    world,
    commandsByTick,
    eventCounts,
    commandsSent,
    peakParticles,
    elapsedMs: performance.now() - started,
  };
}

const measured = run();
const replay = run(measured.commandsByTick);
assert.ok(
  (measured.eventCounts.constructed ?? 0) > 0,
  "construction was not exercised",
);
assert.ok((measured.eventCounts.damage ?? 0) > 0, "combat was not exercised");
assert.equal(
  measured.eventCounts.researched,
  PLAYERS.length,
  "research was not exercised",
);
const finalHash = hashState(measured.world);
assert.equal(
  hashState(replay.world),
  finalHash,
  "recorded-command replay diverged",
);
assert.deepEqual(
  replay.eventCounts,
  measured.eventCounts,
  "replay outcomes diverged",
);
const revision = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const rulesHash = createHash("sha256")
  .update(JSON.stringify(RULES))
  .digest("hex");
console.log(
  JSON.stringify(
    {
      revision,
      rulesVersion: RULES.version,
      rulesHash,
      seed: `0x${SEED.toString(16)}`,
      workload:
        "four-owner 8x8 construction/research/routing/combat; default timing; seeded local command policy",
      ticks: TICKS,
      commands: measured.commandsSent,
      runtimeMs: Number(measured.elapsedMs.toFixed(1)),
      ticksPerSecond: Number(((TICKS * 1000) / measured.elapsedMs).toFixed(1)),
      replayMs: Number(replay.elapsedMs.toFixed(1)),
      finalHash,
      replayEqual: true,
      peakParticles: measured.peakParticles,
      particleCap: PLAYERS.length * RULES.particleCount,
      outcomes: measured.eventCounts,
      built: measured.world.players.map((p) => p.statistics.built),
      damage: measured.world.players.map((p) => p.statistics.damage),
      research: measured.world.players.map((p) => p.research),
    },
    null,
    2,
  ),
);
