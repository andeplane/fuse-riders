/** Real game menus at desktop and phone widths; no real OAuth credentials or production data. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const origin = process.env.ONLINE_URL ?? "http://127.0.0.1:5180/";
const games = [
  "fuse-riders",
  "ball-bros",
  "dice",
  "hook-havok",
  "fuse-choppers",
  "fuse-craft",
  "fuse-freight",
  "fuse-axe",
  "fuse-bombers",
  "fuse-lane",
];
const browser = await chromium.launch({ headless: true });
await mkdir("artifacts/shared-social", { recursive: true });
try {
  for (const width of [1280, 390]) {
    for (const game of games) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(new URL(`${game}/?mute`, origin).href);
      const friends = page.getByRole("button", {
        name: "FRIENDS",
        exact: true,
      });
      await friends.waitFor({ timeout: 30_000 });
      await friends.click();
      const dialog = page.getByRole("dialog", { name: "FRIENDS", exact: true });
      await dialog.waitFor();
      await dialog
        .getByText("Sign in to add friends", { exact: false })
        .waitFor();
      const box = await dialog.boundingBox();
      assert.ok(
        box && box.x >= 0 && box.x + box.width <= width + 1,
        `${game}: friends dialog fits ${width}px`,
      );
      await page.screenshot({
        path: `artifacts/shared-social/${game}-friends-${width}.png`,
      });
      await dialog
        .getByRole("button", { name: "SIGN IN", exact: true })
        .click();
      const account = page.locator("dialog[open]");
      await account.waitFor();
      await account.getByText("SIGN IN WITH GOOGLE", { exact: true }).waitFor();
      const accountBox = await account.boundingBox();
      assert.ok(
        accountBox &&
          accountBox.x >= 0 &&
          accountBox.x + accountBox.width <= width + 1,
        `${game}: account fits ${width}px`,
      );
      await page.screenshot({
        path: `artifacts/shared-social/${game}-account-${width}.png`,
      });
      // Unauthenticated browsing still exposes a matches feed, with a retry on a failed fetch.
      await account
        .getByRole("button", { name: "MATCHES", exact: true })
        .click();
      await account
        .getByRole("button", { name: "EVERYONE", exact: true })
        .waitFor();
      await account.getByRole("button", { name: "CLOSE", exact: true }).click();
      assert.deepEqual(errors, [], `${game}: no runtime errors at ${width}px`);
      console.log(`OK ${game}: friends → sign-in → matches at ${width}px`);
      await page.close();
    }
  }
} finally {
  await browser.close();
}
