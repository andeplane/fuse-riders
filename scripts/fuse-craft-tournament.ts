import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  renameSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import {
  aiCommands,
  AI_STRATEGIES,
  type AiStrategy,
} from "../games/neural-defence/src/engine/ai.js";
import { CONSTRUCTIONS } from "../games/neural-defence/src/engine/catalog.js";
import {
  createMatch,
  loadMap,
  step,
  hashState,
  encodeState,
  decodeState,
  type Command,
  type MapDefinition,
} from "../games/neural-defence/src/engine/index.js";

// Every match uses production rules and ordinary commands. No instant build,
// injected resources or artificial "winner" when the time budget expires.
// Bump when match setup, command generation, stepping or result measurement
// changes. Existing manifests without this field used this same version-1 loop.
const harnessVersion = 3;
const option = (name: string, fallback: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : (process.argv[index + 1] ?? fallback);
};
const output = resolve(option("out", "/tmp/fuse-craft-tournament"));
mkdirSync(output, { recursive: true });
const maps: MapDefinition[] = [
  "skirmish-24",
  "open-front",
  "narrow-front",
  "lean-resources",
  "close-quarters",
  "twin-hemispheres",
  "synapse-islands",
  "cortex-crossing",
  "grand-cortex",
].map((id) =>
  loadMap(
    JSON.parse(
      readFileSync(
        new URL(`../games/neural-defence/maps/${id}.json`, import.meta.url),
        "utf8",
      ),
    ),
  ),
);
const selectedMaps = option("maps", "all").split(",");
if (
  selectedMaps[0] !== "all" &&
  selectedMaps.some((id) => !maps.some((map) => map.id === id))
)
  throw new Error("Unknown map");
const names = option("strategies", AI_STRATEGIES.join(",")).split(",");
if (!names.every((name) => AI_STRATEGIES.includes(name as AiStrategy)))
  throw new Error("Unknown strategy");
if (new Set(names).size !== names.length) throw new Error("Duplicate strategy");
const strategies = names as AiStrategy[];
const seconds = Number(option("seconds", "900"));
// Powerups vary per match through the match id; without the flag runs are
// identical to earlier matrices.
const powerups = process.argv.includes("--powerups");
if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600)
  throw new Error("seconds must be 1..3600");
const source = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const dirty = execFileSync("git", ["diff", "--stat"], {
  encoding: "utf8",
}).trim();
const rows: object[] = [];
const completed = new Set<string>();
const manifestPath = `${output}/manifest.json`;
const resultsPath = `${output}/results.jsonl`;
const resume = process.argv.includes("--resume");
const simulationPaths = [
  "games/neural-defence/src/engine",
  "games/neural-defence/maps",
];
// Untracked engine or map files change the simulation as much as edits do.
const simulationDirty = [
  execFileSync("git", ["diff", "HEAD", "--stat", "--", ...simulationPaths], {
    encoding: "utf8",
  }),
  execFileSync(
    "git",
    ["ls-files", "--others", "--exclude-standard", "--", ...simulationPaths],
    { encoding: "utf8" },
  ),
]
  .join("")
  .trim();
const run = {
  harnessVersion,
  source,
  dirty,
  simulationDirty,
  command: process.argv,
  seconds,
  strategies,
  maps,
  ...(powerups ? { powerups } : {}),
};
if (resume) {
  const previous = JSON.parse(readFileSync(manifestPath, "utf8"));
  const previousMapIndex = previous.command.indexOf("--maps");
  const previousMaps =
    previousMapIndex < 0 ? "all" : previous.command[previousMapIndex + 1];
  if (
    (previous.harnessVersion ?? 1) !== harnessVersion ||
    (previous.simulationDirty ?? previous.dirty) ||
    previous.seconds !== seconds ||
    Boolean(previous.powerups) !== powerups ||
    JSON.stringify(previous.strategies) !== JSON.stringify(strategies) ||
    JSON.stringify(previous.maps) !== JSON.stringify(maps) ||
    previousMaps !== option("maps", "all")
  )
    throw new Error(
      "Cannot resume: original run is dirty or configuration differs",
    );
  // Presentation/docs commits do not invalidate a simulation run. Compare the
  // original engine and map source to the actual working tree, including edits.
  const changed = execFileSync(
    "git",
    [
      "diff",
      previous.source,
      "--",
      "games/neural-defence/src/engine",
      "games/neural-defence/maps",
    ],
    { encoding: "utf8" },
  );
  if (changed) throw new Error("Cannot resume: simulation source differs");
  const expected = new Set<string>();
  for (const map of maps.filter(
    (m) => selectedMaps[0] === "all" || selectedMaps.includes(m.id),
  ))
    for (let a = 0; a < strategies.length; a++)
      for (let b = a; b < strategies.length; b++)
        for (const slot of [0, 1])
          expected.add(`${map.id}-${strategies[a]}-${strategies[b]}-${slot}`);
  if (existsSync(resultsPath)) {
    for (const line of readFileSync(resultsPath, "utf8")
      .split("\n")
      .filter(Boolean)) {
      const row = JSON.parse(line);
      if (
        !expected.has(row.key) ||
        completed.has(row.key) ||
        !row.hash ||
        !row.players ||
        ![
          previous.source,
          ...(previous.resumptions ?? []).map(
            (r: { source: string }) => r.source,
          ),
        ].includes(row.source)
      )
        throw new Error("Cannot resume: invalid or duplicate result");
      completed.add(row.key);
      rows.push(row);
    }
  }
  writeFileSync(
    `${manifestPath}.tmp`,
    JSON.stringify(
      { ...previous, resumptions: [...(previous.resumptions ?? []), run] },
      null,
      2,
    ),
  );
  renameSync(`${manifestPath}.tmp`, manifestPath);
  console.log(`Resuming ${completed.size} completed matches`);
} else {
  if (existsSync(manifestPath) || existsSync(resultsPath))
    throw new Error("Output already exists; use --resume or a new directory");
  writeFileSync(manifestPath, JSON.stringify(run, null, 2));
}
for (const map of maps.filter(
  (m) =>
    option("maps", "all") === "all" ||
    option("maps", "all").split(",").includes(m.id),
)) {
  for (let a = 0; a < strategies.length; a++)
    for (let b = a; b < strategies.length; b++)
      for (const slot of [0, 1]) {
        const pair = [strategies[a]!, strategies[b]!] as const;
        const key = `${map.id}-${pair.join("-")}-${slot}`;
        if (completed.has(key)) continue;
        let world = createMatch(
          map,
          powerups ? { powerups: true, matchId: key } : {},
          [
            { id: "alpha", slot },
            { id: "beta", slot: 1 - slot },
          ],
        );
        const initial = encodeState(world);
        const claims: Record<string, number> = { alpha: 0, beta: 0 };
        const commands: { tick: number; commands: Command[] }[] = [];
        let contact: number | null = null,
          rejected = 0;
        const sampled = world.players.map(() => ({
          samples: 0,
          emptyFront: 0,
          disconnected: 0,
          idleBuilder: 0,
          unfinishedPaidJobsRemoved: 0,
          biomassOnRemovedJobs: 0,
          paidCancellations: 0,
          shieldAbsorbed: 0,
        }));
        const builds: Record<string, Record<string, number>> = {
          alpha: {},
          beta: {},
        };
        while (!world.finished && world.tick < seconds * 20) {
          const inputs = [
            ...aiCommands(world, "alpha", pair[0]),
            ...aiCommands(world, "beta", pair[1]),
          ];
          if (inputs.length)
            commands.push({ tick: world.tick, commands: inputs });
          const prior = world;
          world = step(world, inputs);
          for (const o of world.outcomes)
            if (o.type === "claimed") claims[o.playerId]!++;
          prior.players.forEach((p, i) => {
            for (const job of p.queue.filter((j) => j.paid)) {
              if (
                world.players[i]!.queue.some((j) => j.cell === job.cell) ||
                // An upgrade leaves its neuron behind when cancelled, so only
                // a structure of the job's own kind means it finished.
                world.structures.some(
                  (s) =>
                    s.ownerId === p.id &&
                    s.cell === job.cell &&
                    s.kind === job.kind,
                )
              )
                continue;
              const metric = sampled[i]!;
              if (
                inputs.some(
                  (c) =>
                    c.playerId === p.id &&
                    c.action.type === "cancelConstruction" &&
                    c.action.cell === job.cell,
                )
              )
                metric.paidCancellations++;
              else {
                // This diagnostic includes upgrade-source loss and elimination
                // cleanup. Actual combat site losses are engine statistics.
                metric.unfinishedPaidJobsRemoved++;
                metric.biomassOnRemovedJobs += CONSTRUCTIONS[job.kind].cost;
              }
            }
          });
          for (const event of world.outcomes) {
            if (event.type === "damage") contact ??= world.tick;
            if (event.type === "rejected") rejected++;
            if (event.type === "shielded") {
              const index = world.players.findIndex(
                (p) => p.id === event.playerId,
              );
              sampled[index]!.shieldAbsorbed += event.amount ?? 0;
            }
            if (event.type === "constructed") {
              const kind = world.structures.find(
                (s) => s.cell === event.cell,
              )?.kind;
              if (kind)
                builds[event.playerId]![kind] =
                  (builds[event.playerId]![kind] ?? 0) + 1;
            }
          }
          if (world.tick % 20 === 0)
            world.players.forEach((p, i) => {
              const metric = sampled[i]!;
              metric.samples++;
              metric.idleBuilder += Number(p.worker.mode === "idle");
              metric.disconnected += world.structures.filter(
                (s) => s.ownerId === p.id && !s.connected,
              ).length;
              metric.emptyFront += Object.keys(p.priorities).filter(
                (cell) =>
                  !world.particles.some(
                    (q) =>
                      q.ownerId === p.id &&
                      q.mode === "stationed" &&
                      q.cell === Number(cell),
                  ),
              ).length;
            });
        }
        const hash = hashState(world);
        // Replay logged public commands from a validated checkpoint, independent of AI.
        if (
          option("replay", "sample") === "all" ||
          (a === 0 && b === strategies.length - 1 && slot === 0)
        ) {
          let replay = decodeState(initial),
            cursor = 0;
          while (replay.tick < world.tick) {
            const row = commands[cursor];
            const inputs =
              row?.tick === replay.tick ? (cursor++, row.commands) : [];
            replay = step(replay, inputs);
          }
          if (hashState(replay) !== hash)
            throw new Error(`Replay diverged: ${key}`);
          writeFileSync(
            `${output}/${key}.replay.json`,
            JSON.stringify({
              initial: JSON.parse(initial),
              commands,
              ticks: world.tick,
              hash,
            }),
          );
        }
        const row = {
          key,
          source,
          rules: world.rulesVersion,
          strategies: pair,
          slot,
          seconds: world.tick / 20,
          contact: contact === null ? null : contact / 20,
          result: world.finished ? (world.winnerId ?? "draw") : "timeout",
          victory: world.victory,
          rejected,
          hash,
          ...(powerups ? { claims } : {}),
          players: world.players.map((p, i) => ({
            id: p.id,
            strategy: pair[i],
            ...p.statistics,
            biomass: p.biomass,
            insight: p.insight,
            territory: p.territory,
            peakTerritory: Math.max(
              0,
              ...world.timeline.map(
                (sample) =>
                  sample.players.find((q) => q.id === p.id)!.territory,
              ),
            ),
            research: p.research,
            builds: builds[p.id],
            ...sampled[i],
          })),
        };
        rows.push(row);
        writeFileSync(
          `${output}/results.jsonl.tmp`,
          rows.map((r) => JSON.stringify(r)).join("\n") + "\n",
        );
        renameSync(`${output}/results.jsonl.tmp`, resultsPath);
        console.log(JSON.stringify(row));
      }
}
