import type { Page } from "playwright";

/** Existing solo/local/shared-TV recipes live behind the shared main menu's secondary action. */
export async function openPlayOptions(page: Page): Promise<void> {
  if (await page.locator(".fui-main-menu .fui-menu-dialog[open]").isVisible())
    return;
  await page.locator(".fui-main-menu-other").click();
}

/** Room creation leaves the host unseated until the explicit Join action. */
export async function takeHostSeat(page: Page, name: string): Promise<void> {
  const join = page.locator(".fui-room-join");
  await join
    .locator('input:not([type="radio"]):not([type="checkbox"])')
    .first()
    .fill(name);
  await join.getByRole("button", { name: /^Join(?: as player)?$/i }).click();
  await join
    .getByRole("button", { name: /^Join(?: as player)?$/i })
    .waitFor({ state: "hidden" });
}
