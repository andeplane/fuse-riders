/** Real history HTTP + UI with an injected identity provider. No real Google account or production data. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { createServer } from "vite";
import { chromium, webkit } from "playwright";
import { WebSocket } from "ws";
import { createDevRoomService } from "../service/dev.js";
import { authFrame, peerId } from "fuse-network-be";
import {
  beginMatchParticipant,
  recordDeath,
  snapshotMatchStats,
  type MatchStatsState,
} from "../games/fuse-riders/src/engine/match-stats.js";
import type { MatchResult } from "../games/fuse-riders/src/platform.js";

const vite = await createServer({
  server: { host: "127.0.0.1", port: 0 },
  logLevel: "error",
});
await vite.listen();
const origin = `http://127.0.0.1:${(vite.httpServer!.address() as AddressInfo).port}`;
let now = Date.now();
const service = createDevRoomService({
  now: () => now,
  allowedOrigins: [origin],
  identity: async (token) =>
    token.startsWith("smoke:") ? token.slice(6) : undefined,
});
await new Promise<void>((resolve) =>
  service.server.listen(0, "127.0.0.1", resolve),
);
const api = `http://127.0.0.1:${(service.server.address() as AddressInfo).port}`;
const sockets: WebSocket[] = [];
const call = (path: string, init: RequestInit = {}) =>
  fetch(api + path, { ...init, headers: { Origin: api, ...init.headers } });
try {
  const created = (await (
    await call("/api/rooms", { method: "POST" })
  ).json()) as { code: string; token: string };
  const tokens = [created.token, "a".repeat(64), "b".repeat(64)];
  for (const token of tokens)
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(
        `${api.replace("http", "ws")}/api/rooms/${created.code}/ws`,
        { origin: api },
      );
      sockets.push(socket);
      // The token is the socket's first frame and never part of its URL (docs/online/TOKEN-TRANSPORT.md).
      socket.once("open", () => socket.send(authFrame(token)));
      socket.once("message", () => resolve());
      socket.once("error", reject);
    });
  const ids = tokens.map(peerId);
  for (let match = 0; match < 8; match++) {
    now += 1000;
    const participants =
      match === 7 ? [ids[0]!, "bot:1"] : match % 2 ? ids : [...ids, "bot:1"];
    const stats: MatchStatsState = new Map();
    participants.forEach((id, slot) =>
      beginMatchParticipant(stats, {
        id,
        slot,
        name: ["Neon Rider", "Alex", "Sam", "CPU"][slot]!,
        color: ["#22d3ee", "#ff4fa3", "#a3e635", "#fb923c"][slot]!,
      }),
    );
    if (participants.includes(ids[1]!)) {
      recordDeath(stats, ids[1]!, "explosion", ids[0], "shell");
      recordDeath(stats, ids[0]!, "trail", ids[1]);
    }
    if (participants.includes("bot:1"))
      recordDeath(stats, "bot:1", "explosion", ids[0], "bomb");
    const players = snapshotMatchStats(stats).map((p, i) => ({
      ...p,
      roundsPlayed: 3,
      roundWins: i === match % 3 ? 2 : 0,
      matchScoreUnits: i === match % 3 ? 180 : 60 - i * 10,
      matchPlacement: i === match % 3 ? 1 : i === 0 ? 2 : 3,
      survivalTicks: 1700,
      longestSurvivalTicks: 820,
      distanceUnits: 9875.25,
      bombsPlaced: 12,
      pickupsCollected: 8,
    }));
    const result: MatchResult = {
      matchId: `smoke-${match}`,
      length: 3,
      finishers: participants.filter((id) => !id.startsWith("bot:")).sort(),
      players,
    };
    if (match === 7)
      players.forEach((p, i) => {
        p.matchPlacement = i + 1;
      });
    for (let i = 0; i < tokens.length; i++)
      if (participants.includes(ids[i]!)) {
        const response = await call(`/api/rooms/${created.code}/results`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${tokens[i]}`,
            "X-Fuse-Identity": `smoke:user${i}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ result }),
        });
        assert.equal(response.status, 200, await response.text());
        const roundResponse = await call(
          `/api/rooms/${created.code}/round-results`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${tokens[i]}`,
              "X-Fuse-Identity": `smoke:user${i}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              result: {
                ...result,
                round: 1,
                length: 1,
                players: players.map((p) => ({
                  ...p,
                  roundsPlayed: 1,
                  roundWins: p.roundWins ? 1 : 0,
                })),
              },
            }),
          },
        );
        assert.equal(roundResponse.status, 200, await roundResponse.text());
      }
  }
  const initial = (await (
    await call("/api/me", { headers: { Authorization: "Bearer smoke:user0" } })
  ).json()) as {
    profile: { rank: number; rating: { value: number; games: number } };
  };
  assert.equal(
    initial.profile.rating.games,
    8,
    "a lone signed-in human records a zero-change round",
  );
  await mkdir("artifacts", { recursive: true });
  for (const [name, launcher] of [
    ["chromium", chromium],
    ["webkit", webkit],
  ] as const) {
    const browser = await launcher.launch({ headless: true });
    try {
      for (const viewport of [
        { width: 1280, height: 1000 },
        { width: 390, height: 844 },
      ]) {
        const page = await browser.newPage({ viewport });
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        // tsx keepNames helper for functions serialized into page.evaluate; no game API is patched.
        await page.addInitScript("window.__name = value => value");
        await page.goto(origin);
        await page.locator(".online-app").waitFor();
        await page.evaluate(
          async ({ api }) => {
            const path = "/games/fuse-riders/src/online/account-panel.ts";
            const { createAccountPanel } = (await import(
              path
            )) as typeof import("../games/fuse-riders/src/online/account-panel.js");
            let listener:
              ((account: { name: string } | undefined) => void) | undefined;
            const panel = createAccountPanel({
              profileUrl: `${api}/api/me`,
              leaderboardUrl: `${api}/api/leaderboard`,
              historyUrl: (before) =>
                `${api}/api/me/matches${before === undefined ? "" : `?before=${before}`}`,
              localName: () => "Neon Rider",
              fetch: (input, init) => fetch(input, init),
              track: () => {},
              auth: {
                watch: (cb) => {
                  listener = cb;
                  cb({ name: "Neon Rider" });
                  return () => {};
                },
                token: async () => "smoke:user0",
                ready: async () => {},
                warm: () => {},
                signIn: async () => {
                  listener?.({ name: "Neon Rider" });
                },
                signOut: async () => {
                  listener?.(undefined);
                },
                remember: () => {},
              },
            });
            const app = document.querySelector(".online-app")!;
            const landing = app.querySelector(".landing-top-end")!;
            for (const control of landing.querySelectorAll(".landing-account"))
              control.remove();
            for (const dialog of app.querySelectorAll(".stats-dialog"))
              dialog.remove();
            landing.append(panel.leaderboardButton, panel.button);
            app.append(panel.dialog);
          },
          { api },
        );
        const current = (await (
          await call("/api/me", {
            headers: { Authorization: "Bearer smoke:user0" },
          })
        ).json()) as { profile: { username?: string; name?: string } };
        const expected = `${current.profile.username ?? current.profile.name ?? "Neon Rider"} ${Math.round(initial.profile.rating.value).toLocaleString()} ELO`;
        await page
          .getByRole("button", { name: expected, exact: true })
          .waitFor();
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > window.innerWidth + 1,
          ),
          false,
          "signed-in landing fits",
        );
        await page.screenshot({
          path: `artifacts/player-landing-${name}-${viewport.width}.png`,
        });
        await page.getByRole("button", { name: expected, exact: true }).click();
        await page.locator(".rating-chart").waitFor();
        assert.equal(
          await page.locator('[data-testid="elo-value"]').textContent(),
          Math.round(initial.profile.rating.value).toLocaleString(),
        );
        assert.equal(await page.locator(".rating-chart circle").count(), 9);
        assert.equal(
          await page.locator(".stats-primary dd").first().textContent(),
          "8",
        );
        await page
          .getByLabel("Game opponents", { exact: true })
          .selectOption("practice");
        assert.equal(
          await page.locator(".stats-primary dd").first().textContent(),
          "1",
        );
        await page
          .getByLabel("Game opponents", { exact: true })
          .selectOption("human");
        assert.equal(
          await page.locator(".stats-primary dd").first().textContent(),
          "3",
        );
        await page
          .getByLabel("Game opponents", { exact: true })
          .selectOption("mixed");
        assert.equal(
          await page.locator(".stats-primary dd").first().textContent(),
          "4",
        );
        await page
          .getByLabel("Combat opponent", { exact: true })
          .selectOption("ai");
        await page
          .getByText("Weapon & death breakdown", { exact: true })
          .click();
        assert.match(await page.locator(".stats-content").innerText(), /Bomb/);
        await page
          .getByLabel("Game opponents", { exact: true })
          .selectOption("all");
        const overflow = await page
          .locator(".stats-dialog .dialog-body")
          .evaluate((e) => e.scrollWidth > e.clientWidth + 1);
        assert.equal(overflow, false, "no horizontal overflow");
        await page.locator(".stats-dialog .dialog-body").evaluate((e) => {
          e.scrollTop = 0;
        });
        await page.screenshot({
          path: `artifacts/player-stats-${name}-${viewport.width}.png`,
        });
        await page
          .getByRole("button", { name: "GLOBAL LEADERBOARD", exact: true })
          .click();
        await page.locator(".stats-leaderboard").waitFor();
        assert.match(
          await page
            .locator('.stats-leaderboard tr[data-you="true"]')
            .innerText(),
          new RegExp(Math.round(initial.profile.rating.value).toLocaleString()),
        );
        await page.screenshot({
          path: `artifacts/player-leaderboard-${name}-${viewport.width}.png`,
        });
        await page
          .getByRole("button", { name: "MY STATS", exact: true })
          .click();
        await page.locator(".rating-chart").waitFor();
        await page.getByText("Account settings", { exact: true }).click();
        await page
          .getByLabel("USERNAME", { exact: true })
          .fill(`Rider ${viewport.width}`);
        await page.getByRole("button", { name: "SAVE", exact: true }).click();
        await page
          .getByRole("heading", {
            name: `Rider ${viewport.width}`,
            exact: true,
          })
          .waitFor();
        await page
          .getByRole("button", { name: "SIGN OUT", exact: true })
          .click();
        await page
          .getByRole("button", { name: "SIGN IN WITH GOOGLE", exact: true })
          .waitFor();
        assert.equal(await page.locator(".rating-chart").count(), 0);
        assert.deepEqual(errors, []);
        await page.close();
        console.log(`PASS stats + leaderboard ${name} ${viewport.width}px`);
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  for (const socket of sockets) socket.terminate();
  await service.close();
  await vite.close();
}
