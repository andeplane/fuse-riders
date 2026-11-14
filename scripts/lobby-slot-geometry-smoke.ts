import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import type { Page } from "playwright";
import { launchSelected } from "./lib/browser.js";

/** Real admission actions must not move neighbouring slots or change the pressed control's geometry. */
const base = process.env.ONLINE_URL ?? "http://127.0.0.1:8787/";
const output = process.env.SMOKE_SHOTS ?? "artifacts/lobby-slot-geometry";
const games = (
  process.env.SMOKE_GAMES ?? "fuse-volley,fuse-riders,fuse-craft"
).split(",");
await mkdir(output, { recursive: true });
const browser = await launchSelected("chrome", {
  headless: true,
  args: ["--mute-audio"],
});
const evidence: unknown[] = [];
async function geometry(page: Page) {
  return page.locator(".fui-room-open-slot:visible").evaluateAll((slots) =>
    slots.map((slot) => {
      const box = slot.getBoundingClientRect();
      let y = box.y + scrollY;
      // Dialog focus restoration may scroll the game's own scrolling page, not the window.
      for (
        let parent = slot.parentElement;
        parent;
        parent = parent.parentElement
      )
        if (parent !== document.scrollingElement) y += parent.scrollTop;
      return {
        slot: (slot as HTMLElement).dataset.slot,
        height: box.height,
        width: box.width,
        y,
      };
    }),
  );
}
try {
  for (const game of games)
    for (const viewport of [
      { width: 1440, height: 1000 },
      { width: 390, height: 844 },
    ]) {
      const context = await browser.newContext({ viewport });
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        await page.goto(new URL(`${game}/?mute`, base).href);
        await page.getByRole("button", { name: "Play", exact: true }).click();
        const host = page.getByRole("button", {
          name: "Host room",
          exact: true,
        });
        if (await host.isVisible()) await host.click();
        const room = page.locator(".fui-room-layout");
        await room.waitFor();
        await page.evaluate(() => document.fonts.ready);
        const modes = room.locator(".fui-room-modes button");
        if (await modes.count()) {
          await modes.last().click();
          await room
            .locator(".fui-room-count")
            .filter({ hasText: "0 / 6" })
            .waitFor();
        }
        const before = await geometry(page);
        assert.ok(before.length >= 2);
        assert.ok(
          before.every((slot) => slot.height === before[0]!.height),
          "empty slots have one fixed height",
        );
        const first = room.locator('.fui-room-open-slot[data-slot="0"]');
        const ai = first.getByRole("button", { name: "Add AI", exact: true });
        await ai.scrollIntoViewIfNeeded();
        const buttonBefore = await ai.boundingBox();
        assert.ok(buttonBefore);
        await page.mouse.move(
          buttonBefore.x + buttonBefore.width / 2,
          buttonBefore.y + buttonBefore.height / 2,
        );
        await page.mouse.down();
        assert.deepEqual(
          await ai.boundingBox(),
          buttonBefore,
          "pressing does not resize or shift the button",
        );
        await page.mouse.up();
        await first.locator(".fui-slot-occupant > *").waitFor();
        assert.deepEqual(
          await geometry(page),
          before,
          "adding AI preserves every slot and the whole grid",
        );
        const second = room.locator('.fui-room-open-slot[data-slot="1"]');
        await second.getByRole("button", { name: "Join", exact: true }).click();
        const dialog = room.locator(".fui-slot-admission[open]");
        await dialog
          .locator('input:not([type="checkbox"]):not([type="radio"])')
          .first()
          .fill("A very long player name for slots");
        await dialog.getByRole("button", { name: "Join", exact: true }).click();
        await second.locator(".fui-slot-occupant > *").waitFor();
        assert.deepEqual(
          await geometry(page),
          before,
          "joining and a long name preserve the same slot geometry",
        );
        const primary = room.locator(".fui-room-primary-action");
        if (await primary.count()) {
          await page.evaluate(() => scrollTo(0, 0));
          const box = await primary.boundingBox();
          assert.ok(box);
          assert.ok(
            box.y >= 0 && box.y + box.height <= viewport.height,
            "main action is reachable before the slot list without scrolling",
          );
          assert.equal(
            await primary.evaluate((node) =>
              node.nextElementSibling?.textContent?.trim(),
            ),
            "Game settings",
          );
        }
        await first.getByRole("button").click();
        await first
          .getByRole("button", { name: "Add AI", exact: true })
          .waitFor();
        assert.deepEqual(
          await geometry(page),
          before,
          "removing AI preserves slot geometry",
        );
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          "long names do not overflow the viewport",
        );
        evidence.push({ game, viewport, slots: before });
        console.log(
          `PASS ${game} ${viewport.width}: ${before[0]!.height}px slots, stable add/join/remove/press`,
        );
      } finally {
        await context.close();
      }
    }
} finally {
  await browser.close();
}
await writeFile(`${output}/geometry.json`, JSON.stringify(evidence, null, 2));
