import { readFileSync, writeFileSync } from "node:fs";
import { analyzeFile } from "../lib/fusemania/analyze.js";
import { generateCharts, type Difficulty } from "../lib/fusemania/generate.js";
import { beatSeconds } from "../lib/fusemania/analysis.js";
/**
 * The rule-based generator on held-out pack songs, for `gen.py eval`:
 *   pnpm exec tsx scripts/chartnet/rule-baseline.ts <jobs.json> <out.json> [placement.json]
 *
 * With a placement (beats per song and difficulty, from `gen.py placement-eval`) it is the hybrid instead: the learned
 * rhythm with this generator's arrows.
 */
const [jobsPath, outPath, placementPath] = process.argv.slice(2);
if (!jobsPath || !outPath)
  throw new Error(
    "usage: rule-baseline.ts <jobs.json> <out.json> [placement.json]",
  );
const placement = placementPath
  ? (JSON.parse(readFileSync(placementPath, "utf8")) as Record<
      string,
      Partial<Record<Difficulty, number[]>>
    >)
  : {};
const jobs = JSON.parse(readFileSync(jobsPath, "utf8")) as {
  key: string;
  file: string;
}[];
const out: Record<string, unknown> = {};
for (const { key, file } of jobs) {
  const t0 = Date.now();
  try {
    const a = analyzeFile(key, file);
    const charts = generateCharts(a, placement[key]);
    out[key] = {
      offset: a.offset,
      bpms: a.bpms,
      slotsPerBeat: a.slotsPerBeat,
      charts: charts.map((c) => {
        const rows = new Map<number, string[]>();
        for (const n of c.notes) {
          const r = rows.get(n.slot) ?? ["0", "0", "0", "0"];
          r[n.column] = n.kind === "mine" ? "M" : n.kind === "hold" ? "2" : "1";
          rows.set(n.slot, r);
        }
        return {
          difficulty: c.difficulty,
          meter: c.meter,
          rows: [...rows.entries()]
            .sort((x, y) => x[0] - y[0])
            .map(([s, r]) => [
              s / a.slotsPerBeat,
              beatSeconds(a, s / a.slotsPerBeat),
              r.join(""),
            ]),
        };
      }),
    };
    console.log(key, ((Date.now() - t0) / 1000).toFixed(1), "s");
  } catch (e) {
    console.log("fail", key, String(e));
  }
}
writeFileSync(outPath, JSON.stringify(out));
