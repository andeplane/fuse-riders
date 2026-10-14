import { chromium, type Page } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const base = process.argv[2] ?? "http://localhost:8893";
const output = process.argv[3] ?? "/tmp/fuse-birds-phones";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors: string[] = [];
const pages: Page[] = [];
try {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 1440, height: 900 },
  ]) {
    const context = await browser.newContext({
      viewport,
      isMobile: viewport.width < 500,
      hasTouch: viewport.width < 500,
      deviceScaleFactor: viewport.width < 500 ? 2 : 1,
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    pages.push(page);
  }
  const [first, second, tv] = pages as [Page, Page, Page];
  await first.goto(`${base}/fuse-birds/?mute`);
  await first.getByLabel("Shared TV + phone controllers").check();
  await first.getByRole("button", { name: "CREATE ROOM" }).click();
  await first.locator(".fui-name-input").fill("SKYE");
  await first.getByRole("button", { name: "JOIN BATTLE" }).click();
  const code = await first.locator(".birds-code").innerText();
  await second.goto(`${base}/fuse-birds/?room=${code}&mute`);
  await second.locator(".fui-name-input").fill("EMBER");
  await second.getByRole("button", { name: "JOIN BATTLE" }).click();
  await first.locator(".birds-roster").getByText("EMBER").waitFor();
  await tv.goto(`${base}/fuse-birds/?room=${code}&display=1&mute`);
  await first.getByRole("button", { name: "START BATTLE" }).click();
  for (const page of pages)
    await page
      .locator('canvas[data-ready="true"]')
      .waitFor({ timeout: 60_000 });
  await first
    .getByRole("button", { name: "Scatter Bomb, 3 shots remaining" })
    .click();
  await first.getByRole("button", { name: "FULL MAP", exact: true }).click();
  const peerZoom = await second
    .getByLabel("Map zoom", { exact: true })
    .innerText();
  const turn = await first.locator(".birds-room").getAttribute("data-turn");
  const cdp = await first.context().newCDPSession(first);
  async function startAim() {
    const box = await first.locator("canvas").boundingBox();
    assert.ok(box);
    const scale = Math.min(box.width / 1536, box.height / 768);
    // Spawn pad height is 350–409; this point is within the minimum 48 CSS-pixel aim target.
    const point = {
      id: 1,
      x: box.x + box.width / 2 + (70 - 768) * scale,
      y: box.y + box.height / 2 + (380 - 384) * scale,
    };
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [point],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ ...point, x: point.x + 20, y: point.y + 20 }],
    });
    await first.locator('canvas[data-gesture="aim"]').waitFor();
    return { ...point, x: point.x + 20, y: point.y + 20 };
  }
  const point = await startAim();
  const other = { id: 2, x: point.x + 100, y: point.y };
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [point, other],
  });
  await first.locator('canvas[data-gesture="pinch"]').waitFor();
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [point, { ...other, x: other.x + 90 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await first.locator('canvas[data-gesture="idle"]').waitFor();
  assert.notEqual(
    await first.getByLabel("Map zoom", { exact: true }).innerText(),
    "100%",
  );
  assert.equal(
    await second.getByLabel("Map zoom", { exact: true }).innerText(),
    peerZoom,
  );
  assert.equal(await tv.locator(".birds-camera").isHidden(), true);
  for (const [index, page] of pages.entries())
    await page.screenshot({ path: `${output}/different-views-${index}.png` });
  await first.getByRole("button", { name: "FULL MAP", exact: true }).click();
  await startAim();
  await first.setViewportSize({ width: 844, height: 390 });
  await first.locator('canvas[data-gesture="idle"]').waitFor();
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await first.getByRole("button", { name: "FULL MAP", exact: true }).click();
  await startAim();
  // Browser event dispatch exercises the app's blur listener; it is not physical OS focus evidence.
  await first.evaluate(() => window.dispatchEvent(new Event("blur")));
  await first.locator('canvas[data-gesture="idle"]').waitFor();
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  assert.equal(
    await first.locator(".birds-room").getAttribute("data-turn"),
    turn,
  );
  for (const page of pages)
    await page
      .getByRole("button", { name: "Scatter Bomb, 3 shots remaining" })
      .waitFor();
  await first.screenshot({ path: `${output}/landscape-cancelled.png` });
  // A new gesture must remain usable after external cancellation.
  await startAim();
  await first.keyboard.press("Escape");
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  assert.deepEqual(errors, []);
  console.log(
    `Room ${code}: two independent emulated phone views and full-map TV; pinch, viewport resize and dispatched blur cancel an active aim without spending ammo. ${output}`,
  );
} catch (error) {
  for (const [index, page] of pages.entries()) {
    console.error(await page.locator("body").innerText());
    await page.screenshot({ path: `${output}/failure-${index}.png` });
  }
  throw error;
} finally {
  await browser.close();
}
