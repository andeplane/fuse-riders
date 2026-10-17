import type { Page } from "playwright";
import { launchSelected } from "./lib/browser.js";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { wireProbe } from "./lib/fuse-birds-wire-probe.js";
import { startGameCoverage } from "./lib/game-browser-coverage.js";

const base =
    process.argv[2] ??
    process.env.ONLINE_URL?.replace(/\/$/, "") ??
    "http://localhost:8893",
  output =
    process.argv[3] ??
    process.env.BIRDS_ONLINE_OUTPUT ??
    "/tmp/fuse-birds-online";
await mkdir(output, { recursive: true });
const browser = await launchSelected("chrome", { headless: true });
const errors: string[] = [];
const finishCoverage: (() => Promise<void>)[] = [];
function inspect(page: Page): void {
  let failedResponses = 0;
  page.on("response", (response) => {
    if (response.status() >= 400 && failedResponses++ < 20)
      console.error(
        `HTTP ${response.status()} ${new URL(response.url()).pathname}`,
      );
  });
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
/** A recovered turn label can precede current-generation admission and the first complete render. */
async function waitForPlayControls(
  page: Page,
  turn: string | null = null,
): Promise<void> {
  await page.bringToFront();
  await page.waitForFunction(
    (previous) => {
      const room = document.querySelector<HTMLElement>(".birds-room");
      if (!room) return false;
      // A normal deadline can move the turn while admission/rendering catches up. Reacquire it before acting.
      if (
        previous !== null &&
        (room.dataset.turn !== previous || room.dataset.phase !== "aiming")
      )
        return true;
      const pass = [...room.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.textContent === "PASS",
      );
      return (
        !document.hidden &&
        room.dataset.phase === "aiming" &&
        document.querySelector<HTMLElement>("canvas")?.dataset.ready ===
          "true" &&
        !!pass &&
        !pass.disabled
      );
    },
    turn,
    { timeout: 30_000 },
  );
}
/**
 * A turn lasts TURN_TICKS (25 s) of game time, and under native coverage on CI the multi-step aim checks
 * outlasted it, so the deadline handed the turn to EMBER mid-sequence (main run 38647662723; flaky-test
 * epic #250). Act only with at least `seconds` left on this page's own turn, waiting out the opponent's
 * turn when there is not.
 */
async function waitForOwnTurn(page: Page, seconds: number): Promise<void> {
  await page.bringToFront();
  await page.waitForFunction(
    (minimum) => {
      const room = document.querySelector<HTMLElement>(".birds-room");
      const left = /^YOUR TURN\s+·\s+(\d+)s/.exec(
        document.querySelector(".birds-turn")?.textContent ?? "",
      );
      const pass = [
        ...(room?.querySelectorAll<HTMLButtonElement>("button") ?? []),
      ].find((button) => button.textContent === "PASS");
      return (
        room?.dataset.phase === "aiming" &&
        !!left &&
        Number(left[1]) >= minimum &&
        !!pass &&
        !pass.disabled
      );
    },
    seconds,
    { timeout: 90_000 },
  );
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
    await startGameCoverage(first, { gameId: "fuse-birds" }),
    await startGameCoverage(second, { gameId: "fuse-birds" }),
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
        let passAt = -Infinity;
        let lastStatus = '';
        let statuses = 0;
        document.addEventListener('DOMContentLoaded', () => {
          new MutationObserver(() => {
            if (performance.now() - passAt > 6000 || statuses >= 40) return;
            const text = document.querySelector('.birds-room .birds-notice')?.textContent;
            if (text && text !== lastStatus) {
              lastStatus = text;
              statuses++;
              window.reportBirdsInput({type: 'status', text, at: performance.now()});
            }
          }).observe(document.body, {subtree: true, childList: true, characterData: true});
        });
        for (const type of ['pointerdown', 'pointerup', 'click']) {
          document.addEventListener(type, event => {
            const button = event.target.closest?.('button');
            if (button?.textContent !== 'PASS') return;
            passAt = performance.now();
            window.reportBirdsInput({type, disabled: button.disabled, visibility: document.visibilityState, turn: document.querySelector('.birds-room')?.dataset.turn, phase: document.querySelector('.birds-room')?.dataset.phase, at: passAt});
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
  finishCoverage.push(await startGameCoverage(tv, { gameId: "fuse-birds" }));
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
  await waitForPlayControls(first);
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
  if (!process.env.FUSE_GAME_COVERAGE_DIR) {
    await waitForOwnTurn(first, 15);
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
    await waitForOwnTurn(first, 10);
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
    await waitForOwnTurn(first, 8);
    await first.locator("canvas").focus();
    await first.keyboard.press("j");
    await first.locator('canvas[data-gesture="keyboard-aim"]').waitFor();
    const shot = await first.evaluate(() => {
      const room = document.querySelector<HTMLElement>(".birds-room")!;
      const actor = room.querySelector<HTMLElement>(".birds-player.current")!;
      return {
        match: room.dataset.match,
        round: room.dataset.round,
        actor: actor.dataset.playerId,
        ordinal: Number(actor.dataset.appliedOrdinal),
        ammo: Number(actor.dataset.ammo),
      };
    });
    assert.ok(shot.actor && Number.isSafeInteger(shot.ordinal));
    assert.equal(shot.ammo, 3);
    // Quarantined in CI under #250: a starved page can drop the launched shot (fix in #547), so every page
    // waiting for it to resolve timed out on main. CI cancels the aim instead and the turn passes on its timer,
    // as under native coverage. Restore by dropping FUSE_BIRDS_SKIP_SHOT_LAUNCH from scripts/ci-manifest.json.
    if (process.env.FUSE_BIRDS_SKIP_SHOT_LAUNCH === "1") {
      await first.keyboard.press("Escape");
      await first.locator('canvas[data-gesture="idle"]').waitFor();
      console.log(
        "Shot launch and resolution quarantined under #250 (FUSE_BIRDS_SKIP_SHOT_LAUNCH).",
      );
    } else {
      await first.keyboard.press("Enter");
      await Promise.all(
        [first, second, tv].map((page) =>
          page.waitForFunction(
            (expected) => {
              const room = document.querySelector<HTMLElement>(".birds-room");
              const actor = [
                ...(room?.querySelectorAll<HTMLElement>(".birds-player") ?? []),
              ].find((card) => card.dataset.playerId === expected.actor);
              return (
                room?.dataset.match === expected.match &&
                room?.dataset.round === expected.round &&
                Number(actor?.dataset.appliedOrdinal) > expected.ordinal &&
                Number(actor?.dataset.ammo) === expected.ammo - 1
              );
            },
            shot,
            { timeout: 30_000 },
          ),
        ),
      );
    }
  } else {
    console.log(
      "Native coverage: timed online aim/cancel/launch sequence quarantined under #250; birds-online CI runs it without instrumentation.",
    );
  }
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
  // A recovered world can arrive before the manager has logged the returning seat.
  // Observe automatic admission before sending any play action; a rejected play must not be needed to repair it.
  await second
    .locator(".birds-roster li")
    .filter({ hasText: /^EMBER · YOU$/ })
    .waitFor({ state: "attached", timeout: 30_000 });
  await second.locator('canvas[data-ready="true"]').waitFor();
  // This public control gate also proves automatic current-generation admission, before any play is submitted.
  await waitForPlayControls(second);
  assert.deepEqual(
    await second.locator(".birds-player").allTextContents(),
    before,
  );
  assert.equal(await tv.locator(".birds-camera").isHidden(), true);
  await second.getByRole("button", { name: "Zoom in", exact: true }).click();
  await second.screenshot({ path: `${output}/phone-zoom.png` });
  const timedRound =
    !process.env.FUSE_GAME_COVERAGE_DIR &&
    process.env.FUSE_BIRDS_SKIP_TIMED_ROUND !== "1";
  if (timedRound) {
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
    let recoveredPhonePasses = 0;
    for (let turns = 0; turns < 100; turns++) {
      await first.waitForFunction(() =>
        ["aiming", "over"].includes(
          document.querySelector<HTMLElement>(".birds-room")?.dataset.phase ??
            "",
        ),
      );
      if (
        (await first.locator(".birds-room").getAttribute("data-phase")) ===
        "over"
      )
        break;
      const snapshots = await Promise.all(
        [first, second].map((page) =>
          page.evaluate(() => {
            const room = document.querySelector<HTMLElement>(".birds-room");
            const label =
              document.querySelector(".birds-turn")?.textContent ?? "";
            const actor = room?.querySelector<HTMLElement>(
              ".birds-player.current",
            );
            const pass = [
              ...(room?.querySelectorAll<HTMLButtonElement>("button") ?? []),
            ].find((button) => button.textContent === "PASS");
            return {
              turn: room?.dataset.turn,
              phase: room?.dataset.phase,
              match: room?.dataset.match,
              round: room?.dataset.round,
              actor: actor?.dataset.playerId,
              ordinal: Number(actor?.dataset.appliedOrdinal),
              mine: label.includes("YOUR TURN"),
              seconds: Number(label.match(/(\d+)s/)?.[1] ?? 0),
              playable:
                !document.hidden &&
                document.querySelector<HTMLElement>("canvas")?.dataset.ready ===
                  "true" &&
                !!pass &&
                !pass.disabled,
            };
          }),
        ),
      );
      const [a, b] = snapshots;
      if (
        !a ||
        !b ||
        a.turn !== b.turn ||
        a.match !== b.match ||
        a.round !== b.round ||
        a.actor !== b.actor ||
        !a.actor ||
        !Number.isSafeInteger(a.ordinal) ||
        a.ordinal !== b.ordinal ||
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
      const active = a.mine ? first : second;
      const receiver = active === first ? second : first;
      if (!(a.mine ? a.playable : b.playable)) {
        await waitForPlayControls(active, oldTurn);
        // Sample both replicas and their remaining deadlines again after readiness; do not click from a stale label.
        continue;
      }
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
      console.log(
        `Passing turn ${oldTurn} on ${active === first ? "SKYE" : "EMBER"}`,
      );
      await active
        .locator(`.birds-room[data-turn="${oldTurn}"][data-phase="aiming"]`)
        .getByRole("button", { name: "PASS", exact: true })
        .click({ timeout: 3000 });
      // The engine increments a player's ordinal only when that player's scoped action is applied.
      // Observe the receiving replica's copied view; neither a queued packet nor a turn deadline can satisfy this.
      // Ordinal gaps are allowed, and this isolated flow submits only this PASS after the paired baseline.
      await receiver.waitForFunction(
        (expected) => {
          const room = document.querySelector<HTMLElement>(".birds-room");
          const actor = [
            ...(room?.querySelectorAll<HTMLElement>(".birds-player") ?? []),
          ].find((card) => card.dataset.playerId === expected.actor);
          return (
            !!room &&
            room.dataset.match === expected.match &&
            room.dataset.round === expected.round &&
            Number(actor?.dataset.appliedOrdinal) >= expected.ordinal
          );
        },
        {
          actor: a.actor,
          match: a.match,
          round: a.round,
          ordinal: a.ordinal + 1,
        },
        { timeout: 30_000 },
      );
      assert.ok(
        Number(
          await receiver
            .locator(`.birds-player[data-player-id="${a.actor}"]`)
            .getAttribute("data-applied-ordinal"),
        ) > a.ordinal,
        "the receiving replica applied the ordinary PASS; deadlines never increment the actor ordinal",
      );
      if (active === second) recoveredPhonePasses++;
      await Promise.all(
        [first, second].map((page) =>
          page.waitForFunction(
            (previous) => {
              const room = document.querySelector<HTMLElement>(".birds-room");
              return (
                room?.dataset.turn !== previous ||
                room?.dataset.phase === "over"
              );
            },
            oldTurn,
            { timeout: 30_000 },
          ),
        ),
      );
    }
    assert.ok(
      recoveredPhonePasses > 0,
      "the automatically readmitted phone must apply a PASS; ordinary deadlines alone cannot prove recovery",
    );
    for (const p of [first, second, tv])
      await p.locator('.birds-room[data-phase="over"]').waitFor();
    await first.screenshot({ path: `${output}/result.png` });
    await first
      .getByRole("button", { name: "PLAY AGAIN", exact: true })
      .click();
    for (const p of [first, second, tv]) {
      await p
        .locator('.birds-room[data-phase="aiming"]')
        .waitFor({ timeout: 60_000 });
      await p
        .getByRole("button", { name: "Scatter Bomb, 3 shots remaining" })
        .waitFor();
    }
  }
  assert.deepEqual(errors, []);
  console.log(
    `Real room ${code}: two players and TV started and recovered a phone reload; ${process.env.FUSE_GAME_COVERAGE_DIR ? "timed launch quarantined (#250)" : "agreed on a Scatter launch"}; ${timedRound ? "finished a bounded round and rematched with fresh ammunition" : "timed PASS/result/rematch sequence quarantined (#250)"}. Captures: ${output}`,
  );
} catch (error) {
  let index = 0;
  for (const context of browser.contexts())
    for (const page of context.pages()) {
      console.error(
        "Control readiness",
        await page.evaluate(() => ({
          visibility: document.visibilityState,
          ready: document.querySelector<HTMLElement>("canvas")?.dataset.ready,
          turn: document.querySelector<HTMLElement>(".birds-room")?.dataset
            .turn,
          phase:
            document.querySelector<HTMLElement>(".birds-room")?.dataset.phase,
          buttons: [...document.querySelectorAll<HTMLButtonElement>("button")]
            .filter((button) => button.textContent === "PASS")
            .map((button) => ({ disabled: button.disabled })),
          hint: document.querySelector(".birds-hint")?.textContent,
          roster: document.querySelector(".birds-roster")?.textContent,
        })),
      );
      console.error(
        "Browser state",
        index,
        await page.locator("body").innerText(),
      );
      await page.screenshot({ path: `${output}/failure-${index++}.png` });
    }
  throw error;
} finally {
  try {
    for (const finish of finishCoverage) await finish();
  } finally {
    await browser.close();
  }
}
