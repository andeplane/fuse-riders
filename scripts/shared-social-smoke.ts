/** Real game menus at desktop and phone widths; no real OAuth credentials or production data. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, type Browser } from "playwright";
import { startRoomService } from "./lib/server.js";

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
  "graveyard-shift",
];
const only = process.env.ONLY?.split(",").filter(Boolean);
const selected = only ? games.filter((game) => only.includes(game)) : games;
assert.ok(
  selected.length > 0,
  "ONLY must name a game in the social smoke catalog",
);
const service = process.env.ONLINE_URL
  ? undefined
  : await startRoomService({ logFile: "artifacts/shared-social-service.log" });
const origin = process.env.ONLINE_URL ?? service!.url;
let browser: Browser | undefined;
try {
  browser = await chromium.launch({ headless: true });
  await mkdir("artifacts/shared-social", { recursive: true });
  for (const width of [1280, 390]) {
    for (const game of selected) {
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
      if (game === "graveyard-shift") {
        await page.goto(new URL(`${game}/?solo=1&mute`, origin).href);
        await page.locator('[data-phase="running"]').waitFor();
        const personal = page.locator(".personal");
        for (const kind of ["friends", "account"] as const) {
          await page.locator("canvas").click();
          const readyTick = Number(
            await page.locator("main[data-tick]").getAttribute("data-tick"),
          );
          await page.waitForFunction(
            (at) =>
              Number(
                document.querySelector<HTMLElement>("main[data-tick]")?.dataset
                  .tick,
              ) >=
              at + 2,
            readyTick,
          );
          const before = Number(await personal.getAttribute("data-x"));
          await page.keyboard.down("ArrowRight");
          await page.waitForFunction(
            (x) =>
              Number(
                document.querySelector<HTMLElement>(".personal")?.dataset.x,
              ) >
              x + 5,
            before,
            { timeout: 5000 },
          );
          const controls = page.locator(".fui-social");
          if (kind === "friends")
            await controls
              .getByRole("button", { name: "FRIENDS", exact: true })
              .click();
          else await controls.getByRole("button").first().click();
          const modal = page.locator("dialog[open]");
          await modal.waitFor();
          const tick = Number(
            await page.locator("main[data-tick]").getAttribute("data-tick"),
          );
          await page.waitForFunction(
            (at) =>
              Number(
                document.querySelector<HTMLElement>("main[data-tick]")?.dataset
                  .tick,
              ) >=
              at + 2,
            tick,
          );
          const stopped = Number(await personal.getAttribute("data-x"));
          assert.equal(
            await page.evaluate(() => {
              const key = new KeyboardEvent("keydown", {
                key: "ArrowRight",
                bubbles: true,
                cancelable: true,
              });
              document.querySelector("dialog[open] button")!.dispatchEvent(key);
              return key.defaultPrevented;
            }),
            false,
            "dialog arrow keys retain their native default",
          );
          await page.waitForFunction(
            (at) =>
              Number(
                document.querySelector<HTMLElement>("main[data-tick]")?.dataset
                  .tick,
              ) >=
              at + 22,
            tick,
          );
          assert.equal(
            Number(await personal.getAttribute("data-x")),
            stopped,
            `${kind}: opening the dialog releases held movement`,
          );
          await page.keyboard.up("ArrowRight");
          await modal
            .getByRole("button", { name: "CLOSE", exact: true })
            .click();
        }
        console.log(
          `OK ${game}: held movement cleared by friends/account; dialog arrows stay native at ${width}px`,
        );
      }
      assert.deepEqual(errors, [], `${game}: no runtime errors at ${width}px`);
      console.log(`OK ${game}: friends → sign-in → matches at ${width}px`);
      await page.close();
    }
  }
} finally {
  try {
    await browser?.close();
  } finally {
    await service?.stop();
  }
}
