// Captures a burst of consecutive frames after an event, to judge an effect's whole life.
// node games/killer-fuse/preview/burst.mjs http://127.0.0.1:PORT/ queenKill [seed] [count]
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const [base, type = "queenKill", seed = "1", count = "8"] =
  process.argv.slice(2);
if (!base?.startsWith("http://127.0.0.1:"))
  throw new Error("Pass the local URL printed by preview/serve.mjs");
const shots = fileURLToPath(new URL("./shots/", import.meta.url));
await mkdir(shots, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  await page.goto(
    `${new URL(base).origin}/?mute&clean&seat=none&level=hard&seed=${seed}`,
  );
  await page
    .locator('#status[data-state="ready"]')
    .waitFor({ state: "attached" });
  await page.evaluate(() => window.__game.pause());
  const found = await page.evaluate((t) => window.__game.until(t), type);
  if (!found) throw new Error(`no ${type} with seed ${seed}`);
  const started = Date.now();
  for (let i = 0; i < Number(count); i += 1) {
    await page.screenshot({ path: `${shots}burst-${type}-${i}.png` });
    console.log(`burst-${type}-${i}.png at ${Date.now() - started} ms`);
  }
} finally {
  await browser.close();
}
