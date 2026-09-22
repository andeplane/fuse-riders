/** Internal visual acceptance harness; the online entry will compose these same library and renderer exports. */
import {
  advance,
  createMatch,
  getView,
  quantize,
  UNIT,
  type Action,
  type Vector,
  type Weapon,
} from "../engine/index.js";
import { createArena } from "../render/arena.js";
import type { Camera } from "../render/camera.js";
const canvas = document.querySelector<HTMLCanvasElement>("#arena")!,
  status = document.querySelector<HTMLElement>("#status")!;
const arena = createArena(canvas, "/games/fuse-birds/art/v1");
let seed = 123,
  state = createMatch("render-check", seed, [
    { id: "cyan", name: "SKYE" },
    { id: "pink", name: "EMBER" },
    { id: "green", name: "FERN" },
    { id: "orange", name: "SOL" },
  ]);
let camera: Camera = { x: 768, y: 384, zoom: 1 },
  weapon: Weapon = "pebble",
  ordinal = 0,
  aim: Vector | undefined;
let drag: { x: number; y: number; pointer: number } | undefined;
type Play =
  | { type: "launch"; weapon: Weapon; vx: number; vy: number }
  | { type: "move"; direction: -1 | 1 }
  | { type: "hop"; direction: -1 | 0 | 1 }
  | { type: "pass" };
let pending: Action[] = [];
const act = (action: Play) => {
  pending.push({
    ...action,
    actor: state.players[state.active]!.id,
    round: state.round,
    turn: state.turn,
    ordinal: ++ordinal,
  });
};
for (const kind of ["pebble", "scatter"] as const)
  document.getElementById(kind)!.onclick = () => {
    drag = undefined;
    aim = undefined;
    weapon = kind;
    document
      .getElementById("pebble")!
      .setAttribute("aria-pressed", String(kind === "pebble"));
    document
      .getElementById("scatter")!
      .setAttribute("aria-pressed", String(kind === "scatter"));
  };
document.getElementById("left")!.onclick = () =>
  act({ type: "move", direction: -1 });
document.getElementById("right")!.onclick = () =>
  act({ type: "move", direction: 1 });
document.getElementById("hop")!.onclick = () =>
  act({ type: "hop", direction: 0 });
document.getElementById("pass")!.onclick = () => act({ type: "pass" });
document.getElementById("zoom")!.onclick = () => {
  const p = state.players[state.active]!;
  camera = { x: p.x / UNIT, y: p.y / UNIT, zoom: camera.zoom === 1 ? 3 : 1 };
};
document.getElementById("reset")!.onclick = () => {
  state = createMatch("render-check", ++seed, state.players);
  pending = [];
  aim = undefined;
  drag = undefined;
};
canvas.onpointerdown = (e) => {
  if (drag) {
    drag = undefined;
    aim = undefined;
    return;
  }
  canvas.setPointerCapture(e.pointerId);
  drag = { x: e.clientX, y: e.clientY, pointer: e.pointerId };
};
canvas.onpointermove = (e) => {
  if (drag?.pointer === e.pointerId)
    aim = quantize((drag.x - e.clientX) * 22, (drag.y - e.clientY) * 22);
};
canvas.onpointerup = (e) => {
  if (drag?.pointer === e.pointerId && aim)
    act({ type: "launch", weapon, ...aim });
  drag = undefined;
  aim = undefined;
};
canvas.onpointercancel = () => {
  drag = undefined;
  aim = undefined;
};
window.addEventListener("blur", () => {
  drag = undefined;
  aim = undefined;
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    drag = undefined;
    aim = undefined;
  }
});
let last = 0,
  elapsed = 0;
await arena.ready;
function frame(now: number): void {
  elapsed += Math.min(100, now - (last || now));
  last = now;
  while (elapsed >= 50) {
    for (const fact of advance(state, pending))
      arena.emit(fact, `${state.id}:${state.round}`, now);
    pending = [];
    elapsed -= 50;
  }
  const view = getView(state),
    bird = view.players[view.active]!;
  status.textContent = `${bird.name} · ${view.phase} · ${Math.ceil(view.timeLeft)}s · wind ${view.wind}`;
  document.getElementById("scatter")!.textContent =
    `Scatter Bomb ×${bird.ammo}`;
  canvas.dataset.ready = String(
    view.phase !== "preparing" &&
      arena.paint({ world: view, camera, aim }, now),
  );
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.addEventListener("pagehide", () => arena.destroy(), { once: true });
