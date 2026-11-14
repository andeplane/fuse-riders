import assert from "node:assert/strict";
import { readdir, writeFile, mkdir } from "node:fs/promises";
import { launchSelected } from "./lib/browser.js";

/** Real menu → room → admission paths. No injected game state or browser API replacements. */
const base = process.env.ONLINE_URL ?? "http://127.0.0.1:8787/";
const evidence = process.env.SMOKE_SHOTS ?? "artifacts/game-lobbies";
await mkdir(evidence, { recursive: true });
const browser = await launchSelected("chrome", {
  headless: true,
  args: ["--mute-audio"],
});
const games = (await readdir("games")).filter((id) => !id.startsWith("."));
const results: { game: string; error?: string; ai?: string }[] = [];
try {
  for (const game of games) {
    if (
      process.env.SMOKE_GAMES &&
      !process.env.SMOKE_GAMES.split(",").includes(game)
    )
      continue;
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors: string[] = [];
    let step = "menu";
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto(new URL(`${game}/?mute`, base).href);
      const menu = page.locator(".fui-main-menu");
      await page.waitForFunction(
        () =>
          document.querySelector<HTMLElement>(".fui-main-menu")?.dataset
            .attractState === "running",
      );
      assert.ok(
        await menu.locator(".fui-attract canvas, .fui-attract svg").count(),
        "real gameplay renderer is present",
      );
      const firstTick = await menu.getAttribute("data-attract-tick");
      await page.waitForFunction(
        (first) =>
          document.querySelector<HTMLElement>(".fui-main-menu")?.dataset
            .attractTick !== first,
        firstTick,
      );
      await menu
        .getByRole("button", { name: "Pause background", exact: true })
        .click();
      await page.waitForFunction(
        () =>
          document.querySelector<HTMLElement>(".fui-main-menu")?.dataset
            .attractState === "paused",
      );
      await menu
        .getByRole("button", { name: "Play background", exact: true })
        .click();
      await menu.getByRole("button", { name: "About", exact: true }).click();
      const about = page.locator("dialog[open]");
      assert.match(await about.innerText(), /Made by the vibe coding gang/);
      assert.match(await about.innerText(), /Sindre Aarsaether/);
      assert.doesNotMatch(await about.innerText(), /bedeho/i);
      await page.keyboard.press("Escape");
      await menu
        .getByRole("button", { name: "How to play", exact: true })
        .click();
      if (game === "fuse-craft") {
        await page.locator('[data-action="back-menu"]').click();
      } else {
        assert.ok(
          (
            await page
              .locator("dialog[open], [role=dialog]:visible")
              .innerText()
          ).length > 60,
        );
        await page.keyboard.press("Escape");
      }
      await page.setViewportSize({ width: 390, height: 844 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        "phone menu overflows horizontally",
      );
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.getByRole("button", { name: "Play", exact: true }).click();
      await page
        .getByRole("button", { name: "Host room", exact: true })
        .click();
      step = "empty room and QR";
      const room = page.locator(".fui-room-layout");
      await room.waitFor();
      await page.waitForFunction(
        () =>
          document.querySelector<HTMLElement>(".fui-room-layout")?.dataset
            .attractState === "running",
      );
      await room
        .locator(".fui-room-count")
        .filter({ hasText: /^0\s*\/\s*\d/ })
        .waitFor();
      if (["fuse-front", "fuseball", "fuse-volley"].includes(game)) {
        const modes = room.locator(".fui-room-modes");
        await modes.waitFor();
        const buttons = modes.getByRole("button");
        // Fuse Volley: DUEL, 2 V 2, 3 V 3 and 2 V 2 V 2; the others have three. Every last mode seats six.
        assert.equal(await buttons.count(), game === "fuse-volley" ? 4 : 3);
        await buttons.last().click();
        await room
          .locator(".fui-room-count")
          .filter({ hasText: "0 / 6" })
          .waitFor();
        await buttons.first().click();
        await room
          .locator(".fui-room-count")
          .filter({ hasText: "0 / 2" })
          .waitFor();
      }
      await room.locator("img.fui-invite-qr").waitFor();
      await page.waitForFunction(() =>
        [
          ...document.querySelectorAll<HTMLImageElement>(
            ".fui-room-layout img.fui-invite-qr",
          ),
        ].some((img) => img.complete && img.naturalWidth > 0),
      );
      await room
        .locator('.fui-room-open-slot[data-slot="1"]')
        .getByRole("button", { name: "Join", exact: true })
        .click();
      const name = room
        .locator(
          'dialog[open] input:not([type="checkbox"]):not([type="radio"])',
        )
        .first();
      await name.fill("Menu Tester");
      step = "host admission";
      await room
        .locator("dialog[open]")
        .getByRole("button", { name: /^Join(?: as player)?$/i })
        .click();
      await page.waitForFunction(() =>
        /^1\s*\//.test(
          document.querySelector(".fui-room-count")?.textContent ?? "",
        ),
      );
      await room
        .locator('.fui-room-open-slot[data-slot="1"].fui-slot-occupied')
        .waitFor();
      const settings = room.getByRole("button", {
        name: "Game settings",
        exact: true,
      });
      step = "settings";
      if (await settings.isVisible()) {
        await settings.click();
        const dialog = page.locator("dialog[open]");
        await dialog.waitFor();
        const select = dialog.locator("select:enabled").first();
        if (await select.count()) {
          const next = await select
            .locator("option")
            .nth(1)
            .getAttribute("value");
          if (next !== null) await select.selectOption(next);
          await page.locator("dialog[open]").waitFor();
        }
        await page.keyboard.press("Escape");
      }
      const ai = room
        .locator('.fui-room-open-slot[data-slot="0"]')
        .getByRole("button", { name: /^Add AI$/i })
        .first();
      step = "AI admission";
      const hasAI =
        (await ai.count()) > 0 &&
        (await ai.isVisible()) &&
        (await ai.isEnabled());
      if (hasAI) {
        await ai.click();
        await page.waitForFunction(() =>
          /^2\s*\//.test(
            document.querySelector(".fui-room-count")?.textContent ?? "",
          ),
        );
        await room
          .locator('.fui-room-open-slot[data-slot="0"].fui-slot-occupied')
          .waitFor();
      }
      await page.setViewportSize({ width: 390, height: 844 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        "phone room overflows horizontally",
      );
      assert.deepEqual(errors, [], "browser exceptions");
      results.push({
        game,
        ai: hasAI ? "added" : "unsupported or unavailable",
      });
      console.log(`PASS ${game}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ game, error: `${step}: ${message}` });
      // What the page was showing: a room that fell back to its menu or reported an error says so here, not in the timeout.
      const showing = await page
        .evaluate(() =>
          [
            document.body.className,
            ...[
              ...document.querySelectorAll<HTMLElement>(
                '[data-state="error"], [role="alert"], [role="status"]',
              ),
            ].map((node) => node.textContent?.trim().slice(0, 120)),
          ]
            .filter(Boolean)
            .join(" | "),
        )
        .catch(() => "page gone");
      console.error(
        `FAIL ${game} at ${step}: ${message.slice(0, 350)}\n  page: ${showing}`,
      );
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
await writeFile(`${evidence}/results.json`, JSON.stringify(results, null, 2));
assert.ok(
  results.length > 0 && results.every((result) => !result.error),
  "all game menu and room flows pass",
);
