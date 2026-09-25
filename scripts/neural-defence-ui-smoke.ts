import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, webkit, type Page } from "playwright";

// Real menu -> sandbox flow; Chromium CDP supplies trusted multi-touch input.
// Phone emulation is not a physical-device or real-network qualification.
const url =
  process.argv[2] ?? "http://127.0.0.1:5174/games/neural-defence/?mute";
const output = process.argv[3] ?? "/tmp/neural-rts-smoke";
await mkdir(output, { recursive: true });

async function start(page: Page) {
  await page.goto(url);
  await page.locator('[data-action="new-game"]').click();
  await page.locator('[data-action="start"]').click();
  await page.locator(".command-dock").waitFor();
}

async function view(page: Page) {
  return (await page.locator("#nd-board").getAttribute("viewBox"))!
    .split(" ")
    .map(Number);
}

async function zoomOut(page: Page) {
  for (let i = 0; i < 8; i++)
    await page.locator("#nd-viewport").dispatchEvent("wheel", {
      deltaY: 3000,
      clientX: 150,
      clientY: 150,
    });
}

async function cancelled(page: Page, value: boolean) {
  await page.waitForFunction(
    (disabled) =>
      document
        .querySelector('[data-action="cancel-build"]')
        ?.getAttribute("aria-disabled") === String(disabled),
    value,
  );
}

async function geometry(page: Page) {
  const size = page.viewportSize()!;
  const board = (await page.locator("#nd-viewport").boundingBox())!;
  const dock = (await page.locator(".command-dock").boundingBox())!;
  assert.equal(
    board.width,
    size.width,
    "battlefield must use full screen width",
  );
  assert.ok(
    board.height > size.height / 2,
    "battlefield retains most of the screen",
  );
  assert.ok(dock.y >= board.y + board.height - 1);
  assert.ok(dock.y + dock.height <= size.height + 1);
  assert.equal(
    await page
      .locator(
        '[data-action="zoom-in"], [data-action="zoom-out"], [data-action="zoom-fit"]',
      )
      .count(),
    0,
  );
  assert.equal(await page.locator(".hud-popover").count(), 0);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  for (const control of await page
    .locator(".command-dock button, .command-dock input, .battle-topbar button")
    .all()) {
    const box = (await control.boundingBox())!;
    assert.ok(
      box.x >= 0 &&
        box.y >= 0 &&
        box.x + box.width <= size.width + 1 &&
        box.y + box.height <= size.height + 1,
      await control.innerText(),
    );
  }
}

for (const [name, engine] of [
  ["chromium", chromium],
  ["webkit", webkit],
] as const) {
  const browser = await engine.launch();
  const errors: string[] = [];
  try {
    const desktop = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    desktop.on("pageerror", (error) => errors.push(error.message));
    await start(desktop);
    await geometry(desktop);
    await desktop.locator('.terrain-layer [data-cell="14"]').hover();
    assert.equal(
      await desktop
        .locator('.terrain-layer [data-cell="14"]')
        .evaluate((tile) =>
          tile.lastElementChild?.classList.contains("hex-hover-outline"),
        ),
      true,
      "hover outline paints above its texture",
    );
    await desktop
      .locator('.terrain-layer [data-cell="14"]')
      .screenshot({ path: `${output}/${name}-hover-hex.png` });
    assert.deepEqual(
      await desktop.locator(".command-card kbd").allTextContents(),
      ["Q", "W", "E", "A"],
    );
    await desktop.screenshot({ path: `${output}/${name}-desktop.png` });
    const initial = await view(desktop);
    await desktop.mouse.move(720, 360);
    await desktop.mouse.wheel(0, -300);
    await desktop.waitForFunction(
      (width) =>
        Number(
          document
            .querySelector("#nd-board")!
            .getAttribute("viewBox")!
            .split(" ")[2],
        ) < width,
      initial[2]!,
    );
    const zoomed = await view(desktop);
    const selection = await desktop.locator(".tile-heading").innerText();
    await desktop.mouse.down();
    await desktop.mouse.move(570, 300, { steps: 8 });
    await desktop.mouse.up();
    assert.notDeepEqual(await view(desktop), zoomed, "drag must pan");
    assert.equal(
      await desktop.locator(".tile-heading").innerText(),
      selection,
      "drag must not select",
    );
    const panned = await view(desktop);
    await desktop.locator('[data-action="leave"]').click();
    await desktop.locator('[data-action="cancel-confirm"]').click();
    assert.deepEqual(
      await view(desktop),
      panned,
      "cancel menu must preserve camera",
    );
    await desktop.locator("#nd-board").focus();
    await desktop.keyboard.press("w");
    await desktop.locator('.command-card[data-panel="research"]').waitFor();
    assert.deepEqual(
      await desktop.locator(".command-card kbd").allTextContents(),
      ["Q", "W", "E", "A", "S"],
    );
    await desktop.locator('[data-action="research-growth"]').hover();
    await desktop
      .locator("#help-research-growth")
      .waitFor({ state: "visible" });
    assert.match(
      await desktop.locator("#help-research-growth").innerText(),
      /more insight/,
    );
    await desktop.screenshot({ path: `${output}/${name}-research.png` });
    await desktop.keyboard.press("Escape");
    await desktop.locator('.command-card[data-panel="inspect"]').waitFor();
    await zoomOut(desktop);
    await desktop.waitForFunction(
      (width) =>
        Number(
          document
            .querySelector("#nd-board")!
            .getAttribute("viewBox")!
            .split(" ")[2],
        ) > width,
      zoomed[2]!,
    );
    // Release outside the viewport before mouse capture: later hover must not pan.
    const fitted = await view(desktop);
    await desktop.mouse.move(300, 45);
    await desktop.mouse.down();
    await desktop.mouse.move(300, 42);
    await desktop.mouse.up();
    await desktop.mouse.move(350, 150);
    assert.deepEqual(
      await view(desktop),
      fitted,
      "released mouse must not continue panning",
    );
    assert.equal(
      await desktop.evaluate(() => getSelection()?.toString()),
      "",
      "panning must not select page text",
    );
    // WheelEvent deltaMode 1 is measured in lines, not pixels.
    await desktop.locator("#nd-viewport").dispatchEvent("wheel", {
      deltaY: -3,
      deltaMode: 1,
      clientX: 720,
      clientY: 350,
    });
    assert.ok(
      (await view(desktop))[2]! < fitted[2]! * 0.95,
      "line-mode wheel must zoom meaningfully",
    );
    await zoomOut(desktop);
    await desktop.screenshot({ path: `${output}/${name}-fit.png` });
    await desktop.locator('.terrain-layer [data-cell="14"]').click();
    await desktop.keyboard.press("q");
    await desktop.keyboard.press("q");
    await cancelled(desktop, false);
    await desktop.waitForFunction(
      () =>
        Number(
          document
            .querySelector('[data-action="build-neuron"] [role="progressbar"]')
            ?.getAttribute("aria-valuenow"),
        ) > 0,
    );
    await desktop.keyboard.press("s");
    await cancelled(desktop, true);
    await desktop.keyboard.press("w");
    await cancelled(desktop, false);
    await desktop.keyboard.press("s");
    await cancelled(desktop, true);
    await desktop.keyboard.press("a");
    await desktop.keyboard.press("e");
    await desktop.locator('.command-card[data-panel="activity"]').waitFor();
    await desktop.keyboard.press("a");

    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 1,
    });
    const phone = await context.newPage();
    phone.on("pageerror", (error) => errors.push(error.message));
    await start(phone);
    await geometry(phone);
    await phone.setViewportSize({ width: 320, height: 568 });
    await geometry(phone);
    await phone.screenshot({ path: `${output}/${name}-narrow.png` });
    await phone.setViewportSize({ width: 390, height: 844 });
    await phone.screenshot({ path: `${output}/${name}-phone.png` });
    if (name === "chromium") {
      const cdp = await context.newCDPSession(phone);
      const before = await view(phone);
      const selected = await phone.locator(".tile-heading").innerText();
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [
          { x: 150, y: 320, id: 1 },
          { x: 240, y: 320, id: 2 },
        ],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          { x: 95, y: 320, id: 1 },
          { x: 295, y: 320, id: 2 },
        ],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      const pinched = await view(phone);
      assert.ok(pinched[2]! < before[2]!, "two-finger spread must zoom in");
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: 210, y: 380, id: 1 }],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: 120, y: 280, id: 1 }],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      assert.notDeepEqual(await view(phone), pinched, "one finger must pan");
      assert.equal(
        await phone.locator(".tile-heading").innerText(),
        selected,
        "touch gestures must not select",
      );
    }
    await zoomOut(phone);
    await phone.locator('[data-action="panel-research"]').tap();
    await phone.locator('.command-card[data-panel="research"]').waitFor();
    await geometry(phone);
    const grey = (await phone
      .locator('[data-action="research-growth"]')
      .boundingBox())!;
    await phone.touchscreen.tap(
      grey.x + grey.width / 2,
      grey.y + grey.height / 2,
    );
    await phone.locator("#help-research-growth").waitFor({ state: "visible" });
    assert.match(
      await phone.locator("#help-research-growth").innerText(),
      /more insight/,
    );
    await phone.screenshot({ path: `${output}/${name}-phone-research.png` });
    await phone
      .locator('[data-action="close-panel"]')
      .filter({ visible: true })
      .tap();
    await geometry(phone);
    await phone.locator('.terrain-layer [data-cell="14"]').tap();
    await phone.locator('[data-action="panel-build"]').tap();
    await phone
      .locator('[data-action="build-neuron"]')
      .waitFor({ state: "visible" });
    await geometry(phone);
    await phone.locator('[data-action="build-neuron"]').tap();
    await cancelled(phone, false);
    await phone.waitForFunction(
      () =>
        Number(
          document
            .querySelector('[data-action="build-neuron"] [role="progressbar"]')
            ?.getAttribute("aria-valuenow"),
        ) > 0,
    );
    await phone.screenshot({ path: `${output}/${name}-build.png` });
    await phone.setViewportSize({ width: 568, height: 320 });
    await zoomOut(phone);
    await geometry(phone);
    await phone.screenshot({ path: `${output}/${name}-landscape.png` });
    await phone.locator('.terrain-layer [data-cell="26"]').tap();
    await phone.locator('[data-action="build-tower"]').focus();
    const tooltip = phone.locator("#help-build-tower");
    await tooltip.waitFor({ state: "visible" });
    assert.match(await tooltip.innerText(), /connected friendly neighbors/);
    assert.equal(
      await tooltip.evaluate((el) => el.scrollHeight > el.clientHeight),
      true,
      "long landscape explanations should scroll",
    );
    const helpBox = (await tooltip.boundingBox())!;
    const beforeHelpScroll = await view(phone);
    await phone.mouse.move(
      helpBox.x + helpBox.width / 2,
      helpBox.y + helpBox.height / 2,
    );
    // Playwright mobile WebKit cannot synthesize wheel or swipe scrolling.
    // Chromium checks actual scroll routing; both check the scrollable layout.
    if (name === "chromium") {
      await phone.mouse.wheel(0, 180);
      await phone.waitForFunction(
        () => document.querySelector("#help-build-tower")!.scrollTop > 0,
      );
    }
    assert.deepEqual(
      await view(phone),
      beforeHelpScroll,
      "scrolling requirements must not zoom the map",
    );
    await phone.screenshot({ path: `${output}/${name}-landscape-help.png` });
    assert.deepEqual(errors, []);
    console.log(
      `${name}: full-width HUD, wheel zoom, drag, modal, panels, phone layout and landscape passed${name === "chromium" ? "; trusted pinch/pan passed" : ""}`,
    );
  } finally {
    await browser.close();
  }
}
