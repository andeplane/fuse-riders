import assert from "node:assert/strict";
import { launchSelected } from "./lib/browser.js";
import { startViteServer } from "./lib/server.js";
import { ridersPageUrl } from "./lib/riders-url.js";

const server = await startViteServer();
// Desktop Chrome smoke of the actual landing flow; this does not qualify physical phones or train networks.
const browser = await launchSelected("chrome");
let release!: () => void;
const artwork = new Promise<void>((resolve) => {
  release = resolve;
});
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 800 },
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Delay actual artwork at the browser network boundary so the real landing flow stays loading for capture.
  await page.route("**/*.svg", async (route) => {
    await artwork;
    await route.continue();
  });
  await page.goto(`${ridersPageUrl(server.url)}?mute`, {
    waitUntil: "domcontentloaded",
  });
  const progress = page.getByRole("progressbar", { name: "Loading graphics" });
  await progress.waitFor();
  assert.equal(await progress.getAttribute("aria-valuemin"), "0");
  await page.screenshot({ path: "artifacts/pr390-real-loading.png" });
  release();
  await progress.waitFor({ state: "hidden" });
  await page.locator('canvas[data-renderer-status="ready"]').first().waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "PASS real landing loading card, named progressbar, screenshot, and ready cleanup.",
  );
} finally {
  release();
  await browser.close();
  await server.stop();
}
