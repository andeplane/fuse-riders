import { chromium, type Page } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const base = process.argv[2] ?? "http://localhost:8893",
  output = process.argv[3] ?? "/tmp/fuse-birds-recovery";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const pages: Page[] = [],
  errors: string[] = [];
try {
  for (let i = 0; i < 3; i++) {
    const page = await browser.newPage({
      viewport: { width: 1200, height: 900 },
    });
    page.on("pageerror", (error) => errors.push(error.message));
    pages.push(page);
  }
  const [creator, successor, survivor] = pages as [Page, Page, Page];
  await creator.route(
    "**/api/rooms?gameId=fuse-birds",
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Room service temporarily unavailable" }),
      }),
    { times: 1 },
  );
  await creator.goto(`${base}/fuse-birds/?mute`);
  await creator.getByRole("button", { name: "CREATE ROOM" }).click();
  await creator.getByRole("status").filter({ hasText: "Try again" }).waitFor();
  assert.equal(
    await creator.getByRole("button", { name: "CREATE ROOM" }).isEnabled(),
    true,
  );
  await creator.screenshot({ path: `${output}/create-retry.png` });
  await creator.getByRole("button", { name: "CREATE ROOM" }).click();
  await creator.locator(".fui-name-input").fill("SKYE");
  await creator.getByRole("button", { name: "JOIN BATTLE" }).click();
  const code = await creator.locator(".birds-code").innerText();
  async function join(page: Page, name: string) {
    await page.goto(`${base}/fuse-birds/?room=${code}&mute`);
    await page.locator(".fui-name-input").fill(name);
    await page.getByRole("button", { name: "JOIN BATTLE" }).click();
    await page
      .locator(".birds-roster")
      .getByText(`${name} · YOU`, { exact: true })
      .waitFor();
  }
  async function leave(page: Page) {
    await page.locator("summary").filter({ hasText: "MENU" }).click();
    await page.getByRole("button", { name: "LEAVE", exact: true }).click();
    await page.getByRole("button", { name: "CREATE ROOM" }).waitFor();
  }
  await join(successor, "EMBER");
  await creator
    .locator(".birds-roster")
    .getByText("EMBER", { exact: true })
    .waitFor();
  await leave(creator);
  await successor
    .getByRole("button", { name: "START BATTLE" })
    .waitFor({ timeout: 30_000 });
  assert.equal(
    await successor.getByRole("button", { name: "START BATTLE" }).isDisabled(),
    true,
  );
  await join(survivor, "FERN");
  await successor.getByRole("button", { name: "START BATTLE" }).click();
  for (const page of [successor, survivor])
    await page
      .locator('canvas[data-ready="true"]')
      .waitFor({ timeout: 60_000 });
  await successor
    .locator(".birds-turn")
    .filter({ hasText: "YOUR TURN" })
    .waitFor();
  await successor.getByRole("button", { name: "PASS", exact: true }).click();
  await survivor
    .locator(".birds-turn")
    .filter({ hasText: "YOUR TURN" })
    .waitFor();
  await leave(successor);
  const turn = await survivor.locator(".birds-room").getAttribute("data-turn");
  await survivor.getByRole("button", { name: "PASS", exact: true }).click();
  await survivor.waitForFunction(
    (previous) =>
      document.querySelector<HTMLElement>(".birds-room")?.dataset.turn !==
      previous,
    turn,
  );
  await survivor.screenshot({ path: `${output}/surviving-room.png` });
  assert.equal(
    await survivor.locator(".birds-room").getAttribute("data-phase"),
    "aiming",
  );
  assert.deepEqual(errors, []);
  console.log(
    `Room ${code}: failed room creation showed retry and recovered; lobby ownership survived creator leave; successor admitted a new player and started; after the successor left mid-match, the remaining peer applied an ordinary turn action. ${output}`,
  );
} catch (error) {
  for (const [index, page] of pages.entries()) {
    console.error(await page.locator("body").innerText());
    await page.screenshot({ path: `${output}/failure-${index}.png` });
  }
  throw error;
} finally {
  await browser.close();
}
