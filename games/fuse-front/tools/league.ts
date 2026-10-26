/**
 * v3 M7's balance report: `pnpm exec tsx games/fuse-front/tools/league.ts [--shard i/n] [--json]`.
 *
 * Plays bot matches on the lane maps and prints each map's match lengths, side split and items at minute 15, and Neon
 * Duel's cross-pairing wins by hero and difficulty:
 *
 * - Neon Duel: all 16 hero pairings with normal bots, and the 12 cross pairings with hard and with easy bots;
 * - Twin Wilds: 16 normal lineups (each team one of four hero pairs);
 * - Crown Jungle: 9 normal lineups (each team one of three hero trios).
 *
 * Bots and rules draw no randomness, so a match is fixed by its map, seats and heroes. About 20 minutes of CPU; with
 * `--shard i/n --json` it plays every n-th match from the i-th and prints one JSON line a match, and with JSON lines
 * on stdin (`--merge`) it prints the report for them, so shards can run side by side.
 */
import { readFileSync } from "node:fs";
import {
  HERO_KINDS,
  ITEMS,
  NO_WINNER,
  STEPS_PER_SECOND,
  STEPS_PER_TICK,
  botCommands,
  createWorld,
  stepTick,
  type Difficulty,
  type HeroKind,
} from "../src/engine/index.js";
import { mapById } from "../src/online/maps.js";

type Job = { map: string; bots: Difficulty; kinds: Record<number, HeroKind> };
type Result = Job & {
  winner: number;
  minutes: number;
  items: number[];
  gold: number[];
};

const jobs: Job[] = [];
for (const bots of ["normal", "hard", "easy"] as const)
  for (const a of HERO_KINDS)
    for (const b of HERO_KINDS)
      if (bots === "normal" || a !== b)
        jobs.push({ map: "neon-duel", bots, kinds: { 0: a, 1: b } });
const teams = (map: string, lineups: HeroKind[][]) => {
  for (const a of lineups)
    for (const b of lineups)
      jobs.push({
        map,
        bots: "normal",
        kinds: Object.fromEntries(
          a.flatMap((kind, i) => [
            [2 * i, kind],
            [2 * i + 1, b[i]!],
          ]),
        ),
      });
};
teams("twin-wilds", [
  ["brick", "vix"],
  ["rivet", "tally"],
  ["vix", "rivet"],
  ["tally", "brick"],
]);
teams("crown-jungle", [
  ["brick", "vix", "rivet"],
  ["tally", "brick", "vix"],
  ["rivet", "tally", "brick"],
]);

const LIMIT = (60 * 60 * STEPS_PER_SECOND) / STEPS_PER_TICK;
const MINUTE_15 = 15 * 60 * STEPS_PER_SECOND;

function run(job: Job): Result {
  const map = mapById(job.map);
  const seats = Object.keys(job.kinds).map(Number);
  let world = createWorld(map, seats, 1, job.kinds);
  let items: number[] | undefined;
  let gold: number[] = [];
  for (let tick = 0; tick < LIMIT && world.winner === NO_WINNER; tick++) {
    world = stepTick(
      map,
      world,
      world.players.flatMap((p) => botCommands(map, world, p.seat, job.bots)),
    );
    if (items === undefined && world.step >= MINUTE_15) {
      items = world.heroes.map((h) => h.items.filter((id) => id >= 0).length);
      // Gold earned so far: the purse plus what its items cost.
      gold = world.heroes.map((h) =>
        h.items.reduce(
          (sum, id) => sum + (id >= 0 ? ITEMS[id]!.cost : 0),
          h.gold,
        ),
      );
    }
  }
  const minutes = world.step / STEPS_PER_SECOND / 60;
  return { ...job, winner: world.winner, minutes, items: items ?? [], gold };
}

const range = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median =
    sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return `${sorted[0]!.toFixed(1)}–${sorted.at(-1)!.toFixed(1)} (median ${median.toFixed(1)})`;
};

function report(results: Result[]): void {
  for (const map of ["neon-duel", "twin-wilds", "crown-jungle"])
    for (const bots of ["normal", "hard", "easy"]) {
      const set = results.filter((r) => r.map === map && r.bots === bots);
      if (set.length === 0) continue;
      const side = [0, 1].map(
        (team) => set.filter((r) => r.winner === team).length,
      );
      const items = set.flatMap((r) => r.items);
      const gold = set.flatMap((r) => r.gold);
      const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
      console.log(
        `${map} ${bots}: ${set.length} matches, ${range(set.map((r) => r.minutes))} min, sides ${side.join("/")}` +
          (items.length
            ? `, items at 15 ${Math.min(...items)}–${Math.max(...items)} (mean ${mean(items).toFixed(1)}), gold ${Math.round(mean(gold))}`
            : ""),
      );
      if (map !== "neon-duel") continue;
      const wins = HERO_KINDS.map((kind) => {
        const won = set.filter(
          (r) => r.kinds[0] !== r.kinds[1] && r.kinds[r.winner] === kind,
        ).length;
        return `${kind} ${won}`;
      });
      console.log(`  cross-pairing wins of 6: ${wins.join(", ")}`);
    }
}

const args = process.argv.slice(2);
if (args.includes("--merge")) {
  const lines = readFileSync(0, "utf8").split("\n").filter(Boolean);
  report(lines.map((line) => JSON.parse(line) as Result));
} else {
  const at = args.indexOf("--shard");
  const [shard, shards] =
    at >= 0 ? args[at + 1]!.split("/").map(Number) : [0, 1];
  const mine = jobs.filter((_, i) => i % shards! === shard);
  const results = mine.map(run);
  if (args.includes("--json"))
    for (const r of results) console.log(JSON.stringify(r));
  else report(results);
}
