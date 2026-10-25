/**
 * Screenshots the concept robot heroes and base in game against a running service (`pnpm build`, then
 * `service/dev.ts`):
 *
 *   node games/fuse-front/preview/concept-shot.mjs http://localhost:PORT/ games/fuse-front/docs/images [name]
 *
 * CREATE ROOM at 2V2 against bots, with a hero picked for every seat (SHOT_HERO for you, default Brick; bots get the rest),
 * then START and zoom in (Z) on your hero at your fort. Saves `<name>-<t>.png` (default `robots-heroes`) close up at
 * each match second in SHOT_TIMES (default 1), then `<name>-base.png` SHOT_OUT (default 2) steps further out. SHOT_SOLO=1 plays solo
 * instead. Forced high quality, muted.
 */
import { chromium } from "playwright";
import { join } from "node:path";

const [base, dir, name = "robots-heroes"] = process.argv.slice(2);
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+\/$/.test(base ?? "") || !dir)
  throw new Error("Pass the local service URL and a screenshot directory");
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || undefined,
  headless: true,
});
const errors = [];
/** CREATE ROOM, 2V2, a hero for every seat, START. */
async function lobby(page) {
  await page.getByRole("button", { name: "CREATE ROOM" }).click();
  await page
    .locator(".ff-team-0 .ff-seat")
    .first()
    .waitFor({ timeout: 15_000 });
  await page.getByRole("button", { name: "2V2" }).click();
  await page.locator(".ff-team-1 .ff-seat").nth(1).waitFor({ timeout: 15_000 });
  const pick = async (team, seat, hero) => {
    const button = page
      .locator(`.ff-team-${team} .ff-seat`)
      .nth(seat)
      .locator(`.ff-hero[aria-label='${hero}']`);
    await button.click();
    await page
      .locator(`.ff-team-${team} .ff-seat`)
      .nth(seat)
      .locator(`.ff-hero.ff-on[aria-label='${hero}']`)
      .waitFor({ timeout: 10_000 });
  };
  // SHOT_HERO picks yours; the other three go to the bots.
  const mine = process.env.SHOT_HERO ?? "brick";
  const rest = ["brick", "vix", "rivet", "tally"].filter((h) => h !== mine);
  await pick(0, 0, mine);
  await pick(0, 1, rest[0]);
  await pick(1, 0, rest[1]);
  await pick(1, 1, rest[2]);
  await page.getByRole("button", { name: "START" }).click();
}
try {
  const page = await browser.newPage({
    viewport: { width: 1100, height: 800 },
  });
  page.on("pageerror", (error) => errors.push(error.message));
  const solo = !!process.env.SHOT_SOLO;
  await page.goto(
    `${base}fuse-front/?mute&quality=high${solo ? "&solo=1" : ""}`,
  );
  if (!solo) await lobby(page);

  await page.locator("canvas.ff-board").waitFor({ timeout: 60_000 });
  await page.locator(".ff-spell").first().waitFor({ timeout: 60_000 });
  // Z zooms in on your hero at your fort; a shot at each match second in SHOT_TIMES (the clock runs slowly under a
  // software rasteriser), the heroes walking out.
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("z");
    await page.waitForTimeout(400);
  }
  const clock = (t) => page.waitForFunction((t) => { const m = /\b(\d+):(\d\d)\b/.exec(document.body.innerText); return !!m && +m[1] * 60 + +m[2] >= t; }, t, { timeout: 900_000, polling: 500 }); // prettier-ignore
  for (const t of (process.env.SHOT_TIMES ?? "1").split(",").map(Number)) {
    await clock(t);
    await page.screenshot({ path: join(dir, `${name}-${t}.png`) });
  }
  for (let i = 0; i < Number(process.env.SHOT_OUT ?? 2); i++) {
    await page.keyboard.press("x");
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(4000);
  await page.screenshot({ path: join(dir, `${name}-base.png`) });
  if (errors.length) throw new Error(errors.join("\n"));
  console.log("ok");
} catch (error) {
  // What the page showed when a step failed, beside the shots.
  await browser
    .contexts()[0]
    ?.pages()[0]
    ?.screenshot({ path: join(dir, `${name}-failed.png`) });
  throw error;
} finally {
  await browser.close();
}
