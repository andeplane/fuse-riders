import assert from "node:assert/strict";
import { chromium, type Page } from "playwright";

// Two browsers play one online Versus room through the local room service
// (`pnpm dev`, port 8787): create, join by link, start, grow both networks,
// then return to the lobby. Pass a base URL to target another service.
const base = process.argv[2] ?? "http://localhost:8787";
const out = process.argv[3] ?? "/tmp/fuse-craft-versus";
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
  await host.goto(`${base}/neural-defence/?mute`);
  await host.locator('[data-action="multiplayer"]').click();
  await host.locator('[data-action="create-room"]').click();
  await host.locator(".room-code").waitFor({ timeout: 15_000 });
  const code = (await host.locator(".room-code").innerText()).trim();
  assert.match(host.url(), new RegExp(`room=${code}`));
  await join(host, "Host");
  const friend = await open("friend");
  await friend.goto(`${base}/neural-defence/?mute&room=${code}`);
  await join(friend, "Friend");
  for (const page of [host, friend])
    for (const name of ["Host", "Friend"])
      await page
        .locator(".room-seat", { hasText: name })
        .waitFor({ timeout: 20_000 });
  assert.equal(
    await friend.locator('[data-action="start-room"]').count(),
    0,
    "only the host starts the match",
  );
  await host.screenshot({ path: `${out}-lobby.png` });
  await host.locator('[data-action="start-room"]').click();
  for (const page of [host, friend])
    await page.locator(".structure-brain").nth(1).waitFor({ timeout: 20_000 });
  for (const page of [host, friend])
    await page.locator('[data-action="auto-expand"]').click();
  // Both views converge on the same networks.
  await host.waitForFunction(
    () => document.querySelectorAll(".structure-neuron").length >= 4,
    undefined,
    { timeout: 60_000 },
  );
  const cells = (page: Page) =>
    page
      .locator(".structure")
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-cell")).sort(),
      );
  await friend.waitForTimeout(1500);
  await host.waitForTimeout(1500);
  const [a, b] = await Promise.all([cells(host), cells(friend)]);
  const shared = a.filter((cell) => b.includes(cell));
  assert.ok(
    shared.length >= Math.min(a.length, b.length) - 2,
    `views agree on the networks: ${a} vs ${b}`,
  );
  await host.screenshot({ path: `${out}-host.png` });
  await friend.screenshot({ path: `${out}-friend.png` });
  // The host returns everyone to the lobby.
  await host.locator('[data-action="reset"]').click();
  await host.locator('[data-action="confirm-reset"]').click();
  for (const page of [host, friend])
    await page.locator(".room-seats").waitFor({ timeout: 20_000 });
  assert.deepEqual(errors, []);
  console.log(
    `versus room ${code}: lobby, start, synced growth and return to lobby passed`,
  );
} finally {
  await browser.close();
}
