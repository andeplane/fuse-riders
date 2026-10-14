/** Actual solo runtime → recap → history, with a typed test account adapter and real local HTTP settlement.
 * No production OAuth or Firestore is used. Both signed-in and guest games run normally; no simulation is injected.
 */
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { createServer } from "vite";
import { chromium } from "playwright";
import { createDevRoomService } from "../service/dev.js";
import {
  defaultRoomSettings,
  SETTINGS_KEY,
} from "../games/fuse-riders/src/engine/room-settings.js";

const accountPath = fileURLToPath(
  new URL("../games/fuse-riders/src/online/account.ts", import.meta.url),
);
const vite = await createServer({
  server: { host: "127.0.0.1", port: 0 },
  logLevel: "error",
  define: { "import.meta.env.VITE_API_ORIGIN": JSON.stringify("") },
  plugins: [
    {
      name: "solo-history-test-account",
      enforce: "pre",
      async load(id) {
        if (id.split("?")[0] === accountPath)
          return readFile(
            new URL("./fixtures/solo-history-account.ts", import.meta.url),
            "utf8",
          );
      },
    },
  ],
});
await vite.listen();
const origin = `http://127.0.0.1:${(vite.httpServer!.address() as AddressInfo).port}`;
const service = createDevRoomService({
  allowedOrigins: [origin],
  identity: async (token) =>
    token === "smoke:solo-player" ? "solo-player" : undefined,
});
await new Promise<void>((resolve) =>
  service.server.listen(0, "127.0.0.1", resolve),
);
const api = `http://127.0.0.1:${(service.server.address() as AddressInfo).port}`;
// Both listeners select free ports. Supply the API origin before the browser requests any app modules.
vite.config.define!["import.meta.env.VITE_API_ORIGIN"] = JSON.stringify(api);
const browser = await chromium.launch({
  headless: true,
  args: ["--mute-audio"],
});
await mkdir("artifacts", { recursive: true });
try {
  for (const signedIn of [true, false]) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    await context.addInitScript(
      ({ signedIn, key, settings }) => {
        localStorage.setItem(key, JSON.stringify(settings));
        if (signedIn) localStorage.setItem("solo-history-smoke-account", "1");
      },
      {
        signedIn,
        key: SETTINGS_KEY,
        settings: { ...defaultRoomSettings(), match: "rounds", length: 1 },
      },
    );
    const page = await context.newPage();
    const reports: string[] = [],
      errors: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/results"))
        reports.push(request.url());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", async (response) => {
      if (
        response.request().method() === "POST" &&
        response.url().includes("results")
      )
        console.log(
          `Report ${response.url().split("/api/")[1]}: ${response.status()} ${await response.text()}`,
        );
    });
    const finishedReport = signedIn
      ? page.waitForResponse(
          (response) =>
            response.url() === `${api}/api/me/results` &&
            response.request().method() === "POST",
          { timeout: 180_000 },
        )
      : undefined;
    await page.goto(`${origin}/?solo=1&mute`);
    await page.locator(".recap-dialog[open]").waitFor({ timeout: 180_000 });
    if (signedIn) {
      const response = await finishedReport!;
      assert.equal(response.status(), 200, await response.text());
      await page.getByRole("button", { name: "CLOSE", exact: true }).click();
      await page.getByRole("button", { name: "MATCHES", exact: true }).click();
      await page.getByRole("button", { name: "YOURS", exact: true }).click();
      await page.locator(".account-match").waitFor();
      assert.equal(await page.locator(".account-match").count(), 1);
      await page.screenshot({ path: "artifacts/solo-history-yours.png" });
      await page.getByRole("button", { name: "EVERYONE", exact: true }).click();
      await page.locator(".account-match").waitFor();
      assert.equal(await page.locator(".account-match").count(), 1);
      await page.locator(".account-match-open").click();
      await page.locator(".stats-dialog[open] .match-recap-report").waitFor();
      await page.screenshot({ path: "artifacts/solo-history-results.png" });
      assert.equal(reports.length, 1);
    } else
      assert.equal(reports.length, 0, "guest solo has no whole-game report");
    assert.deepEqual(errors, []);
    await context.close();
  }
  const profile = (await (
    await fetch(`${api}/api/me`, {
      headers: { Origin: api, Authorization: "Bearer smoke:solo-player" },
    })
  ).json()) as {
    profile: {
      totals: { matches: number };
      rating: { value: number; rounds: number };
    };
  };
  assert.equal(profile.profile.totals.matches, 1);
  assert.equal(profile.profile.rating.value, 1000);
  assert.equal(profile.profile.rating.rounds, 1);
  console.log(
    "PASS: signed-in solo recap records one career game in YOURS and EVERYONE; guest solo sends none; Elo unchanged.",
  );
} catch (error) {
  for (const context of browser.contexts())
    for (const page of context.pages()) {
      await page.screenshot({ path: "artifacts/solo-history-failure.png" });
      console.log((await page.locator("body").innerText()).slice(-2000));
    }
  throw error;
} finally {
  await browser.close();
  await vite.close();
  await service.close();
}
