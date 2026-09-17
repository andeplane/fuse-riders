import { readFileSync, writeFileSync } from "node:fs";
import { RULES } from "../src/shared/apply-tick.js";
import {
  makeRecording,
  replayHashes,
  type Recording,
} from "../tests/fixtures/replay-log.js";

const path = new URL("../tests/fixtures/", import.meta.url);
// Only the initial recording generation adapts ordinary input commands to observed
// play. Later rules updates replay those exact commands, never reshape the workload.
const recording: Recording = process.argv.includes("--record")
  ? makeRecording(20260915, 30_000, true)
  : JSON.parse(readFileSync(new URL("mechanics-recording.json", path), "utf8"));
if (process.argv.includes("--record"))
  writeFileSync(
    new URL("mechanics-recording.json", path),
    JSON.stringify(recording) + "\n",
  );
writeFileSync(
  new URL("golden-hashes.json", path),
  JSON.stringify({ rules: RULES, hashes: replayHashes(recording) }, null, 2) +
    "\n",
);
