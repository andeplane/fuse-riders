import { readFile, stat, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  checkpointJSON,
  initialMatch,
  readCheckpoint,
  readLog,
  runHeadless,
  type Driver,
} from "./lib/fuse-birds-headless.js";

const { values } = parseArgs({
  options: {
    seed: { type: "string", default: "123" },
    players: { type: "string", default: "2" },
    ticks: { type: "string", default: "100000" },
    mode: { type: "string", default: "pass" },
    load: { type: "string" },
    save: { type: "string" },
    log: { type: "string" },
    record: { type: "string" },
    trace: { type: "string" },
    help: { type: "boolean" },
  },
});
if (values.help) {
  console.log(
    "Fuse Birds headless runner\n--seed N --players 2..5 --ticks N --mode pass|idle|aimed\n--log actions.json --record actions.json --trace ticks.ndjson\n--load checkpoint.json --save checkpoint.json\nA log suppresses the driver; checkpoint resume uses absolute log ticks. Output includes final state and hash. Files are never overwritten.",
  );
} else {
  const json = async (path: string): Promise<unknown> => {
    if ((await stat(path)).size > 16_000_000)
      throw new Error(`Input file exceeds 16 MB: ${path}`);
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  };
  if (!["pass", "idle", "aimed"].includes(values.mode))
    throw new Error("Mode must be pass, idle or aimed");
  if (
    values.load &&
    process.argv.some(
      (arg) =>
        arg === "--seed" ||
        arg.startsWith("--seed=") ||
        arg === "--players" ||
        arg.startsWith("--players="),
    )
  )
    throw new Error("A checkpoint already owns its seed and roster");
  const state = values.load
    ? readCheckpoint(await json(values.load))
    : initialMatch(Number(values.seed), Number(values.players));
  const log = values.log ? readLog(await json(values.log)) : undefined;
  const traces: string[] = [];
  const result = runHeadless(state, {
    ticks: Number(values.ticks),
    driver: values.mode as Driver,
    log,
    trace: values.trace
      ? (entry) => {
          traces.push(JSON.stringify(entry));
        }
      : undefined,
  });
  const checkpoint = checkpointJSON(state);
  // Exclusive creation makes accidental overwrite of an input/log/checkpoint fail safely.
  if (values.save) await writeFile(values.save, checkpoint, { flag: "wx" });
  if (values.record)
    await writeFile(values.record, JSON.stringify(result.record), {
      flag: "wx",
    });
  if (values.trace)
    await writeFile(values.trace, traces.join("\n") + "\n", { flag: "wx" });
  console.log(
    JSON.stringify({ ...result.summary, state: JSON.parse(checkpoint).state }),
  );
  if (state.phase === "fault") process.exitCode = 1;
}
