import assert from "node:assert/strict";
import { launchSelected } from "../../scripts/lib/browser.js";

const origin = process.env.ONLINE_URL ?? "http://localhost:8792/";
const browser = await launchSelected("chrome");
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(new URL("ball-bros/?mute", origin).href);
  await page
    .getByRole("combobox", { name: "Core avatar" })
    .selectOption("dragon");
  await page.screenshot({
    path: "artifacts/ball-bros-avatar-choice.png",
    fullPage: true,
  });
  // Documented asset impairment: abort the optional portrait sheet, never inject game state.
  await page.route("**/avatars/neon-heads.png", (route) => route.abort());
  await page.getByRole("button", { name: "PLAY SOLO", exact: true }).click();
  await page.getByText("GET READY · 2", { exact: true }).waitFor();
  assert.equal(await page.locator(".scorecard").count(), 5);
  await page.getByRole("button", { name: "RADIO OFF", exact: true }).waitFor();
  await page.screenshot({
    path: "artifacts/ball-bros-portrait-fallback.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  await page.getByRole("button", { name: "LEAVE", exact: true }).click();
  await page.unroute("**/avatars/neon-heads.png");
  await page.getByRole("button", { name: "CREATE ROOM", exact: true }).click();
  await page.getByPlaceholder("Your name").fill("Pilot");
  await page.getByRole("button", { name: "JOIN", exact: true }).click();
  await page.locator(".fui-roster-name", { hasText: "Pilot" }).waitFor();
  await page.getByRole("button", { name: "+ ADD BOT", exact: true }).click();
  await page.locator(".fui-roster-name", { hasText: "Sparks" }).waitFor();
  await page.screenshot({
    path: "artifacts/ball-bros-phase3-lobby.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "LEAVE", exact: true }).click();
  console.log(
    "PASS: avatar picker, optional portrait failure, radio remains off and live room lobby; muted screenshots saved.",
  );
} finally {
  await browser.close();
}
