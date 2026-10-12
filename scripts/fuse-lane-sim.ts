/**
 * Headless Fuse Lane: runs whole bot-only games through the real rules fold and prints how long they take and where
 * the economy wanders, for balance checks (economy-sim.md §9). Usage:
 *
 *   pnpm exec tsx scripts/fuse-lane-sim.ts [games=200] [players=4] [goal=50]
 *
 * Every game is seeded by its index, so a run is reproducible.
 */
import { ACTION, BOT, SETTINGS, type StreamEntries } from "fuse-netcode";
import {
  ASSET_NAMES,
  CATEGORIES,
  CYCLES,
  DEFAULT_SETTINGS,
  GOALS,
  createRoom,
  degrees,
  foldTick,
  stats,
  type FuseLaneEntry,
  type FuseLaneRoom,
} from "../games/fuse-lane/src/game/index.js";

const games = Number(process.argv[2] ?? 200),
  seats = Number(process.argv[3] ?? 4),
  goal = Number(process.argv[4] ?? 50);

let seq = 0;
function fold(room: FuseLaneRoom, host: unknown[][] = []): void {
  const tick = room.tick + 1,
    streams = new Map<string, StreamEntries<FuseLaneEntry>>();
  if (host.length)
    streams.set("host", {
      generation: 1,
      entries: host.map((body) => [++seq, tick, ...body] as FuseLaneEntry),
    });
  foldTick(room, "host", streams);
}

export function playGame(
  seed: number,
  players = seats,
  goals = goal,
): FuseLaneRoom {
  const room = createRoom(`sim-${seed}`, DEFAULT_SETTINGS);
  void SETTINGS;
  void GOALS;
  fold(
    room,
    Array.from({ length: players }, (_, slot) => [
      BOT,
      "add",
      `bot:${slot + 1}`,
      `Bot ${slot + 1}`,
      slot,
    ]),
  );
  for (const id of Object.keys(room.goals)) delete room.goals[id];
  fold(room, [[ACTION, "start", `sim-${seed}`]]);
  for (const player of Object.values(room.players))
    player.goals = [goals, goals, goals, goals];
  while (room.stage === "running") fold(room);
  return room;
}

const pct = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
};

function main(): void {
  const weeks: number[] = [];
  const winsBySlot = Array.from({ length: seats }, () => 0);
  const lows = Array.from({ length: 12 }, () => Infinity),
    highs = Array.from({ length: 12 }, () => 0);
  const priceLows = CATEGORIES.map(() => Infinity),
    priceHighs = CATEGORIES.map(() => 0);
  const cycles = CYCLES.map(() => 0);
  let rates: number[] = [];
  const statsAtEnd: number[][] = [[], [], [], []];
  let unfinished = 0;
  const started = Date.now();
  for (let game = 0; game < games; game++) {
    const room = playGame(game);
    weeks.push(room.week);
    const finished = room.winners.filter(
      (id) => room.players[id]!.finished > 0,
    );
    for (const id of finished) winsBySlot[room.roster[id]!.slot]!++;
    if (!finished.length) unfinished++;
    const e = room.economy;
    e.price.forEach((price, asset) => {
      lows[asset] = Math.min(lows[asset]!, price);
      highs[asset] = Math.max(highs[asset]!, price);
    });
    e.prices.forEach((index, category) => {
      priceLows[category] = Math.min(priceLows[category]!, index);
      priceHighs[category] = Math.max(priceHighs[category]!, index);
    });
    cycles[e.cycle]!++;
    rates.push(e.policyRate);
    for (const player of Object.values(room.players)) {
      stats(player, e).forEach((value, index) =>
        statsAtEnd[index]!.push(value),
      );
      void degrees(player);
    }
  }
  rates = rates.sort((a, b) => a - b);
  console.log(
    `Fuse Lane sim: ${games} games, ${seats} bots, goals ${goal}/${goal}/${goal}/${goal} (${((Date.now() - started) / 1000).toFixed(1)} s)`,
  );
  console.log(
    `weeks to finish: min ${Math.min(...weeks)}  p10 ${pct(weeks, 0.1)}  median ${pct(weeks, 0.5)}  p90 ${pct(weeks, 0.9)}  max ${Math.max(...weeks)}  (no winner: ${unfinished})`,
  );
  console.log(
    `players meeting all goals in the winning week, by seat: ${winsBySlot.join(" / ")}`,
  );
  console.log(
    "final stats (median of all players): " +
      ["wealth", "happiness", "education", "career"]
        .map((name, index) => `${name} ${pct(statsAtEnd[index]!, 0.5)}`)
        .join(", "),
  );
  console.log("asset price range at game end:");
  ASSET_NAMES.forEach((name, asset) =>
    console.log(
      `  ${name.padEnd(8)} ${lows[asset]!.toFixed(2).padStart(9)} .. ${highs[asset]!.toFixed(2)}`,
    ),
  );
  console.log("category price index range at game end:");
  CATEGORIES.forEach((name, category) =>
    console.log(
      `  ${name.padEnd(10)} ${priceLows[category]!.toFixed(3)} .. ${priceHighs[category]!.toFixed(3)}`,
    ),
  );
  console.log(
    `policy rate at end: ${rates[0]!.toFixed(2)}% .. ${rates.at(-1)!.toFixed(2)}% (median ${pct(rates, 0.5).toFixed(2)}%)`,
  );
  console.log(
    `cycle at end: ${CYCLES.map((name, index) => `${name} ${cycles[index]}`).join(", ")}`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main();
