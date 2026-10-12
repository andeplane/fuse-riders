/**
 * Fusetown balance: plays many all-bot hot-seat matches through the real rules fold and prints how long they last,
 * which goal the winner reached last, how each bot style fares, where the markets end and how the loans, scratch cards
 * and Second Life get used. See games/fuse-lane/docs/balance.md for what the numbers were tuned to.
 *
 *   pnpm exec tsx scripts/fuse-lane-balance.ts [--games 200] [--bots 4] [--level 2] [--goal 50]
 *   pnpm exec tsx scripts/fuse-lane-balance.ts --games 1 --trace 1 [--style Hustler]   # one bot's weeks
 */
import { ACTION, BOT, type StreamEntries } from "fuse-netcode";
import { botStyle } from "../games/fuse-lane/src/game/bot.js";
import {
  createRoom,
  foldTick,
  stats,
  netWorth,
  degrees,
  progress,
  JOBS,
  type FuseLaneEntry,
  type FuseLaneRoom,
  type FuseLaneSettings,
} from "../games/fuse-lane/src/game/index.js";

const arg = (name: string, fallback: number) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? Number(process.argv[at + 1]) : fallback;
};
const GAMES = arg("games", 200),
  BOTS = arg("bots", 4),
  LEVEL = arg("level", 2),
  GOAL = arg("goal", 50),
  TRACE = arg("trace", 0),
  TRACE_STYLE = process.argv.includes("--style")
    ? process.argv[process.argv.indexOf("--style") + 1]
    : "";

let seq = 0;
function fold(room: FuseLaneRoom, bodies: Record<string, unknown[][]> = {}) {
  const tick = room.tick + 1,
    streams = new Map<string, StreamEntries<FuseLaneEntry>>();
  for (const [id, list] of Object.entries(bodies))
    streams.set(id, {
      generation: 1,
      entries: list.map((body) => [++seq, tick, ...body] as FuseLaneEntry),
    });
  return foldTick(room, "a", streams);
}

const settings: FuseLaneSettings = {
  weekSeconds: 45,
  display: false,
  turns: true,
  level: LEVEL,
};
const weeksToWin: number[] = [];
const statAtEnd: number[][] = [];
const winsBySlot = new Map<number, number>();
const reachedWeek = [0, 0, 0, 0]; // first week each goal reached, summed
const reachedCount = [0, 0, 0, 0];
const lastGoal = [0, 0, 0, 0];
const jobsHeld = new Map<string, number>();
let timeouts = 0;
const winsByStyle = new Map<string, number>(),
  seatsByStyle = new Map<string, number>();
const runnerUp: number[] = [];
const weeksByStyle = new Map<string, number[]>();
const markets: number[][] = [];
let borrowers = 0,
  scratchCards = 0,
  usedBuys = 0,
  rich = 0;
for (let game = 0; game < GAMES; game++) {
  const room = createRoom(`balance-${game}`, settings);
  fold(room, {
    a: Array.from({ length: BOTS }, (_, slot) => [
      BOT,
      "add",
      `bot:${slot + 1}`,
      `Bot ${slot + 1}`,
      slot,
    ]),
  });
  room.goals = {};
  fold(room, { a: [[ACTION, "start", `g${game}`]] });
  for (const player of Object.values(room.players))
    player.goals = [GOAL, GOAL, GOAL, GOAL];
  const first: Record<string, number[]> = {};
  let lastWeek = 0;
  const borrowed = new Set<string>();
  const seen: Record<string, number> = {};
  for (let n = 0; n < 20_000 && room.stage === "running"; n++) {
    fold(room);
    for (const [id, player] of Object.entries(room.players)) {
      if (player.loan > 0) borrowed.add(id);
      if (player.msgN !== seen[id]) {
        seen[id] = player.msgN;
        if (player.msg.startsWith("Second-hand")) usedBuys++;
        if (/^(Scratch|Winner|Your \$|JACKPOT)/.test(player.msg))
          scratchCards++;
        if (player.msg.startsWith("JACKPOT")) rich++;
      }
    }
    if (room.week !== lastWeek) {
      lastWeek = room.week;
      for (const [id, player] of Object.entries(room.players)) {
        const s = stats(player, room.economy);
        const f = (first[id] ??= [0, 0, 0, 0]);
        s.forEach((v, i) => {
          if (!f[i] && v >= GOAL) f[i] = room.week;
        });
        if (
          TRACE &&
          game === 0 &&
          (TRACE_STYLE
            ? botStyle(room, id).name === TRACE_STYLE
            : id === "bot:1")
        )
          console.log(
            `${id} w${room.week} cash=${player.cash} bank=${player.bank} worth=${netWorth(player, room.economy)} stats=${s.join(",")} job=${player.job >= 0 ? JOBS[player.job]!.title : "-"} wage=${player.wage} dep=${player.dep} exp=${player.exp} deg=${degrees(player)} relax=${player.relax} home=${player.home}`,
          );
      }
    }
  }
  if (room.winners.length && room.week <= 150) {
    weeksToWin.push(room.week);
    const w = room.winners[0]!;
    const slot = room.roster[w]?.slot ?? -1;
    const style = botStyle(room, w).name;
    weeksByStyle.set(style, [...(weeksByStyle.get(style) ?? []), room.week]);
    winsByStyle.set(style, (winsByStyle.get(style) ?? 0) + 1);
    const second = room.ranking[1];
    if (second) runnerUp.push(progress(room.players[second]!, room.economy));
    winsBySlot.set(slot, (winsBySlot.get(slot) ?? 0) + 1);
    const f = first[w]!;
    f.forEach((week, i) => {
      if (week) {
        reachedWeek[i]! += week;
        reachedCount[i]!++;
      }
    });
    const last = f.indexOf(Math.max(...f));
    lastGoal[last]!++;
  } else timeouts++;
  borrowers += borrowed.size;
  markets.push([
    room.economy.price[9]! / 100,
    room.economy.price[10]! / 100,
    room.economy.price[12]! / 50,
    room.economy.policyRate,
    room.economy.inflation * 52,
  ]);
  for (const [id, player] of Object.entries(room.players)) {
    const style = botStyle(room, id).name;
    seatsByStyle.set(style, (seatsByStyle.get(style) ?? 0) + 1);
    statAtEnd.push(stats(player, room.economy));
    const title = player.job >= 0 ? JOBS[player.job]!.title : "none";
    jobsHeld.set(title, (jobsHeld.get(title) ?? 0) + 1);
  }
}
const sorted = [...weeksToWin].sort((a, b) => a - b);
const q = (p: number) => sorted[Math.floor((sorted.length - 1) * p)];
console.log(
  `games=${GAMES} bots=${BOTS} level=${LEVEL} goal=${GOAL} timeouts=${timeouts}`,
);
console.log(
  `weeks to win: p10=${q(0.1)} median=${q(0.5)} p90=${q(0.9)} mean=${(sorted.reduce((a, b) => a + b, 0) / Math.max(1, sorted.length)).toFixed(1)}`,
);
console.log(
  `winner's first week per goal (W,H,E,C): ${reachedWeek.map((s, i) => (s / Math.max(1, reachedCount[i]!)).toFixed(1)).join(" ")}`,
);
console.log(`last goal the winner reached (W,H,E,C): ${lastGoal.join(" ")}`);
console.log(
  `wins by slot: ${[...winsBySlot]
    .sort()
    .map(([s, n]) => `${s}:${n}`)
    .join(" ")}`,
);
console.log(
  `win rate by style: ${[...seatsByStyle].map(([s, n]) => `${s}:${((100 * (winsByStyle.get(s) ?? 0)) / n).toFixed(0)}%`).join(" ")}`,
);
console.log(
  `winning week by style (mean): ${[...weeksByStyle].map(([s, w]) => `${s}:${(w.reduce((a, b) => a + b, 0) / w.length).toFixed(1)}`).join(" ")}`,
);
const ru = [...runnerUp].sort((a, b) => a - b);
console.log(
  `runner-up progress at the end: p10=${ru[Math.floor(ru.length * 0.1)]?.toFixed(2)} median=${ru[Math.floor(ru.length / 2)]?.toFixed(2)}`,
);
console.log(
  `markets at the end (median): ${[
    "index",
    "bonds",
    "crypto",
    "rate%",
    "inflation%/y",
  ]
    .map((name, i) => {
      const v = markets.map((m) => m[i]!).sort((a, b) => a - b);
      return `${name} ${v[Math.floor(v.length / 2)]!.toFixed(2)} (p10 ${v[Math.floor(v.length * 0.1)]!.toFixed(2)}, p90 ${v[Math.floor(v.length * 0.9)]!.toFixed(2)})`;
    })
    .join(", ")}`,
);
console.log(
  `new systems: ${((100 * borrowers) / (GAMES * BOTS)).toFixed(0)}% of players borrowed, ${(scratchCards / GAMES).toFixed(1)} scratch cards a game, ${(usedBuys / GAMES).toFixed(1)} second-hand buys a game, ${rich} jackpots in ${GAMES} games`,
);
const mean = [0, 1, 2, 3].map(
  (i) => statAtEnd.reduce((a, s) => a + s[i]!, 0) / statAtEnd.length,
);
console.log(`mean stats at end: ${mean.map((v) => v.toFixed(1)).join(" ")}`);
console.log(
  `jobs at end: ${[...jobsHeld]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([t, n]) => `${t}:${n}`)
    .join(", ")}`,
);
