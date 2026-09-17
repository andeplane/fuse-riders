// One screenshot per arena map, for eyeballing the ground and the scenery. A renderer fixture, not match evidence.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { createGameServer } from "../src/server/index.js";
import { AVATARS } from "../src/shared/avatars.js";
import { addPlayer, startMatch, COUNTDOWN_TICKS } from "../src/shared/game.js";
import {
  ARENA_MAPS,
  generateObstacles,
  OBSTACLE_WALL_MARGIN,
} from "../src/shared/arena-map.js";

const app = await createGameServer({
  port: 0,
  hostname: "127.0.0.1",
  lanAddress: "127.0.0.1",
  manualTicks: true,
  buildDirectory: process.env.BUILD_DIRECTORY,
});
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const colors = ["#22d3ee", "#ff4fa3", "#a3e635", "#fb923c", "#a78bfa"];
  for (let i = 0; i < 3; i++)
    addPlayer(app.game, {
      id: `p${i}`,
      name: `P${i + 1}`,
      avatarId: AVATARS[i * 2]!.id,
      slot: i,
      color: colors[i],
    });
  startMatch(app.game);
  app.advance(COUNTDOWN_TICKS + 1);
  app.game.nextPickupSpawnTick = Number.MAX_SAFE_INTEGER;
  for (const [index, player] of [...app.game.players.values()].entries()) {
    Object.assign(player, {
      x: 120,
      y: 160 + index * 300,
      angle: 0,
      alive: true,
      trail: [],
      invulnerableUntilTick: Number.MAX_SAFE_INTEGER,
    });
  }
  const page = await browser.newPage({
    viewport: { width: 1672, height: 940 },
  });
  await page.addInitScript("globalThis.__name = (fn) => fn;");
  await page.goto(`http://127.0.0.1:${app.port}/display#${app.hostToken}`);
  await page.getByText("HOST ONLINE", { exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await mkdir("artifacts", { recursive: true });
  let seed = 7;
  for (const map of ARENA_MAPS) {
    app.game.map = map;
    app.game.obstacles = generateObstacles({
      map,
      random: () => {
        seed = (seed * 1103515245 + 12345) >>> 0;
        return seed / 0x1_0000_0000;
      },
      bounds: {
        minX: 20 + OBSTACLE_WALL_MARGIN,
        minY: 20 + OBSTACLE_WALL_MARGIN,
        maxX: 1580 - OBSTACLE_WALL_MARGIN,
        maxY: 880 - OBSTACLE_WALL_MARGIN,
      },
      keepClear: [...app.game.players.values()].map((player) => ({
        x1: player.x,
        y1: player.y,
        x2: player.x + 220,
        y2: player.y,
        radius: 56,
      })),
    });
    // One rider parked on the right-hand edge, so the wrap map shows it arriving on the left as it leaves.
    Object.assign(app.game.players.get("p1")!, {
      x: 1594,
      y: 460,
      angle: 0,
      trail: [],
    });
    app.advance(1);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `artifacts/map-${map}.png` });
    console.log(`${map}: ${app.game.obstacles.length} obstacles`);
  }
} finally {
  await browser.close();
  await app.close();
}
