import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { launchSelected } from "./lib/browser.js";
import { readyRoom } from "./lib/ready-room.js";

const browser = await launchSelected("chromium", { headless: true });
const base = process.env.ONLINE_URL ?? "http://localhost:8791/";
const errors: string[] = [];
try {
  const tv = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const a = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const b = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  for (const page of [tv, a, b]) {
    page.setDefaultTimeout(20000);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      window.addEventListener("fuse-benchmark", (event) => {
        const detail = (event as CustomEvent).detail;
        if (detail.kind === "snapshot")
          Reflect.set(window, "readySnapshot", detail);
      });
    });
  }
  await tv.goto(new URL("?mute&benchmark=1", base).href);
  await tv
    .locator(".landing-mode label", {
      has: tv.getByRole("radio", { name: "Shared TV", exact: true }),
    })
    .click();
  await tv.getByRole("button", { name: "CREATE ROOM", exact: true }).click();
  await tv.waitForURL(/room=/);
  const invite = new URL(tv.url());
  invite.searchParams.set("mute", "1");
  invite.searchParams.set("benchmark", "1");
  await tv.getByRole("button", { name: "ROOM SETTINGS", exact: true }).click();
  await tv.getByLabel("Match length").fill("1");
  await tv.getByRole("button", { name: "SAVE SETTINGS", exact: true }).click();
  for (const [page, name] of [
    [a, "Ada"],
    [b, "Bo"],
  ] as const) {
    await page.goto(invite.href);
    await page.getByPlaceholder("Your name").fill(name);
    await page
      .getByRole("button", { name: "JOIN AS PLAYER", exact: true })
      .click();
    await page.getByRole("button", { name: "READY", exact: true }).waitFor();
  }
  assert.equal(
    await tv.getByRole("button", { name: "READY", exact: true }).count(),
    0,
  );
  await a.getByRole("button", { name: "READY", exact: true }).click();
  await a.getByRole("button", { name: "NOT READY", exact: true }).waitFor();
  await a.getByRole("button", { name: "NOT READY", exact: true }).click();
  await a.getByRole("button", { name: "READY", exact: true }).waitFor();
  await b.getByRole("button", { name: "READY", exact: true }).click();
  await b.getByRole("button", { name: "NOT READY", exact: true }).waitFor();
  await mkdir("artifacts", { recursive: true });
  await tv.screenshot({ path: "artifacts/ready-check-tv.png" });
  await a.screenshot({ path: "artifacts/ready-check-phone.png" });
  for (const page of [a, b])
    await page.setViewportSize({ width: 844, height: 390 });
  await a.getByRole("button", { name: "READY", exact: true }).click();
  for (const page of [a, b])
    await page.locator(".mobile-play.controller-only").waitFor();
  await a.waitForFunction(
    () => Reflect.get(window, "readySnapshot")?.phase === "countdown",
  );
  const old = await a.evaluate(
    () => Reflect.get(window, "readySnapshot").matchId,
  );
  await a.waitForFunction(
    () =>
      document
        .querySelector(".online-notice")
        ?.textContent?.includes("MATCH COMPLETE"),
    {},
    { timeout: 120000 },
  );
  // Phone controls must offer rematch without touching the TV; the real helper opens the phone menu if needed.
  await readyRoom(a);
  for (const page of [a, b])
    await page.waitForFunction((previous) => {
      const snapshot = Reflect.get(window, "readySnapshot");
      return snapshot?.matchId !== previous && snapshot?.phase === "countdown";
    }, old);
  await a.screenshot({ path: "artifacts/ready-check-rematch.png" });
  assert.deepEqual(errors, []);
  console.log(
    "Ready check passed: unseated TV, two phone voters, toggle off/on, automatic start and rematch, no TV interaction.",
  );
} finally {
  await browser.close();
}
