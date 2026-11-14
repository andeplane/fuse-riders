import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { launchSelected } from "./lib/browser.js";

const base = process.env.ONLINE_URL ?? "http://127.0.0.1:8787/";
const browser = await launchSelected("chrome", {
  headless: true,
  args: ["--mute-audio"],
});
try {
  for (const game of (await readdir("games")).filter(
    (name) =>
      !name.startsWith(".") &&
      (!process.env.SMOKE_GAMES ||
        process.env.SMOKE_GAMES.split(",").includes(name)),
  )) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto(new URL(`${game}/?mute`, base).href);
      const top = page.locator(".fui-top-bar:visible");
      await top.waitFor();
      assert.equal(await top.count(), 1, `${game}: one shared header`);
      assert.equal(
        await top.evaluate((node) => getComputedStyle(node).backgroundColor),
        "rgba(0, 0, 0, 0)",
      );
      const account = top.locator(".fui-top-bar-account");
      await account.waitFor();
      const before = await account.boundingBox();
      assert.ok(before);
      // Geometry fixture: exercise the exact labels emitted by account loading/sign-in/rating updates.
      for (const label of [
        "Andeplane\n955 ELO",
        "Andeplane\n1,000 ELO",
        "A long account name\n10,000 ELO",
      ]) {
        await top
          .locator(".fui-top-bar-account-source")
          .evaluate((node, text) => {
            node.textContent = text;
          }, label);
        await account.filter({ hasText: label }).waitFor();
        const next = await account.boundingBox();
        assert.ok(next);
        assert.equal(
          next.height,
          before.height,
          `${game}: account height must not jump`,
        );
        assert.equal(
          next.width,
          before.width,
          `${game}: account width must not jump`,
        );
      }
      await top
        .getByRole("button", { name: "Open game menu", exact: true })
        .click();
      await top.locator(".fui-top-bar-menu[open]").waitFor();
      await page.keyboard.press("Escape");
      await top.locator(".fui-top-bar-menu[open]").waitFor({ state: "hidden" });
      await page.setViewportSize({ width: 390, height: 844 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        `${game}: phone overflow`,
      );
      const bounds = await account.boundingBox();
      assert.equal(bounds?.height, 44);
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.getByRole("button", { name: "Play", exact: true }).click();
      await page
        .getByRole("button", { name: "Host room", exact: true })
        .click();
      await page.locator(".fui-room-layout").waitFor();
      await page
        .locator(".fui-top-bar:visible")
        .getByRole("button", { name: "Open game menu", exact: true })
        .click();
      await page.locator(".fui-top-bar-menu[open]").waitFor();
      await page.keyboard.press("Escape");
      assert.deepEqual(errors, [], `${game}: browser errors`);
      console.log(`PASS ${game}`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
