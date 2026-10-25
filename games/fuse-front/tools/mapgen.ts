/**
 * Writes generated maps: `pnpm exec tsx games/fuse-front/tools/mapgen.ts [id ...] [--seed N] [--check]`.
 * With no id it writes every template in `mapgen/templates.ts` (the lane maps too) to `maps/<id>.json`; `--seed`
 * overrides the template's seed, `--check` writes nothing and fails when a committed map differs from what its
 * template generates.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { formatMap, generate } from "./mapgen/generate.js";
import { generateLanes, laneWalkSeconds } from "./mapgen/lanes.js";
import { LANE_TEMPLATES, TEMPLATES } from "./mapgen/templates.js";
import { loadMap } from "../src/engine/index.js";

const args = process.argv.slice(2);
const check = args.includes("--check");
const seedAt = args.indexOf("--seed");
const seed = seedAt >= 0 ? Number(args[seedAt + 1]) : undefined;
if (seed !== undefined && !Number.isInteger(seed))
  throw new Error("--seed: a whole number");
const ids = args.filter(
  (arg, index) => !arg.startsWith("--") && (seedAt < 0 || index !== seedAt + 1),
);

let failed = false;
const all = { ...TEMPLATES, ...LANE_TEMPLATES };
for (const id of ids.length > 0 ? ids : Object.keys(all)) {
  const template = all[id];
  if (template === undefined)
    throw new Error(`no template ${id}: ${Object.keys(all).join(", ")}`);
  const started = performance.now();
  const lanes = LANE_TEMPLATES[id];
  const file = lanes
    ? generateLanes({ ...lanes, seed: seed ?? lanes.seed })
    : generate({ ...TEMPLATES[id]!, seed: seed ?? template.seed });
  const text = formatMap(file);
  const path = new URL(`../maps/${id}.json`, import.meta.url);
  const map = loadMap(JSON.parse(text));
  const walks = map.lanes.map(
    (lane) => `${lane.name} ${laneWalkSeconds(map, lane).toFixed(0)} s`,
  );
  const summary = `${id}: ${map.width}×${map.height}, ${map.flags.length} flags, ${map.sites.length} sites${walks.length > 0 ? `, grunt walk ${walks.join(" / ")}` : ""}, ${(performance.now() - started).toFixed(0)} ms`;
  if (check) {
    const same = readFileSync(path, "utf8") === text;
    failed ||= !same;
    console.log(`${summary}${same ? "" : " — differs from its template"}`);
  } else {
    writeFileSync(path, text);
    console.log(summary);
  }
}
if (failed) process.exitCode = 1;
