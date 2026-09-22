import type { Page } from "playwright";

/**
 * The room bar collapses behind one ☰ MENU where the viewport is short (top-menu.css), and several smokes run at
 * 844x390, which is exactly that. A smoke that wants a bar action has to open the sheet first; on a viewport where
 * the bar is still a bar the ☰ is not rendered and this does nothing, so a caller need not know which it is on.
 */
export async function openTopMenu(page: Page): Promise<void> {
  const toggle = page.locator(".online-header > .top-menu-toggle");
  if (!(await toggle.isVisible())) return;
  if ((await toggle.getAttribute("aria-expanded")) === "true") return;
  await toggle.click();
}
