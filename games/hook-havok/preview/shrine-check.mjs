import { chromium } from "playwright";
import assert from "node:assert/strict";

const base = process.argv[2];
const evidence =
  process.argv[3] ?? "games/hook-havok/docs/evidence/shrine-ball-desktop.png";
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+\/$/.test(base))
  throw new Error("Pass local service URL");
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  let asset;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (/lantern-shrine-source-.*\.png/.test(response.url()))
      asset = response.url();
  });
  await page.goto(base + "hook-havok/?mute");
  await page.locator('#status[data-state="ready"]').waitFor();
  await page.locator("#start").click();
  await page.locator('#status[data-state="playing"]').waitFor();
  assert.ok(asset);
  const alpha = await page.evaluate(async (url) => {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let clear = 0,
      opaque = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] === 0) clear++;
      if (data[i] > 240) opaque++;
    }
    return {
      width: image.width,
      height: image.height,
      clear: clear / (data.length / 4),
      opaque: opaque / (data.length / 4),
    };
  }, asset);
  assert.ok(alpha.clear > 0.4, "Source must contain real transparent space");
  assert.ok(alpha.opaque > 0.05, "Source must contain solid painted objects");
  console.log("Source alpha", alpha);
  for (const map of ["crossroads", "belfry", "crossroads"]) {
    await page.locator("#map").selectOption(map);
    await page.waitForFunction(
      (id) => document.querySelector("#scene").dataset.map === id,
      map,
    );
    assert.equal(
      await page.locator("#scene").getAttribute("data-shrine-props"),
      map === "crossroads" ? "21" : "0",
    );
    assert.equal(
      await page.locator("#scene").getAttribute("data-terrain-groups"),
      "1",
    );
  }
  await page.locator("#experiment").selectOption("ball");
  await page.waitForFunction(() => {
    const scene = document.querySelector("#scene");
    return (
      scene.dataset.experiment === "ball" &&
      JSON.parse(scene.dataset.balls).length > 0
    );
  });
  await page.locator("#arena-focus").click();
  await page.screenshot({
    path: evidence,
    fullPage: true,
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await page.locator('#status[data-state="playing"]').waitFor();
  assert.equal(await page.locator("#scene canvas").count(), 1);
  await page.route("**/lantern-shrine-source-*.png", (route) => route.abort());
  await page.goto(base + "hook-havok/?showcase=1&mute");
  await page.locator('#status[data-state="error"]').waitFor();
  await page.unroute("**/lantern-shrine-source-*.png");
  await page.locator("#retry").click();
  await page.locator('#status[data-state="ready"]').waitFor();
  assert.equal(await page.locator("#scene canvas").count(), 1);
  assert.deepEqual(errors, []);
  console.log(
    "PASS shrine transparency, map cleanup, ball flow, reduced-motion refresh and source failure/retry",
  );
} finally {
  await browser.close();
}
