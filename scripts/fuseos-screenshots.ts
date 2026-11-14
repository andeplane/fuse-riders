import type { BrowserContext, Page } from "playwright";
import { launchSelected } from "./lib/browser.js";
import {
  bootScreen,
  closeStartMenu,
  closeWindow,
  controlPanelTab,
  desktopIcon,
  desktopIcons,
  gameFrame,
  isPresent,
  osUrl,
  osWindow,
  ScreenshotDirectory,
  startMenu,
  taskbar,
} from "./lib/fuseos-desktop.js";

/**
 * The pull-request screenshot set of FuseOS, from a site that is already being served; this builds nothing.
 *
 *   pnpm exec tsx scripts/fuseos-screenshots.ts <url> [directory]
 *   pnpm exec tsx scripts/fuseos-screenshots.ts http://127.0.0.1:8787/            # a `pnpm dev` or `pnpm exec vite`
 *   pnpm exec tsx scripts/fuseos-screenshots.ts https://andeplane.github.io/fuse-riders/ shots/
 *
 * Headless Chrome opens the desktop muted and captures, into `directory` (default artifacts/fuseos-shots):
 * boot, desktop, game-window, winamp, clippy-balloon, control-panel-games, doom, explorer, notepadpp,
 * pipes-preview and mobile. A shot whose feature is not on this build (Explorer and Notepad++ are B11, the
 * 3D Pipes preview is B10) is skipped with a line saying why, never a failure: the set is whatever the
 * desktop has. Only a desktop that never appears fails the run.
 */
export type ScreenshotArgs = { url: string; directory: string };

/** The command line: a URL and an optional directory; anything else is a usage error. */
export function parseScreenshotArgs(
  argv: readonly string[],
): ScreenshotArgs | { error: string } {
  const [url, directory, ...rest] = argv;
  if (!url || rest.length > 0)
    return { error: "usage: fuseos-screenshots.ts <url> [directory]" };
  try {
    new URL(url);
  } catch {
    return { error: `not a URL: ${url}` };
  }
  return { url, directory: directory ?? "artifacts/fuseos-shots" };
}

/** The shots, in the order they are taken; every one is named here so the set is one list. */
export const SHOT_NAMES = [
  "boot",
  "desktop",
  "game-window",
  "winamp",
  "clippy-balloon",
  "control-panel-games",
  "doom",
  "explorer",
  "notepadpp",
  "pipes-preview",
  "mobile",
] as const;
export type ShotName = (typeof SHOT_NAMES)[number];

/** What a run did for each shot: the file it wrote, or why it was skipped. */
export type ShotOutcome =
  { name: ShotName; file: string } | { name: ShotName; skipped: string };

/** The first visible match among candidates, when a feature may be reached in more than one way. */
async function firstPresent(
  candidates: readonly { locator: ReturnType<Page["locator"]>; via: string }[],
): Promise<{ locator: ReturnType<Page["locator"]>; via: string } | undefined> {
  for (const candidate of candidates)
    if (await isPresent(candidate.locator)) return candidate;
  return undefined;
}

/** A Start menu leaf when it exists; the menu is closed again when it does not. */
async function startMenuItemExists(
  page: Page,
  path: readonly string[],
): Promise<boolean> {
  await startMenu(page, path.slice(0, -1));
  const menu = page.getByRole("menu", { name: "Start menu" });
  const present = await isPresent(
    menu.getByRole("menuitem", { name: path[path.length - 1]!, exact: true }),
  );
  if (!present) await closeStartMenu(page);
  return present;
}

/** Waits for an embedded page (a Fuse game, js-dos) to finish loading, then a moment for its first frame. */
async function settleFrame(page: Page, title: string, paintMs: number) {
  await page.waitForFunction(
    (name) =>
      document.querySelector<HTMLIFrameElement>(`iframe[title="${name}"]`)
        ?.contentDocument?.readyState === "complete",
    title,
    { timeout: 60_000 },
  );
  await page.waitForTimeout(paintMs);
}

class Skipped extends Error {}

export async function captureScreenshots(
  context: BrowserContext,
  args: ScreenshotArgs,
  log: (line: string) => void = console.log,
): Promise<ShotOutcome[]> {
  const shots = new ScreenshotDirectory(args.directory);
  const outcomes: ShotOutcome[] = [];
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);

  const shot = async (name: ShotName, take: () => Promise<void>) => {
    try {
      await take();
      const file = await shots.save(page, name);
      outcomes.push({ name, file });
      log(`shot ${name}: ${file}`);
    } catch (error) {
      const reason =
        error instanceof Skipped
          ? error.message
          : `not captured: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`;
      outcomes.push({ name, skipped: reason });
      log(`skip ${name}: ${reason}`);
      // Whatever the step left open (a window, the Start menu) must not leak into the next shot.
      await closeStartMenu(page).catch(() => undefined);
      await page.keyboard.press("Escape").catch(() => undefined);
    }
  };
  const closeAll = async () => {
    const dialogs = page.getByRole("dialog");
    while ((await dialogs.count()) > 0) await closeWindow(dialogs.last());
  };

  await page.goto(osUrl(args.url, { mute: true }));
  await shot("boot", async () => {
    // The splash holds for 1.5 s; a slow load may have replaced it before this runs.
    await bootScreen(page).waitFor({ timeout: 5_000 });
  });
  await taskbar(page).waitFor({ timeout: 60_000 });
  await bootScreen(page).waitFor({ state: "detached", timeout: 10_000 });
  await desktopIcons(page).getByRole("button").first().waitFor();
  // Clippy's sprite and the greeting load after the desktop; give them a moment so the desktop is complete.
  await page.waitForTimeout(2_000);
  await shot("desktop", async () => undefined);

  await shot("game-window", async () => {
    const icon = (await isPresent(desktopIcon(page, "Fuseball")))
      ? desktopIcon(page, "Fuseball")
      : desktopIcons(page).getByRole("button").first();
    // The label is the icon's last span; the tile's SVG text (the mark) comes before it in textContent.
    const name = (await icon.locator("span").last().textContent())?.trim();
    if (!name) throw new Skipped("no Fuse game icon on the desktop");
    await icon.dblclick();
    const window = osWindow(page, name);
    await window.waitFor();
    await gameFrame(window, name).waitFor();
    await settleFrame(page, name, 2_500);
  });
  await closeAll();

  await shot("winamp", async () => {
    if (!(await isPresent(desktopIcon(page, "Winamp"))))
      await startMenu(page, ["Programs", "Accessories", "Winamp"]);
    else await desktopIcon(page, "Winamp").dblclick();
    // Frameless: Webamp's own windows on the desktop layer, no FuseOS dialog around them.
    const layer = page.getByRole("region", { name: "Winamp" });
    await layer.waitFor();
    // Webamp arrives lazily; the layer shows a status until it has mounted. Capture what is there after 20 s regardless.
    await layer
      .getByRole("status")
      .waitFor({ state: "detached", timeout: 20_000 })
      .catch(() => undefined);
    await page.waitForTimeout(1_000);
  });
  await closeAll();

  await shot("clippy-balloon", async () => {
    const balloon = page.getByRole("region", { name: "Clippy balloon" });
    const clippy = page.getByRole("button", { name: "Clippy", exact: true });
    if (!(await isPresent(clippy))) throw new Skipped("Clippy is hidden");
    // The first boot greets on its own; otherwise a click opens the balloon.
    if (!(await isPresent(balloon))) await clippy.click();
    await balloon.waitFor();
  });

  await shot("control-panel-games", async () => {
    await controlPanelTab(page, "Games");
  });
  await closeAll();

  await shot("doom", async () => {
    await startMenu(page, ["Programs", "Games", "Retro Games", "DOOM"]);
    const window = osWindow(page, "DOOM");
    await window.waitFor();
    // js-dos boots the game inside its frame; a few seconds shows the title screen rather than the loader.
    await settleFrame(page, "DOOM", 8_000);
  });
  await closeAll();

  await shot("explorer", async () => {
    const found = await firstPresent([
      { locator: desktopIcon(page, "My Computer"), via: "icon" },
      { locator: desktopIcon(page, "Windows Explorer"), via: "icon" },
    ]);
    if (found) await found.locator.dblclick();
    else if (await startMenuItemExists(page, ["Programs", "Windows Explorer"]))
      await startMenu(page, ["Programs", "Windows Explorer"]);
    else throw new Skipped("TODO(B11): no Explorer on this build");
    const window = osWindow(page, /Explorer|My Computer|\(C:\)/);
    await window.waitFor();
    // C:\ is the repository; opening the drive shows its tree.
    const drive = window.getByText(/\(C:\)/).first();
    if (await isPresent(drive)) {
      await drive.dblclick();
      await page.waitForTimeout(2_000);
    }
  });
  await closeAll();

  await shot("notepadpp", async () => {
    if (await isPresent(desktopIcon(page, "Notepad++")))
      await desktopIcon(page, "Notepad++").dblclick();
    else if (
      await startMenuItemExists(page, ["Programs", "Accessories", "Notepad++"])
    )
      await startMenu(page, ["Programs", "Accessories", "Notepad++"]);
    else throw new Skipped("TODO(B11): no Notepad++ on this build");
    await osWindow(page, /Notepad\+\+/).waitFor();
    // The editor (CodeMirror) is a lazy import; let it mount and highlight.
    await page.waitForTimeout(2_500);
  });
  await closeAll();

  await shot("pipes-preview", async () => {
    // Start > Settings > Screen Saver opens Display Properties on its Screen Saver tab.
    await startMenu(page, ["Settings", "Screen Saver"]);
    const window = osWindow(page, "Control Panel");
    await window.waitFor();
    await window.getByRole("button", { name: "Preview" }).click();
    // three.js and the pipes module load lazily; a few seconds of pipes is the picture.
    await page.waitForTimeout(5_000);
  });
  await page.keyboard.press("Escape");
  await page.mouse.move(10, 10);
  await closeAll();

  await page.close();

  const mobile = await context.browser()?.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  if (mobile) {
    const phone = await mobile.newPage();
    phone.setDefaultTimeout(20_000);
    try {
      await phone.goto(osUrl(args.url, { mute: true }));
      await taskbar(phone).waitFor({ timeout: 60_000 });
      await bootScreen(phone).waitFor({ state: "detached", timeout: 10_000 });
      await phone.waitForTimeout(2_000);
      const file = await shots.save(phone, "mobile");
      outcomes.push({ name: "mobile", file });
      log(`shot mobile: ${file}`);
    } catch (error) {
      const reason = `not captured: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`;
      outcomes.push({ name: "mobile", skipped: reason });
      log(`skip mobile: ${reason}`);
    } finally {
      await mobile.close();
    }
  }
  return outcomes;
}

if (process.argv[1]?.endsWith("fuseos-screenshots.ts")) {
  const args = parseScreenshotArgs(process.argv.slice(2));
  if ("error" in args) {
    console.error(args.error);
    process.exit(2);
  }
  const browser = await launchSelected("chrome", { headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    });
    const outcomes = await captureScreenshots(context, args);
    await context.close();
    const taken = outcomes.filter((outcome) => "file" in outcome).length;
    console.log(
      `${taken}/${SHOT_NAMES.length} screenshots in ${args.directory}`,
    );
  } finally {
    await browser.close();
  }
}
