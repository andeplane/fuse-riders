import "fuse-ui/tokens.css";
import "./style.css";
import { el } from "fuse-ui";
import { BallRuntime } from "../online/runtime.js";
import { createRenderer } from "../render/arena.js";
import { colorCss, interpolate } from "../render/present.js";
import type { BallView } from "../engine/view.js";
import { view } from "../engine/view.js";
import { createArena } from "../engine/state.js";
import { Controls, keyboardButton, gameplayKey } from "./controls.js";
import { Audio } from "./audio.js";
import { present } from "./presenter.js";

const root = document.querySelector<HTMLDivElement>("#app")!;
const abort = new AbortController(),
  signal = abort.signal;
const audio = new Audio(new URLSearchParams(location.search).has("mute"));
const top = el("header", "", "topbar"),
  home = el("a", "← FUSE ARCADE", "back");
home.href = new URL("../", location.href).href;
const badge = el("span", "EXPERIMENT 02 / SOLO + 4 BOTS", "eyebrow");
const sound = el(
  "button",
  audio.muted ? "SOUND OFF" : "SOUND ON",
  "quiet-button",
);
sound.addEventListener(
  "click",
  () => {
    audio.muted = !audio.muted;
    audio.unlock();
    sound.textContent = audio.muted ? "SOUND OFF" : "SOUND ON";
  },
  { signal },
);
top.append(home, badge, sound);
const heading = el("section", "", "heading");
heading.append(
  el("span", "FIVE CORES. ONE SURVIVOR.", "eyebrow"),
  el("h1", "BALL BROS"),
  el("p", "Protect your core. Turn every save into a shot."),
);
const scoreboard = el("div", "", "scoreboard");
const cards = Array.from({ length: 5 }, (_, slot) => {
  const c = el("div", "", "scorecard");
  c.style.setProperty("--player", colorCss(slot));
  scoreboard.append(c);
  return c;
});
const layout = el("main", "", "layout"),
  arenaBox = el("section", "", "arena-wrap");
const canvasHost = el("div", "", "canvas-host");
canvasHost.setAttribute("aria-label", "Ball Bros arena");
const overlay = el("div", "", "overlay"),
  overlayTitle = el("h2", "DEFEND YOUR CORE"),
  overlayText = el(
    "p",
    "A / D to orbit · W / S to reach out / pull in · Space to launch",
  ),
  start = el("button", "PLAY SOLO", "primary");
overlay.append(
  el("span", "BALL BROS / FIRST CONTACT", "eyebrow"),
  overlayTitle,
  overlayText,
  start,
);
const toast = el("div", "", "arena-toast");
toast.setAttribute("aria-live", "polite");
arenaBox.append(canvasHost, toast, overlay);
const side = el("aside", "", "sidebar");
const clock = el("div", "02:00", "clock"),
  status = el("p", "Loading arena…", "status");
status.setAttribute("role", "status");
const instructions = el("div", "", "instructions");
instructions.append(
  el("span", "HOW TO SURVIVE", "eyebrow"),
  el("h3", "Keep the rally alive."),
  el(
    "p",
    "Orbit with A / D. Reach out with W for early interceptions; pull in with S for tighter coverage. Combine both to chase a save.",
  ),
  el(
    "p",
    "Your blocks break on impact. One hit to the core ends your round. Even your own ball can hurt you.",
  ),
);
const keys = el("div", "", "key-guide");
keys.append(
  el("p", "A / D   ORBIT"),
  el("p", "W / S   OUT / IN"),
  el("p", "SPACE   LAUNCH"),
);
const restart = el("button", "RESTART ROUND", "quiet-button");
restart.hidden = true;
side.append(
  el("span", "ROUND TIMER", "eyebrow"),
  clock,
  status,
  instructions,
  keys,
  restart,
  el("p", "CORE POC · Fixed bases · No power-ups", "footnote"),
);
layout.append(arenaBox, side);
const controlsRow = el("div", "", "touch-controls");
root.append(top, heading, scoreboard, layout, controlsRow);
let renderer = createRenderer(canvasHost),
  graphicsFailed = false;
let runtime: BallRuntime | undefined,
  latest: BallView | undefined,
  frame = 0,
  playing = false;
const controls = new Controls((steer, radial, launch) => {
  audio.unlock();
  runtime?.input(steer, radial, launch);
});
for (const [action, label] of [
  ["left", "↶ LEFT"],
  ["inward", "IN ↓"],
  ["launch", "LAUNCH"],
  ["outward", "OUT ↑"],
  ["right", "RIGHT ↷"],
] as const) {
  const button = el("button", label, `pad ${action}`);
  button.dataset.action = action;
  button.addEventListener(
    "pointerdown",
    (e) => {
      e.preventDefault();
      button.setPointerCapture(e.pointerId);
      controls.press(`pointer-${e.pointerId}`, action);
      button.classList.add("pressed");
    },
    { signal },
  );
  const release = (e: PointerEvent) => {
    controls.release(`pointer-${e.pointerId}`);
    button.classList.remove("pressed");
  };
  button.addEventListener("pointerup", release, { signal });
  button.addEventListener("pointercancel", release, { signal });
  button.addEventListener("lostpointercapture", release, { signal });
  controlsRow.append(button);
}
const cancel = () => {
  controls.cancel();
  runtime?.cancel();
  controlsRow
    .querySelectorAll(".pressed")
    .forEach((b) => b.classList.remove("pressed"));
};
document.addEventListener(
  "keydown",
  (e) => {
    const target = e.target instanceof HTMLElement ? e.target : undefined;
    const action = gameplayKey(
      e.code,
      !!(
        target?.isContentEditable || target?.closest("input, textarea, select")
      ),
      !!target?.closest("button, a"),
    );
    if (!action || e.repeat || !playing) return;
    e.preventDefault();
    controls.press(e.code, action);
  },
  { signal },
);
document.addEventListener(
  "keyup",
  (e) => {
    if (keyboardButton(e.code)) {
      controls.release(e.code);
    }
  },
  { signal },
);
window.addEventListener("blur", cancel, { signal });
document.addEventListener(
  "visibilitychange",
  () => {
    if (document.hidden) cancel();
  },
  { signal },
);

let previousHud = "";
function update(v: BallView): void {
  latest = v;
  const model = present(v);
  if (!model) return;
  const key = JSON.stringify(model);
  if (key === previousHud) return;
  previousHud = key;
  for (const player of model.cards) {
    const card = cards[player.slot]!;
    card.replaceChildren(
      el("span", player.name, "player-name"),
      el("strong", player.armor),
      el("span", player.label, "card-label"),
    );
    card.classList.toggle("eliminated", !player.alive);
  }
  clock.textContent = model.time;
  toast.textContent = model.toast;
  if (model.over) {
    playing = false;
    cancel();
    overlay.hidden = false;
    overlayTitle.textContent = model.title;
    overlayText.textContent = model.result;
    start.textContent = "PLAY AGAIN";
    status.textContent = "Round complete";
  }
}
async function begin(): Promise<void> {
  start.disabled = true;
  try {
    if (graphicsFailed) {
      renderer.destroy();
      renderer = createRenderer(canvasHost);
      graphicsFailed = false;
    }
    await renderer.ready;
    cancel();
    previousHud = "";
    audio.unlock();
    overlay.hidden = true;
    start.blur();
    playing = true;
    restart.hidden = false;
    root.classList.add("in-match");
    restart.blur();
    if (runtime && latest?.arena?.phase === "over") {
      runtime.command({ type: "action", action: "rematch" });
      return;
    }
    runtime?.stop();
    runtime = new BallRuntime({
      ready: () => {},
      state: (f) => update(f),
      event: (e) => {
        renderer.impact(e, performance.now());
        audio.play(e);
      },
      status: (text) => (status.textContent = text),
    });
    runtime.start();
  } catch (error) {
    graphicsFailed = true;
    playing = false;
    overlay.hidden = false;
    status.textContent = `Could not start: ${error instanceof Error ? error.message : String(error)}`;
    start.textContent = "RETRY ARENA";
  } finally {
    start.disabled = false;
  }
}
start.addEventListener("click", () => void begin(), { signal });
restart.addEventListener("click", () => void begin(), { signal });
void renderer.ready.then(
  () => (status.textContent = "Ready for first contact"),
  () => {
    graphicsFailed = true;
    status.textContent = "Arena could not load. Retry to play.";
    start.textContent = "RETRY ARENA";
  },
);
update(
  view(
    0,
    "preview",
    createArena(
      ["You", "Sparks", "Ricochet", "Comet", "Pixel"].map((name, slot) => ({
        id: slot === 0 ? "solo" : `bot-${slot}`,
        name,
        slot,
        bot: slot !== 0,
      })),
    ),
  ),
);
toast.textContent = "";
function paint(now: number): void {
  const timing = runtime?.frameTiming();
  try {
    if (!graphicsFailed && !document.hidden && timing)
      renderer.paint(interpolate(timing.older, timing.newer, timing.tick), now);
    else if (!graphicsFailed && !document.hidden && latest)
      renderer.paint(latest, now);
  } catch {
    graphicsFailed = true;
    cancel();
    runtime?.stop();
    runtime = undefined;
    playing = false;
    overlay.hidden = false;
    start.textContent = "RETRY ARENA";
    status.textContent =
      "Arena rendering stopped. Retry to start a fresh round.";
  }
  frame = requestAnimationFrame(paint);
}
frame = requestAnimationFrame(paint);
window.addEventListener(
  "pagehide",
  () => {
    cancel();
    runtime?.stop();
    cancelAnimationFrame(frame);
    renderer.destroy();
    audio.destroy();
    abort.abort();
  },
  { once: true },
);
window.addEventListener("pageshow", (event) => {
  if (event.persisted) location.reload();
});
