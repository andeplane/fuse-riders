import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { launchSelected } from "./lib/browser.js";
import type { Page } from "playwright";

async function renderedArena(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(".fd-arena");
    if (canvas?.dataset.ready !== "true") return false;
    const box = canvas.getBoundingClientRect();
    return box.width > innerWidth * 0.6 && box.bottom <= innerHeight;
  });
}

const origin = process.env.ONLINE_URL ?? "http://localhost:8797/";
const browser = await launchSelected("chrome");
const failures: string[] = [];
await mkdir("artifacts/fuse-drivers", { recursive: true });
const contexts = await Promise.all([
  browser.newContext({ viewport: { width: 1440, height: 900 } }),
  browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  }),
  browser.newContext({ viewport: { width: 1440, height: 900 } }),
]);
try {
  const host = await contexts[0]!.newPage();
  const peer = await contexts[1]!.newPage();
  const tv = await contexts[2]!.newPage();
  for (const page of [host, peer, tv])
    page.on("pageerror", (error) => failures.push(error.message));
  await host.goto(new URL("?mute", origin).href);
  await host.getByRole("button", { name: "Fuse games", exact: true }).click();
  await host.getByRole("link", { name: /Fuse Drivers/ }).click();
  assert.equal(new URL(host.url()).searchParams.has("mute"), true);
  await host.goto(new URL("fuse-drivers/?solo=1&mute", origin).href);
  await host.locator(".fd-hud").filter({ hasText: "LAP" }).waitFor();
  await host.locator(".fd-arena").waitFor({ state: "visible" });
  await renderedArena(host);
  await host.screenshot({ path: "artifacts/fuse-drivers/solo.png" });
  await host.goto(new URL("fuse-drivers/?mute", origin).href);
  await host
    .getByRole("checkbox", { name: "Shared TV + phone controllers" })
    .check();
  await host.getByRole("button", { name: "CREATE ROOM", exact: true }).click();
  await host.waitForURL(/room=/);
  const code = new URL(host.url()).searchParams.get("room")!;
  await host.getByPlaceholder("Your name").fill("Ada");
  await host
    .getByRole("button", { name: "JOIN THE GRID", exact: true })
    .click();
  await peer.goto(new URL(`fuse-drivers/?room=${code}&mute`, origin).href);
  await peer.getByPlaceholder("Your name").fill("Bo");
  await peer
    .getByRole("button", { name: "JOIN THE GRID", exact: true })
    .click();
  await host.locator(".fui-roster-name", { hasText: "Bo" }).waitFor();
  const displayUrl = await host
    .getByRole("link", { name: "OPEN TV DISPLAY" })
    .getAttribute("href");
  await tv.goto(`${displayUrl!}&mute`);
  await host.screenshot({ path: "artifacts/fuse-drivers/room-lobby.png" });
  await host.getByRole("button", { name: "START RACE", exact: true }).click();
  await Promise.all(
    [host, peer].map((page) =>
      page.locator(".fd-hud").filter({ hasText: "LAP" }).waitFor(),
    ),
  );
  await tv.locator(".fd-arena").waitFor({ state: "visible" });
  await renderedArena(tv);
  await host.locator(".fd-arena").waitFor({ state: "hidden" });
  await peer.locator(".fd-arena").waitFor({ state: "hidden" });
  await tv.locator(".fd-pad").waitFor({ state: "hidden" });
  await peer.screenshot({ path: "artifacts/fuse-drivers/phone-race.png" });
  await host.screenshot({ path: "artifacts/fuse-drivers/room-race.png" });
  await tv.screenshot({ path: "artifacts/fuse-drivers/tv-race.png" });
  await peer.reload();
  await peer.locator(".fd-hud").filter({ hasText: "LAP" }).waitFor();
  assert.deepEqual(failures, []);
  console.log(
    "Fuse Drivers solo, portal, two-peer room and reload smoke passed",
  );
} finally {
  await Promise.all(contexts.map((context) => context.close()));
  await browser.close();
}
