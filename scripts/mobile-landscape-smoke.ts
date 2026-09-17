import { chromium, webkit, type Page } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { smokeTimeout } from "./smoke-timeout.js";
const base = process.env.HOME_URL ?? "http://127.0.0.1:4188/";
const results: object[] = [];
await mkdir("artifacts", { recursive: true });
// A solo round can end while the hints fade: matchOver opens the tools overlay (pointer-events:none on the thirds) and a phase
// change clears held input. Close the overlay and retry the press instead of racing the round clock.
const press = async (page: Page, x: number, y: number) => {
  for (let attempt = 0; attempt < 6; attempt++) {
    if (await page.locator(".mobile-tools-open").count())
      await page.locator(".mobile-tools-toggle").click();
    await page.mouse.move(x, y);
    await page.mouse.down();
    if (
      await page
        .locator(".online-controls button")
        .first()
        .evaluate((e: Element) => e.classList.contains("active"))
    )
      return;
    await page.mouse.up();
    await page.waitForTimeout(400);
  }
  assert.fail("the left third never registered a press");
};
for (const [name, type] of [
  ["chrome", chromium],
  ["webkit", webkit],
] as const) {
  const browser = await type.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(smokeTimeout(15000));
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.stack ?? e.message));
  try {
    /* The rider is left riding while the touch zones are probed: the classic board has nothing for it to crash into. */ await page.addInitScript(
      () => {
        if (!localStorage.getItem("fuse-riders-room-settings-v1"))
          localStorage.setItem(
            "fuse-riders-room-settings-v1",
            JSON.stringify({
              version: 1,
              mode: "devices",
              match: "rounds",
              length: 5,
              map: "classic",
              weights: { power: 1 },
            }),
          );
      },
    );
    await page.goto(new URL("?solo=1", base).href);
    await page.locator(".mobile-rotate-gate").waitFor({ state: "visible" });
    await page.locator(".mobile-tools-toggle").click();
    await page.screenshot({
      path: `artifacts/mobile-portrait-tools-${name}.png`,
    });
    await page
      .getByRole("button", { name: "BACK TO LOBBY", exact: true })
      .click();
    await page.locator(".phone-lobby").waitFor();
    await page.screenshot({
      path: `artifacts/mobile-portrait-lobby-${name}.png`,
    });
    await page.getByRole("button", { name: "START RACE", exact: true }).click();
    await page.locator(".mobile-rotate-gate").waitFor({ state: "visible" });
    await page
      .locator(".mobile-tools-open")
      .waitFor({ state: "detached" })
      .catch(() => assert.fail("starting a race closes the tools overlay"));
    await page.setViewportSize({ width: 844, height: 390 });
    await page.locator(".mobile-rotate-gate").waitFor({ state: "hidden" });
    await page.waitForFunction(() =>
      document.querySelector("canvas")?.dataset.renderer?.startsWith("phaser-"),
    );
    const hintsOpacity = () =>
      page
        .locator(".mobile-control-hints")
        .evaluate((e) => Number(getComputedStyle(e).opacity));
    assert.ok((await hintsOpacity()) > 0, "hints visible during the countdown");
    const bounds = await page
      .locator(".online-controls button")
      .evaluateAll((buttons) =>
        buttons.map((b) => {
          const r = b.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        }),
      );
    for (const [i, r] of bounds.entries()) {
      assert.ok(Math.abs(r.x - (i * 844) / 3) < 1);
      assert.ok(Math.abs(r.width - 844 / 3) < 1);
      assert.equal(r.y, 0);
      assert.equal(r.height, 390);
    }
    const fit = await page
      .locator(".online-arena")
      .evaluate((canvas) => getComputedStyle(canvas).objectFit);
    assert.equal(fit, "contain");
    // #14: a long press on any third must never select label text or open Copy / Look Up; zones, labels, gate and pill carry the no-select styles.
    await page.waitForFunction(
      () => document.querySelector(".online-notice")?.textContent === "",
    ); // countdown → playing clears held input; press during play
    assert.ok(
      (await hintsOpacity()) > 0,
      "hint fade restarts when play begins",
    );
    const zones = page.locator(".online-controls>button");
    const cdp =
      name === "chrome" ? await context.newCDPSession(page) : undefined;
    for (const third of [0, 1, 2]) {
      const x = 844 / 6 + (third * 844) / 3,
        y = 195;
      if (cdp)
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ x, y }],
        });
      else {
        await page.mouse.move(x, y);
        await page.mouse.down();
      }
      await page.waitForTimeout(650);
      assert.ok(
        await zones.nth(third).evaluate((e) => e.classList.contains("active")),
        `third ${third} must be held during the long press`,
      );
      if (cdp)
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchEnd",
          touchPoints: [],
        });
      else await page.mouse.up();
      assert.equal(
        await page.evaluate(() => document.getSelection()?.toString() ?? ""),
        "",
        `long press on third ${third} selected text`,
      );
    }
    assert.equal(
      await page.evaluate(() => {
        const hints = document.querySelector(".mobile-control-hints")!,
          selection = document.getSelection();
        selection?.selectAllChildren(hints);
        const text = selection?.toString() ?? "";
        selection?.removeAllRanges();
        return text + hints.textContent;
      }),
      "",
      "hint labels must not be selectable text nodes",
    );
    // Desktop engines drop the iOS-only -webkit-touch-callout declaration, so read the selectors carrying it from the served stylesheets.
    const calloutSelectors = await page.evaluate(
      async () =>
        (
          await Promise.all(
            [...document.styleSheets].flatMap((sheet) =>
              sheet.href ? [fetch(sheet.href).then((r) => r.text())] : [],
            ),
          )
        )
          .join("\n")
          .match(/[^{}]+\{[^{}]*-webkit-touch-callout:\s*none[^{}]*\}/g)
          ?.flatMap((rule) =>
            rule
              .slice(0, rule.indexOf("{"))
              .split(",")
              .map((sel) => sel.trim()),
          ) ?? [],
    );
    const noSelect = await page
      .locator(
        ".online-controls>button,.mobile-control-hints span,.mobile-rotate-gate,.mobile-tools-toggle,.online-notice",
      )
      .evaluateAll(
        (elements, selectors) =>
          elements.map((e) => {
            const s = getComputedStyle(e);
            return {
              userSelect: s.userSelect,
              webkitUserSelect: s.webkitUserSelect,
              touchAction: s.touchAction,
              touchCallout: selectors.some((sel) => e.matches(sel))
                ? "none"
                : "missing",
            };
          }),
        calloutSelectors,
      );
    assert.equal(noSelect.length, 9);
    for (const style of noSelect)
      assert.deepEqual(style, {
        userSelect: "none",
        webkitUserSelect: "none",
        touchAction: "none",
        touchCallout: "none",
      });
    // The fade restarts on every entry into countdown and playing, because mobile-play-layout removes and re-appends
    // the element, so across an ~11s round cycle the opacity is 1 for about two seconds after each restart and
    // non-zero for over half of it. Sampling once lands wherever the round clock happens to be -- and sleeping longer
    // makes that worse, not better. Poll for the fade instead: where in the cycle it starts stops mattering, and the
    // wait fails loudly if the hints never disappear.
    await page.waitForFunction(
      () =>
        getComputedStyle(document.querySelector(".mobile-control-hints")!)
          .opacity === "0",
      undefined,
      { timeout: smokeTimeout(10000) },
    );
    await page.screenshot({
      path: `artifacts/mobile-landscape-faded-${name}.png`,
    });
    await press(page, 100, 200);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator(".mobile-rotate-gate").waitFor({ state: "visible" });
    assert.equal(
      await page.locator(".online-controls button.active").count(),
      0,
    );
    await page.mouse.up();
    // The tools overlay closes by design whenever a solo round enters countdown/play (mobile-play-layout.ts), which can
    // happen between opening it and clicking a button inside it; reopen and retry instead of racing the round clock.
    const clickInTools = async (name: string) => {
      for (let attempt = 0; attempt < 6; attempt++) {
        if (!(await page.locator(".mobile-tools-open").count()))
          await page.locator(".mobile-tools-toggle").click();
        try {
          await page
            .getByRole("button", { name, exact: true })
            .click({ timeout: smokeTimeout(2500) });
          return;
        } catch {
          /* overlay closed under us; reopen */
        }
      }
      throw new Error(
        `${name} never became clickable inside the tools overlay`,
      );
    };
    const avatarHidden = () =>
      page.evaluate(
        () =>
          [
            ...document.querySelectorAll<HTMLButtonElement>(
              ".online-header button",
            ),
          ].find((b) => b.textContent === "AVATAR")!.hidden,
      );
    assert.equal(
      await avatarHidden(),
      true,
      "avatars are a lobby choice, not a mid-round one",
    );
    await clickInTools("BACK TO LOBBY");
    await page.waitForFunction(() =>
      document
        .querySelector(".online-notice")
        ?.textContent?.startsWith("Join your friends"),
    );
    await page.locator(".phone-lobby").waitFor();
    assert.equal(
      await page.locator(".mobile-play").count(),
      0,
      "the lobby is a phone screen, not the controller (#134)",
    );
    assert.equal(
      await page.locator(".mobile-rotate-gate").isVisible(),
      false,
      "no rotate gate in the lobby",
    );
    assert.equal(
      await avatarHidden(),
      false,
      "the lobby offers the avatar button again",
    );
    assert.deepEqual(errors, []);
    results.push({
      browser: name,
      passed: true,
      portraitGate: true,
      thirds: bounds,
      objectFit: fit,
      longPressNoSelect: noSelect,
      hintsFaded: true,
      rotationCancelledHeldInput: true,
      lobbyScreen: true,
      errors,
    });
    console.log(`PASS ${name} mobile landscape`);
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
      "artifacts/mobile-landscape-smoke.json",
      JSON.stringify(results, null, 2),
    );
  }
}
