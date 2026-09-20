import { readyRoom } from "./lib/ready-room.js";
/** Real navigation/runtime with the identity module replaced at the browser boundary.
 * No Firebase credentials or production services: profile HTTP is a deterministic fixture.
 */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { chromium, webkit, type Page } from "playwright";
import { createServer } from "vite";
import { createDevRoomService } from "../service/dev.js";

const origin = "http://127.0.0.1:4197";
const service = createDevRoomService({ allowedOrigins: [origin] });
await new Promise<void>((resolve) =>
  service.server.listen(0, "127.0.0.1", resolve),
);
const api = `http://127.0.0.1:${(service.server.address() as AddressInfo).port}`;
const vite = await createServer({
  server: { host: "127.0.0.1", port: 4197, strictPort: true },
  define: { "import.meta.env.VITE_API_ORIGIN": JSON.stringify(api) },
  logLevel: "error",
});
await vite.listen();
await mkdir("artifacts", { recursive: true });
const rating = "Neon Rider 969 ELO";
const inside = async (page: Page) => {
  const account = page.getByRole("button", { name: rating, exact: true });
  await account.waitFor({ state: "visible" });
  const box = await account.boundingBox(),
    viewport = page.viewportSize()!;
  assert.ok(
    box &&
      box.x >= 0 &&
      box.y >= 0 &&
      box.x + box.width <= viewport.width + 1 &&
      box.y + box.height <= viewport.height + 1,
    "Elo remains visible within viewport",
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    ),
    false,
    "No horizontal overflow",
  );
};
try {
  for (const [name, launcher] of [
    ["chromium", chromium],
    ["webkit", webkit],
  ] as const) {
    const browser = await launcher.launch({ headless: true });
    try {
      for (const phone of [false, true]) {
        const page = await browser.newPage({
          viewport: phone
            ? { width: 390, height: 844 }
            : { width: 1440, height: 1000 },
          isMobile: phone,
          hasTouch: phone,
        });
        await page.addInitScript("window.__name = value => value");
        const errors: string[] = [];
        page.on("pageerror", (e) => {
          if (!/access control checks/.test(e.message)) errors.push(e.message);
        });
        // Only authentication is substituted; actual createAccountPanel and room navigation execute unchanged.
        await page.route(
          "**/games/fuse-riders/src/online/account.ts",
          (route) =>
            route.fulfill({
              contentType: "application/javascript",
              body: `
          export const remembersSignIn = () => false;
          export const accountUsername = () => 'Neon Rider';
          export const rememberUsername = () => {};
          export const fetchUsername = async () => 'Neon Rider';
          export const warmAccount = () => {};
          export const accountReady = async () => {};
          export const watchAccount = listener => { listener({name:'Google Legal Name'}); return () => {}; };
          export const signIn = async () => {};
          export const signOut = async () => {};
          export const signedInToken = async () => undefined;
          export const identityToken = async () => 'smoke:header';
          export const signInFailure = () => '';
        `,
            }),
        );
        await page.route(`${api}/api/me`, (route) =>
          route.fulfill({
            json: {
              profile: {
                username: "Neon Rider",
                rank: 3,
                rating: { value: 969, games: 12 },
              },
            },
          }),
        );
        await page.route(`${api}/api/me/matches*`, (route) =>
          route.fulfill({ json: { matches: [] } }),
        );
        let feedRequests = 0;
        await page.route(`${api}/api/matches*`, (route) => {
          feedRequests++;
          return route.fulfill({ json: { matches: [] } });
        });
        await page.route(`${api}/api/leaderboard*`, (route) =>
          route.fulfill({ json: { players: [] } }),
        );
        await page.goto(origin);
        await inside(page);
        await page.screenshot({
          path: `artifacts/top-menu-${name}-${phone ? "phone" : "desktop"}-home.png`,
        });
        const radioStyle = await page
          .locator(".audio-controls > summary")
          .evaluate((el) => {
            const css = getComputedStyle(el);
            return [css.font, css.letterSpacing];
          });
        const style = await page
          .getByRole("button", { name: "SETTINGS", exact: true })
          .evaluate((el) => {
            const css = getComputedStyle(el);
            return [css.font, css.borderColor, css.backgroundColor];
          });
        await page
          .getByRole("button", { name: "CREATE ROOM", exact: true })
          .click();
        await page
          .getByRole("button", { name: "ROOM SETTINGS", exact: true })
          .waitFor();
        await page
          .getByRole("button", { name: "JOIN AS PLAYER", exact: true })
          .click();
        await inside(page);
        assert.deepEqual(
          await page
            .getByRole("button", { name: "SETTINGS", exact: true })
            .evaluate((el) => {
              const css = getComputedStyle(el);
              return [css.font, css.borderColor, css.backgroundColor];
            }),
          style,
          "Lobby and home use the same menu style",
        );
        for (const label of [
          "♫ RADIO",
          /♫ MUSIC (ON|OFF)/,
          /🔊 SOUND (ON|OFF)/,
          "SETTINGS",
          "MATCHES",
          "#3 · LEADERBOARD",
          rating,
        ])
          await page
            .getByRole("button", { name: label, exact: true })
            .waitFor({ state: "visible" });
        assert.deepEqual(
          await page
            .getByRole("button", { name: "♫ RADIO", exact: true })
            .evaluate((el) => {
              const css = getComputedStyle(el);
              return [css.font, css.letterSpacing];
            }),
          radioStyle,
          "Radio typography is consistent",
        );
        await page.screenshot({
          path: `artifacts/top-menu-${name}-${phone ? "phone" : "desktop"}-lobby.png`,
        });
        await page.getByRole("button", { name: "ADD AI", exact: true }).click();
        if (phone) await page.setViewportSize({ width: 844, height: 390 });
        await readyRoom(page);
        await page.locator(phone ? ".mobile-play" : ".desktop-game").waitFor();
        await inside(page);
        if (phone) {
          const accountBox = await page
            .getByRole("button", { name: rating, exact: true })
            .boundingBox();
          const hud = page.locator(".mobile-hud:not([hidden])");
          await hud.waitFor({ state: "visible" });
          const hudBox = await hud.boundingBox();
          assert.ok(
            accountBox &&
              hudBox &&
              (accountBox.x + accountBox.width <= hudBox.x ||
                hudBox.x + hudBox.width <= accountBox.x ||
                accountBox.y + accountBox.height <= hudBox.y ||
                hudBox.y + hudBox.height <= accountBox.y),
            "Account button never covers the live rider HUD",
          );
        }
        await page.screenshot({
          path: `artifacts/top-menu-${name}-${phone ? "phone" : "desktop"}-play.png`,
        });
        await page.getByRole("button", { name: rating, exact: true }).click();
        await page.locator(".stats-dialog[open]").waitFor();
        // An empty feed is read once, not refetched on every redraw.
        await page
          .locator(".stats-tabs")
          .getByRole("button", { name: "MATCHES", exact: true })
          .click();
        await page
          .getByText("No finished games yet", { exact: false })
          .waitFor();
        await page.waitForTimeout(500);
        assert.equal(feedRequests, 1, "An empty match feed is fetched once");
        await page.getByRole("button", { name: "CLOSE", exact: true }).click();
        if (phone) {
          await page
            .getByRole("button", { name: "☰ MENU", exact: true })
            .click();
          await page
            .getByRole("button", { name: "#3 · LEADERBOARD", exact: true })
            .waitFor({ state: "visible" });
          await inside(page);
        }
        assert.deepEqual(errors, [], "No browser exceptions");
        if (!phone) {
          const refreshChecks = await page.evaluate(async () => {
            const path = "/games/fuse-riders/src/online/account-panel.ts";
            const { createAccountPanel } = (await import(
              path
            )) as typeof import("../games/fuse-riders/src/online/account-panel.js");
            let now = 0,
              requests = 0,
              score = 1000,
              offline = false;
            const pending = new Map<number, () => void>();
            const delays: number[] = [];
            let timerId = 0;
            const panel = createAccountPanel({
              profileUrl: "/profile",
              leaderboardUrl: "/board",
              historyUrl: () => "/history",
              matchesUrl: () => "/matches",
              localName: () => "Test",
              track: () => {},
              fetch: async () => {
                requests++;
                if (offline) throw new Error("offline");
                return new Response(
                  JSON.stringify({
                    profile: { rank: 3, rating: { value: score, games: 12 } },
                  }),
                );
              },
              auth: {
                watch: (cb) => {
                  cb({ name: "Test" });
                  return () => {};
                },
                token: async () => "test",
                ready: async () => {},
                warm: () => {},
                signIn: async () => {},
                signOut: async () => {},
                remember: () => {},
              },
              refreshClock: {
                now: () => now,
                schedule: (callback, ms) => {
                  const id = ++timerId;
                  pending.set(id, callback);
                  delays.push(ms);
                  return () => {
                    pending.delete(id);
                  };
                },
              },
            });
            const changed = (ready: () => boolean) =>
              new Promise<void>((resolve) => {
                if (ready()) {
                  resolve();
                  return;
                }
                const observer = new MutationObserver(() => {
                  if (ready()) {
                    observer.disconnect();
                    resolve();
                  }
                });
                observer.observe(panel.button, {
                  childList: true,
                  subtree: true,
                  attributes: true,
                });
              });
            await changed(() => panel.button.textContent === "Test\n1,000 ELO");
            panel.refresh();
            panel.refresh();
            panel.refresh();
            const coalesced =
              pending.size === 1 && requests === 1 && delays[0] === 15000;
            score = 1016;
            now = 15000;
            const scheduled = [...pending.values()];
            pending.clear();
            scheduled.forEach((run) => run());
            await changed(() => panel.button.textContent === "Test\n1,016 ELO");
            const updated =
              panel.button.textContent === "Test\n1,016 ELO" &&
              requests === 2 &&
              pending.size === 0;
            offline = true;
            panel.refresh();
            now = 30000;
            const failure = [...pending.values()];
            pending.clear();
            failure.forEach((run) => run());
            await changed(() =>
              panel.button.title.includes("Could not refresh"),
            );
            const retained = panel.button.textContent === "Test\n1,016 ELO";
            panel.refresh();
            panel.dispose();
            if (!updated || !retained)
              throw new Error(
                JSON.stringify({
                  label: panel.button.textContent,
                  requests,
                  pending: pending.size,
                }),
              );
            return {
              coalesced,
              updated,
              retained,
              cancelled: pending.size === 0,
            };
          });
          assert.deepEqual(refreshChecks, {
            coalesced: true,
            updated: true,
            retained: true,
            cancelled: true,
          });
        }
        await page.close();
      }
      console.log(
        `${name}: consistent home/lobby menu and visible Elo in desktop/phone play PASS`,
      );
    } finally {
      await browser.close();
    }
  }
} finally {
  await vite.close();
  await service.close();
}
