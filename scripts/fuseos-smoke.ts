import assert from "node:assert/strict";
import { launchSelected } from "./lib/browser.js";
import {
  closeWindow,
  controlPanelTab,
  desktopIcon,
  gameFrame,
  isGameEmbed,
  isPresent,
  osUrl,
  osWindow,
  recordedOpens,
  bootScreen,
  ScreenshotDirectory,
  stubWindowOpen,
  taskbar,
} from "./lib/fuseos-desktop.js";
import { smokeTimeout } from "./smoke-timeout.js";

/**
 * FuseOS in a browser, against the built site (`HOME_URL`, the room service serving dist/): the desktop boots,
 * a Fuse game opens in a window whose frame is the game's own muted page, the Control Panel's Games applet
 * can send launches to a tab (window.open is stubbed, so nothing opens), and a `?open=paint` link restores
 * Paint and leaves the address. Screenshots land in artifacts/fuseos/ for the evidence upload.
 *
 * Phase B lands features in parallel. A step that depends on one not merged yet (the Games applet's launch
 * choice, the title-bar Pop out, both B2) probes for its control and prints a `TODO(B2)` line instead of
 * failing when it is absent, so the smoke is green on every branch and strict once the feature is there.
 * The integrator removes the probes when every package is in.
 */
const GAME_ID = "fuseball";
const GAME_NAME = "Fuseball";
const base = process.env.HOME_URL ?? "http://127.0.0.1:5179/";
const shots = new ScreenshotDirectory("artifacts/fuseos");

const browser = await launchSelected("chrome", { headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(smokeTimeout(30_000));
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await stubWindowOpen(page);

  // Boot: the splash announces itself, then the desktop replaces it.
  await page.goto(osUrl(base, { mute: true }));
  await bootScreen(page).waitFor();
  await shots.save(page, "boot");
  await taskbar(page).waitFor();
  await bootScreen(page).waitFor({ state: "detached" });
  await desktopIcon(page, GAME_NAME).waitFor();
  await shots.save(page, "desktop");
  console.log("PASS boot -> desktop");

  // A Fuse game in a window: its own page, muted like the OS, in an iframe titled by the game.
  await desktopIcon(page, GAME_NAME).dblclick();
  const gameWindow = osWindow(page, GAME_NAME);
  await gameWindow.waitFor();
  const frame = gameFrame(gameWindow, GAME_NAME);
  await frame.waitFor();
  const src = (await frame.getAttribute("src")) ?? "";
  assert.ok(
    isGameEmbed(src, GAME_ID, true),
    `game frame src should end with /${GAME_ID}/?mute, got ${src}`,
  );
  // The frame is same-origin and really loads the game: wait for its document rather than only the tag.
  await page.waitForFunction(
    (name) => {
      const element = document.querySelector<HTMLIFrameElement>(
        `iframe[title="${name}"]`,
      );
      return element?.contentDocument?.readyState === "complete";
    },
    GAME_NAME,
    { timeout: smokeTimeout(60_000) },
  );
  await page.waitForTimeout(smokeTimeout(1500));
  await shots.save(page, "game-window");
  assert.equal((await recordedOpens(page)).length, 0, "no tab opened yet");
  console.log(`PASS ${GAME_NAME} window embeds ${src}`);

  // Pop out: the toolbar sends the live game URL to a new tab and closes the window.
  await gameWindow.getByRole("button", { name: /pop out/i }).click();
  {
    const opens = await recordedOpens(page);
    assert.equal(opens.length, 1, "Pop out opens one tab");
    assert.ok(
      opens[0]!.url.includes(`/${GAME_ID}/`),
      `Pop out opens the game, got ${opens[0]!.url}`,
    );
    console.log(`PASS Pop out -> ${opens[0]!.url}`);
  }
  if (await isPresent(gameWindow)) await closeWindow(gameWindow);

  // Settings > Games: launching in a tab goes through window.open, never a window on the desktop.
  const controlPanel = await controlPanelTab(page, "Games");
  await shots.save(page, "control-panel-games");
  await controlPanel
    .getByRole("radio", { name: "Always a new browser tab" })
    .click();
  {
    await closeWindow(controlPanel);
    const before = (await recordedOpens(page)).length;
    await desktopIcon(page, GAME_NAME).dblclick();
    await page.waitForFunction(
      (count) =>
        ((window as unknown as Record<string, unknown>).__fuseosOpens as [])
          .length > count,
      before,
    );
    const opens = await recordedOpens(page);
    const launch = opens[opens.length - 1]!;
    assert.ok(
      launch.url.includes(`/${GAME_ID}/`),
      `tab launch opens the game, got ${launch.url}`,
    );
    assert.equal(launch.target, "_blank");
    assert.match(launch.features, /noopener/);
    assert.equal(
      await osWindow(page, GAME_NAME).count(),
      0,
      "tab mode opens no window on the desktop",
    );
    console.log(`PASS tab launch -> ${launch.url}`);
    // Back to windows so the rest of the smoke, and a reused profile, see the default.
    const again = await controlPanelTab(page, "Games");
    await again.getByRole("radio", { name: "A window inside FuseOS" }).click();
    await closeWindow(again);
  }

  // A deep link opens its window on boot and is consumed from the address.
  await page.goto(osUrl(base, { mute: true, open: ["paint"] }));
  await taskbar(page).waitFor();
  const paint = osWindow(page, /- Paint$/);
  await paint.waitFor();
  assert.ok(
    !new URL(page.url()).searchParams.has("open"),
    `?open= should be consumed, address is ${page.url()}`,
  );
  await shots.save(page, "paint-deep-link");
  console.log("PASS ?open=paint restores Paint");

  assert.deepEqual(errors, [], "page errors");
  console.log(`Screenshots: ${shots.taken.join(", ")}`);
  await context.close();
} finally {
  await browser.close();
}
