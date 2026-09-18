export interface GoldenHashes {
  rules: string;
  hashes: readonly string[];
}

/** The one command that refreshes the golden after an intended rules change. About a minute, deterministic. */
/** Where `RULES` is declared. The one place the path is written: the messages below, their test and the docs check all read it. */
export const RULES_FILE = "src/engine/apply-tick.ts";
export const RECORD_COMMAND =
  "pnpm exec tsx scripts/update-golden-hashes.ts --record";
const WORKFLOW = "docs/design/engine-safety-net.md, 'When the golden fails'";

/** The updater declining to write: an answer for whoever ran it, not a crash. */
export class GoldenRefusal extends Error {}

/** An expected-data update must not bless a missed simulation-rules bump. */
export function validateGoldenUpdate(
  previous: GoldenHashes,
  next: GoldenHashes,
  recordingChanged = false,
): void {
  if (previous.rules !== next.rules) return;
  const hashesChanged =
    previous.hashes.length !== next.hashes.length ||
    previous.hashes.some((hash, index) => hash !== next.hashes[index]);
  if (hashesChanged || recordingChanged)
    throw new GoldenRefusal(
      `Refusing to update the golden or recording under unchanged RULES (${next.rules}). Preserve the baseline for refactors, or bump RULES in ${RULES_FILE} for intended simulation/workload changes and run \`${RECORD_COMMAND}\`.`,
    );
}

/**
 * The golden test asserts that the pinned recording still exercises every mechanic, so a golden whose replay lost one
 * fails that test however fresh its hashes are. `lost` is the keys of the coverage claims the replay about to be
 * pinned does not meet; `recorded` says whether that replay is of a fresh `--record` workload or of the stored inputs.
 */
export function validateGoldenCoverage(
  previous: GoldenHashes,
  next: GoldenHashes,
  lost: readonly string[],
  recorded = false,
): void {
  if (!lost.length) return;
  const list = `${lost.length} coverage requirement${lost.length === 1 ? "" : "s"} (${lost.join(", ")})`;
  if (recorded)
    throw new GoldenRefusal(
      `Refusing to pin ${next.rules}: the fresh recording does not reach ${list}, so tests/golden-hash.test.ts would fail. The recorder (tests/fixtures/replay-recorder.ts) has to play for them; see ${WORKFLOW}. Nothing was written.`,
    );
  if (previous.rules === next.rules)
    throw new GoldenRefusal(
      `The stored recording does not reach ${list} under unchanged RULES (${next.rules}): tests/fixtures/replay-coverage.ts asks for something these inputs never did. A new workload is a rules change: bump RULES in ${RULES_FILE} and run \`${RECORD_COMMAND}\`. Nothing was written.`,
    );
  throw new GoldenRefusal(
    `Refusing to pin ${next.rules}: replayed under the new rules (was ${previous.rules}), the stored inputs no longer reach ${list}, so tests/golden-hash.test.ts would fail. Run \`${RECORD_COMMAND}\` instead (about a minute): it plays a fresh workload under the new rules. Nothing was written.`,
  );
}

/**
 * What the golden test tells a developer when the replay and the golden disagree, or undefined when they agree.
 * `firstDivergence` is the 1-based tick of the first differing hash, or 0 when every compared tick matches.
 */
export function goldenFailure(
  rules: string,
  goldenRules: string,
  firstDivergence: number,
  ticks: number,
  goldenTicks: number,
): string | undefined {
  const where = firstDivergence
    ? `First diverging tick: ${firstDivergence} of ${ticks}.`
    : ticks !== goldenTicks
      ? `The recording runs ${ticks} ticks and the golden pins ${goldenTicks}: the two fixtures are out of step.`
      : "";
  const refresh = [
    `run \`${RECORD_COMMAND}\` (about a minute, deterministic), and commit tests/fixtures/golden-hashes.json and`,
    `tests/fixtures/mechanics-recording.json together with the change, in one commit tagged [rules N→N+1].`,
  ];
  if (rules !== goldenRules)
    return [
      `RULES is ${rules} but the golden still pins ${goldenRules}: RULES was bumped and the golden was not refreshed.`,
      firstDivergence
        ? `${where} (That is where the new rules first change the stored workload.)`
        : where ||
          "Every tick of the stored workload still hashes the same under the new rules; the golden has to name them all the same.",
      `  To finish the rules change: ${refresh[0]}`,
      `  ${refresh[1]}`,
      `  If you merged main and both sides bumped RULES: take the next free number, then run the same command again.`,
      `  If you did not mean to change RULES: restore it in ${RULES_FILE}.`,
      `See ${WORKFLOW}.`,
    ]
      .filter(Boolean)
      .join("\n");
  if (!where) return undefined;
  if (!firstDivergence)
    return [
      `${where} One was changed without the other, under unchanged RULES (${rules}).`,
      `  Restore both from main; or, for an intended workload change, bump RULES in ${RULES_FILE}, ${refresh[0]}`,
      `  ${refresh[1]}`,
      `See ${WORKFLOW}.`,
    ].join("\n");
  return [
    `The simulation's behaviour changed and RULES did not (still ${rules}). ${where}`,
    `  If the change is INTENDED: bump RULES in ${RULES_FILE}, ${refresh[0]}`,
    `  ${refresh[1]}`,
    `  If it is NOT intended (a refactor, a cosmetic or tooling change): this is a determinism or behaviour regression.`,
    `  Do not refresh the golden; find what changed the state at tick ${firstDivergence} and fix it. A [hash-identical] change must leave every tick as it is.`,
    `See ${WORKFLOW}.`,
  ].join("\n");
}
