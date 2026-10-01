import { createMatch, loadMap } from "../src/engine/index.js";
import { neighbors } from "../src/engine/map.js";
import { renderBoard } from "../src/render/board.js";
import { spriteUrls } from "../src/render/sprites.js";
import {
  createBuildingSprites,
  createBrowserSpriteRasterizer,
} from "../src/render/sprite-raster.js";
import { hexCenter } from "../src/render/projection.js";
import { createWebGlLightRenderer } from "../src/render/light-canvas.js";
import type { StructureKind } from "../src/engine/types.js";
import map from "../maps/close-quarters.json";
import "../src/app/fuse-craft.css";

const svg = document.querySelector<SVGSVGElement>("#nd-board")!;
const light =
  createWebGlLightRenderer(
    document.querySelector<HTMLCanvasElement>("#nd-light")!,
    () => window.devicePixelRatio,
  ) ?? undefined;
const world = createMatch(loadMap(map), {}, [
  { id: "a", slot: 0 },
  { id: "b", slot: 1 },
]);
let id = 1000;
const occupied = () => new Set(world.structures.map((s) => s.cell));
function growFrom(owner: string, count: number, kinds: StructureKind[]) {
  for (let i = 0; i < count; i++) {
    const own = world.structures.filter((s) => s.ownerId === owner);
    const taken = occupied();
    const options = own
      .flatMap((s) => neighbors(world.map, s.cell))
      .filter((c) => !taken.has(c) && world.map.cells[c]?.terrain === "open");
    const cell = options[(i * 7 + 3) % options.length];
    if (cell === undefined) return;
    world.structures.push({
      id: id++,
      cell,
      ownerId: owner,
      kind: kinds[i % kinds.length]!,
      hp: 60,
      connected: true,
    });
  }
}
growFrom("a", 16, ["neuron", "neuron", "neuron", "tower", "neuron"]);
growFrom("b", 12, ["neuron", "neuron", "relay", "neuron"]);
world.settings.powerups = true;
{
  const taken = occupied();
  const free = world.structures
    .filter((s) => s.ownerId === "a")
    .flatMap((s) => neighbors(world.map, s.cell))
    .flatMap((c) => neighbors(world.map, c))
    .filter(
      (c, i, all) =>
        all.indexOf(c) === i &&
        !taken.has(c) &&
        world.map.cells[c]?.terrain === "open",
    );
  (["cache", "regrowth", "surge", "frenzy"] as const).forEach((kind, i) =>
    world.powerups.push({
      id: id++,
      cell: free[i * 3]!,
      kind,
      expiresAt: 100_000,
    }),
  );
}
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
let animation = renderBoard(
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
const brain = world.structures.find((s) => s.ownerId === "a")!;
const at = hexCenter(world.map.width, brain.cell);
const zoom = Number(new URLSearchParams(location.search).get("zoom") ?? 1);
const w = 900 / zoom,
  h = 560 / zoom;
svg.setAttribute("viewBox", `${at.x - w / 2} ${at.y - h / 2} ${w} ${h}`);
const rerender = () => {
  world.tick++;
  animation = renderBoard(
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
  svg.setAttribute("viewBox", `${at.x - w / 2} ${at.y - h / 2} ${w} ${h}`);
};
document.querySelector("#grow")!.addEventListener("click", () => {
  growFrom("a", 1, ["neuron"]);
  rerender();
});
document.querySelector("#cut")!.addEventListener("click", () => {
  const s = world.structures.filter((s) => s.ownerId === "a").at(-1)!;
  s.connected = !s.connected;
  rerender();
});
document.querySelector("#kill")!.addEventListener("click", () => {
  const index = world.structures.lastIndexOf(
    world.structures.filter((s) => s.ownerId === "a").at(-1)!,
  );
  const [gone] = world.structures.splice(index, 1);
  world.outcomes = [
    {
      tick: world.tick + 1,
      playerId: "a",
      type: "destroyed",
      cell: gone!.cell,
    },
  ];
  rerender();
});
document.querySelector("#site")!.addEventListener("click", () => {
  const player = world.players[0]!;
  const taken = occupied();
  const cell = world.structures
    .filter((s) => s.ownerId === "a")
    .flatMap((s) => neighbors(world.map, s.cell))
    .find((c) => !taken.has(c) && world.map.cells[c]?.terrain === "open")!;
  player.queue.push({
    cell,
    kind: "neuron",
    paid: true,
    progress: 3,
    duration: 10,
    hp: 10,
  });
  rerender();
});
const frame = (now: number) => {
  animation.animate(now);
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
