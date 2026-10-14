import { chromium, type Page } from "playwright";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { wireProbe } from "./lib/fuse-birds-wire-probe.js";
import { startBirdsCoverage } from "./lib/fuse-birds-browser-coverage.js";

const base = process.argv[2] ?? "http://localhost:8893",
  output = process.argv[3] ?? "/tmp/fuse-birds-online";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors: string[] = [];
const finishCoverage: (() => Promise<void>)[] = [];
function inspect(page: Page): void {
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.error(e.message);
  });
  page.on("console", (e) => {
    if (e.type() === "error") {
      errors.push(e.text());
      console.error(e.text());
    }
  });
}
try {
  const a = await browser.newContext({
      viewport: { width: 1400, height: 900 },
    }),
    b = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
  const first = await a.newPage(),
    second = await b.newPage();
  inspect(first);
  inspect(second);
  finishCoverage.push(
    await startBirdsCoverage(first),
    await startBirdsCoverage(second),
  );
  if (process.env.FUSE_BIRDS_INPUT_PROBE) {
    for (const [label, page] of [
      ["SKYE", first],
      ["EMBER", second],
    ] as const) {
      await page.exposeFunction("reportBirdsInput", (detail: unknown) =>
        console.log(label, JSON.stringify(detail)),
      );
      await page.addInitScript(`(() => {
        for (const type of ['pointerdown', 'pointerup', 'click']) {
          document.addEventListener(type, event => {
            const button = event.target.closest?.('button');
            if (button?.textContent !== 'PASS') return;
            window.reportBirdsInput({type, disabled: button.disabled, turn: document.querySelector('.birds-room')?.dataset.turn, phase: document.querySelector('.birds-room')?.dataset.phase, at: performance.now()});
          }, true);
        }
      })()`);
    }
  }
  if (process.env.FUSE_BIRDS_WIRE_PROBE) {
    await wireProbe(first, output, "first");
    await wireProbe(second, output, "second");
  }
  await first.goto(`${base}/fuse-birds/?mute`);
  await first.getByLabel("Shared TV + phone controllers").check();
  await first.getByRole("button", { name: "CREATE ROOM" }).click();
  await first.locator(".fui-name-input").fill("SKYE");
  await first.getByRole("button", { name: "JOIN BATTLE" }).click();
  const code = await first.locator(".birds-code").innerText();
  await second.goto(`${base}/fuse-birds/?room=${code}&mute`);
  await second.locator(".fui-name-input").fill("EMBER");
  await second.getByRole("button", { name: "JOIN BATTLE" }).click();
  await first.locator(".birds-roster").getByText("EMBER").waitFor();
  const tv = await a.newPage();
  inspect(tv);
  if (process.env.FUSE_BIRDS_WIRE_PROBE) await wireProbe(tv, output, "tv");
  await tv.goto(`${base}/fuse-birds/?room=${code}&display=1&mute`);
  await first.getByRole("button", { name: "START BATTLE" }).click();
  for (const p of [first, second, tv])
    await p
      .locator('.birds-room[data-phase="aiming"]')
      .waitFor({ timeout: 60_000 });
  for (const p of [first, second, tv])
    await p.locator('canvas[data-ready="true"]').waitFor();
  await first.screenshot({ path: `${output}/desktop.png` });
  await second.screenshot({ path: `${output}/phone.png` });
  await tv.screenshot({ path: `${output}/tv.png` });
  assert.equal(
    await first
      .getByRole("button", { name: /^(Move left|Move right|HOP)$/ })
      .count(),
    0,
    "Slingshot controls must not offer walking or hopping",
  );
  await first
    .getByRole("button", { name: "Scatter Bomb, 3 shots remaining" })
    .click();
  await first.getByRole("button", { name: "FULL MAP", exact: true }).click();
  const box = await first.locator("canvas").boundingBox();
  assert.ok(box);
  const scale = Math.min(box.width / 1536, box.height / 768),
    x = box.x + box.width / 2 + (70 - 768) * scale,
    y = box.y + box.height / 2 + (380 - 384) * scale;
  await first.mouse.move(x, y);
  await first.mouse.down();
  await first.mouse.move(x - 100, y + 105, { steps: 10 });
  await first.locator('canvas[data-gesture="aim"]').waitFor();
  await first.keyboard.press("Escape");
  await first.locator('canvas[data-gesture="idle"]').waitFor();
  await first.mouse.up();
  assert.ok(
    await first
      .getByRole("button", { name: "Scatter Bomb, 3 shots remaining" })
      .isVisible(),
  );
  await first.locator("canvas").focus();
  await first.keyboard.press("i");
  await first.locator('canvas[data-gesture="keyboard-aim"]').waitFor();
  await first.screenshot({ path: `${output}/keyboard-aim.png` });
  await first.keyboard.press("Escape");
  await first.locator('canvas[data-gesture="idle"]').waitFor();
  assert.ok(
    await first
      .getByRole("button", { name: "Scatter Bomb, 3 shots remaining" })
      .isVisible(),
  );
  await first.keyboard.press("j");
  await first.keyboard.press("Enter");
  await first
    .getByRole("button", { name: "Scatter Bomb, 2 shots remaining" })
    .waitFor({ timeout: 10_000 });
  await second
    .getByRole("button", { name: "Scatter Bomb, 2 shots remaining" })
    .waitFor({ timeout: 10_000 });
  await tv
    .getByRole("button", { name: "Scatter Bomb, 2 shots remaining" })
    .waitFor({ timeout: 10_000 });
  await second
    .locator(".birds-turn")
    .filter({ hasText: "YOUR TURN" })
    .waitFor({ timeout: 30_000 });
  await second.screenshot({ path: `${output}/phone-next-turn.png` });
  const before = await second.locator(".birds-player").allTextContents();
  await second.reload();
  await second
    .locator('.birds-room[data-phase="aiming"]')
    .waitFor({ timeout: 30_000 });
  assert.deepEqual(
    await second.locator(".birds-player").allTextContents(),
    before,
  );
  assert.equal(await tv.locator(".birds-camera").isHidden(), true);
  await second.getByRole("button", { name: "Zoom in", exact: true }).click();
  await second.screenshot({ path: `${output}/phone-zoom.png` });
  const cpuRate = Number(process.env.FUSE_BIRDS_CPU_RATE ?? 1);
  assert.ok(Number.isFinite(cpuRate) && cpuRate >= 1 && cpuRate <= 6);
  if (cpuRate > 1) {
    for (const page of [first, second, tv]) {
      const session = await page.context().newCDPSession(page);
      await session.send("Emulation.setCPUThrottlingRate", { rate: cpuRate });
    }
    console.log(`Pass-loop CPU slowdown: ${cpuRate}x on every page`);
  }
  // Finish a real room without changing clocks or injecting game state. Sudden-death water bounds all-pass play.
  for (let turns = 0; turns < 100; turns++) {
    await first.waitForFunction(() =>
      ["aiming", "over"].includes(
        document.querySelector<HTMLElement>(".birds-room")?.dataset.phase ?? "",
      ),
    );
    if (
      (await first.locator(".birds-room").getAttribute("data-phase")) === "over"
    )
      break;
    const snapshots = await Promise.all(
      [first, second].map((page) =>
        page.evaluate(() => {
          const room = document.querySelector<HTMLElement>(".birds-room");
          const label =
            document.querySelector(".birds-turn")?.textContent ?? "";
          return {
            turn: room?.dataset.turn,
            phase: room?.dataset.phase,
            mine: label.includes("YOUR TURN"),
            seconds: Number(label.match(/(\d+)s/)?.[1] ?? 0),
          };
        }),
      ),
    );
    const [a, b] = snapshots;
    if (
      !a ||
      !b ||
      a.turn !== b.turn ||
      a.phase !== "aiming" ||
      b.phase !== "aiming" ||
      a.mine === b.mine
    ) {
      // Reacquire current state rather than waiting forever for a turn a peer has already passed.
      await first.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          ),
      );
      continue;
    }
    const oldTurn = a.turn!;
    if (Math.min(a.seconds, b.seconds) < 12) {
      console.log(
        `Turn ${oldTurn} too close to deadline for a causal PASS check; waiting for the next turn`,
      );
      await first.waitForFunction(
        (previous) =>
          document.querySelector<HTMLElement>(".birds-room")?.dataset.turn !==
          previous,
        oldTurn,
      );
      continue;
    }
    const active = a.mine ? first : second;
    console.log(
      `Passing turn ${oldTurn} on ${active === first ? "SKYE" : "EMBER"}`,
    );
    await active
      .locator(`.birds-room[data-turn="${oldTurn}"][data-phase="aiming"]`)
      .getByRole("button", { name: "PASS", exact: true })
      .click({ timeout: 3000 });
    await first.waitForFunction(
      (previous) => {
        const room = document.querySelector<HTMLElement>(".birds-room");
        return (
          room?.dataset.turn !== previous || room?.dataset.phase === "over"
        );
      },
      oldTurn,
      { timeout: 5000 },
    );
  }
  for (const p of [first, second, tv])
    await p.locator('.birds-room[data-phase="over"]').waitFor();
  await first.screenshot({ path: `${output}/result.png` });
  await first.getByRole("button", { name: "PLAY AGAIN", exact: true }).click();
  for (const p of [first, second, tv]) {
    await p
      .locator('.birds-room[data-phase="aiming"]')
      .waitFor({ timeout: 60_000 });
    await p
      .getByRole("button", { name: "Scatter Bomb, 3 shots remaining" })
      .waitFor();
  }
  assert.deepEqual(errors, []);
  console.log(
    `Real room ${code}: two players and TV started, agreed on a Scatter launch, recovered a phone reload, finished a bounded round and rematched with fresh ammunition. Captures: ${output}`,
  );
} catch (error) {
  let index = 0;
  for (const context of browser.contexts())
    for (const page of context.pages()) {
      console.error(
        "Browser state",
        index,
        await page.locator("body").innerText(),
      );
      await page.screenshot({ path: `${output}/failure-${index++}.png` });
    }
  throw error;
} finally {
  for (const finish of finishCoverage) await finish();
  await browser.close();
}
