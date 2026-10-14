/**
 * Fails when a covered source file is at zero: no test loads it by any path.
 *
 * The thresholds in `.c8rc.json` are totals over every included file, so a whole module at 0% is diluted by the tens
 * of thousands of covered lines around it and the gate still reads green. That is how `games/fuse-drivers/src/app/
 * runtime.ts` — the class that turns a thumb on the wheel into log entries — shipped with no test touching it at all,
 * beside a test fixture that had quietly reimplemented it. The first run of this check found five more.
 *
 * A file at exactly zero is a different fact from a file at 80: it says no test reaches this code by any path, so
 * whatever it does is unproven and free to drift. `tests/fixtures/coverage-floor-allowlist.json` records the ones
 * that are already like that, with what each would take to cover; a file that leaves zero must leave the list too,
 * so the list only shrinks. Deliberately untestable modules belong in `.c8rc.json`'s exact-file exclusions instead,
 * with their reason in docs/coverage-exclusions.md.
 */

import { readFileSync } from "node:fs";
import { relative } from "node:path";

interface FileSummary {
  statements: { pct: number; total: number };
}
interface Allowlist {
  files: Record<string, string>;
}

const REPORT = "coverage/coverage-summary.json";
const ALLOWLIST = "tests/fixtures/coverage-floor-allowlist.json";

function read(path: string, why: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    console.error(`No ${path}: ${why}`);
    process.exit(1);
  }
}

function main(): void {
  const summary = JSON.parse(
    read(REPORT, "run this after `pnpm test:coverage`, which writes it."),
  ) as Record<string, FileSummary>;
  const allowed = (
    JSON.parse(read(ALLOWLIST, "it records the files already at zero.")) as
      Allowlist | undefined
  )?.files;
  if (!allowed) {
    console.error(`${ALLOWLIST} has no "files" object.`);
    process.exit(1);
  }

  const zero = new Set<string>();
  for (const [file, entry] of Object.entries(summary)) {
    if (file === "total") continue;
    // A module with no statements at all is not evidence of anything.
    if (entry.statements.total > 0 && entry.statements.pct === 0)
      zero.add(relative(process.cwd(), file));
  }

  const fresh = [...zero].filter((file) => !(file in allowed)).sort();
  const covered = Object.keys(allowed)
    .filter((file) => !zero.has(file))
    .sort();

  if (fresh.length > 0) {
    console.error(
      `${String(fresh.length)} source file(s) are at 0% — no test loads them:\n`,
    );
    for (const file of fresh) console.error(`  ${file}`);
    console.error(
      `\nTest them. If one cannot be tested at all, exempt it by exact path in .c8rc.json and say why in` +
        ` docs/coverage-exclusions.md; if it is merely untested for now, add it to ${ALLOWLIST} with what would cover it.`,
    );
  }
  if (covered.length > 0) {
    console.error(
      `\n${String(covered.length)} file(s) in ${ALLOWLIST} are covered now. Remove them from it — the list only shrinks:\n`,
    );
    for (const file of covered) console.error(`  ${file}`);
  }
  if (fresh.length > 0 || covered.length > 0) process.exit(1);
}

main();
