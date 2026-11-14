import assert from "node:assert/strict";
import { launchSelected } from "./lib/browser.js";

// Exercise native button activation while a real match is running: gameplay must
// release held input and leave the modal's Space/arrow keys to the browser.
const base = process.env.ONLINE_URL ?? "http://127.0.0.1:8787/";
const browser = await launchSelected("chrome", {
  headless: true,
  args: ["--mute-audio"],
});
try {
  for (const game of [
    "fuseball",
    "fuse-volley",
    "elasto-fuse",
    "fuse-axe",
    "fuse-choppers",
    "fuse-freight",
    "killer-fuse",
  ]) {
    const page = await browser.newPage();
    try {
      await page.goto(new URL(`${game}/?mute&solo=1`, base).href);
      const toggle = page.getByRole("button", {
        name: "Open game menu",
        exact: true,
      });
      await toggle.waitFor();
      await page.keyboard.down("ArrowRight");
      await toggle.focus();
      await page.keyboard.press("Space");
      const menu = page.locator(".fui-top-bar-menu[open]");
      await menu.waitFor();
      const close = menu.getByRole("button", { name: "CLOSE", exact: true });
      await close.focus();
      await page.keyboard.press("Space");
      await menu.waitFor({ state: "hidden" });
      await page.keyboard.up("ArrowRight");
      await page.waitForFunction(
        () =>
          document
            .querySelector(".fui-top-bar-toggle")
            ?.getAttribute("aria-expanded") === "false",
      );
      assert.equal(await toggle.getAttribute("aria-expanded"), "false");
      console.log(
        `PASS ${game}: gameplay leaves modal Space activation intact`,
      );
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}
