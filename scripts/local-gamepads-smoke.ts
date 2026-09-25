/** Browser Gamepad API harness, not physical-controller evidence. Only navigator.getGamepads is substituted;
 * the real landing, setup, input loop, runtime, simulation, dialogs and renderer run unchanged. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { launchSelected } from "./lib/browser.js";
import type { PadSnapshot } from "../games/fuse-riders/src/client/controller-gamepad.js";

interface Sample {
  phase: string;
  players: { id: string; angle: number; bombChargeStartedTick?: number }[];
}
declare global {
  interface Window {
    testPads: (PadSnapshot | null)[];
    padFrame?: Sample;
  }
}
const browser = await launchSelected("chromium", { headless: true });
console.log("Controller smoke: browser launched");
const base = process.env.BASE_URL ?? "http://localhost:4887";
const pad = (index: number, buttons: number[] = [], axis = 0): PadSnapshot => ({
  index,
  id: "Simulated standard controller",
  mapping: "standard",
  connected: true,
  axes: [axis, 0],
  buttons: Array.from({ length: 17 }, (_, i) => ({
    pressed: buttons.includes(i),
    value: Number(buttons.includes(i)),
  })),
});
const errors: string[] = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(`(() => {
    window.testPads = [];
    Object.defineProperty(navigator, "getGamepads", { value: () => window.testPads });
    window.addEventListener("fuse-benchmark", (event) => {
      const sample = event.detail;
      if (sample.kind === "snapshot") window.padFrame = sample;
    });
  })()`);
  await page.goto(`${base}/?mute`);
  console.log("Controller smoke: landing loaded");
  await page.getByRole("link", { name: "PLAY LOCAL GAME CONTROLLERS" }).click();
  await page
    .getByText("No controllers detected yet.", { exact: false })
    .waitFor();
  assert.equal(
    await page.getByRole("button", { name: "START LOCAL GAME" }).isEnabled(),
    false,
  );
  // Preserve the actual local route but enable the app's existing diagnostic events for assertions.
  await page.goto(`${base}/?solo=1&local=1&mute&benchmark=1`);
  await page.evaluate(
    (pads) => {
      window.testPads = pads;
    },
    [pad(0), null, pad(2)],
  );
  await page.getByText("2 players · 3 AI rivals").waitFor();
  await page.getByLabel("Controller 1 player name").fill("Alice");
  await page.getByLabel("Controller 3 player name").fill("Bob");
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/local-gamepads-setup.png" });
  await page.getByRole("button", { name: "START LOCAL GAME" }).click();
  await page.waitForFunction(() => window.padFrame?.phase === "playing");
  const before = await page.evaluate(() =>
    window.padFrame!.players.map((p) => p.angle),
  );
  await page.evaluate(
    (pads) => {
      window.testPads = pads;
    },
    [pad(0, [0], -1), null, pad(2, [0], 1)],
  );
  await page.waitForFunction((angles) => {
    const players = window.padFrame?.players.slice(0, 2);
    return players?.every(
      (p, i) => p.angle !== angles[i] && p.bombChargeStartedTick !== undefined,
    );
  }, before);
  // A missing pad cancels its charge while the other pad keeps charging.
  await page.evaluate(
    (p) => {
      window.testPads = [null, null, p];
    },
    pad(2, [0], 1),
  );
  await page.getByText("Pad 1 disconnected", { exact: false }).waitFor();
  await page.waitForFunction(() => {
    const players = window.padFrame?.players;
    return (
      players?.[0]?.bombChargeStartedTick === undefined &&
      players?.[1]?.bombChargeStartedTick !== undefined
    );
  });
  await page.evaluate(
    (pads) => {
      window.testPads = pads;
    },
    [pad(0, [0]), null, pad(2)],
  );
  await page.waitForFunction(() =>
    window.padFrame?.players
      .slice(0, 2)
      .every((p) => p.bombChargeStartedTick === undefined),
  );
  await page.evaluate(
    (pads) => {
      window.testPads = pads;
    },
    [pad(0), null, pad(2)],
  );
  await page.screenshot({ path: "artifacts/local-gamepads-playing.png" });
  // Keyboard-mode controllers are ordinary keystrokes; each configured trio owns one independent rider.
  await page.goto(`${base}/?solo=1&local=1&mute&benchmark=1`);
  await page.getByRole("button", { name: "ADD KEYBOARD PLAYER" }).click();
  await page.getByRole("button", { name: "ADD KEYBOARD PLAYER" }).click();
  await page.getByRole("button", { name: "ADD KEYBOARD PLAYER" }).click();
  await page.getByText("3 players · 2 AI rivals").waitFor();
  await page.screenshot({ path: "artifacts/local-keyboards-setup.png" });
  await page.getByRole("button", { name: "START LOCAL GAME" }).click();
  await page.waitForFunction(() => window.padFrame?.phase === "playing");
  const keyboardBefore = await page.evaluate(() =>
    window.padFrame!.players.map((p) => p.angle),
  );
  for (const key of ["a", "f", "i", "Space", "m", "k"])
    await page.keyboard.down(key);
  await page.waitForFunction(
    (angles) =>
      window.padFrame?.players
        .slice(0, 3)
        .every(
          (p, i) =>
            p.angle !== angles[i] && p.bombChargeStartedTick !== undefined,
        ),
    keyboardBefore,
  );
  await page.keyboard.up("Space");
  await page.waitForFunction(
    () =>
      window.padFrame?.players[0]?.bombChargeStartedTick === undefined &&
      window.padFrame?.players[1]?.bombChargeStartedTick !== undefined &&
      window.padFrame?.players[2]?.bombChargeStartedTick !== undefined,
  );
  await page
    .getByRole("button", { name: "Keyboard controls", exact: true })
    .click();
  await page.waitForFunction(() =>
    window.padFrame?.players
      .slice(0, 3)
      .every((p) => p.bombChargeStartedTick === undefined),
  );
  for (const key of ["a", "f", "i", "m", "k"]) await page.keyboard.up(key);
  await page.getByRole("button", { name: "CLOSE", exact: true }).click();
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      browser: process.env.BROWSER ?? "chromium",
      independentSteeringAndCharges: true,
      disconnectCancellation: true,
      keyboardModeControllers: "A/D/Space, E/F/M and I/G/K",
      errors,
    }),
  );
} finally {
  await browser.close();
}
