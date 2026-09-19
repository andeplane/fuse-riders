import type { Page, Locator } from "playwright";
import { browserKind, launchBrowser } from "./lib/browser.js";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { defaultRoomSettings } from "../games/fuse-riders/src/engine/room-settings.js";
import { smokeTimeout } from "./smoke-timeout.js";
/**
 * End-of-match recap evidence: a solo match plays to completion, the report opens only after the
 * final-round pause, shows standings and highlights with expandable statistics, closes, and reopens from RESULTS on a desktop
 * viewport and on a phone-landscape viewport. BROWSER=webkit selects WebKit; HOME_URL the served app.
 */
const base = process.env.HOME_URL ?? "http://127.0.0.1:4188/";
// Reports and screenshots have always called the bundled Chromium "chrome".
const kind = browserKind("chromium");
const browserName = kind === "webkit" ? "webkit" : "chrome";
interface RecapSnapshot {
  phase: string;
  tick: number;
  pauseEndsAt: number | undefined;
  dialogOpen: boolean;
  alive: boolean | undefined;
  /** The arena announcer as it stood when the snapshot arrived: `round` or `final`, its label and its headline. */
  banner: { kind: string; small: string; big: string } | undefined;
}
interface ViewportResult {
  viewport: { width: number; height: number };
  matchOverTick: number;
  pauseTicks: number;
  champions: number;
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
  champions: number;
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
  const surface = await dialog.evaluate((element) => {
    const style = getComputedStyle(element),
      box = element.getBoundingClientRect();
    return {
      width: box.width,
      viewport: innerWidth,
      background: style.backgroundColor,
      shadow: style.boxShadow,
      border: style.borderWidth,
    };
  });
  assert.equal(
    surface.width,
    surface.viewport,
    "results span the viewport without side panels",
  );
  assert.equal(
    surface.background,
    "rgba(0, 0, 0, 0)",
    "results have no opaque panel",
  );
  assert.equal(surface.shadow, "none");
  assert.equal(surface.border, "0px");
  const scene = page.locator(".online-arena");
  assert.ok(
    await scene.isVisible(),
    "the actual arena stays visible behind results",
  );
  assert.equal(
    await page.locator("canvas").count(),
    1,
    "results use the existing scene, not a copied canvas",
  );
  assert.ok(
    await scene.evaluate((element) =>
      getComputedStyle(element).filter.includes("blur"),
    ),
    "the scene is blurred for the overview",
  );
  await inside(page, page.getByRole("button", { name: /full stats/ }));
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
  await dialog.getByText("MATCH COMPLETE", { exact: true }).waitFor();
  const champions = await page.locator(".recap-standings .is-champion").count();
  assert.ok(champions >= 1 && champions <= 5, `champions: ${champions}`);
  assert.equal(await page.locator(".recap-standings tbody tr").count(), 5);
  assert.equal(await page.locator(".recap-standings .is-you").count(), 1);
  assert.ok(await page.locator(".recap-victory h2").textContent());
  assert.ok((await page.locator(".recap-feature").count()) >= 1);
  assert.equal(await page.locator(".recap-details").isVisible(), false);
  await page
    .getByRole("button", { name: "View full stats ↗", exact: true })
    .click();
  assert.equal(await page.locator(".recap-details").isVisible(), true);
  assert.equal(
    await page.locator(".recap-stats-toggle").getAttribute("aria-expanded"),
    "true",
  );
  const awards = await page.locator(".recap-awards .award-card").count(),
    totals = await page.locator(".recap-total").count(),
    rows = await page
      .locator(".comparison-row:not(.comparison-header)")
      .count();
  assert.ok(awards >= 1, "at least one award card");
  assert.equal(totals, 8, "gameplay totals strip");
  assert.equal(rows, 5, "one comparison row per rider");
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
  await page
    .getByRole("button", { name: "Hide full stats ↗", exact: true })
    .click();
  assert.equal(await page.locator(".recap-details").isVisible(), false);
  return { champions, awards, totals, rows, comparisonScrolls };
}

const browser = await launchBrowser(kind, { headless: true });
try {
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 844, height: 390 },
    { width: 390, height: 844 },
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
          localStorage.setItem("fuse-riders-room-settings-v2", settings);
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
            banner: (() => {
              if (detail.phase !== "matchOver") return undefined;
              const card = document.querySelector<HTMLElement>(
                ".online-announce:not([hidden])",
              );
              if (!card || getComputedStyle(card).display === "none")
                return undefined;
              return {
                kind: card.classList.contains("final")
                  ? "final"
                  : card.classList.contains("round")
                    ? "round"
                    : "other",
                small: card.querySelector(".announce-small")?.textContent ?? "",
                big: card.querySelector("strong")?.textContent ?? "",
              };
            })(),
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
      await page.goto(new URL("?solo=1&benchmark=1&mute", base).href);
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
      // The pause is two beats on every screen: the final round's own result, then the match winner. One card naming the
      // match winner for the whole pause read as the winner of the round. The card trails its snapshot by one record.
      // A round that ends in overtime leaves its overtime card in the first record: not one of the two beats.
      const banners = paused.flatMap((snapshot) =>
          snapshot.banner && snapshot.banner.kind !== "other"
            ? [snapshot.banner]
            : [],
        ),
        firstFinal = banners.findIndex((banner) => banner.kind === "final");
      // Portrait devices now render the rotated arena, so every orientation must show both beats.
      assert.ok(
        firstFinal > 0,
        `the round result comes before the match result: ${JSON.stringify(banners.map((banner) => banner.kind))}`,
      );
      for (const [index, banner] of banners.entries())
        if (index < firstFinal) {
          assert.equal(banner.kind, "round", JSON.stringify(banner));
          assert.match(banner.small, /^FINAL ROUND/);
          assert.match(banner.big, /THE ROUND$|^DRAW$/);
        } else {
          assert.equal(banner.kind, "final", JSON.stringify(banner));
          assert.match(banner.small, /^MATCH (WINNER|RESULT)$/);
          assert.match(banner.big, /THE MATCH$|^SHARED VICTORY$/);
        }
      const layout = await assertRecapLayout(page);
      if (!phone) {
        await page
          .getByRole("button", { name: "View full stats ↗", exact: true })
          .click();
        const watch = page.locator(".watch-again").first();
        if (await watch.count()) {
          await watch.click();
          await page.locator(".online-app.replaying").waitFor();
          const playback = await page
            .locator(".online-arena")
            .evaluate((element) => ({
              filter: getComputedStyle(element).filter,
              fit: getComputedStyle(element).objectFit,
            }));
          assert.deepEqual(
            playback,
            { filter: "none", fit: "contain" },
            "WATCH restores a sharp, uncropped arena",
          );
          assert.equal(
            await page.locator(".shared-lobby").isVisible(),
            false,
            "lobby controls do not cover replay",
          );
          console.log(`PASS ${tag} sharp highlight replay`);
          await page
            .getByRole("dialog", { name: "Match results" })
            .waitFor({ timeout: smokeTimeout(20000) });
          await assertRecapLayout(page);
        } else {
          await page
            .getByRole("button", { name: "Hide full stats ↗", exact: true })
            .click();
        }
        await page.setViewportSize({ width: 2000, height: 1100 });
        await assertRecapLayout(page);
        await page.screenshot({
          path: `artifacts/match-recap-${browserName}-ultrawide.png`,
        });
        await page.setViewportSize(viewport);
      }
      const screenshots = [`artifacts/match-recap-${tag}.png`];
      await page.screenshot({ path: screenshots[0]! });
      await page
        .getByRole("button", { name: "View full stats ↗", exact: true })
        .click();
      await page.locator("dialog[open] .dialog-body").evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await inside(page, page.getByRole("button", { name: /full stats/ }));
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
        "reopening starts at the champions, not where the reader left off",
      );
      screenshots.push(`artifacts/match-recap-${tag}-reopened.png`);
      await page.screenshot({ path: screenshots[2]! });
      if (!phone) {
        await page
          .getByRole("dialog")
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
        assert.equal(
          await page
            .locator(".online-app")
            .evaluate((element) =>
              element.classList.contains("scene-background"),
            ),
          false,
          "rematch restores the sharp playing arena",
        );
      }
      if (phone) {
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "Back to lobby", exact: true })
          .click();
        await waitFor(
          () => latest()?.phase === "lobby",
          20000,
          "footer returns to lobby",
        );
        assert.ok(
          await page.locator(".online-arena").isVisible(),
          "the lobby retains the actual arena",
        );
        assert.ok(
          await page
            .locator(".online-arena")
            .evaluate((element) =>
              getComputedStyle(element).filter.includes("blur"),
            ),
          "lobby keeps the scene treatment",
        );
        assert.equal(await page.getByRole("dialog").isVisible(), false);
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
        `PASS ${tag} match recap (${layout.champions} champions, ${layout.awards} awards, ${layout.rows} rows)`,
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
