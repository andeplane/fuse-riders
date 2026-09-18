import { readFileSync, writeFileSync } from "node:fs";
import { format } from "prettier";
import { RULES } from "../src/engine/apply-tick.js";
import {
  GoldenRefusal,
  validateGoldenCoverage,
  validateGoldenUpdate,
  type GoldenHashes,
} from "./lib/golden-update.js";
import {
  GOLDEN_SEED,
  GOLDEN_TICK_BUDGET,
  replayGolden,
} from "../tests/fixtures/golden-replay.js";
import type { Recording } from "../tests/fixtures/replay-log.js";
import { makeRecording } from "../tests/fixtures/replay-recorder.js";

const path = new URL("../tests/fixtures/", import.meta.url);
const previous: GoldenHashes = JSON.parse(
  readFileSync(new URL("golden-hashes.json", path), "utf8"),
);
const previousRecording: Recording = JSON.parse(
  readFileSync(new URL("mechanics-recording.json", path), "utf8"),
);
const record = process.argv.includes("--record");
try {
  // `--record` is the ordinary way to follow a rules change: the scripted players react to what they see, so almost
  // any change in behaviour plays the stored inputs into different rounds that no longer reach the coverage the
  // golden test asserts. It plays a fresh workload under the new rules, seeded and deterministic, until every
  // requirement in tests/fixtures/replay-coverage.ts is met. Without it the stored inputs are replayed as they
  // are, which is only enough for a rules change they do not notice; that is checked below, never assumed.
  const recording: Recording = record
    ? makeRecording(GOLDEN_SEED, GOLDEN_TICK_BUDGET, true)
    : previousRecording;
  const { hashes, claims } = replayGolden(recording);
  const next: GoldenHashes = { rules: RULES, hashes };
  const recordingChanged =
    JSON.stringify(previousRecording) !== JSON.stringify(recording);
  validateGoldenUpdate(previous, next, recordingChanged);
  validateGoldenCoverage(
    previous,
    next,
    claims.filter((claim) => !claim.ok).map((claim) => claim.key),
    record,
  );
  if (recordingChanged)
    writeFileSync(
      new URL("mechanics-recording.json", path),
      // The format gate covers fixtures, so the workload is written the way Prettier would leave it.
      await format(JSON.stringify(recording), { parser: "json" }),
    );
  writeFileSync(
    new URL("golden-hashes.json", path),
    JSON.stringify(next, null, 2) + "\n",
  );
  console.log(
    `Pinned ${next.rules}: ${hashes.length} ticks, ${recordingChanged ? "fresh recording written" : "recording unchanged"}, every coverage requirement met.`,
  );
} catch (error) {
  // A refusal is an answer, not a crash: one line, nothing written, non-zero exit.
  const incomplete =
    error instanceof Error && error.message.startsWith("Coverage incomplete");
  if (!(error instanceof GoldenRefusal) && !incomplete) throw error;
  console.error(
    incomplete
      ? `${error.message}. The recorder could not reach these within ${GOLDEN_TICK_BUDGET} ticks under ${RULES}; see docs/design/engine-safety-net.md, 'When the golden fails'. Nothing was written.`
      : error.message,
  );
  process.exitCode = 1;
}
