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
  "fuse-drivers",
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
      const page = await browser.newPage({
        viewport: { width, height: 1100 },
        hasTouch: true,
      });
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
      if (game === "hook-havok") {
        await page.goto(new URL(`${game}/?mute&play&touch`, origin).href);
        await page.locator('#status[data-state="ready"]').waitFor();
        await page.locator("#start").click();
        await page.locator('#status[data-state="playing"]').waitFor();
        await page.locator("#map").selectOption("spire");
        await page.waitForFunction(
          () =>
            document.querySelector<HTMLElement>("#scene")?.dataset.map ===
            "spire",
        );
        const cdp = await page.context().newCDPSession(page);
        const thrown = (): Promise<number> =>
          page.locator("#scene").evaluate((element) => {
            const data = (element as HTMLElement).dataset;
            return (
              JSON.parse(data.keepers ?? "[]") as {
                id: string;
                tally: { thrown: number };
              }[]
            ).find((keeper) => keeper.id === data.playerId)!.tally.thrown;
          });
        for (const kind of ["friends", "account"] as const) {
          await page.locator("#touch-toggle").focus();
          const pad = page.locator('[data-pad="bomb"]');
          await pad.scrollIntoViewIfNeeded();
          const box = (await pad.boundingBox())!;
          const point = {
            id: 1,
            x: box.x + box.width / 2,
            y: box.y + box.height / 2,
          };
          const before: number = await thrown();
          await cdp.send("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: [point],
          });
          await page.waitForFunction(
            () =>
              Number(
                document.querySelector<HTMLElement>("#scene")?.dataset.charge,
              ) > 0,
          );
          const controls = page.locator(".fui-social");
          const button =
            kind === "friends"
              ? controls.getByRole("button", { name: "FRIENDS", exact: true })
              : controls.getByRole("button").first();
          await button.scrollIntoViewIfNeeded();
          const socialBox = (await button.boundingBox())!;
          assert.ok(
            socialBox.y >= 0 && socialBox.y + socialBox.height <= 1100,
            "social controls remain reachable while touch is held",
          );
          // Chromium does not synthesize a button click from a second simultaneous touch.
          // A native mouse click opens the real dialog while the touch pointer stays held.
          await button.click();
          const modal = page.locator("dialog[open]");
          await modal.waitFor();
          await page.waitForFunction(
            () =>
              Number(
                document.querySelector<HTMLElement>("#scene")?.dataset.charge,
              ) === 0,
          );
          assert.equal(
            await thrown(),
            before,
            `${kind}: held touch charge cancels without throwing`,
          );
          await page.screenshot({
            path: `artifacts/shared-social/hook-havok-${kind}-held-touch-${width}.png`,
          });
          await cdp.send("Input.dispatchTouchEvent", {
            type: "touchCancel",
            touchPoints: [],
          });
          await modal
            .getByRole("button", { name: "CLOSE", exact: true })
            .click();
        }
        // A fresh ordinary touch release still throws after the dialogs have closed.
        await page.locator('[data-pad="bomb"]').scrollIntoViewIfNeeded();
        const box = (await page.locator('[data-pad="bomb"]').boundingBox())!;
        const before: number = await thrown();
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [
            { id: 3, x: box.x + box.width / 2, y: box.y + box.height / 2 },
          ],
        });
        await page.waitForFunction(
          () =>
            Number(
              document.querySelector<HTMLElement>("#scene")?.dataset.charge,
            ) > 0,
        );
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchEnd",
          touchPoints: [],
        });
        await page.waitForFunction((count: number) => {
          const data = document.querySelector<HTMLElement>("#scene")!.dataset;
          return (
            (
              JSON.parse(data.keepers ?? "[]") as {
                id: string;
                tally: { thrown: number };
              }[]
            ).find((keeper) => keeper.id === data.playerId)?.tally.thrown ===
            count + 1
          );
        }, before);
        await cdp.detach();
        console.log(
          `OK ${game}: held touch charge cancelled by friends/account, normal release throws at ${width}px`,
        );
      }
      if (game === "fuse-drivers") {
        await page.goto(new URL(`${game}/?solo=1&mute`, origin).href);
        await page.locator(".fd-pad").waitFor();
        const main = page.locator("main[data-tick]");
        const cdp = await page.context().newCDPSession(page);
        for (const kind of ["friends", "account"] as const) {
          await page.locator("canvas").click();
          await page.keyboard.down("ArrowRight");
          await page.waitForFunction(
            () =>
              document.querySelector<HTMLElement>("main[data-turn]")?.dataset
                .turn === "1",
          );
          const pad = page
            .locator(".fd-pad")
            .getByRole("button", { name: "▶", exact: true });
          await pad.scrollIntoViewIfNeeded();
          const box = (await pad.boundingBox())!;
          await cdp.send("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: [
              { id: 1, x: box.x + box.width / 2, y: box.y + box.height / 2 },
            ],
          });
          const controls = page.locator(".fui-social");
          if (kind === "friends")
            await controls
              .getByRole("button", { name: "FRIENDS", exact: true })
              .click();
          else await controls.getByRole("button").first().click();
          const modal = page.locator("dialog[open]");
          await modal.waitFor();
          await page.waitForFunction(
            () =>
              document.querySelector<HTMLElement>("main[data-turn]")?.dataset
                .turn === "0",
          );
          const tick = Number(await main.getAttribute("data-tick"));
          await page.waitForFunction(
            (at: number) =>
              Number(
                document.querySelector<HTMLElement>("main[data-tick]")?.dataset
                  .tick,
              ) >=
              at + 8,
            tick,
          );
          assert.equal(
            await main.getAttribute("data-turn"),
            "0",
            `${kind}: held steering cleared`,
          );
          await page.screenshot({
            path: `artifacts/shared-social/fuse-drivers-${kind}-held-steering-${width}.png`,
          });
          await page.keyboard.up("ArrowRight");
          await cdp.send("Input.dispatchTouchEvent", {
            type: "touchCancel",
            touchPoints: [],
          });
          await modal
            .getByRole("button", { name: "CLOSE", exact: true })
            .click();
        }
        await page.locator("canvas").click();
        await page.keyboard.down("ArrowRight");
        await page.waitForFunction(
          () =>
            document.querySelector<HTMLElement>("main[data-turn]")?.dataset
              .turn === "1",
        );
        await page.keyboard.up("ArrowRight");
        await cdp.detach();
        console.log(
          `OK ${game}: held steering cancelled by friends/account, resumes after close at ${width}px`,
        );
      }
      if (game === "graveyard-shift") {
        if (width === 390) {
          const landscape = await browser.newPage({
            viewport: { width: 844, height: 390 },
            hasTouch: true,
            isMobile: true,
          });
          const landscapeErrors: string[] = [];
          landscape.on("pageerror", (error) =>
            landscapeErrors.push(error.message),
          );
          await landscape.goto(new URL(`${game}/?solo=1&mute`, origin).href);
          await landscape.locator('[data-phase="running"]').waitFor();
          for (const selector of ["canvas", ".up", ".vacuum", ".pulse"]) {
            const box = await landscape.locator(selector).boundingBox();
            assert.ok(
              box &&
                box.x >= 0 &&
                box.y >= 0 &&
                box.x + box.width <= 844 &&
                box.y + box.height <= 390,
              `${selector}: landscape phone control fits before interaction`,
            );
          }
          await landscape.screenshot({
            path: "artifacts/shared-social/graveyard-landscape-play.png",
          });
          for (const kind of ["friends", "account"] as const) {
            const controls = landscape.locator(".fui-social");
            if (kind === "friends")
              await controls
                .getByRole("button", { name: "FRIENDS", exact: true })
                .click();
            else await controls.getByRole("button").first().click();
            const modal = landscape.locator("dialog[open]");
            await modal.waitFor();
            const box = (await modal.boundingBox())!;
            assert.ok(
              box.x >= 0 &&
                box.y >= 0 &&
                box.x + box.width <= 844 &&
                box.y + box.height <= 390,
              `${kind}: landscape phone dialog fits`,
            );
            await landscape.screenshot({
              path: `artifacts/shared-social/graveyard-landscape-${kind}.png`,
            });
            await modal
              .getByRole("button", { name: "CLOSE", exact: true })
              .click();
          }
          assert.deepEqual(landscapeErrors, []);
          await landscape.close();
          console.log(
            "OK graveyard-shift: arena/thumbs and social dialogs fit844x390 before interaction",
          );
        }
        await page.goto(new URL(`${game}/?solo=1&mute`, origin).href);
        await page.locator('[data-phase="running"]').waitFor();
        const personal = page.locator(".personal");
        for (const kind of ["friends", "account"] as const) {
          await page.locator("canvas").click();
          const readyTick = Number(
            await page.locator("main[data-tick]").getAttribute("data-tick"),
          );
          await page.waitForFunction(
            (at: number) =>
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
            (x: number) =>
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
            (at: number) =>
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
            (at: number) =>
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
