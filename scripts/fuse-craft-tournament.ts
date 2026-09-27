import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
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
const strategies = names as AiStrategy[];
const seconds = Number(option("seconds", "900"));
if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600)
  throw new Error("seconds must be 1..3600");
const source = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const dirty = execFileSync("git", ["diff", "--stat"], {
  encoding: "utf8",
}).trim();
writeFileSync(
  `${output}/manifest.json`,
  JSON.stringify(
    { source, dirty, command: process.argv, seconds, strategies, maps },
    null,
    2,
  ),
);
const rows: object[] = [];
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
        let world = createMatch(map, {}, [
          { id: "alpha", slot },
          { id: "beta", slot: 1 - slot },
        ]);
        const initial = encodeState(world);
        const commands: { tick: number; commands: Command[] }[] = [];
        let contact: number | null = null,
          rejected = 0;
        const sampled = world.players.map(() => ({
          samples: 0,
          emptyFront: 0,
          disconnected: 0,
          idleBuilder: 0,
          sitesLost: 0,
          biomassLostOnSites: 0,
          paidCancellations: 0,
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
          prior.players.forEach((p, i) => {
            for (const job of p.queue.filter((j) => j.paid)) {
              if (
                world.players[i]!.queue.some((j) => j.cell === job.cell) ||
                world.structures.some(
                  (s) => s.ownerId === p.id && s.cell === job.cell,
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
                metric.sitesLost++;
                metric.biomassLostOnSites += CONSTRUCTIONS[job.kind].cost;
              }
            }
          });
          for (const event of world.outcomes) {
            if (event.type === "damage") contact ??= world.tick;
            if (event.type === "rejected") rejected++;
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
          rejected,
          hash,
          players: world.players.map((p, i) => ({
            id: p.id,
            strategy: pair[i],
            ...p.statistics,
            biomass: p.biomass,
            insight: p.insight,
            research: p.research,
            builds: builds[p.id],
            ...sampled[i],
          })),
        };
        rows.push(row);
        writeFileSync(
          `${output}/results.jsonl`,
          rows.map((r) => JSON.stringify(r)).join("\n") + "\n",
        );
        console.log(JSON.stringify(row));
      }
}
