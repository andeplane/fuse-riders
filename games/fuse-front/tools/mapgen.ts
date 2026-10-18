/**
 * Writes generated maps: `pnpm exec tsx games/fuse-front/tools/mapgen.ts [id ...] [--seed N] [--check]`. With no id
 * it writes every template in `mapgen/templates.ts` to `maps/<id>.json`; `--seed` overrides the template's seed and
 * `--check` writes nothing and fails when a committed map differs from what its template generates.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { formatMap, generate } from "./mapgen/generate.js";
import { TEMPLATES } from "./mapgen/templates.js";
import { loadMap } from "../src/engine/index.js";

const args = process.argv.slice(2);
const check = args.includes("--check");
const seedAt = args.indexOf("--seed");
const seed = seedAt >= 0 ? Number(args[seedAt + 1]) : undefined;
if (seed !== undefined && !Number.isInteger(seed))
  throw new Error("--seed: a whole number");
const ids = args.filter(
  (arg, index) => !arg.startsWith("--") && index !== seedAt + 1,
);
let failed = false;
for (const id of ids.length > 0 ? ids : Object.keys(TEMPLATES)) {
  const template = TEMPLATES[id];
  if (template === undefined)
    throw new Error(`no template ${id}: ${Object.keys(TEMPLATES).join(", ")}`);
  const started = performance.now();
  const text = formatMap(
    generate(seed === undefined ? template : { ...template, seed }),
  );
  const file = new URL(`../maps/${id}.json`, import.meta.url);
  const map = loadMap(JSON.parse(text));
  const summary = `${id}: ${map.width}×${map.height}, ${map.flags.length} flags, ${map.sites.length} sites, ${(performance.now() - started).toFixed(0)} ms`;
  if (check) {
    const same = readFileSync(file, "utf8") === text;
    failed ||= !same;
    console.log(`${summary}${same ? "" : " — differs from its template"}`);
  } else {
    writeFileSync(file, text);
    console.log(summary);
  }
}
if (failed) process.exitCode = 1;
