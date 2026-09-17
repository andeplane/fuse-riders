import { chromium, webkit, type Page, type Locator } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { defaultRoomSettings } from "../src/shared/room-settings.js";
import { smokeTimeout } from "./smoke-timeout.js";
/**
 * End-of-match recap evidence: a solo match plays to completion, the report opens only after the
 * final-round pause, shows a podium/awards/comparison, closes, and reopens from RESULTS on a desktop
 * viewport and on a phone-landscape viewport. BROWSER=webkit selects WebKit; HOME_URL the served app.
 */
const base = process.env.HOME_URL ?? "http://127.0.0.1:4188/";
const browserName = process.env.BROWSER === "webkit" ? "webkit" : "chrome";
interface RecapSnapshot {
  phase: string;
  tick: number;
  pauseEndsAt: number | undefined;
  dialogOpen: boolean;
  alive: boolean | undefined;
}
interface ViewportResult {
  viewport: { width: number; height: number };
  matchOverTick: number;
  pauseTicks: number;
  podium: number;
  awards: number;
  totals: number;
  rows: number;
  comparisonScrolls: boolean;
  screenshots: string[];
}
const results: object[] = [];
await mkdir("artifacts", { recursive: true });
const identity = {
  revision: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  date: new Date().toISOString(),
  base,
  browser: browserName,
};
const oneRound = {
  ...defaultRoomSettings(),
  match: "rounds" as const,
  length: 1,
};

async function inside(page: Page, locator: Locator): Promise<void> {
  const box = await locator.boundingBox(),
    view = page.viewportSize()!;
  assert.ok(
    box &&
      box.x >= -1 &&
      box.y >= -1 &&
      box.x + box.width <= view.width + 1 &&
      box.y + box.height <= view.height + 1,
    `Element outside ${view.width}x${view.height}: ${JSON.stringify(box)}`,
  );
}
async function assertRecapLayout(page: Page): Promise<{
  podium: number;
  awards: number;
  totals: number;
  rows: number;
  comparisonScrolls: boolean;
}> {
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible" });
  await page.locator(".match-recap-report").waitFor({ state: "visible" });
  assert.ok(
    await page
      .locator("dialog.game-dialog[open]")
      .evaluate((element) => element.classList.contains("recap-dialog")),
    "recap uses the wide dialog variant",
  );
  assert.equal(
    await dialog.getAttribute("aria-label"),
    "Match results",
    "the report announces itself as the results, not the game menu",
  );
  await inside(page, dialog);
  await inside(page, page.getByRole("button", { name: "CLOSE", exact: true }));
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "document must not scroll horizontally",
  );
  assert.ok(
    await page
      .locator("dialog[open] .dialog-body")
      .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    "dialog body must not scroll horizontally",
  );
  await page
    .getByText("MATCH COMPLETE // AFTER ACTION REPORT", { exact: true })
    .waitFor({ state: "visible" });
  const podium = await page.locator(".podium-card").count(),
    awards = await page.locator(".recap-awards .award-card").count(),
    totals = await page.locator(".recap-total").count();
  const rows = await page
    .locator(".comparison-row:not(.comparison-header)")
    .count();
  assert.ok(podium >= 1 && podium <= 5, `podium cards: ${podium}`);
  assert.ok(
    (await page.locator(".podium-card.podium-place-1").count()) >= 1,
    "a champion card is present",
  );
  assert.ok(awards >= 1, "at least one award card");
  assert.equal(totals, 8, "gameplay totals strip");
  assert.equal(rows, 5, "one comparison row per rider");
  assert.ok(
    (await page.locator(".podium-card small").allTextContents()).every((text) =>
      text.includes(" PTS · "),
    ),
    "podium explains match points and round wins",
  );
  await page
    .locator(".comparison-header")
    .getByText("PTS", { exact: true })
    .waitFor();
  assert.equal(
    await page.locator(".comparison-header span").count(),
    11,
    "comparison header columns",
  );
  const comparisonScrolls = await page
    .locator(".recap-comparison")
    .evaluate((element) => element.scrollWidth > element.clientWidth + 1);
  return { podium, awards, totals, rows, comparisonScrolls };
}

const browser = await (browserName === "webkit" ? webkit : chromium).launch({
  headless: true,
});
try {
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 844, height: 390 },
  ]) {
    const phone = viewport.width < 1000;
    const context = await browser.newContext({
      viewport,
      ...(phone ? { isMobile: true, hasTouch: true } : {}),
    });
    const page = await context.newPage();
    page.setDefaultTimeout(smokeTimeout(20000));
    const errors: string[] = [],
      snapshots: RecapSnapshot[] = [];
    page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
    await page.exposeFunction(
      "recordRecapSnapshot",
      (snapshot: RecapSnapshot) => {
        snapshots.push(snapshot);
      },
    );
    // The dialog state is read inside the page at the moment each authoritative snapshot is published, so the pause is observed exactly.
    await page.addInitScript(
      (settings: string | undefined) => {
        if (settings)
          localStorage.setItem("fuse-riders-room-settings-v1", settings);
        window.addEventListener("fuse-benchmark", (event) => {
          const detail = (
            event as CustomEvent<{
              kind: string;
              phase: string;
              tick: number;
              phaseEndsAtTick?: number;
              players: Array<{ id: string; alive: boolean }>;
            }>
          ).detail;
          if (detail.kind !== "snapshot") return;
          void Reflect.get(
            window,
            "recordRecapSnapshot",
          )({
            phase: detail.phase,
            tick: detail.tick,
            pauseEndsAt: detail.phaseEndsAtTick,
            dialogOpen: Boolean(
              document.querySelector<HTMLDialogElement>(
                "dialog.game-dialog:not(.stats-dialog)",
              )?.open,
            ),
            alive: detail.players.find((player) => player.id === "solo")?.alive,
          });
        });
      },
      phone ? JSON.stringify(oneRound) : undefined,
    );
    const tag = `${browserName}-${viewport.width}x${viewport.height}`;
    const latest = () => snapshots.at(-1);
    const waitFor = async (
      predicate: () => boolean,
      timeoutMs: number,
      what: string,
    ) => {
      const deadline = Date.now() + timeoutMs;
      while (!predicate()) {
        assert.ok(Date.now() < deadline, `timed out waiting for ${what}`);
        await page.waitForTimeout(50);
      }
    };
    try {
      await page.goto(new URL("?solo=1&benchmark=1", base).href);
      await page.waitForFunction(() =>
        document
          .querySelector("canvas")
          ?.dataset.renderer?.startsWith("phaser-"),
      );
      await waitFor(() => snapshots.length > 0, 20000, "first snapshot");
      assert.equal(
        await page
          .getByRole("button", {
            name: "RESULTS",
            exact: true,
            includeHidden: true,
          })
          .evaluate((element: HTMLElement) => element.hidden),
        true,
        "RESULTS stays hidden before the match ends",
      );
      if (!phone) {
        // The desktop run picks the shortest format through the real settings menu; a new length applies to the next match.
        await page
          .getByRole("button", { name: "ROOM SETTINGS", exact: true })
          .click();
        const dialog = page.getByRole("dialog");
        await dialog.waitFor({ state: "visible" });
        await dialog
          .getByRole("button", { name: "3 ROUNDS · QUICK", exact: true })
          .click();
        assert.equal(await page.getByLabel("Match length").inputValue(), "3");
        await page.getByLabel("Match length").fill("1");
        await page
          .getByRole("button", { name: "SAVE SETTINGS", exact: true })
          .click();
        await dialog.waitFor({ state: "hidden" });
        await page
          .getByRole("button", { name: "BACK TO LOBBY", exact: true })
          .click();
        await page
          .getByRole("button", { name: "START RACE", exact: true })
          .click();
      }
      await waitFor(() => latest()?.phase === "playing", 20000, "round start");
      // Steer in a tight circle so the human rider leaves the round quickly; the AI riders finish it.
      await page.keyboard.down("ArrowLeft");
      const steerUntil = Date.now() + 12000;
      while (Date.now() < steerUntil && latest()?.alive !== false)
        await page.waitForTimeout(100);
      await page.keyboard.up("ArrowLeft");
      await waitFor(
        () => latest()?.phase === "matchOver",
        130000,
        "match over",
      );
      const first = snapshots.find(
        (snapshot) => snapshot.phase === "matchOver",
      )!;
      // A final round with a highlight moment pauses longer for the replay (ADR 044), so the pause end is read, not assumed.
      const matchOverTick = first.tick,
        pauseEnd = first.pauseEndsAt ?? matchOverTick + 60;
      await page
        .locator(".match-recap-report")
        .waitFor({ state: "visible", timeout: smokeTimeout(20000) });
      // The snapshot published at the end of the pause is recorded before that same tick opens the dialog, so the first
      // record that saw it open is a later tick, still on its way through exposeFunction when the report is visible (#130).
      await waitFor(
        () =>
          snapshots.some(
            (snapshot) =>
              snapshot.phase === "matchOver" &&
              snapshot.tick >= pauseEnd &&
              snapshot.dialogOpen,
          ),
        smokeTimeout(5000),
        "the report opens after the pause",
      );
      // Records arrive in order, so every pause-time record is in by now.
      const paused = snapshots.filter(
        (snapshot) =>
          snapshot.phase === "matchOver" && snapshot.tick < pauseEnd,
      );
      assert.ok(
        paused.length > 0 && paused.every((snapshot) => !snapshot.dialogOpen),
        "the report must stay closed during the final-round pause",
      );
      const layout = await assertRecapLayout(page);
      const screenshots = [`artifacts/match-recap-${tag}.png`];
      await page.screenshot({ path: screenshots[0]! });
      await page.locator("dialog[open] .dialog-body").evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await inside(
        page,
        page.getByRole("button", { name: "CLOSE", exact: true }),
      );
      screenshots.push(`artifacts/match-recap-${tag}-scrolled.png`);
      await page.screenshot({ path: screenshots[1]! });
      await page.getByRole("button", { name: "CLOSE", exact: true }).click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      // `close` is fired from a queued task, so the ordinary width/title/name are restored just after the dialog stops rendering.
      await page.waitForFunction(() => {
        const element = document.querySelector(
          "dialog.game-dialog:not(.stats-dialog)",
        )!;
        return (
          !element.classList.contains("recap-dialog") &&
          element.getAttribute("aria-label") === "Game menu"
        );
      });
      // A joined phone stays the landscape thirds controller in matchOver, so the header (and RESULTS) sits behind the ☰ MENU overlay.
      const reopen = page.getByRole("button", { name: "RESULTS", exact: true });
      if (phone && !(await reopen.isVisible()))
        await page.locator(".mobile-tools-toggle").click();
      await reopen.waitFor({ state: "visible" });
      await inside(page, reopen);
      await reopen.click();
      await assertRecapLayout(page);
      assert.equal(
        await page
          .locator("dialog[open] .dialog-body")
          .evaluate((element) => element.scrollTop),
        0,
        "reopening starts at the podium, not where the reader left off",
      );
      screenshots.push(`artifacts/match-recap-${tag}-reopened.png`);
      await page.screenshot({ path: screenshots[2]! });
      await page.getByRole("button", { name: "CLOSE", exact: true }).click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      if (!phone) {
        await page
          .getByRole("button", { name: "REMATCH", exact: true })
          .click();
        await waitFor(
          () => latest()?.phase === "countdown",
          20000,
          "rematch replays the match instead of returning to the lobby",
        );
        await page
          .getByRole("button", {
            name: "RESULTS",
            exact: true,
            includeHidden: true,
          })
          .waitFor({ state: "hidden" });
        assert.equal(
          await page.getByRole("dialog").isVisible(),
          false,
          "a rematch does not reopen the old report",
        );
      }
      assert.deepEqual(errors, []);
      const result: ViewportResult = {
        viewport,
        matchOverTick,
        pauseTicks: pauseEnd - matchOverTick,
        ...layout,
        screenshots,
      };
      results.push({ browser: browserName, passed: true, ...result });
      console.log(
        `PASS ${tag} match recap (${layout.podium} podium, ${layout.awards} awards, ${layout.rows} rows)`,
      );
    } catch (error) {
      await page
        .screenshot({ path: `artifacts/match-recap-failure-${tag}.png` })
        .catch(() => {});
      results.push({
        browser: browserName,
        viewport,
        passed: false,
        error: String(error),
        errors,
        lastSnapshots: snapshots.slice(-10),
      });
      throw error;
    } finally {
      await context.close();
      await writeFile(
        `artifacts/match-recap-smoke-${browserName}.json`,
        JSON.stringify({ identity, results }, null, 2),
      );
    }
  }
} finally {
  await browser.close();
}
