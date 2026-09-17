import { chromium } from "playwright";
import { createGameServer } from "../src/server/index.js";
/** Capture an actually-played AI match: no injected fixture, positions come from real bot decisions. */
function score(game: Awaited<ReturnType<typeof createGameServer>>["game"]) {
  const alive = [...game.players.values()].filter((p) => p.alive).length;
  const gunBombs = [...game.bombs.values()].filter((b) => b.shell?.gun).length;
  return (
    (game.portalPairs.length > 0 ? 100 : 0) +
    gunBombs * 40 +
    game.bombs.size * 15 +
    alive * 2 +
    (game.blasts.length > 0 ? 20 : 0)
  );
}
const browser = await chromium.launch({ channel: "chrome" });
let bestScore = -1;
try {
  for (let attempt = 0; attempt < 3 && bestScore < 175; attempt++) {
    const app = await createGameServer({
      port: 0,
      hostname: "127.0.0.1",
      lanAddress: "127.0.0.1",
      manualTicks: true,
      buildDirectory: process.env.BUILD_DIRECTORY ?? "artifacts/phaser-dist",
    });
    try {
      const page = await browser.newPage({
        viewport: { width: 1600, height: 1000 },
      });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(app.hostUrl);
      for (let i = 0; i < 5; i++)
        await page.getByRole("button", { name: "ADD AI", exact: true }).click();
      await page
        .getByRole("button", { name: "START RACE", exact: true })
        .click();
      for (
        let ticks = 0;
        app.game.phase !== "matchOver" && ticks < 6000 && bestScore < 175;
        ticks++
      ) {
        app.advance(1);
        if (app.game.phase !== "playing") continue;
        const current = score(app.game);
        if (current > bestScore) {
          await page.waitForFunction(
            () =>
              document.querySelector<HTMLCanvasElement>("canvas.arena")?.dataset
                .rendererMetrics !== undefined,
          );
          await page.waitForTimeout(150);
          await page.evaluate(
            () =>
              new Promise<void>((resolve) =>
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => resolve()),
                ),
              ),
          );
          await page.screenshot({ path: "docs/gameplay-phaser.png" });
          bestScore = current;
          const bombPositions = [...app.game.bombs.values()]
            .map((b) => `(${b.x | 0},${b.y | 0}${b.shell?.gun ? ",gun" : ""})`)
            .join(" ");
          const portalPositions = app.game.portalPairs
            .map((p) => p.gates.map((g) => `(${g.x | 0},${g.y | 0})`).join("-"))
            .join(" ");
          console.log(
            `attempt ${attempt} tick ${app.game.tick}: new best score ${bestScore} (bombs ${app.game.bombs.size} ${bombPositions}, portals ${app.game.portalPairs.length} ${portalPositions}, blasts ${app.game.blasts.length})`,
          );
        }
      }
      if (errors.length) throw Error(errors.join("\n"));
    } finally {
      await app.close();
    }
  }
  if (bestScore < 0) throw Error("no candidate frame captured");
  console.log(
    `Captured a real AI-played match, best action score ${bestScore}: docs/gameplay-phaser.png`,
  );
} finally {
  await browser.close();
}
