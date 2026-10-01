import { createMatch, step, type World } from "../src/engine/index.js";
import { renderBoard } from "../src/render/board.js";
import { spriteUrls } from "../src/render/sprites.js";
import {
  createBuildingSprites,
  createBrowserSpriteRasterizer,
} from "../src/render/sprite-raster.js";
import { hexCenter } from "../src/render/projection.js";
import { createWebGlLightRenderer } from "../src/render/light-canvas.js";
import "../src/app/fuse-craft.css";

// A Spore tower of a's, supplied, facing a clump of b's neurons.
const svg = document.querySelector<SVGSVGElement>("#nd-board")!;
const light =
  createWebGlLightRenderer(
    document.querySelector<HTMLCanvasElement>("#nd-light")!,
    () => window.devicePixelRatio,
  ) ?? undefined;
const W = 12;
let world: World = createMatch(
  {
    schemaVersion: 1,
    id: "spore-lab",
    width: W,
    height: 8,
    layout: "odd-r",
    cells: Array.from({ length: W * 8 }, () => ({ terrain: "open" as const })),
    spawns: [
      { slot: 0, cellIndex: W * 4 + 1 },
      { slot: 1, cellIndex: W * 4 + 10 },
    ],
  },
  {},
  [
    { id: "a", slot: 0 },
    { id: "b", slot: 1 },
  ],
);
const add = (ownerId: string, cell: number, kind: "neuron" | "spore") =>
  world.structures.push({
    id: world.nextEntityId++,
    cell,
    ownerId,
    kind,
    hp: kind === "spore" ? 70 : 60,
    connected: true,
  });
for (const c of [2, 3, 4]) add("a", W * 4 + c, c === 4 ? "spore" : "neuron");
for (const c of [6, 7, 8, 9]) add("b", W * 4 + c, "neuron");
for (const c of [6, 7, 8]) add("b", W * 3 + c, "neuron");
for (const c of [6, 7, 8]) add("b", W * 5 + c, "neuron");
world.players[0]!.research = ["growth"];
world.players[0]!.priorities = { [W * 4 + 4]: 3 };
const raster = createBuildingSprites(
  spriteUrls,
  createBrowserSpriteRasterizer(
    document,
    () => new Image(),
    (blob) => URL.createObjectURL(blob),
  ),
);
const buildingSprites = {
  resolve: (scale: number, slots: readonly number[]) =>
    raster.resolve(scale * window.devicePixelRatio, slots),
};
const at = hexCenter(W, W * 4 + 6);
const draw = () => {
  const animation = renderBoard(
    svg,
    world,
    null,
    false,
    false,
    performance.now(),
    spriteUrls,
    buildingSprites,
    light,
  );
  svg.setAttribute("viewBox", `${at.x - 330} ${at.y - 200} 660 400`);
  return animation;
};
let animation = draw();
setInterval(() => {
  world = step(world);
  // Keep the targets standing so the lab keeps firing.
  for (const s of world.structures) if (s.ownerId === "b") s.hp = 60;
  animation = draw();
}, 50);
const frame = (now: number) => {
  animation.animate(now);
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
