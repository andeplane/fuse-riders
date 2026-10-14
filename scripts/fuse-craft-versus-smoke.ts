import assert from "node:assert/strict";
import { chromium, type Page } from "playwright";

// N browsers play one online Versus room through the local room service
// (`pnpm dev`, port 8787): create, join by link, pick the map, start, grow
// every network, then return to the lobby.
//   tsx scripts/fuse-craft-versus-smoke.ts [base] [out] [players] [map]
const base = process.argv[2] ?? "http://localhost:8787";
const out = process.argv[3] ?? "/tmp/fuse-craft-versus";
const players = Number(process.argv[4] ?? "2");
const mapId =
  process.argv[5] ?? (players > 2 ? "cortex-crossing" : "close-quarters");
const names = ["Host", "Friend", "Third", "Fourth", "Fifth", "Sixth"].slice(
  0,
  players,
);
const browser = await chromium.launch();
const errors: string[] = [];
const open = async (name: string) => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`${name}: ${error.message}`));
  return page;
};
const join = async (page: Page, name: string) => {
  await page.locator("#player-name").fill(name);
  await page.locator('[data-action="join-seat"]').click();
};
try {
  const host = await open("host");
  await host.goto(`${base}/fuse-craft/?mute`);
  await host.locator('[data-action="multiplayer"]').click();
  await host.locator('[data-action="create-room"]').click();
  await host.locator(".room-code").waitFor({ timeout: 15_000 });
  const code = (await host.locator(".room-code").innerText()).trim();
  assert.match(host.url(), new RegExp(`room=${code}`));
  await join(host, "Host");
  await host.locator("#room-map").selectOption(mapId);
  const guests: Page[] = [];
  for (const name of names.slice(1)) {
    const page = await open(name.toLowerCase());
    await page.goto(`${base}/fuse-craft/?mute&room=${code}`);
    await join(page, name);
    guests.push(page);
  }
  const everyone = [host, ...guests];
  for (const page of everyone) {
    for (const name of names)
      await page
        .locator(".room-seat", { hasText: name })
        .waitFor({ timeout: 20_000 });
    assert.equal(await page.locator("#room-map").inputValue(), mapId);
  }
  for (const page of guests)
    assert.equal(
      await page.locator('[data-action="start-room"]').count(),
      0,
      "only the host starts the match",
    );
  await host.screenshot({ path: `${out}-lobby.png` });
  await host.locator('[data-action="start-room"]').click();
  for (const page of everyone)
    await page
      .locator(".structure-brain")
      .nth(players - 1)
      .waitFor({ timeout: 20_000 });
  for (const page of everyone)
    await page.locator('[data-action="auto-expand"]').click();
  // Every view converges on the same networks.
  await host.waitForFunction(
    (count) => document.querySelectorAll(".structure-neuron").length >= count,
    players * 2,
    { timeout: 90_000 },
  );
  const cells = (page: Page) =>
    page
      .locator(".structure")
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-cell")).sort(),
      );
  await host.waitForTimeout(1500);
  const views = await Promise.all(everyone.map(cells));
  for (const [i, view] of views.entries()) {
    const shared = views[0]!.filter((cell) => view.includes(cell));
    assert.ok(
      shared.length >= Math.min(views[0]!.length, view.length) - 2 * players,
      `${names[i]} agrees on the networks: ${views[0]} vs ${view}`,
    );
  }
  for (const [i, page] of everyone.entries())
    await page.screenshot({
      path: `${out}-${names[i]!.toLowerCase()}.png`,
    });
  // The host returns everyone to the lobby.
  await host.locator('[data-action="reset"]').click();
  await host.locator('[data-action="confirm-reset"]').click();
  for (const page of everyone)
    await page.locator(".room-seats").waitFor({ timeout: 20_000 });
  assert.deepEqual(errors, []);
  console.log(
    `versus room ${code} (${players} players, ${mapId}): lobby, start, synced growth and return to lobby passed`,
  );
} finally {
  await browser.close();
}
