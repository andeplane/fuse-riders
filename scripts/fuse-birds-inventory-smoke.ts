import { chromium, type Page } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import {
  advance,
  candidateVector,
  decodeState,
  encodeState,
  UNIT,
  MAX_VX,
  MAX_VY,
  type Match,
  type Vector,
} from "fuse-birds-game";
import { wireProbe } from "./lib/fuse-birds-wire-probe.js";

const base = process.argv[2] ?? "http://localhost:8893",
  output = process.argv[3] ?? "/tmp/fuse-birds-inventory";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const pages: Page[] = [];
const errors: string[] = [];
let observed: Match | undefined;
try {
  for (let i = 0; i < 2; i++) {
    const page = await browser.newPage({
      viewport: { width: 1400, height: 900 },
    });
    page.on("pageerror", (error) => errors.push(error.message));
    pages.push(page);
  }
  const [first, second] = pages as [Page, Page];
  await wireProbe(second, output, "inventory", (room) => {
    if (room.match) observed = room.match;
  });
  await first.goto(`${base}/fuse-birds/?mute`);
  await first.getByRole("button", { name: "CREATE ROOM" }).click();
  await first.locator(".fui-name-input").fill("SKYE");
  await first.getByRole("button", { name: "JOIN BATTLE" }).click();
  const code = await first.locator(".birds-code").innerText();
  await second.goto(`${base}/fuse-birds/?room=${code}&mute`);
  await second.locator(".fui-name-input").fill("EMBER");
  await second.getByRole("button", { name: "JOIN BATTLE" }).click();
  await first.locator(".birds-roster").getByText("EMBER").waitFor();
  await first.getByRole("button", { name: "START BATTLE" }).click();
  for (const page of pages)
    await page
      .locator('canvas[data-ready="true"]')
      .waitFor({ timeout: 60_000 });

  async function checkpoint(): Promise<Match> {
    observed = undefined;
    await second.reload();
    await second
      .locator('canvas[data-ready="true"]')
      .waitFor({ timeout: 30_000 });
    assert.ok(
      observed,
      "reload supplies an observed, validated peer checkpoint",
    );
    return observed;
  }
  async function turnChanged(page: Page, turn: number) {
    await page.waitForFunction((previous) => {
      const room = document.querySelector<HTMLElement>(".birds-room");
      return (
        Number(room?.dataset.turn) > previous &&
        room?.dataset.phase === "aiming"
      );
    }, turn);
  }
  async function fire(
    page: Page,
    state: Match,
    weapon: "pebble" | "scatter",
    vector: Vector,
  ) {
    const player = state.players[state.active]!;
    assert.equal(
      Number(await page.locator(".birds-room").getAttribute("data-turn")),
      state.turn,
      "aim is scoped to observed turn",
    );
    await page
      .getByRole("button", {
        name:
          weapon === "pebble"
            ? "Pebble, unlimited ammunition"
            : `Scatter Bomb, ${player.ammo} shots remaining`,
        exact: true,
      })
      .click();
    await page.getByRole("button", { name: "FULL MAP", exact: true }).click();
    const box = await page.locator("canvas").boundingBox();
    assert.ok(box);
    const scale = Math.min(box.width / 1536, box.height / 768),
      pull = Math.max(
        90,
        Math.min(160, Math.min(box.width, box.height) * 0.35),
      );
    const x = box.x + box.width / 2 + (player.x / UNIT - 768) * scale,
      y = box.y + box.height / 2 + (player.y / UNIT - 384) * scale;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(
      x - (vector.vx / MAX_VX) * pull,
      y - (vector.vy / MAX_VY) * pull,
      { steps: 5 },
    );
    await page.locator('canvas[data-gesture="aim"]').waitFor();
    await page.mouse.up();
    await turnChanged(first, state.turn);
  }
  // Spend only normal Scatter launches directed away from the island, preserving targets for the refill test.
  for (let ammo = 3; ammo > 0; ammo--) {
    const state = await checkpoint();
    assert.equal(state.players[state.active]!.name, "SKYE");
    assert.equal(state.players[state.active]!.ammo, ammo);
    await fire(first, state, "scatter", { vx: -MAX_VX, vy: -MAX_VY });
    const turn = Number(
      await first.locator(".birds-room").getAttribute("data-turn"),
    );
    await second.getByRole("button", { name: "PASS", exact: true }).click();
    await turnChanged(first, turn);
  }
  const empty = first.getByRole("button", {
    name: "Scatter Bomb, 0 shots remaining",
  });
  await empty.waitFor();
  assert.equal(await empty.isDisabled(), true);
  assert.equal(
    await first
      .getByRole("button", { name: "Pebble, unlimited ammunition" })
      .getAttribute("aria-pressed"),
    "true",
  );
  await first.screenshot({ path: `${output}/empty-ammo.png` });
  // The checkpoint is observed from real transport. Search a copied library state, then submit only a mouse shot.
  let collected = false;
  for (let attempt = 0; attempt < 12 && !collected; attempt++) {
    const state = await checkpoint(),
      player = state.players[state.active]!;
    const page = player.name === "SKYE" ? first : second;
    let shot: Vector | undefined;
    for (const crate of state.crates.filter(
      (crate) => crate.grounded && player.ammo === 0 && player.name === "SKYE",
    )) {
      for (let index = 0; index < 201 && !shot; index++) {
        const vector = candidateVector(player, crate, state.wind, index);
        if (!vector) continue;
        const copy = decodeState(encodeState(state))!;
        let facts = advance(copy, [
          {
            type: "launch",
            actor: player.id,
            round: copy.round,
            turn: copy.turn,
            ordinal: player.ordinal + 1,
            weapon: "pebble",
            ...vector,
          },
        ]);
        for (let tick = 0; tick < 220; tick++) {
          if (
            facts.some(
              (fact) =>
                fact.type === "pickup" &&
                fact.actor === player.id &&
                fact.amount === 1,
            )
          ) {
            shot = vector;
            break;
          }
          if (copy.turn !== state.turn || copy.phase === "over") break;
          facts = advance(copy);
        }
      }
    }
    if (shot) {
      assert.equal(player.ammo, 0, "the exhausted bird collects the refill");
      await fire(page, state, "pebble", shot);
      const recovered = await checkpoint();
      assert.equal(
        recovered.players.find((p) => p.id === player.id)!.ammo,
        player.ammo + 1,
      );
      if (recovered.players[recovered.active]!.id !== player.id) {
        const nextPage =
          recovered.players[recovered.active]!.name === "SKYE" ? first : second;
        await nextPage
          .getByRole("button", { name: "PASS", exact: true })
          .click();
        await turnChanged(first, recovered.turn);
      }
      await page
        .getByRole("button", {
          name: `Scatter Bomb, ${player.ammo + 1} shots remaining`,
          exact: true,
        })
        .waitFor();
      await page.screenshot({ path: `${output}/collected-refill.png` });
      collected = true;
    } else {
      await page.getByRole("button", { name: "PASS", exact: true }).click();
      await turnChanged(first, state.turn);
    }
  }
  assert.ok(
    collected,
    "a normal Pebble shot collected a naturally spawned ammo crate",
  );
  assert.deepEqual(errors, []);
  console.log(
    `Room ${code}: three Scatter shots exhaust inventory; zero disables Scatter and selects Pebble; an ordinary Pebble collects a naturally dropped refill, confirmed through peer recovery. ${output}`,
  );
} catch (error) {
  for (const [index, page] of pages.entries()) {
    console.error(await page.locator("body").innerText());
    await page.screenshot({ path: `${output}/failure-${index}.png` });
  }
  throw error;
} finally {
  await browser.close();
}
