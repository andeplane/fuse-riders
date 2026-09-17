import { chromium } from "playwright";
import { createGameServer } from "../src/server/index.js";
import { addPlayer, startMatch } from "../src/shared/game.js";
import { visualFixture } from "../src/client/phaser/benchmark-fixture.js";
/** Capture the actual LAN application renderer with a deterministic showcase state. */
const app = await createGameServer({
  port: 0,
  hostname: "127.0.0.1",
  lanAddress: "127.0.0.1",
  manualTicks: true,
  buildDirectory: process.env.BUILD_DIRECTORY ?? "artifacts/phaser-dist",
});
const browser = await chromium.launch({ channel: "chrome" });
try {
  const base = visualFixture(40);
  const names = ["ADA", "BO", "CY", "DEE", "ELI"];
  const fixture = {
    ...base,
    players: base.players.map((player) => ({
      ...player,
      name: names[player.slot]!,
    })),
  };
  for (const player of fixture.players) addPlayer(app.game, player);
  startMatch(app.game);
  app.game.phase = "playing";
  app.game.tick = 40;
  app.game.roundStartedTick = 0;
  for (const player of fixture.players) {
    Object.assign(app.game.players.get(player.id)!, player, {
      trail: [...player.trail],
    });
  }
  app.game.pickups = fixture.pickups.map((p) => ({ ...p }));
  app.game.bombs = new Map(
    fixture.bombs
      .filter((_, i) => i % 3 === 0 || i < 4)
      .map((b) => [
        b.id,
        { ...b, flightPath: [...b.flightPath], placedTick: b.launchedTick },
      ]),
  );
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${app.port}/display#${app.hostToken}`);
  await page.locator('canvas[data-renderer="phaser-webgl"]').waitFor();
  app.game.blasts = fixture.blasts.map((b) => ({
    ...b,
    expiresAtTick: app.game.tick + 8,
    ownerId: "p0",
  }));
  app.advance(1);
  // Blasts are sampled geometry rather than pooled particles. Wait for the LAN snapshot frame.
  await page.waitForFunction(
    () =>
      document.querySelector<HTMLCanvasElement>("canvas.arena")?.dataset
        .rendererMetrics !== undefined,
  );
  app.game.blasts = app.game.blasts.map((b) => ({
    ...b,
    bombId: b.bombId + 1000,
  }));
  app.advance(1);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await page.screenshot({ path: "docs/gameplay-phaser.png" });
  if (errors.length) throw Error(errors.join("\n"));
  console.log(
    "Captured actual LAN application with deterministic showcase state: docs/gameplay-phaser.png",
  );
} finally {
  await browser.close();
  await app.close();
}
