import assert from "node:assert/strict";
import { readdir, access, mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { startRoomService } from "./lib/server.js";

/** Intercept real SDK requests from every shipped page; never send test metrics to Mixpanel. Build first. */
const server = process.env.HOME_URL ? undefined : await startRoomService();
const base = process.env.HOME_URL ?? server!.url;
const pages = [{ gameId: "fuse-riders", path: "fuse-riders/" }];
for (const gameId of await readdir("games")) {
  if (gameId === "fuse-riders") continue;
  try {
    await access(`games/${gameId}/index.html`);
  } catch {
    continue;
  }
  pages.push({ gameId, path: `${gameId}/` });
}
const browser = await chromium.launch({ args: ["--mute-audio"] });
const evidence: { gameId: string; events: string[] }[] = [];
try {
  for (const { gameId, path } of pages) {
    const context = await browser.newContext();
    const reported: { event: string; properties: Record<string, unknown> }[] =
      [];
    let opened!: () => void;
    const opening = new Promise<void>((resolve) => {
      opened = resolve;
    });
    await context.route("**/*mixpanel.com/**", async (route) => {
      const raw = new URLSearchParams(route.request().postData() ?? "").get(
        "data",
      );
      if (raw) {
        const payload: unknown = JSON.parse(raw);
        assert.ok(Array.isArray(payload));
        reported.push(...payload);
        if (reported.some((event) => event.event === "fuse.App Opened"))
          opened();
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: '{"status":1}',
      });
    });
    const page = await context.newPage();
    const bootErrors: string[] = [];
    page.on("pageerror", (error) => bootErrors.push(error.name));
    try {
      await page.goto(`${base}${path}?mute&analytics=1`);
      let timer: ReturnType<typeof setTimeout>;
      try {
        await Promise.race([
          opening,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new Error(
                    `${gameId}: no App Opened payload; page errors: ${bootErrors.join(", ") || "none"}`,
                  ),
                ),
              45000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer!);
      }
      assert.equal(
        reported.filter((event) => event.event === "fuse.App Opened").length,
        1,
        gameId,
      );
      for (const event of reported) {
        assert.ok(event.event.startsWith("fuse."), event.event);
        assert.equal(event.properties.gameId, gameId);
        for (const forbidden of [
          "$current_url",
          "$referrer",
          "$initial_referrer",
        ])
          assert.equal(event.properties[forbidden], undefined);
      }
      evidence.push({ gameId, events: reported.map((event) => event.event) });
      console.log(`${gameId}: shared prefix, gameId and opening verified`);
    } finally {
      await context.close();
    }
  }
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/all-games-analytics.json",
    JSON.stringify(evidence, null, 2),
  );
} finally {
  await browser.close();
  await server?.stop();
}
