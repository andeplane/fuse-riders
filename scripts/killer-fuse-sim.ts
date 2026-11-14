/**
 * Headless Killer Fuse: plays whole bot-only games through the real engine step and prints who wins, how, and how
 * long it takes, for balance work (games/killer-fuse/docs/balance.md). Usage:
 *
 *   pnpm exec tsx scripts/killer-fuse-sim.ts --games 200 --level hard [--level-b medium] [--map 1] [--seed 1]
 *     [--max-seconds 300] [--idle-queen] [--json]
 *
 * `--level` is the bots' difficulty (easy, medium, hard). With `--level-b` the two teams play at different levels:
 * side A plays `--level`, side B `--level-b`, and they swap screen sides every game so the map's sides cancel out.
 * Game `i` is seeded `seed + i`, so a run is reproducible. Every game is played twice and the two final state hashes
 * must match: the run fails if the engine is not deterministic. A game still undecided after `--max-seconds` is a
 * timeout, counted on its own and left out of the length figures. With `--idle-queen` side B's Queen is a seat whose
 * player holds nothing, as someone who has walked away from the keyboard: a check that bots finish such a Queen.
 */
import {
  TICK_HZ,
  createRound,
  hashRound,
  isMapId,
  stepRound,
  type BotLevel,
  type MapId,
  type VictoryKind,
} from "../games/killer-fuse/src/engine/index.js";

const LEVELS: readonly BotLevel[] = ["easy", "medium", "hard"];
const KINDS: readonly VictoryKind[] = ["military", "economy", "snail"];

export interface SimOptions {
  games: number;
  level: BotLevel;
  levelB: BotLevel;
  map: MapId;
  seed: number;
  maxSeconds: number;
  /** Side B's Queen is a human seat that holds no controls. */
  idleQueen: boolean;
  json: boolean;
}

export interface GameResult {
  seed: number;
  /** The level on each screen side (team 0 is left). */
  levels: [BotLevel, BotLevel];
  /** The winning team and kind, or null on a timeout. */
  winner: { team: number; kind: VictoryKind } | null;
  steps: number;
  queenDeaths: number;
  kills: number;
  berries: number;
  kickIns: number;
  gateUses: number;
  snailMounts: number;
  snailEats: number;
  hash: string;
}

export function playGame(
  seed: number,
  map: MapId,
  levels: [BotLevel, BotLevel],
  maxSeconds: number,
  /** A team (0 or 1) whose Queen seat is held by a player who presses nothing, or -1. */
  idleQueen = -1,
): GameResult {
  const state = createRound({
    seed,
    mapId: map,
    teamLevels: levels,
    humans: [idleQueen === 0, idleQueen === 1],
  });
  const result: GameResult = {
    seed,
    levels,
    winner: null,
    steps: 0,
    queenDeaths: 0,
    kills: 0,
    berries: 0,
    kickIns: 0,
    gateUses: 0,
    snailMounts: 0,
    snailEats: 0,
    hash: "",
  };
  const limit = maxSeconds * TICK_HZ;
  while (!state.winner && state.step < limit) {
    stepRound(state, []);
    for (const event of state.events) {
      if (event.type === "queenKill") result.queenDeaths += 1;
      else if (event.type === "kill") result.kills += 1;
      else if (event.type === "berryDeposit") result.berries += 1;
      else if (event.type === "berryKickIn") {
        result.berries += 1;
        result.kickIns += 1;
      } else if (event.type === "gateUse") result.gateUses += 1;
      else if (event.type === "snailMount") result.snailMounts += 1;
      else if (event.type === "snailEat") result.snailEats += 1;
    }
  }
  result.winner = state.winner;
  result.steps = state.step;
  result.hash = hashRound(state);
  return result;
}

export interface Summary {
  games: number;
  map: MapId;
  seed: number;
  levelA: BotLevel;
  levelB: BotLevel;
  idleQueen: boolean;
  decided: number;
  timeouts: number;
  /** Wins by screen side: team 0 (left) and team 1 (right). */
  sideWins: [number, number];
  /** Wins by level side: A plays `levelA`, B plays `levelB`. */
  levelWins: [number, number];
  /** Wins per kind, and per kind for each level side. */
  kinds: Record<VictoryKind, number>;
  kindsBySide: [Record<VictoryKind, number>, Record<VictoryKind, number>];
  /** Game length in seconds over decided games. */
  medianSeconds: number;
  meanSeconds: number;
  p90Seconds: number;
  /** Per game, over every game played. */
  queenDeaths: number;
  kills: number;
  berries: number;
  kickIns: number;
  gateUses: number;
  snailMounts: number;
  snailEats: number;
  deterministic: boolean;
}

const emptyKinds = (): Record<VictoryKind, number> => ({
  military: 0,
  economy: 0,
  snail: 0,
});

function quantile(sorted: readonly number[], q: number): number {
  if (!sorted.length) return 0;
  return (
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0
  );
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

export function runSim(options: SimOptions): Summary {
  const summary: Summary = {
    games: options.games,
    map: options.map,
    seed: options.seed,
    levelA: options.level,
    levelB: options.levelB,
    idleQueen: options.idleQueen,
    decided: 0,
    timeouts: 0,
    sideWins: [0, 0],
    levelWins: [0, 0],
    kinds: emptyKinds(),
    kindsBySide: [emptyKinds(), emptyKinds()],
    medianSeconds: 0,
    meanSeconds: 0,
    p90Seconds: 0,
    queenDeaths: 0,
    kills: 0,
    berries: 0,
    kickIns: 0,
    gateUses: 0,
    snailMounts: 0,
    snailEats: 0,
    deterministic: true,
  };
  const lengths: number[] = [];
  for (let i = 0; i < options.games; i += 1) {
    // Side A sits on the left in even games and on the right in odd ones.
    const swapped = i % 2 === 1;
    const levels: [BotLevel, BotLevel] = swapped
      ? [options.levelB, options.level]
      : [options.level, options.levelB];
    const seed = options.seed + i;
    const idle = options.idleQueen ? (swapped ? 0 : 1) : -1;
    const game = playGame(seed, options.map, levels, options.maxSeconds, idle);
    const again = playGame(seed, options.map, levels, options.maxSeconds, idle);
    if (again.hash !== game.hash || again.steps !== game.steps) {
      summary.deterministic = false;
      throw new Error(
        `seed ${seed} is not deterministic: ${game.hash} at step ${game.steps}, then ${again.hash} at step ${again.steps}`,
      );
    }
    summary.queenDeaths += game.queenDeaths;
    summary.kills += game.kills;
    summary.berries += game.berries;
    summary.kickIns += game.kickIns;
    summary.gateUses += game.gateUses;
    summary.snailMounts += game.snailMounts;
    summary.snailEats += game.snailEats;
    if (!game.winner) {
      summary.timeouts += 1;
      continue;
    }
    summary.decided += 1;
    lengths.push(game.steps / TICK_HZ);
    const side = game.winner.team === 0 ? 0 : 1;
    const levelSide = (side === 0) === !swapped ? 0 : 1;
    summary.sideWins[side] += 1;
    summary.levelWins[levelSide] += 1;
    summary.kinds[game.winner.kind] += 1;
    summary.kindsBySide[levelSide][game.winner.kind] += 1;
  }
  lengths.sort((a, b) => a - b);
  const total = lengths.reduce((sum, value) => sum + value, 0);
  summary.medianSeconds = round1(quantile(lengths, 0.5));
  summary.p90Seconds = round1(quantile(lengths, 0.9));
  summary.meanSeconds = round1(lengths.length ? total / lengths.length : 0);
  const games = Math.max(1, options.games);
  for (const key of [
    "queenDeaths",
    "kills",
    "berries",
    "kickIns",
    "gateUses",
    "snailMounts",
    "snailEats",
  ] as const)
    summary[key] = Math.round((summary[key] / games) * 100) / 100;
  return summary;
}

const percent = (part: number, whole: number): string =>
  whole ? `${Math.round((part / whole) * 1000) / 10}%` : "-";

export function report(summary: Summary): string {
  const { decided } = summary;
  const mixed = summary.levelA !== summary.levelB || summary.idleQueen;
  const lines = [
    `Killer Fuse, map ${summary.map}: ${summary.games} games, ${summary.levelA} against ${summary.levelB}${summary.idleQueen ? " with an idle Queen" : ""}, seeds ${summary.seed}..${summary.seed + summary.games - 1}`,
    `decided ${decided}, timeouts ${summary.timeouts}`,
    `side wins: left (team 0) ${summary.sideWins[0]} (${percent(summary.sideWins[0], decided)}), right (team 1) ${summary.sideWins[1]} (${percent(summary.sideWins[1], decided)})`,
  ];
  if (mixed)
    lines.push(
      `level wins: ${summary.levelA} ${summary.levelWins[0]} (${percent(summary.levelWins[0], decided)}), ${summary.levelB} ${summary.levelWins[1]} (${percent(summary.levelWins[1], decided)})`,
    );
  lines.push(
    `win kinds: ${KINDS.map((kind) => `${kind} ${summary.kinds[kind]} (${percent(summary.kinds[kind], decided)})`).join(", ")}`,
  );
  if (mixed)
    for (const side of [0, 1] as const)
      lines.push(
        `  ${side === 0 ? summary.levelA : summary.levelB} won by: ${KINDS.map((kind) => `${kind} ${summary.kindsBySide[side][kind]}`).join(", ")}`,
      );
  lines.push(
    `length: median ${summary.medianSeconds} s, mean ${summary.meanSeconds} s, p90 ${summary.p90Seconds} s`,
    `per game: Queen deaths ${summary.queenDeaths}, other kills ${summary.kills}, berries banked ${summary.berries} (kicked in ${summary.kickIns}), gate uses ${summary.gateUses}, snail mounts ${summary.snailMounts}, snail meals ${summary.snailEats}`,
    `determinism: every seed played twice, final hashes equal`,
  );
  return lines.join("\n");
}

const isLevel = (value: string): value is BotLevel =>
  LEVELS.some((level) => level === value);

export function parseArgs(argv: readonly string[]): SimOptions {
  const values = new Map<string, string>();
  let json = false,
    idleQueen = false;
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i] ?? "";
    if (flag === "--json") json = true;
    else if (flag === "--idle-queen") idleQueen = true;
    else if (flag.startsWith("--")) {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`${flag} needs a value`);
      values.set(flag.slice(2), value);
      i += 1;
    } else throw new Error(`unexpected argument ${flag}`);
  }
  const count = (name: string, fallback: number): number => {
    const text = values.get(name);
    if (text === undefined) return fallback;
    const value = Number(text);
    if (!Number.isInteger(value) || value < 0)
      throw new Error(`--${name} must be a whole number, not ${text}`);
    return value;
  };
  const levelOf = (name: string, fallback: BotLevel): BotLevel => {
    const text = values.get(name);
    if (text === undefined) return fallback;
    if (!isLevel(text))
      throw new Error(`--${name} must be one of ${LEVELS.join(", ")}`);
    return text;
  };
  const known = ["games", "level", "level-b", "map", "seed", "max-seconds"];
  for (const name of values.keys())
    if (!known.includes(name)) throw new Error(`unknown flag --${name}`);
  const level = levelOf("level", "hard");
  const map = count("map", 1);
  if (!isMapId(map)) throw new Error(`--map must be 1, 2 or 3`);
  return {
    games: count("games", 200),
    level,
    levelB: levelOf("level-b", level),
    map,
    seed: count("seed", 1),
    maxSeconds: count("max-seconds", 300),
    idleQueen,
    json,
  };
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const summary = runSim(options);
  console.log(
    options.json ? JSON.stringify(summary, null, 2) : report(summary),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main();
