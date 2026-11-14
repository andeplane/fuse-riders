import { chromium } from "playwright";

// Fusemania's own latency probe, read after a song played with real browser key events (Playwright's keyboard, so
// each press has a browser stamp and waits for the main thread like a player's). The presses are sent `BIAS_MS`
// away from each note, so the run also shows the timing-bias offer on the result. Figures are this machine's:
// headless Chromium has no display and no audio device, and injected keys skip the keyboard and the operating
// system. Run against a served build: `pnpm exec tsx service/dev.ts --port 8890` after `pnpm build`.
const base = process.env.ONLINE_URL ?? "http://localhost:8890/",
  song = process.env.SONG ?? "arcade-adventure",
  chart = process.env.CHART ?? "1",
  bias = Number(process.env.BIAS_MS ?? -18),
  seconds = Number(process.env.SECONDS ?? 0),
  shot = process.env.SCREENSHOT;

const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: shot ? 2 : 1,
});
await page.goto(
  `${base}fusemania/?solo=1&song=${song}&chart=${chart}&latency${process.env.MUTE ? "&mute" : ""}`,
);
await page.locator('main[data-stage="running"]').waitFor({ timeout: 30_000 });
// A click anywhere unlocks the audio clock where the browser wants a gesture.
await page.mouse.click(640, 400);
await page.waitForFunction("window.fusemania?.clock().loaded === true || true");
await page.waitForTimeout(1500);

type Note = [ms: number, column: number, kind: number];
const notes = (await page.evaluate("window.fusemania.notes()")) as Note[];
const codes = ["KeyA", "KeyS", "KeyW", "KeyD"];
/** Song ms minus this process's clock, sampled a few times: the least is the one with the shortest round trip. */
let skew = Number.POSITIVE_INFINITY;
const sync = async () => {
  const before = performance.now();
  const heard = (await page.evaluate(
    "window.fusemania.clock().heardMs",
  )) as number;
  const after = performance.now();
  if (after - before < 8) skew = heard - (before + after) / 2;
};
for (let i = 0; i < 10; i++) await sync();
const until = seconds > 0 ? seconds * 1000 : Number.POSITIVE_INFINITY;
const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
let sent = 0;
for (const [ms, column, kind] of notes) {
  // Mines are not pressed.
  if (kind === 3 || ms > until) continue;
  const due = ms + bias - skew;
  if (due < performance.now() - 5) continue;
  await sleep(due - performance.now());
  const code = codes[column]!;
  // Not awaited one after the other: a jump's two keys go down together.
  void page.keyboard
    .down(code)
    .then(() => sleep(60))
    .then(() => page.keyboard.up(code));
  if (++sent % 40 === 0) await sync();
}
if (seconds > 0) {
  await sleep(500);
} else {
  await page.locator('main[data-stage="over"]').waitFor({ timeout: 400_000 });
  await sleep(800);
}
console.log(`presses sent: ${sent}, ${bias} ms from each note`);
console.log(await page.evaluate("window.fusemania.latencyText()"));
console.log(
  "result offer:",
  JSON.stringify(
    await page.evaluate(
      "document.querySelector('.fm-card-timing:not([hidden]) p')?.textContent ?? null",
    ),
  ),
);
if (shot) await page.screenshot({ path: shot });
if (process.env.APPLY) {
  await page.locator(".fm-timing-apply").click();
  console.log(
    "after APPLY:",
    await page.evaluate(
      "document.querySelector('.fm-card-timing p')?.textContent + ' | stored ' + localStorage.getItem('fusemania-prefs-v1')",
    ),
  );
  if (shot)
    await page.screenshot({ path: shot.replace(/\.png$/, "-applied.png") });
}
await browser.close();
