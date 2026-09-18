import { readyRoom } from "./lib/ready-room.js";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { launchSelected, browserKind } from "./lib/browser.js";

const base = process.env.ONLINE_URL ?? "http://localhost:8787/";
const browser = await launchSelected("chromium", { headless: true });
const kind = browserKind("chromium");
await mkdir("artifacts", { recursive: true });
const errors: string[] = [];
try {
  const host = await browser.newPage();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const phone = await context.newPage();
  for (const page of [host, phone]) {
    page.setDefaultTimeout(20000);
    page.on("pageerror", (error) => errors.push(error.message));
  }
  await host.goto(new URL("?mute", base).href);
  await host
    .locator(".landing-mode label", {
      has: host.getByRole("radio", { name: "Shared TV", exact: true }),
    })
    .click();
  await host.getByRole("button", { name: "CREATE ROOM", exact: true }).click();
  await host.waitForURL(/room=/);
  const invite = new URL(host.url());
  invite.searchParams.set("mute", "1");
  invite.searchParams.set("benchmark", "1");
  // Observe the public benchmark input events, without replacing transport or physics.
  await phone.addInitScript(() => {
    const inputs: {
      left: boolean;
      right: boolean;
      bomb: boolean;
      bombAction?: string;
    }[] = [];
    Reflect.set(window, "arcadeInputs", inputs);
    window.addEventListener("fuse-benchmark", (event) => {
      const detail = (event as CustomEvent).detail;
      if (detail.kind === "input") {
        inputs.push(detail);
        if (inputs.length > 200) inputs.shift();
      }
    });
  });
  await phone.goto(invite.href);
  await phone.getByPlaceholder("Your name").fill("Arcade Rider");
  await phone
    .getByRole("button", { name: "JOIN AS PLAYER", exact: true })
    .click();
  await phone.locator(".online-join").waitFor({ state: "hidden" });
  await host.getByRole("button", { name: "ADD AI", exact: true }).click();
  await readyRoom(host);
  await phone.locator(".mobile-play.controller-only").waitFor();

  async function cleanScreenshot(options: { path: string }) {
    if (await phone.locator(".mobile-tools-open").count())
      await phone.locator(".mobile-tools-toggle").click();
    await phone
      .locator(".online-announce.countdown")
      .waitFor({ state: "hidden" });
    await phone.screenshot(options);
  }
  async function layout(portrait: boolean, side = "right") {
    const boxes = await phone
      .locator(".online-controls > button")
      .evaluateAll((buttons) =>
        buttons.map((button) => {
          const r = button.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height };
        }),
      );
    const [left, bomb, right] = boxes;
    assert.ok(left && bomb && right);
    const v = phone.viewportSize()!;
    for (const r of boxes)
      assert.ok(
        r.x >= 0 &&
          r.y >= 0 &&
          r.x + r.w <= v.width + 1 &&
          r.y + r.h <= v.height + 1,
      );
    assert.ok(left.x < right.x, "left arrow always precedes right arrow");
    if (portrait) {
      assert.ok(bomb.y < left.y && Math.abs(left.y - right.y) < 1);
      assert.ok(
        Math.abs(bomb.h - left.h) < 2 && Math.abs(bomb.w - left.w * 2) < 5,
      );
    } else {
      assert.ok(Math.abs(bomb.y - left.y) < 1 && Math.abs(bomb.h - left.h) < 1);
      assert.ok(Math.abs(bomb.w - left.w * 2) < 5);
      assert.ok(side === "left" ? bomb.x < left.x : bomb.x > right.x);
    }
    assert.equal(await phone.locator(".online-arena").isVisible(), false);
  }
  await layout(true);
  await cleanScreenshot({ path: `artifacts/arcade-portrait-${kind}.png` });
  await phone.setViewportSize({ width: 844, height: 390 });
  await layout(false);
  await cleanScreenshot({
    path: `artifacts/arcade-landscape-right-${kind}.png`,
  });

  // Synthetic simultaneous PointerEvents exercise the real DOM bindings on both engines.
  // They do not claim physical multi-touch or browser pointer-capture fidelity.
  async function multiTouch() {
    await phone.locator(".pad-left").dispatchEvent("pointerdown", {
      pointerId: 71,
      pointerType: "touch",
      button: 0,
      buttons: 1,
    });
    await phone.locator(".pad-bomb").dispatchEvent("pointerdown", {
      pointerId: 72,
      pointerType: "touch",
      button: 0,
      buttons: 1,
    });
    assert.equal(await phone.locator(".online-controls > .active").count(), 2);
    await phone.locator(".pad-bomb").dispatchEvent("pointercancel", {
      pointerId: 72,
      pointerType: "touch",
      buttons: 0,
    });
    assert.equal(await phone.locator(".pad-left.active").count(), 1);
    await phone.locator(".pad-left").dispatchEvent("pointerup", {
      pointerId: 71,
      pointerType: "touch",
      buttons: 0,
    });
    assert.equal(await phone.locator(".online-controls > .active").count(), 0);
  }
  await multiTouch();
  await phone.locator(".mobile-tools-toggle").click();
  const menuBounds = await phone.locator(".online-header").boundingBox();
  const padBounds = await phone.locator(".online-controls").boundingBox();
  assert.ok(
    menuBounds &&
      padBounds &&
      menuBounds.y >= padBounds.y &&
      menuBounds.y < padBounds.y + padBounds.height,
    "menu overlays pads",
  );
  assert.equal(
    await phone
      .locator(".online-header")
      .evaluate((e) => e.scrollHeight > e.clientHeight + 1),
    false,
    "landscape menu fits without the old scrolling strip",
  );
  for (const selector of [
    ".online-roster",
    ".online-announce",
    ".online-notice",
    ".online-feed",
    ".online-round",
  ])
    assert.equal(
      await phone.locator(selector).first().isVisible(),
      false,
      `${selector} belongs on TV`,
    );
  await phone.screenshot({
    path: `artifacts/arcade-landscape-menu-${kind}.png`,
  });
  await phone.getByRole("button", { name: "SETTINGS", exact: true }).click();
  const sidePicker = phone.getByLabel("Landscape bomb side");
  await sidePicker.scrollIntoViewIfNeeded();
  const labelFits = await sidePicker.evaluate((element) => {
    const select = element as HTMLSelectElement;
    const style = getComputedStyle(select);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d")!;
    context.font = style.font;
    // Reserve room for native select chrome as well as CSS padding.
    return (
      select.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight) -
        32 >=
      context.measureText("Right").width
    );
  });
  assert.equal(
    labelFits,
    true,
    "collapsed side picker has room for Right and native arrow",
  );
  await phone.screenshot({
    path: `artifacts/arcade-landscape-settings-${kind}.png`,
  });
  await phone.getByLabel("Landscape bomb side").selectOption("left");
  await phone.getByRole("button", { name: "CLOSE", exact: true }).click();
  if (await phone.locator(".mobile-tools-open").count())
    await phone.locator(".mobile-tools-toggle").click();
  await layout(false, "left");
  await multiTouch();
  await cleanScreenshot({
    path: `artifacts/arcade-landscape-left-${kind}.png`,
  });
  await phone.locator(".pad-bomb").dispatchEvent("pointerdown", {
    pointerId: 73,
    pointerType: "touch",
    button: 0,
    buttons: 1,
  });
  await phone.setViewportSize({ width: 320, height: 568 });
  await phone.waitForFunction(
    () => !document.querySelector(".online-controls > .active"),
  );
  await layout(true, "left");
  const actions = await phone.evaluate(
    () => Reflect.get(window, "arcadeInputs") as { bombAction?: string }[],
  );
  assert.equal(
    actions.at(-1)?.bombAction,
    "cancel",
    "rotation cancels rather than fires held bomb",
  );
  await cleanScreenshot({
    path: `artifacts/arcade-small-portrait-${kind}.png`,
  });
  await phone.setViewportSize({ width: 844, height: 390 });
  await layout(false, "left");
  await phone.reload();
  // A refresh recovers from a peer; the layout preference is local, never room state.
  await phone.locator(".mobile-play.controller-only").waitFor();
  await layout(false, "left");
  await host
    .getByRole("dialog", { name: "Match results", exact: true })
    .waitFor({ state: "visible", timeout: 90000 });
  await phone.waitForFunction(
    () =>
      document
        .querySelector(".mobile-tools-toggle")
        ?.getAttribute("aria-expanded") === "false",
  );
  assert.equal(
    await phone.locator(".game-dialog[open]").count(),
    0,
    "TV results do not pop up on controller",
  );
  assert.equal(await phone.locator(".online-roster").isVisible(), false);
  assert.deepEqual(errors, []);
  console.log(
    `PASS Arcade Pads (${kind}): real shared room, both orientations/sides, settings, reload, cancellation and multi-touch bindings`,
  );
} finally {
  await browser.close();
}
