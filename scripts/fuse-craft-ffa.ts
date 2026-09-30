/**
 * Free-for-all benchmark: every set of N openings, rotated through the seats
 * of an N-seat map, played AI against AI with powerups. Reports wins by
 * opening and by seat, how matches end and how long they take.
 *
 *   pnpm exec tsx scripts/fuse-craft-ffa.ts --map cortex-crossing \
 *     --players 4 --seconds 900 --jobs 8 --out /tmp/fuse-craft-ffa
 */
import { fork } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import {
  createMatch,
  loadMap,
  step,
  type MapDefinition,
} from "../games/neural-defence/src/engine/index.ts";
import {
  aiCommands,
  AI_STRATEGIES,
  type AiStrategy,
} from "../games/neural-defence/src/engine/ai.ts";

const option = (name: string, fallback: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : (process.argv[index + 1] ?? fallback);
};
const mapId = option("map", "cortex-crossing");
const players = Number(option("players", "4"));
const seconds = Number(option("seconds", "900"));
const map: MapDefinition = loadMap(
  JSON.parse(
    readFileSync(
      new URL(`../games/neural-defence/maps/${mapId}.json`, import.meta.url),
      "utf8",
    ),
  ),
);
if (!Number.isInteger(players) || players < 3 || players > map.spawns.length)
  throw new Error(`players must be 3..${map.spawns.length} on ${mapId}`);

/**
 * Every combination of openings, rotated through every seat in both
 * directions. One direction alone confounds seat with matchup: seats that
 * are neighbours in the rotation would always meet the same opening pair
 * the same way round.
 */
function cases(): AiStrategy[][] {
  const out: AiStrategy[][] = [];
  const pick = (start: number, chosen: AiStrategy[]) => {
    if (chosen.length === players) {
      for (const order of [chosen, [...chosen].reverse()])
        for (let r = 0; r < players; r++)
          out.push(order.map((_, i) => order[(i + r) % players]!));
      return;
    }
    for (let i = start; i < AI_STRATEGIES.length; i++)
      pick(i + 1, [...chosen, AI_STRATEGIES[i]!]);
  };
  pick(0, []);
  return out;
}

interface Row {
  key: string;
  seats: AiStrategy[];
  winner: AiStrategy | null;
  winnerSeat: number | null;
  victory: string | null;
  result: "win" | "draw" | "timeout";
  seconds: number;
  territory: number[];
  eliminatedAt: (number | null)[];
}

function play(seats: AiStrategy[], key: string): Row {
  let w = createMatch(
    map,
    { powerups: true, matchId: key },
    seats.map((_, slot) => ({ id: `p${slot}`, slot })),
  );
  const eliminatedAt: (number | null)[] = seats.map(() => null);
  while (!w.finished && w.tick < seconds * 20) {
    w = step(
      w,
      seats.flatMap((s, i) => aiCommands(w, `p${i}`, s)),
    );
    for (const o of w.outcomes)
      if (o.type === "eliminated")
        eliminatedAt[Number(o.playerId.slice(1))] = w.tick / 20;
  }
  const winnerSeat = w.winnerId === null ? null : Number(w.winnerId.slice(1));
  return {
    key,
    seats,
    winner: winnerSeat === null ? null : seats[winnerSeat]!,
    winnerSeat,
    victory: w.victory,
    result: w.finished ? (w.winnerId ? "win" : "draw") : "timeout",
    seconds: w.tick / 20,
    territory: w.players.map((p) => p.territory),
    eliminatedAt,
  };
}

const all = cases();
const worker = option("worker", "");
if (worker) {
  const [index, count] = worker.split("/").map(Number);
  for (let k = index!; k < all.length; k += count!)
    process.send!(play(all[k]!, `${mapId}-${k}-${all[k]!.join("-")}`));
  process.exit(0);
}

const output = resolve(option("out", "/tmp/fuse-craft-ffa"));
mkdirSync(output, { recursive: true });
const jobs = Number(option("jobs", "8"));
const rows: Row[] = [];
await Promise.all(
  Array.from(
    { length: jobs },
    (_, i) =>
      new Promise<void>((done) => {
        const child = fork(
          new URL(import.meta.url).pathname,
          [...process.argv.slice(2), "--worker", `${i}/${jobs}`],
          { execArgv: ["--import", "tsx"] },
        );
        child.on("message", (row: Row) => rows.push(row));
        child.on("exit", () => done());
      }),
  ),
);
rows.sort((a, b) => (a.key < b.key ? -1 : 1));
writeFileSync(
  `${output}/results.jsonl`,
  rows.map((r) => JSON.stringify(r)).join("\n") + "\n",
);
const source = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const byOpening = Object.fromEntries(
  AI_STRATEGIES.map((s) => {
    const games = rows.filter((r) => r.seats.includes(s)).length;
    const wins = rows.filter((r) => r.winner === s).length;
    return [s, { games, wins, share: +(wins / Math.max(1, games)).toFixed(3) }];
  }),
);
const bySeat = map.spawns
  .slice(0, players)
  .map((_, seat) => rows.filter((r) => r.winnerSeat === seat).length);
const lengths = rows.map((r) => r.seconds).sort((a, b) => a - b);
const summary = {
  source,
  map: mapId,
  players,
  seconds,
  matches: rows.length,
  outcomes: {
    elimination: rows.filter((r) => r.victory === "elimination").length,
    dominance: rows.filter((r) => r.victory === "dominance").length,
    draw: rows.filter((r) => r.result === "draw").length,
    timeout: rows.filter((r) => r.result === "timeout").length,
  },
  medianSeconds: lengths[lengths.length >> 1],
  winsByOpening: byOpening,
  winsBySeat: bySeat,
};
writeFileSync(`${output}/summary.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
