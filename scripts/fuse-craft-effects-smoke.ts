import { readFileSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";
import { chromium, webkit } from "playwright";
import {
  decodeState,
  step,
  hashState,
  type Command,
  type World,
} from "../games/neural-defence/src/engine/index.js";

// Verified real-command combat snapshots, rendered diagnostically at multiple
// effect ages. Ordinary UI flows are covered by the separate expansion smoke.
const recording = JSON.parse(
  readFileSync(
    process.argv[2] ??
      "docs/neural-defence/verification/expansion-2026-09-27/close-quarters.replay.json",
    "utf8",
  ),
) as {
  initial: unknown;
  commands: { tick: number; commands: Command[] }[];
  ticks: number;
  hash: string;
};
let world = decodeState(JSON.stringify(recording.initial));
let cursor = 0;
let battle: { before: World; after: World } | undefined;
while (world.tick < recording.ticks) {
  const before = world;
  const row = recording.commands[cursor];
  world = step(world, row?.tick === world.tick ? (cursor++, row.commands) : []);
  if (
    !battle &&
    world.outcomes.some((o) => o.type === "destroyed") &&
    world.outcomes.some((o) => o.type === "damage")
  )
    battle = { before, after: world };
}
assert.equal(hashState(world), recording.hash);
assert.ok(battle, "recording includes real destruction and damage");
const out = process.argv[3] ?? "/tmp/fuse-depth-effects";
mkdirSync(out, { recursive: true });
for (const [name, engine] of Object.entries({ chromium, webkit })) {
  const browser = await engine.launch();
  try {
    for (const [size, viewport] of Object.entries({
      desktop: { width: 1280, height: 800 },
      phone: { width: 390, height: 844 },
    })) {
      const page = await browser.newPage({ viewport });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto("http://127.0.0.1:5174/games/neural-defence/?mute");
      for (const age of [80, 240, 650]) {
        const result: { effects: number; ordered: boolean; overflow: boolean } =
          await page.evaluate(
            async ({ battle, age }) => {
              const root = "/games/neural-defence/src/render/";
              const renderer = (await import(
                root + "board.ts"
              )) as typeof import("../games/neural-defence/src/render/board.js");
              const art = (await import(root + "sprites.ts")) as {
                spriteUrls: Readonly<Record<string, string>>;
              };
              document.body.replaceChildren();
              const svg = document.createElementNS(
                "http://www.w3.org/2000/svg",
                "svg",
              );
              svg.id = "nd-board";
              svg.style.cssText = "width:100vw;height:100vh;display:block";
              document.body.append(svg);
              renderer.renderBoard(
                svg,
                battle.before,
                null,
                false,
                false,
                0,
                art.spriteUrls,
              );
              const animation = renderer.renderBoard(
                svg,
                battle.after,
                null,
                false,
                false,
                50,
                art.spriteUrls,
              );
              animation.animate(50 + age);
              const event = battle.after.outcomes.find(
                (o) => o.type === "destroyed",
              )!;
              const center = renderer.hexCenter(
                battle.after.map.width,
                event.cell!,
              );
              const height = innerWidth < 500 ? 420 : 520;
              const width = (height * innerWidth) / innerHeight;
              const box = {
                x: center.x - width / 2,
                y: center.y - height / 2,
                width,
                height,
              };
              svg.setAttribute(
                "viewBox",
                `${box.x} ${box.y} ${width} ${height}`,
              );
              for (const [key, value] of Object.entries(box))
                svg
                  .querySelector(".terrain-backdrop")!
                  .setAttribute(key, String(value));
              await Promise.all(
                [...svg.querySelectorAll("image")].map(
                  (n) =>
                    new Promise<void>((resolve) => {
                      const image = new Image();
                      image.onload = () => resolve();
                      image.onerror = () => resolve();
                      image.src = n.getAttribute("href")!;
                    }),
                ),
              );
              const depths = [
                ...svg.querySelector(".structure-layer")!.children,
              ].map((n) =>
                Number(
                  n.getAttribute("data-cell") ?? n.getAttribute("data-depth"),
                ),
              );
              return {
                effects: svg.querySelectorAll(".combat-effect").length,
                ordered: depths.every((v, i) => i === 0 || v >= depths[i - 1]!),
                overflow: document.documentElement.scrollWidth > innerWidth,
              };
            },
            { battle, age },
          );
        assert.ok(result.effects > 0);
        assert.ok(result.ordered);
        assert.equal(result.overflow, false);
        await page.screenshot({ path: `${out}/${name}-${size}-${age}.png` });
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log(
      `${name}: real replay hash ${recording.hash}; depth, effect ages and desktop/phone rendering passed`,
    );
  } finally {
    await browser.close();
  }
}
