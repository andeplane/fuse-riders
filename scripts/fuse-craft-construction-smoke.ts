import { readFileSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";
import { chromium, webkit } from "playwright";
import {
  decodeState,
  step,
  hashState,
  type Command,
  type World,
} from "../games/fuse-craft/src/engine/index.js";

const recording = JSON.parse(
  readFileSync(
    process.argv[2] ??
      "docs/fuse-craft/verification/rules12-replays-2026-10-01/combat.replay.json",
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
const stages: { world: World; cell: number; progress: number }[] = [];
let target: { owner: string; cell: number } | undefined;
for (; world.tick < recording.ticks;) {
  const row = recording.commands[cursor];
  world = step(world, row?.tick === world.tick ? (cursor++, row.commands) : []);
  if (target && stages.length < 3)
    assert.ok(
      world.players
        .find((p) => p.id === target!.owner)
        ?.queue.some((q) => q.cell === target!.cell && q.paid),
      "selected construction survives through all recorded stages",
    );
  for (const p of world.players)
    for (const q of p.queue) {
      if (q.kind !== "siege" || !q.paid || p.worker.mode !== "building")
        continue;
      target ??= { owner: p.id, cell: q.cell };
      if (target.owner !== p.id || target.cell !== q.cell) continue;
      const progress = q.progress / q.duration;
      if (stages.length < 3 && progress >= [0.15, 0.5, 0.85][stages.length]!)
        stages.push({ world, cell: q.cell, progress });
    }
}
assert.equal(hashState(world), recording.hash);
assert.equal(
  stages.length,
  3,
  "recording contains three real construction stages",
);
const out = process.argv[3] ?? "/tmp/fuse-construction";
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
      await page.goto(
        process.env.FUSE_CRAFT_URL ??
          "http://127.0.0.1:5174/games/fuse-craft/?mute",
      );
      for (const [index, stage] of stages.entries()) {
        const result = await page.evaluate(
          async ({ world, cell, progress }) => {
            const root = "/games/fuse-craft/src/render/";
            const renderer = (await import(
              root + "board.ts"
            )) as typeof import("../games/fuse-craft/src/render/board.js");
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
            const animation = renderer.renderBoard(
              svg,
              world,
              cell,
              false,
              false,
              1000,
              art.spriteUrls,
            );
            const body = svg.querySelector<SVGGElement>(
              `.construction-body[data-cell="${cell}"]`,
            )!;
            const first = body.outerHTML;
            animation.animate(1400);
            const moves = first !== body.outerHTML;
            const geometry = [
              ...svg.querySelector(".structure-layer")!.children,
            ].map((n) =>
              Number(
                n.getAttribute("data-cell") ?? n.getAttribute("data-depth"),
              ),
            );
            const center = renderer.hexCenter(world.map.width, cell);
            const height = innerWidth < 500 ? 300 : 400,
              width = (height * innerWidth) / innerHeight;
            const box = {
              x: center.x - width / 2,
              y: center.y - height / 2 - 15,
              width,
              height,
            };
            svg.setAttribute("viewBox", `${box.x} ${box.y} ${width} ${height}`);
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
            const clip = body.querySelector("clipPath rect")!;
            return {
              moves,
              immutable: before === JSON.stringify(world),
              ratio:
                Number(clip.getAttribute("height")) /
                Number(body.getAttribute("data-height")),
              progress,
              ordered: geometry.every(
                (v, i) => i === 0 || v >= geometry[i - 1]!,
              ),
              decorative: body.getAttribute("pointer-events") === "none",
              assembly: body
                .querySelector(".site-assembly")!
                .getAttribute("display"),
              overflow: document.documentElement.scrollWidth > innerWidth,
            };
          },
          stage,
        );
        assert.ok(
          result.moves &&
            result.immutable &&
            result.ordered &&
            result.decorative,
        );
        assert.ok(Math.abs(result.ratio - result.progress) < 1e-9);
        assert.equal(result.assembly, "inline");
        assert.equal(result.overflow, false);
        await page.screenshot({ path: `${out}/${name}-${size}-${index}.png` });
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log(
      `${name}: replay ${recording.hash}, real 15/50/85% construction, motion, depth and desktop/phone bounds pass`,
    );
  } finally {
    await browser.close();
  }
}
