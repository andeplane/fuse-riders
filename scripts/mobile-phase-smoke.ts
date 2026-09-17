import { chromium, webkit } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { smokeTimeout } from "./smoke-timeout.js";
// #13: a joined phone shows one controller presentation (full-screen thirds, hint labels, ☰ MENU pill) in countdown, playing and matchOver.
// #134: the lobby is a phone screen instead — riders, START RACE and one menu on screen in both orientations, no thirds, no rotate gate.
const base = process.env.HOME_URL ?? "http://127.0.0.1:4188/";
const results: object[] = [];
await mkdir("artifacts", { recursive: true });
const PHASES = ["countdown", "playing", "matchOver"] as const;
for (const [name, type] of [
  ["chrome", chromium],
  ["webkit", webkit],
] as const) {
  const browser = await type.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 844, height: 390 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(smokeTimeout(20000));
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.stack ?? e.message));
  // One round ends the match, so matchOver is reachable without a long solo run.
  await page.addInitScript(() =>
    localStorage.setItem(
      "fuse-riders-room-settings-v1",
      JSON.stringify({
        version: 1,
        mode: "devices",
        match: "rounds",
        length: 1,
        map: "classic",
        weights: {},
      }),
    ),
  );
  const notice = (pattern: RegExp, timeout = 20000) =>
    page.waitForFunction(
      (source) =>
        new RegExp(source).test(
          document.querySelector(".online-notice")?.textContent ?? "",
        ),
      pattern.source,
      { timeout },
    );
  const capture = async (phase: string) => {
    await page.screenshot({
      path: `artifacts/mobile-phase-${phase}-${name}.png`,
    });
    return page.evaluate(() =>
      [
        ...document.querySelectorAll(
          ".mobile-play .online-controls>button,.mobile-play>.mobile-control-hints>span,.mobile-play>.mobile-tools-toggle",
        ),
      ].map((e) => {
        const r = e.getBoundingClientRect(),
          s = getComputedStyle(e);
        return {
          tag: e.tagName,
          className: e.className.replace(/\bactive\b/, "").trim(),
          label:
            (e as HTMLElement).dataset.hint ??
            (s.fontSize === "0px" ? "" : e.textContent),
          x: Math.round(r.x),
          y: Math.round(r.y),
          width: Math.round(r.width),
          height: Math.round(r.height),
          display: s.display,
          pointerEvents: s.pointerEvents,
        };
      }),
    );
  };
  const tools = async (open: boolean) => {
    await page.locator(".mobile-tools-toggle").click();
    assert.equal(
      await page.locator(".mobile-tools-open").count(),
      open ? 1 : 0,
    );
  };
  const hintsOpacity = () =>
    page
      .locator(".mobile-control-hints")
      .evaluate((e) => Number(getComputedStyle(e).opacity));
  const onScreen = async (name: string, label: string) => {
    const button = page.getByRole("button", { name, exact: true });
    await button.scrollIntoViewIfNeeded();
    const r = (await button.boundingBox())!,
      v = page.viewportSize()!;
    assert.ok(
      r.x >= 0 &&
        r.y >= 0 &&
        r.x + r.width <= v.width + 1 &&
        r.y + r.height <= v.height + 1,
      `${label}: ${name} must be fully on screen: ${JSON.stringify(r)}`,
    );
  };
  const lobbyScreen = async (label: string) => {
    await page.locator(".phone-lobby").waitFor();
    assert.equal(
      await page.locator(".mobile-play").count(),
      0,
      `${label}: the lobby is not the controller`,
    );
    assert.equal(
      await page.locator(".mobile-tools-open").count(),
      0,
      `${label}: no lingering tools overlay`,
    );
    assert.equal(
      await page.locator(".mobile-rotate-gate").isVisible(),
      false,
      `${label}: no rotate gate`,
    );
    assert.equal(
      await page.locator(".shared-lobby").isVisible(),
      true,
      `${label}: lobby card`,
    );
    assert.equal(
      await page.locator(".room-riders .room-rider").count(),
      5,
      `${label}: riders listed`,
    );
    assert.equal(
      await page
        .locator("button:visible")
        .filter({ hasText: /^(ROOM|EXIT|MENU|☰ MENU)$/ })
        .count(),
      1,
      `${label}: one menu button`,
    );
    for (const name of ["START RACE", "ADD AI", "ROOM SETTINGS"])
      await onScreen(name, label);
  };
  try {
    await page.goto(new URL("?solo=1", base).href);
    await page.locator(".mobile-play").waitFor();
    await page.waitForFunction(() =>
      document.querySelector("canvas")?.dataset.renderer?.startsWith("phaser-"),
    );
    const seen: Record<string, unknown> = {};
    await tools(true);
    await page
      .getByRole("button", { name: "BACK TO LOBBY", exact: true })
      .click();
    await notice(/^Join your friends/);
    await lobbyScreen("landscape lobby");
    await page.screenshot({ path: `artifacts/mobile-phase-lobby-${name}.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await lobbyScreen("portrait lobby");
    await page.screenshot({
      path: `artifacts/mobile-phase-lobby-portrait-${name}.png`,
    });
    await page.setViewportSize({ width: 844, height: 390 });
    await lobbyScreen("landscape lobby again");
    await page.getByRole("button", { name: "START RACE", exact: true }).click();
    await notice(/^READY/);
    assert.equal(
      await page.locator(".mobile-tools-open").count(),
      0,
      "countdown closes the tools overlay",
    );
    assert.ok((await hintsOpacity()) > 0, "hints visible at countdown start");
    seen.countdown = await capture("countdown");
    await notice(/^$/);
    assert.ok((await hintsOpacity()) > 0, "hints visible at play start");
    seen.playing = await capture("playing");
    await notice(/MATCH COMPLETE/, 180000);
    await page.getByRole("button", { name: "CLOSE", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal(
      await page.locator(".mobile-tools-open").count(),
      1,
      "host matchOver opens the tools overlay",
    );
    assert.equal(
      await page.locator(".online-roster:visible>span").count(),
      5,
      "match results roster reachable behind MENU",
    );
    await page
      .getByRole("button", { name: "REMATCH", exact: true })
      .waitFor({ state: "visible" });
    await page.screenshot({ path: `artifacts/mobile-phase-menu-${name}.png` });
    await tools(false);
    seen.matchOver = await capture("matchOver");
    const noticeStyle = await page.locator(".online-notice").evaluate((e) => {
      const s = getComputedStyle(e);
      return {
        userSelect: s.userSelect,
        webkitUserSelect: s.webkitUserSelect,
        touchAction: s.touchAction,
      };
    });
    assert.deepEqual(
      noticeStyle,
      { userSelect: "none", webkitUserSelect: "none", touchAction: "none" },
      "phase notice is not selectable text",
    );
    await tools(true);
    await page
      .getByRole("button", { name: "BACK TO LOBBY", exact: true })
      .click();
    await notice(/^Join your friends/);
    await lobbyScreen("lobby after the match");
    assert.equal(
      (seen.countdown as unknown[]).length,
      7,
      "3 zones + 3 labels + MENU pill",
    );
    for (const phase of PHASES)
      assert.deepEqual(
        seen[phase],
        seen.countdown,
        `${phase} controls must match the countdown controls`,
      );
    assert.deepEqual(errors, []);
    results.push({
      browser: name,
      passed: true,
      controls: seen.countdown,
      phases: PHASES,
      lobbyScreen: true,
      errors,
    });
    console.log(`PASS ${name} one controller across phases`);
  } catch (error) {
    results.push({
      browser: name,
      passed: false,
      error: String(error),
      errors,
    });
    throw error;
  } finally {
    await browser.close();
    await writeFile(
      "artifacts/mobile-phase-smoke.json",
      JSON.stringify(results, null, 2),
    );
  }
}
