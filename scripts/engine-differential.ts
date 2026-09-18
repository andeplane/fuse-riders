/**
 * Differential check between two engines: the one in this checkout and a reference checkout (`--base <dir>`, a worktree
 * of the commit to compare against). Both fold the same input recordings tick by tick; every tick's events and its
 * `toView` must serialise to the same bytes. The state hash is deliberately not compared: a change of state shape
 * moves it with no change of behaviour, and this is the evidence that nothing else moved.
 *
 *   npx tsx scripts/engine-differential.ts --base /path/to/main-worktree [--fuzz 4] [--ticks 30000]
 *
 * Workloads: the golden mechanic recording (the base's fixture, so it is the one main pins) and `--fuzz` fresh
 * recordings made by the base's own recorder (`makeRecording(seed, ticks, true)`), so their inputs owe nothing to the
 * engine under test. `normalise` below lists the only view differences accepted, each named with the reason; any other
 * byte of difference fails with the tick, the workload and the first differing characters.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    base: { type: "string" },
    fuzz: { type: "string", default: "4" },
    ticks: { type: "string", default: "30000" },
    "first-seed": { type: "string", default: "1" },
  },
});
if (!values.base) throw new Error("--base <reference checkout> is required");
const base = path.resolve(values.base);
const head = path.resolve(import.meta.dirname, "..");

interface Engine {
  label: string;
  createRoomState: (matchId: string, settings: unknown) => RoomLike;
  applyTick: (
    state: RoomLike,
    creator: string,
    streams: unknown,
    bots: unknown,
  ) => unknown[];
  toView: (game: unknown) => unknown;
  defaultRoomSettings: () => unknown;
  BotController: new () => unknown;
}
interface RoomLike {
  game: unknown;
}
interface Recording {
  matchId: string;
  creator: string;
  ticks: number;
  entries: Record<string, unknown[]>;
}

async function load(root: string, label: string): Promise<Engine> {
  const at = (file: string) => path.join(root, file);
  const tick = await import(at("games/fuse-riders/src/engine/apply-tick.ts"));
  const view = await import(at("games/fuse-riders/src/engine/view.ts"));
  const settings = await import(
    at("games/fuse-riders/src/engine/room-settings.ts")
  );
  const bots = await import(
    at("games/fuse-riders/src/engine/bot-controller.ts")
  );
  return {
    label,
    createRoomState: tick.createRoomState,
    applyTick: tick.applyTick,
    toView: view.toView,
    defaultRoomSettings: settings.defaultRoomSettings,
    BotController: bots.BotController,
  };
}

/**
 * The accepted view differences, applied to both sides alike. Each one is a projection of a default that only a lobby
 * rider shows, and no reader tells the two apart (`games/fuse-riders/src/render/**` treats a missing flag as false).
 */
function normalise(view: { players: Array<Record<string, unknown>> }): unknown {
  for (const rider of view.players) {
    // freshRoundPlayerState: a rider added in the lobby now carries `false` where addPlayer left the flag unset.
    if (rider.gunArmed === false) delete rider.gunArmed;
    if (rider.shellArmed === false) delete rider.shellArmed;
  }
  return view;
}

interface Tally {
  ticks: number;
  events: number;
  viewBytes: number;
  normalisedTicks: number;
}

function compare(
  name: string,
  recording: Recording,
  engines: readonly [Engine, Engine],
  streamReader: (entries: Recording["entries"]) => (tick: number) => unknown,
): Tally {
  const runs = engines.map((engine) => ({
    engine,
    state: engine.createRoomState(
      recording.matchId,
      engine.defaultRoomSettings(),
    ),
    bots: new engine.BotController(),
    streams: streamReader(recording.entries),
  }));
  const tally: Tally = {
    ticks: 0,
    events: 0,
    viewBytes: 0,
    normalisedTicks: 0,
  };
  for (let tick = 1; tick <= recording.ticks; tick++) {
    const outputs = runs.map((run) => {
      const events = run.engine.applyTick(
        run.state,
        recording.creator,
        run.streams(tick),
        run.bots,
      );
      const raw = JSON.stringify(run.engine.toView(run.state.game));
      return {
        events: JSON.stringify(events),
        raw,
        view: JSON.stringify(normalise(JSON.parse(raw))),
        eventCount: events.length,
      };
    });
    const [a, b] = outputs as [
      (typeof outputs)[number],
      (typeof outputs)[number],
    ];
    if (a.events !== b.events)
      fail(name, tick, "events", a.events, b.events, engines);
    if (a.view !== b.view) fail(name, tick, "view", a.view, b.view, engines);
    if (a.raw !== b.raw) tally.normalisedTicks += 1;
    tally.ticks += 1;
    tally.events += a.eventCount;
    tally.viewBytes += a.view.length;
  }
  return tally;
}

function fail(
  name: string,
  tick: number,
  what: string,
  a: string,
  b: string,
  engines: readonly [Engine, Engine],
): never {
  let at = 0;
  while (at < a.length && a[at] === b[at]) at++;
  const from = Math.max(0, at - 160);
  throw new Error(
    [
      `${name}: ${what} differ at tick ${tick}, character ${at}`,
      `  ${engines[0].label}: …${a.slice(from, at + 160)}`,
      `  ${engines[1].label}: …${b.slice(from, at + 160)}`,
    ].join("\n"),
  );
}

const engines = [
  await load(base, `base (${base})`),
  await load(head, `head (${head})`),
] as const;
const { streamReader } = await import(
  path.join(base, "games/fuse-riders/tests/fixtures/replay-log.ts")
);
const { makeRecording } = await import(
  path.join(base, "games/fuse-riders/tests/fixtures/replay-recorder.ts")
);
const golden: Recording = JSON.parse(
  await readFile(
    path.join(
      base,
      "games/fuse-riders/tests/fixtures/mechanics-recording.json",
    ),
    "utf8",
  ),
);
const workloads: Array<{ name: string; recording: () => Recording }> = [
  { name: "golden mechanic recording", recording: () => golden },
];
const firstSeed = Number(values["first-seed"]);
for (let index = 0; index < Number(values.fuzz); index++) {
  const seed = firstSeed + index;
  workloads.push({
    name: `fuzz seed ${seed}`,
    // Played for coverage (pickups, maps and roster steered toward what is still unseen) while the budget allows;
    // a seed that cannot meet every requirement in it is played as an ordinary room instead.
    recording: () => {
      try {
        return makeRecording(seed, Number(values.ticks), true);
      } catch {
        return makeRecording(seed, Number(values.ticks), false);
      }
    },
  });
}
let total = 0;
for (const workload of workloads) {
  const started = performance.now();
  const recording = workload.recording();
  const tally = compare(workload.name, recording, engines, streamReader);
  total += tally.ticks;
  console.log(
    `${workload.name}: ${tally.ticks} ticks, ${tally.events} events, ${(tally.viewBytes / 1e6).toFixed(0)} MB of view identical; ${tally.normalisedTicks} ticks needed the lobby-flag normalisation; ${Math.round(performance.now() - started)} ms`,
  );
}
console.log(
  `identical events and views over ${total} ticks in ${workloads.length} workloads`,
);
