// Headless AI league: plays whole matches with no rendering, network or clock, so tiers can be compared by evidence.
// Usage: npx tsx scripts/ai-league.ts [matchesPerPairing]
import {
  BotController,
  botDisplayName,
  botRandom,
  BOT_DIFFICULTIES,
  type BotDifficulty,
} from "../games/fuse-riders/src/engine/bot-controller.js";
import {
  createGame,
  addPlayer,
  startMatch,
  step,
  SLOT_COLORS,
  ROUND_DRAW_TICK,
} from "../games/fuse-riders/src/engine/game.js";
import { classicSettings } from "../games/fuse-riders/src/engine/room-settings.js";

/** Identical deterministic brains on symmetric spawns mirror each other into a simultaneous crash, which measures
 *  the arena's symmetry rather than the riders' skill. A seeded nudge off the spawn marks breaks it. */
function jitterSpawns(game: ReturnType<typeof createGame>, seed: number) {
  for (const player of game.players.values()) {
    player.x += (botRandom(seed, player.id + ":x", 7) - 0.5) * 160;
    player.y += (botRandom(seed, player.id + ":y", 7) - 0.5) * 160;
    player.angle += (botRandom(seed, player.id + ":a", 7) - 0.5) * 2;
  }
}
const matches = Number(process.argv[2] ?? 60);
/** One round, four riders, decided by who is still alive last. Returns each slot's lifetime in ticks. */
function round(
  seed: number,
  field: readonly BotDifficulty[],
  controller: BotController,
) {
  const game = createGame(
    `league-${seed}-${field.join("-")}`,
    classicSettings(),
  );
  field.forEach((difficulty, slot) =>
    addPlayer(game, {
      id: `bot:${slot}`,
      name: botDisplayName(`R${slot}`, difficulty),
      slot,
      color: SLOT_COLORS[slot]!,
      avatarId: "robot",
    }),
  );
  startMatch(game);
  jitterSpawns(game, seed);
  const lifetime = field.map(() => 0);
  for (let tick = 0; tick < ROUND_DRAW_TICK && game.round === 1; tick++) {
    step(
      game,
      new Map(
        field.map(
          (_, slot) =>
            [`bot:${slot}`, controller.input(game, `bot:${slot}`)] as const,
        ),
      ),
    );
    field.forEach((_, slot) => {
      if (game.players.get(`bot:${slot}`)!.alive) lifetime[slot] = game.tick;
    });
  }
  return { lifetime, winner: game.roundWinnerId };
}
const controller = new BotController();
const table: string[][] = [["pairing", "wins", "mean lifetime (ticks)"]];
for (let i = 0; i < BOT_DIFFICULTIES.length; i++)
  for (let j = i + 1; j < BOT_DIFFICULTIES.length; j++) {
    const [a, b] = [BOT_DIFFICULTIES[i]!, BOT_DIFFICULTIES[j]!];
    const wins = { [a]: 0, [b]: 0 } as Record<string, number>,
      life = { [a]: 0, [b]: 0 } as Record<string, number>,
      riders = { [a]: 0, [b]: 0 } as Record<string, number>;
    for (let seed = 0; seed < matches; seed++) {
      // Swap the seating every other match so spawn slots cannot flatter either tier.
      const field = seed % 2 ? [a, b, a, b] : [b, a, b, a];
      const { lifetime, winner } = round(seed, field, controller);
      field.forEach((difficulty, slot) => {
        life[difficulty]! += lifetime[slot]!;
        riders[difficulty]!++;
        if (winner === `bot:${slot}`) wins[difficulty]!++;
      });
    }
    for (const difficulty of [a, b])
      table.push([
        `${a} vs ${b}: ${difficulty}`,
        String(wins[difficulty]),
        (life[difficulty]! / riders[difficulty]!).toFixed(0),
      ]);
  }
const width = table[0]!.map((_, column) =>
  Math.max(...table.map((row) => row[column]!.length)),
);
for (const row of table)
  console.log(
    row.map((cell, column) => cell.padEnd(width[column]!)).join("  "),
  );
