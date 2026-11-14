/** Native browser regression: pnpm exec tsx packages/fuse-ui/tests/playtest-menu.browser.ts */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, expect } from "playwright/test";

const bundled = await build({
  entryPoints: [
    fileURLToPath(
      new URL("./playtest-menu.browser-fixture.ts", import.meta.url),
    ),
  ],
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  define: { "import.meta.env": "{}" },
});
const javascript = bundled.outputFiles[0]!.text;
const server = createServer((request, response) => {
  response.setHeader(
    "Content-Type",
    request.url === "/fixture.js" ? "text/javascript" : "text/html",
  );
  response.end(
    request.url === "/fixture.js"
      ? javascript
      : request.url === "/foreign/"
        ? '<!doctype html><script>parent.postMessage({type:"fuse-playtest-recording-toggle"}, "*");parent.postMessage({type:"foreign-barrier"}, "*")</script>'
        : '<!doctype html><body><script type="module" src="/fixture.js"></script></body>',
  );
});
await new Promise<void>((resolve) => server.listen(0, "0.0.0.0", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://localhost:${address.port}/?mute`);
  const game = page.frameLocator("#game");
  const childToggle = game.locator(".fui-playtest-recording-toggle");
  await game.locator(".fui-top-bar-toggle").click();
  await expect(childToggle).toBeVisible();
  await expect(childToggle).toHaveText("Start recording");
  await expect(page.locator("body")).toHaveAttribute("data-starts", "0");
  await childToggle.click();
  await expect(page.locator("body")).toHaveAttribute("data-starts", "1");
  await expect(game.locator("body")).toHaveAttribute("data-starts", "0");
  await expect(page.locator(".fui-playtest-recording-toggle")).toHaveText(
    "Stop recording",
  );
  await game.locator(".fui-top-bar-toggle").click();
  await expect(childToggle).toHaveText("Stop recording");
  await childToggle.click();
  await expect(page.locator("body")).toHaveAttribute("data-stops", "1");
  await expect(game.locator("body")).toHaveAttribute("data-stops", "0");
  // Wrong source, even with the right origin, cannot control desktop capture.
  await page.evaluate(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: location.origin,
        source: window,
        data: { type: "fuse-playtest-recording-toggle" },
      }),
    );
  });
  // A real foreign-origin frame is also rejected, even though it is a current frame.
  await page.evaluate(
    (port) =>
      new Promise<void>((resolve) => {
        const foreign = document.createElement("iframe");
        foreign.src = `http://127.0.0.1:${port}/foreign/`;
        // Messages from one source are delivered in order; this follows the attempted toggle.
        window.addEventListener("message", (event: MessageEvent) => {
          if (event.data?.type === "foreign-barrier") resolve();
        });
        document.body.append(foreign);
      }),
    address.port,
  );
  await expect(page.locator("body")).toHaveAttribute("data-starts", "1");
  await expect(page.locator("body")).toHaveAttribute("data-stops", "1");
  await expect(page.locator("body")).toHaveAttribute("data-access", "1");
  assert.deepEqual(errors, []);
  console.log(
    "PASS: verified desktop owns one capture; child menu starts/stops it; wrong-source and cross-origin messages rejected",
  );
} finally {
  await browser.close();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
