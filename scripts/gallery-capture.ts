import { openPlayOptions, takeHostSeat } from "./lib/main-menu.js";
/**
 * Captures the gallery card image of a game from real play: `public/gallery/<id>.jpg`, the file a game's
 * `portal.json` names as its `screenshot`.
 *
 *   pnpm build && pnpm gallery:capture            # every game with a recipe below
 *   pnpm gallery:capture fuseball ball-bros       # only these
 *   GALLERY_URL=http://localhost:8787/ pnpm gallery:capture fuseball   # against a service already running
 *
 * Each recipe drives the game's own menus into a solo or bot match, with no state injection, and plays for a moment so
 * the frame shows the game rather than its first tick. Pages open muted. Run by hand; not in CI: a capture is a
 * picture someone looks at before committing it, and `tests/gallery-screenshots.test.ts` is what keeps a game from
 * shipping without one.
 */
import { mkdir } from "node:fs/promises";
import type { Page } from "playwright";
import { launchSelected } from "./lib/browser.js";
import { startRoomService } from "./lib/server.js";

/** The card's image: 1200 pixels wide, as `public/gallery/README.md` asks, at the catalog's 16:10. */
const VIEWPORT = { width: 1200, height: 750 };
const JPEG_QUALITY = 84;

/** Holds each key in turn for `ms`, so a rider moves about instead of standing where it spawned. */
async function hold(page: Page, keys: readonly string[], ms: number) {
  for (const key of keys) {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
  }
}

/** From the game's landing page (already open, muted) to a frame of play worth a card. */
type Recipe = (page: Page) => Promise<void>;

const RECIPES: Record<string, Recipe> = {
  "ball-bros": async (page) => {
    await openPlayOptions(page);
    await page
      .getByRole("button", { name: "Single player", exact: true })
      .click();
    await page
      .getByText("SPACE TO LAUNCH", { exact: true })
      .waitFor({ timeout: 30_000 });
    // Space on a focused button presses it; the arena has to hold focus first.
    await page.locator("canvas").click({ position: { x: 20, y: 20 } });
    await page.keyboard.press("Space");
    await hold(page, ["KeyD", "KeyW", "KeyA", "KeyS", "KeyD"], 1800);
  },
  "fuse-birds": async (page) => {
    await openPlayOptions(page);
    await page
      .getByRole("button", { name: "Single player", exact: true })
      .click();
    await page
      .locator('canvas[data-ready="true"]')
      .waitFor({ timeout: 60_000 });
    await page.waitForTimeout(2500);
  },
  "fuse-front": async (page) => {
    await openPlayOptions(page);
    await page.getByRole("button", { name: "Host room" }).click();
    await takeHostSeat(page, "Gallery");
    await page
      .getByRole("button", { name: "Add AI", exact: true })
      .first()
      .click();
    await page.getByRole("button", { name: "START" }).click();
    await page
      .locator("p.ff-hud", { hasText: "right-click: move" })
      .waitFor({ timeout: 30_000 });
    const board = page.locator("canvas.ff-board");
    const at = await board.boundingBox();
    if (!at) throw new Error("Fuse Front has no board");
    // March the hero toward the middle, where the armies meet.
    await page.mouse.click(at.x + at.width * 0.6, at.y + at.height * 0.45, {
      button: "right",
    });
    await page.waitForTimeout(20_000);
  },
  "elasto-fuse": async (page) => {
    await openPlayOptions(page);
    await page.getByRole("button", { name: "PLAY SOLO", exact: true }).click();
    await page
      .locator('.ef-room[data-stage="running"]')
      .waitFor({ timeout: 30_000 });
    // On the gas from the countdown (from a standstill, full gas loops the bike over backwards), up to the first apple.
    await page.keyboard.down("ArrowUp");
    await page.waitForTimeout(5000);
  },
  "fuse-volley": async (page) => {
    await openPlayOptions(page);
    await page
      .getByRole("button", { name: "Single player", exact: true })
      .click();
    await page
      .locator('.fv-room[data-stage="running"]')
      .waitFor({ timeout: 30_000 });
    await page.locator("canvas").click({ position: { x: 20, y: 20 } });
    // Walk under the serve and bump it over, then catch the bot's return mid-rally.
    await page.waitForTimeout(1500);
    await hold(page, ["ArrowRight"], 250);
    await page.keyboard.press("ArrowUp", { delay: 200 });
    await page.waitForTimeout(700);
  },
  fuseball: async (page) => {
    await openPlayOptions(page);
    await page
      .getByRole("button", { name: "Single player", exact: true })
      .click();
    const room = page.locator(".fb-room");
    await room
      .and(page.locator('[data-stage="running"]:not([data-phase="countdown"])'))
      .waitFor({ timeout: 30_000 });
    await page.locator("canvas").click({ position: { x: 20, y: 20 } });
    await page.keyboard.down("ArrowRight");
    for (let jump = 0; jump < 5; jump++) {
      await page.keyboard.press("Space", { delay: 80 });
      await page.waitForTimeout(350);
    }
    await page.keyboard.up("ArrowRight");
  },
  "killer-fuse": async (page) => {
    await openPlayOptions(page);
    await page
      .getByRole("button", { name: "PLAY SOLO WITH BOTS", exact: true })
      .click();
    // The brief covers the arena over the countdown; the card is gone once the game is under way.
    await page
      .locator('main.kf-room[data-stage="running"]')
      .waitFor({ timeout: 30_000 });
    await page
      .locator(".kf-brief")
      .waitFor({ state: "hidden", timeout: 30_000 });
    await page.locator("canvas").click({ position: { x: 20, y: 20 } });
    // Let the six of them spread out over the hives and the snail before the frame is taken.
    await page.waitForTimeout(6000);
    await hold(page, ["KeyD", "Space", "KeyD"], 400);
  },
  "graveyard-shift": async (page) => {
    await page
      .getByRole("button", { name: "START SOLO SHIFT", exact: true })
      .click();
    await page.locator("[data-phase=running]").waitFor({ timeout: 30_000 });
    await page.keyboard.press("Escape");
    await page.locator("canvas").click({ position: { x: 200, y: 200 } });
    await hold(page, ["w", "d", "s", "a"], 1500);
  },
};

const wanted = process.argv.slice(2);
const unknown = wanted.filter((id) => !(id in RECIPES));
if (unknown.length > 0)
  throw new Error(
    `No capture recipe for ${unknown.join(", ")}; scripts/gallery-capture.ts has ${Object.keys(RECIPES).join(", ")}`,
  );
const ids = wanted.length > 0 ? wanted : Object.keys(RECIPES);

const server = process.env.GALLERY_URL ? undefined : await startRoomService();
// A base with a path (GitHub Pages) needs its trailing slash, or `new URL` drops the last segment.
const root = (process.env.GALLERY_URL ?? server?.url ?? "").replace(
  /\/?$/,
  "/",
);
const browser = await launchSelected("chromium");
const failed: string[] = [];
try {
  await mkdir("public/gallery", { recursive: true });
  for (const id of ids) {
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();
    try {
      await page.goto(new URL(`${id}/?mute`, root).href);
      await RECIPES[id]?.(page);
      const path = `public/gallery/${id}.jpg`;
      await page.screenshot({ path, type: "jpeg", quality: JPEG_QUALITY });
      console.log(`Captured ${path}`);
    } catch (error) {
      failed.push(id);
      console.error(`${id}: ${error instanceof Error ? error.message : error}`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
  await server?.stop();
}
if (failed.length > 0) {
  console.error(`No capture for ${failed.join(", ")}`);
  process.exitCode = 1;
}
