import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { BotController, botRandom } from "../src/engine/bot-controller.js";
import {
  createGame,
  addPlayer,
  startMatch,
  step,
  SLOT_COLORS,
  TICK_HZ,
  type InputIntent,
} from "../src/engine/game.js";

// Same seeds and normal game physics before/after. Steering-only runs remove firing
// and random pickups to isolate navigation; combat runs retain both.
const results = [];
for (const [riders, combat] of [
  [2, false],
  [2, true],
  [5, false],
  [5, true],
] as const) {
  const samples = [];
  for (let seed = 0; seed < 10; seed++) {
    const game = createGame(`bot-survival-${seed}`),
      controller = new BotController();
    for (let slot = 0; slot < riders; slot++)
      addPlayer(game, {
        id: `bot:${slot}`,
        name: `AI ${slot}`,
        slot,
        color: SLOT_COLORS[slot]!,
      });
    startMatch(game);
    while (game.phase === "countdown") step(game, new Map());
    if (!combat) game.nextPickupSpawnTick = Number.MAX_SAFE_INTEGER;
    for (const player of game.players.values()) {
      player.angle += (botRandom(game.seed, player.id, 0) - 0.5) * 0.7;
      player.trail = [];
    }
    const started = game.tick,
      deaths: { tick: number; cause: string }[] = [];
    while (game.phase === "playing" && game.tick - started < 1200) {
      const inputs = new Map<string, InputIntent>();
      for (const player of game.players.values()) {
        const intent = controller.input(game, player.id);
        inputs.set(
          player.id,
          combat
            ? intent
            : { left: intent.left, right: intent.right, bomb: false },
        );
      }
      for (const event of step(game, inputs).events) {
        if (event.type === "playerEliminated")
          deaths.push({ tick: game.tick - started, cause: event.cause });
      }
    }
    const duration = game.tick - started;
    samples.push({
      seed: `bot-survival-${seed}`,
      durationTicks: duration,
      deaths,
      // Survivors are censored at the end of the round or the 60-second limit.
      observedRiderTicks:
        deaths.reduce((sum, death) => sum + death.tick, 0) +
        (riders - deaths.length) * duration,
    });
  }
  results.push({
    riders,
    combat,
    samples,
    meanObservedSurvivalSeconds:
      samples.reduce((sum, sample) => sum + sample.observedRiderTicks, 0) /
      (samples.length * riders * TICK_HZ),
    crashesBeforeTenSeconds: samples
      .flatMap((sample) => sample.deaths)
      .filter(
        (death) =>
          death.tick < 10 * TICK_HZ &&
          ["wall", "trail", "rider"].includes(death.cause),
      ).length,
  });
}
const report = {
  controllerSha256: createHash("sha256")
    .update(
      await readFile(
        new URL("../src/shared/bot-controller.ts", import.meta.url),
      ),
    )
    .digest("hex"),
  revision: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  dirty:
    execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()
      .length > 0,
  method:
    "10 fixed seeds per workload, seeded opening heading offsets in [-0.35, 0.35] radians with cleared initial trails, first round capped at 60 seconds; observed survival includes survivors censored at round end. Not human play or a win-rate comparison.",
  results,
};
await mkdir("artifacts", { recursive: true });
await writeFile(
  process.env.BOT_SURVIVAL_REPORT ?? "artifacts/bot-survival.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    { ...report, results: results.map(({ samples, ...summary }) => summary) },
    null,
    2,
  ),
);
