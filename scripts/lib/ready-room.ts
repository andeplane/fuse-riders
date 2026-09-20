import assert from "node:assert/strict";
import type { Page } from "playwright";

/** Exercise real readiness controls on every open rider page in this room; viewers have no vote. Solo retains its start button. */
export async function readyRoom(anchor: Page): Promise<void> {
  const url = new URL(anchor.url());
  if (url.searchParams.has("solo")) {
    await anchor
      .getByRole("button", { name: /^(START RACE|REMATCH)$/ })
      .filter({ visible: true })
      .first()
      .click();
    return;
  }
  const room = url.searchParams.get("room");
  assert.ok(room, "readyRoom needs a room URL");
  const pages = anchor
    .context()
    .browser()!
    .contexts()
    .flatMap((context) => context.pages())
    .filter((page) => new URL(page.url()).searchParams.get("room") === room);
  let voters = 0;
  for (const page of pages) {
    const buttons = page.getByRole("button", {
      name: /^(READY|READY FOR REMATCH|NOT READY)$/,
      includeHidden: true,
    });
    // Native hidden distinguishes watchers from riders even when the phone menu's CSS conceals its actions.
    const eligible = await buttons.evaluateAll((nodes) =>
      nodes.some((node) => !(node as HTMLButtonElement).hidden),
    );
    if (!eligible) continue;
    voters++;
    if (
      await page.getByRole("button", { name: "NOT READY", exact: true }).count()
    )
      continue;
    let ready = page
      .getByRole("button", { name: /^(READY|READY FOR REMATCH)$/ })
      .filter({ visible: true })
      .first();
    if (!(await ready.count())) {
      const menu = page.locator(".mobile-tools-toggle");
      if (await menu.isVisible()) await menu.click();
      ready = page
        .getByRole("button", { name: /^(READY|READY FOR REMATCH)$/ })
        .filter({ visible: true })
        .first();
    }
    await ready.click();
  }
  assert.ok(voters, "the room must contain at least one human rider");
}
