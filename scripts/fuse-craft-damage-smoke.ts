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
import { STRUCTURES } from "../games/neural-defence/src/engine/catalog.js";

const recording = JSON.parse(
  readFileSync(
    "docs/neural-defence/verification/rules9-2026-09-27/combat.replay.json",
    "utf8",
  ),
) as {
  initial: unknown;
  ticks: number;
  hash: string;
  commands: { tick: number; commands: Command[] }[];
};
let world = decodeState(JSON.stringify(recording.initial)),
  cursor = 0;
let damaged: { world: World; cell: number } | undefined;
while (world.tick < recording.ticks) {
  const row = recording.commands[cursor];
  world = step(world, row?.tick === world.tick ? (cursor++, row.commands) : []);
  const structure = world.structures.find(
    (s) => s.kind !== "neuron" && s.hp < STRUCTURES[s.kind].hp / 3,
  );
  if (!damaged && structure) damaged = { world, cell: structure.cell };
}
assert.equal(hashState(world), recording.hash);
assert.ok(damaged, "ordinary combat recording contains a damaged building");
const out = process.argv[2] ?? "/tmp/fuse-damage";
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
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto("http://127.0.0.1:5174/games/neural-defence/?mute");
      const result: {
        moved: boolean;
        stable: boolean;
        unchanged: boolean;
        transparent: string | null;
        visible: boolean;
      } = await page.evaluate(async ({ world, cell }) => {
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
        const before = JSON.stringify(world);
        const frame = renderer.renderBoard(
          svg,
          world,
          cell,
          false,
          false,
          1000,
          art.spriteUrls,
        );
        const plume = svg.querySelector(
          `.structure[data-cell="${cell}"] .damage-plume`,
        )!;
        const initial = plume.outerHTML;
        frame.animate(1700);
        const moved = plume.outerHTML !== initial;
        const { x, y } = renderer.hexCenter(world.map.width, cell);
        const height = innerWidth < 500 ? 320 : 400,
          width = (height * innerWidth) / innerHeight;
        svg.setAttribute(
          "viewBox",
          `${x - width / 2} ${y - height / 2 - 20} ${width} ${height}`,
        );
        const box = plume.getBoundingClientRect();
        const reduced = renderer.renderBoard(
          svg,
          world,
          cell,
          false,
          true,
          1700,
          art.spriteUrls,
        );
        const still = svg.querySelector(".damage-plume")!.outerHTML;
        reduced.animate(6000);
        const stable = still === svg.querySelector(".damage-plume")!.outerHTML;
        renderer.renderBoard(
          svg,
          world,
          cell,
          false,
          false,
          1700,
          art.spriteUrls,
        );
        await Promise.all(
          [...svg.querySelectorAll("image")].map(
            (n) =>
              new Promise<void>((resolve, reject) => {
                const image = new Image();
                image.onload = () => resolve();
                image.onerror = () =>
                  reject(new Error(`Unable to load ${n.getAttribute("href")}`));
                image.src = n.getAttribute("href")!;
              }),
          ),
        );
        return {
          moved,
          stable,
          unchanged: before === JSON.stringify(world),
          transparent: plume.getAttribute("pointer-events"),
          visible: box.width > 0 && box.height > 0,
        };
      }, damaged);
      assert.deepEqual(result, {
        moved: true,
        stable: true,
        unchanged: true,
        transparent: "none",
        visible: true,
      });
      await page.screenshot({ path: `${out}/${name}-${size}.png` });
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log(
      `${name}: real combat damage, motion, reduced motion, pointer transparency and immutable state passed`,
    );
  } finally {
    await browser.close();
  }
}
console.log(`Replay hash ${recording.hash}; screenshots ${out}`);
