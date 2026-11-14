import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Locator, Page } from "playwright";

/**
 * Driving the FuseOS desktop (packages/fuseos) from a browser script: the smoke (scripts/fuseos-smoke.ts) and the
 * screenshot set (scripts/fuseos-screenshots.ts) share these. Everything here finds the desktop by the accessible
 * names its components already carry (the taskbar toolbar, the icon list, a window's `dialog` named by its title,
 * the Start menu's `menuitem`s) rather than by class names or test ids, so a restyle does not break a script.
 */

/** The OS name the boot screen announces (`aria-label="Starting FuseOS"`) and the About window is named after. */
export const OS_NAME = "FuseOS";

/** How long a boot screen stays up at least (packages/fuseos/src/App.tsx BOOT_HOLD_MS). */
export const BOOT_HOLD_MS = 1500;

/**
 * `?mute` carries into every game the desktop embeds (AGENTS.md: previews open muted). `?open=` names the
 * windows to open on boot. The base must be the page the OS is served at, with or without a trailing slash.
 */
export function osUrl(
  base: string,
  params: { mute?: boolean; open?: readonly string[] } = {},
): string {
  const url = new URL(base);
  if (params.open && params.open.length > 0)
    url.searchParams.set("open", params.open.join(","));
  if (params.mute !== false) url.searchParams.append("mute", "");
  // URLSearchParams writes `mute=`; the OS only tests the key, and the bare form is what AGENTS.md shows.
  return url.href.replace(/([?&])mute=(?=&|$)/, "$1mute");
}

/**
 * True when an embedded game frame points at the game's own page under the OS's base: `<base><id>/`, with
 * `?mute` exactly when the OS was opened muted (packages/fuseos/src/fusegames/registry.ts embedUrl).
 */
export function isGameEmbed(
  src: string,
  gameId: string,
  muted: boolean,
): boolean {
  return src.endsWith(`/${gameId}/${muted ? "?mute" : ""}`);
}

/** The window that `window.open` was asked to open: what a stubbed opener records. */
export type RecordedOpen = { url: string; target: string; features: string };

/**
 * Installed before the page's own scripts: replaces `window.open` with a recorder, so a launch in tab mode
 * (settings) or a title-bar Pop out can be asserted without a second page ever opening. Read back with
 * `recordedOpens`.
 */
export async function stubWindowOpen(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const record: RecordedOpen[] = [];
    Object.defineProperty(window, "__fuseosOpens", { value: record });
    window.open = (url?: string | URL, target?: string, features?: string) => {
      record.push({
        url: String(url ?? ""),
        target: target ?? "",
        features: features ?? "",
      });
      return null;
    };
  });
}

export function recordedOpens(page: Page): Promise<RecordedOpen[]> {
  return page.evaluate(() => {
    const opens: unknown = (window as unknown as Record<string, unknown>)
      .__fuseosOpens;
    return Array.isArray(opens) ? (opens as RecordedOpen[]) : [];
  });
}

/** The boot screen: the `main` landmark named "Starting FuseOS" (B1 keeps that label on the neon splash). */
export function bootScreen(page: Page): Locator {
  return page.getByRole("main", { name: `Starting ${OS_NAME}` });
}

/** The taskbar is the one thing every desktop state has; the desktop is up when it is. */
export function taskbar(page: Page): Locator {
  return page.getByRole("toolbar", { name: "Taskbar" });
}

export function desktopIcons(page: Page): Locator {
  return page.getByRole("list", { name: "Desktop icons" });
}

/** A desktop icon by its label; double-click opens it, like Windows. */
export function desktopIcon(page: Page, label: string): Locator {
  return desktopIcons(page).getByRole("button", { name: label, exact: true });
}

/** A window by its title (`WindowChrome` is a `dialog` named by the title bar text). */
export function osWindow(page: Page, title: string | RegExp): Locator {
  return page.getByRole("dialog", { name: title });
}

/** Closes a window through its title-bar button (a window body may have a "Close" of its own) and waits for it to go. */
export async function closeWindow(window: Locator): Promise<void> {
  await window
    .locator("header.title-bar")
    .first()
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await window.waitFor({ state: "detached" });
}

/**
 * Opens the Start menu and follows a path of menu labels (`["Programs", "Games", "Retro Games", "DOOM"]`).
 * Each click either opens a submenu or selects the leaf, which also closes the menu.
 */
export async function startMenu(
  page: Page,
  path: readonly string[],
): Promise<void> {
  const start = taskbar(page).getByRole("button", { name: "Start" });
  if ((await start.getAttribute("aria-pressed")) !== "true")
    await start.click();
  const menu = page.getByRole("menu", { name: "Start menu" });
  await menu.waitFor();
  for (const label of path)
    await menu.getByRole("menuitem", { name: label, exact: true }).click();
}

/** Closes the Start menu when a path stopped short of a leaf (a probe for an item that is not there). */
export async function closeStartMenu(page: Page): Promise<void> {
  const start = taskbar(page).getByRole("button", { name: "Start" });
  if ((await start.getAttribute("aria-pressed")) === "true") {
    await page.keyboard.press("Escape");
    if ((await start.getAttribute("aria-pressed")) === "true")
      await start.click();
  }
}

/** Opens the Control Panel through Start > Settings and switches to one of its tabs ("Games", "Display"). */
export async function controlPanelTab(
  page: Page,
  tab: string,
): Promise<Locator> {
  await startMenu(page, ["Settings", "Control Panel"]);
  const window = osWindow(page, "Control Panel");
  await window.waitFor();
  await window.getByRole("tab", { name: tab, exact: true }).click();
  return window;
}

/** The game page inside a game window, by the iframe's title (the game's name). */
export function gameFrame(window: Locator, name: string): Locator {
  return window.locator(`iframe[title="${name}"]`);
}

/** Where a script's screenshots go; made on first use. */
export class ScreenshotDirectory {
  readonly taken: string[] = [];
  constructor(readonly directory: string) {}

  async save(page: Page, name: string): Promise<string> {
    await mkdir(this.directory, { recursive: true });
    const file = join(this.directory, `${name}.png`);
    await page.screenshot({ path: file });
    this.taken.push(file);
    return file;
  }
}

/** Whether a locator has at least one match right now, without waiting: how a script probes for an optional feature. */
export async function isPresent(locator: Locator): Promise<boolean> {
  return (await locator.count()) > 0;
}
