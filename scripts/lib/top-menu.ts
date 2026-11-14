import type { Page } from "playwright";

/**
 * Every game's header is the shared top bar (fuse-ui `createTopBar`): the brand, Sound, the account and one ☰ that
 * opens the Game menu, a dialog holding every other header action. A smoke that wants one of those actions opens the
 * dialog first; if it is already open this does nothing. An action that opens a dialog of its own closes the menu.
 */
export async function openTopMenu(page: Page): Promise<void> {
  const toggle = page.locator(".fui-top-bar:visible .fui-top-bar-toggle");
  if (!(await toggle.isVisible())) return;
  if ((await toggle.getAttribute("aria-expanded")) === "true") return;
  await toggle.click();
  await page.locator(".fui-top-bar-menu[open]").waitFor();
}

/** Close the Game menu if it is open, for actions that leave it up (a toggle rather than a dialog). */
export async function closeTopMenu(page: Page): Promise<void> {
  const menu = page.locator(".fui-top-bar-menu[open]");
  if (!(await menu.isVisible())) return;
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "hidden" });
}
