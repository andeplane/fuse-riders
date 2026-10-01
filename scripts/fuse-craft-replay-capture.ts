import { readFileSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import {
  decodeState,
  step,
  hashState,
  type Command,
  type World,
} from "../games/neural-defence/src/engine/index.js";

// Diagnostic replay rendering, not a substitute for ordinary UI playtesting.
const file = process.argv[2];
if (!file) throw new Error("Pass a tournament .replay.json file");
const recording = JSON.parse(readFileSync(file, "utf8")) as {
  initial: unknown;
  commands: { tick: number; commands: Command[] }[];
  ticks: number;
  hash: string;
};
let world = decodeState(JSON.stringify(recording.initial));
const frames: World[] = [];
let cursor = 0;
const samples = new Set([
  Math.floor(recording.ticks / 3),
  Math.floor((recording.ticks * 2) / 3),
  recording.ticks,
]);
while (world.tick < recording.ticks) {
  const row = recording.commands[cursor];
  world = step(world, row?.tick === world.tick ? (cursor++, row.commands) : []);
  if (samples.has(world.tick)) frames.push(world);
}
assert.equal(hashState(world), recording.hash);
const out = process.argv[3] ?? "/tmp/fuse-craft-replay";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  await page.goto(
    process.env.FUSE_CRAFT_URL ??
      "http://127.0.0.1:5174/games/neural-defence/?mute",
  );
  for (const [index, frame] of frames.entries()) {
    await page.evaluate(async (world) => {
      const root = "/games/neural-defence/src/render/";
      const renderer = (await import(
        root + "board.ts"
      )) as typeof import("../games/neural-defence/src/render/board.js");
      const art = (await import(root + "sprites.ts")) as {
        spriteUrls: Readonly<Record<string, string>>;
      };
      document.body.replaceChildren();
      const title = document.createElement("p");
      title.textContent = `AI command replay · ${world.map.id} · ${(world.tick / 20).toFixed(0)}s · ${world.finished ? (world.winnerId ?? "Draw") : "In progress"}`;
      title.style.cssText = "padding:12px;color:white;font:14px monospace";
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.id = "nd-board";
      svg.style.cssText = "width:1280px;height:740px;display:block";
      document.body.append(title, svg);
      renderer.renderBoard(svg, world, null, false, true, 0, art.spriteUrls);
      svg.setAttribute("viewBox", "220 175 1060 610");
      // Match the production camera's backdrop sizing after changing viewBox.
      const backdrop = svg.querySelector(".terrain-backdrop")!;
      for (const [key, value] of Object.entries({
        x: 220,
        y: 175,
        width: 1060,
        height: 610,
      }))
        backdrop.setAttribute(key, String(value));
      await Promise.all(
        Array.from(svg.querySelectorAll("image")).map(
          (node) =>
            new Promise<void>((resolve) => {
              const image = new Image();
              image.onload = () => resolve();
              image.onerror = () => resolve();
              image.src = node.getAttribute("href")!;
            }),
        ),
      );
    }, frame);
    await page.screenshot({ path: `${out}/frame-${index + 1}.png` });
  }
  console.log(
    `Replayed ${recording.ticks} ticks with hash ${recording.hash}; captured ${frames.length} production-renderer frames in ${out}`,
  );
} finally {
  await browser.close();
}
