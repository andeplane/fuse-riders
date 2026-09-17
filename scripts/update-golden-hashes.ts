import { readFileSync, writeFileSync } from "node:fs";
import { format } from "prettier";
import { RULES } from "../src/shared/apply-tick.js";
import {
  validateGoldenUpdate,
  type GoldenHashes,
} from "./lib/golden-update.js";
import {
  makeRecording,
  replayHashes,
  type Recording,
} from "../tests/fixtures/replay-log.js";

const path = new URL("../tests/fixtures/", import.meta.url);
const previous: GoldenHashes = JSON.parse(
  readFileSync(new URL("golden-hashes.json", path), "utf8"),
);
const previousRecording: Recording = JSON.parse(
  readFileSync(new URL("mechanics-recording.json", path), "utf8"),
);
// Only the initial recording generation adapts ordinary input commands to observed
// play. Later rules updates replay those exact commands, never reshape the workload.
const recording: Recording = process.argv.includes("--record")
  ? makeRecording(20260915, 30_000, true)
  : previousRecording;
const next: GoldenHashes = { rules: RULES, hashes: replayHashes(recording) };
const recordingChanged =
  JSON.stringify(previousRecording) !== JSON.stringify(recording);
validateGoldenUpdate(previous, next, recordingChanged);
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
