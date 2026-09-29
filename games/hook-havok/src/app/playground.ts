import "./style.css";
import "./presentation.css";
import { createRadio } from "fuse-ui/radio";
import { EffectsAudio, browserToneSink } from "./audio.js";
import {
  PeerTransport,
  createRoom,
  createEndpoints,
  memberToken,
  validRoomCode,
} from "fuse-network-fe";
import { MAX_PACKET_BYTES, roomManager } from "fuse-netcode";
import { HookRuntime } from "../online/runtime.js";
import {
  DEFAULT_TUNING,
  NEUTRAL,
  createWorld,
  type Input,
} from "../engine/world.js";
import { TUNING_BOUNDS, parseTuning } from "../engine/codec.js";
import { toView, POWER_KINDS, type WorldView } from "../engine/view.js";
import { ALL_POWERS } from "../engine/power-rules.js";
import { POWER_STYLE } from "../render/power-ups.js";
import type { ShowcaseHandle } from "../render/scene.js";
import { interpolate } from "../render/interpolation.js";
import { createTouchControls, type TouchControls } from "./touch-controls.js";
import { bombDirection, touchAim, type TouchState } from "./touch-input.js";
import { createRoster } from "./roster.js";
import { createEntrance } from "./entrance.js";
import { KeyboardInput } from "./keyboard-input.js";
import { assistAim } from "./aim-assist.js";
import { createMatchShell } from "./match-shell.js";
import { createKnockoutFeed } from "./knockout-feed.js";
import {
  sessionStore,
  sessionToken,
  saveCreator,
  inviteUrl,
} from "./session.js";

document.querySelector("main")!.innerHTML =
  `<header><a id="home">← BACK TO THE PARTY</a><p class="eyebrow">HOOK HAVOK / SHARED SANDBOX</p><h1>Find your next foothold.</h1><p class="intro">A quiet belfry. Eight ledges. Up to five keepers.</p></header>
<section class="controls room-entry"><label>Your name <input id="keeper-name" maxlength="24" value="Lantern keeper"></label><label>Room code <input id="room-code" maxlength="6" placeholder="Invite code"></label><button id="join-room" disabled>Join room</button><button id="new-room" disabled>New room</button></section>
<section id="invitation" class="controls" hidden><label>Invite <input id="invite-url" readonly aria-label="Room invite link"></label><button id="copy-invite">Copy link</button><a id="display-link" target="_blank" rel="noopener">Open shared display</a><button id="restart-room" disabled>Restart shared trial</button><button id="leave-room">Leave room</button></section><p id="roster" aria-live="polite"></p>
<section class="controls experiment-controls"><label>Experiment <select id="experiment" name="experiment" form="tuning" disabled><option value="movement">Movement course</option><option value="target">Knockback target</option><option value="ball">Splitting ball</option></select></label><label><input id="touch-toggle" type="checkbox"> Touch controls</label><label id="aim-label" hidden>Aim <select id="aim-mode"><option value="eight">8 directions</option><option value="free">Free aim</option></select></label><span id="experiment-help">Explore the eight ledges with jump and grapple.</span></section>
<div class="play-surface"><section class="stage"><div id="scene" tabindex="0" aria-label="Hook Havok playground"></div><div class="stage-caption"><span id="phase">Preparing the belfry…</span><span id="counter">SOLO EXPERIMENT</span></div></section>
<section id="touch-deck" aria-label="Touch controls" hidden><div class="thumb-control move-control"><div class="thumb-pad" data-pad="move" aria-label="Move pad: slide left or right, slide up to jump"><span class="pad-cross">↔</span><span class="thumb-knob"></span></div><span>MOVE · UP TO JUMP</span></div><div class="thumb-control bomb-control"><div class="bomb-button" data-pad="bomb" role="button" aria-label="Bomb: hold to charge, release to throw along your last aim"><span class="thumb-knob"></span></div><span>BOMB · HOLD</span></div><div class="thumb-control aim-control"><div class="thumb-pad" data-pad="aim" aria-label="Hook pad: drag from center to aim and fire, release to let go"><span class="pad-cross">✧</span><span class="thumb-knob"></span></div><span>AIM · HOLD TO HOOK</span></div></section></div>
<p id="touch-help" class="intro" hidden>Left thumb: slide sideways to move, up to jump; hold up for height. Right thumb: start near the center and drag toward your target to fire, keep holding to pull, release to let go. Release and drag again for another shot.</p>
<section class="controls"><button id="start" disabled>Enter the belfry</button><button id="reset" disabled>Restart experiment</button><label><input id="debug" type="checkbox"> Show collision shapes</label><label><input id="atmosphere" type="checkbox" checked> Atmosphere</label><a id="study">Art showcase</a><button id="retry" hidden>Retry graphics</button></section>
<p id="status" role="status" data-state="loading">Loading the belfry…</p>
<p class="intro desktop-help">A / D or ← / → to move · Space to jump (hold for height) · Mouse to aim · Hold left mouse to hook and pull · Release to let go · R to reset. Click the scene to focus.</p>
<details><summary>Movement workshop</summary><form id="tuning" class="controls"></form><p>Apply restarts the exercise. Settings travel with the room checkpoint. Solid platforms: aim around their edges to climb higher.</p></details>`;
function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}
function setText(node: HTMLElement, value: string): void {
  if (node.textContent !== value) node.textContent = value;
}
const rulesPanel = document.createElement("section");
document.body.classList.add("playground");
document.querySelector("h1")!.textContent = "Hook Havok";
const focusButton = document.createElement("button");
focusButton.id = "arena-focus";
focusButton.disabled = true;
focusButton.textContent = "Focus arena";
focusButton.setAttribute("aria-pressed", "false");
document.querySelector("header")!.append(focusButton);
focusButton.onclick = () => {
  clear();
  const focused = document.body.classList.toggle("arena-focused");
  focusButton.textContent = focused ? "Show controls" : "Focus arena";
  focusButton.setAttribute("aria-pressed", String(focused));
  host.focus({ preventScroll: true });
};
const roster = document.createElement("div");
roster.id = "roster";
roster.setAttribute("aria-live", "polite");
roster.setAttribute("role", "list");
el("roster").replaceWith(roster);
const paintRoster = createRoster(roster);
document
  .querySelector('[data-pad="move"]')!
  .setAttribute(
    "aria-label",
    "Move pad: sideways to move, up to jump, down to drop through",
  );
document.querySelector(".move-control > span")!.textContent =
  "MOVE · UP JUMP · DOWN DROP";
el("touch-help").textContent =
  "Left thumb: sideways to move, up to jump, down to drop through a ledge. Release down before dropping again. Right thumb: drag from center to aim and fire, hold to pull, release to let go. Bomb button: hold to charge, release to throw along your last aim (forward and up before you have aimed).";
const mouseHelp =
  "A / D or ← / → to move · Space to jump through ledges · S / ↓ to drop through (one press per ledge) · Mouse to aim · Hold left mouse to hook and pull · Hold right mouse to charge a bomb, release to throw · R to reset. Click the scene to focus.";
const KEYS_SHORT =
  "WASD aims · Space jumps · J or left click hooks · K or right click bombs · ↓ + Space drops.";
const KEYS_HELP =
  "A / D or ← / → to move · WASD / arrows aim in eight directions · Space to jump, twice for an air jump · Hold J to hook and reel in, or left click to hook where the mouse points · Steer to swing · Jump while hooked to leap off · Release to let go · Hold K (or right click) to charge a bomb, release to throw · ↓ + Space (or Shift+↓) to drop · R to reset. Click the scene to focus.";
document.querySelector(".desktop-help")!.textContent = KEYS_HELP;
document.querySelector("details > p")!.textContent =
  "Apply restarts the exercise. Platforms catch players from above; hooks still attach to every surface. Dropping releases your hook.";
rulesPanel.className = "controls rules-controls";
rulesPanel.innerHTML = `<label>Round rules <select id="rules" name="rules" form="tuning" disabled><option value="free">Free play</option><option value="elimination">Last keeper standing</option><option value="score">Hook score</option></select></label><span id="rules-help">Respawn freely and explore.</span><p id="round-status" role="status"></p>`;
el("experiment").closest("section")!.after(rulesPanel);
const mapLabel = document.createElement("label");
mapLabel.innerHTML = `Arena <select id="map" name="map" form="tuning" disabled><option value="belfry">Lantern Belfry</option><option value="crossroads">Crossroads</option></select>`;
const mapHelp = document.createElement("span");
mapHelp.id = "map-help";
mapHelp.textContent = "Changing arena restarts the shared trial.";
rulesPanel.prepend(mapLabel, mapHelp);
const trials = document.createElement("section");
trials.className = "controls experiment-controls";
trials.innerHTML = `<label>Jump <select id="jump-mode" name="jumpMode" form="tuning" disabled><option value="single">Single jump</option><option value="double">Double jump</option></select></label><label>Tether <select id="wire-mode" name="wire" form="tuning" disabled><option value="tip">Hook tip only</option><option value="spiked">Spiked wire</option></select></label><label>Bombs <select id="bomb-mode" name="bomb" form="tuning" disabled><option value="off">Off</option><option value="fuse">Fuse · 1.5 s</option><option value="impact">Impact on a rival</option></select></label><label>Your controls <select id="keyboard-mode"><option value="keyboard">Keyboard · J hook / K bomb</option><option value="mouse">Mouse aim</option></select></label><span id="control-help">${KEYS_SHORT}</span>`;
rulesPanel.after(trials);
const trialHelp = document.createElement("span");
trialHelp.textContent =
  "Jump / Tether / Bombs changes restart the shared trial. Double jump: one extra leap before landing. Spiked wire (default): the whole visible rope pops balls, retract included, and a pop ends the shot; rivals and the brass target still need the tip. Bombs: hold to charge (full at 0.6 s), release to throw; the blast knocks out every keeper in reach, you included. Impact goes off on touching a rival, or at the fuse.";
trials.append(trialHelp);
const jumpMode = el<HTMLSelectElement>("jump-mode"),
  wireMode = el<HTMLSelectElement>("wire-mode"),
  bombMode = el<HTMLSelectElement>("bomb-mode"),
  keyboardMode = el<HTMLSelectElement>("keyboard-mode");
// 11D power-up pool: off, all five, or any mix. One hidden field carries the
// validated bit mask to the settings form; the select and boxes only edit it.
const powerLabel = document.createElement("label");
powerLabel.innerHTML = `Power-ups <select id="power-ups" disabled><option value="${ALL_POWERS}">All five</option><option value="0">Off</option><option value="custom" disabled hidden>Some</option></select><input type="hidden" id="power-mask" name="powerUps" form="tuning" value="${DEFAULT_TUNING.powerUps}">`;
const powerBoxes = document.createElement("span");
powerBoxes.className = "power-pool";
powerBoxes.setAttribute("role", "group");
powerBoxes.setAttribute("aria-label", "Power-ups in the pool");
for (const [i, kind] of POWER_KINDS.entries()) {
  const box = document.createElement("label");
  box.style.setProperty("--power-color", POWER_STYLE[kind].css);
  const input = document.createElement("input");
  input.type = "checkbox";
  input.id = `power-${kind}`;
  input.dataset.bit = String(1 << i);
  input.disabled = true;
  box.append(input, ` ${POWER_STYLE[kind].name}`);
  powerBoxes.append(box);
}
const powerHelp = document.createElement("span");
powerHelp.id = "power-help";
powerHelp.textContent =
  "Pads show a random power-up from the pool and return 10 s after pickup with a new one. One at a time; a new pickup replaces yours. Triple jump: two air jumps for 8 s. Shield: survives one bomb blast, your own included (8 s, bombs only). Cluster bomb: your next 3 bombs split into 3 small bomblets when they land. Harpoon: for 8 s your hook pulls a hit rival in. Dash bump: for 8 s your air jump dashes along your aim and knocks rivals away. Shield and Cluster need bombs on. Changing the pool restarts everyone.";
trials.append(powerLabel, powerBoxes, powerHelp);
const powerMode = el<HTMLSelectElement>("power-ups"),
  powerMask = el<HTMLInputElement>("power-mask"),
  powerInputs = [...powerBoxes.querySelectorAll("input")];
const somePowers = powerMode.querySelector<HTMLOptionElement>(
  'option[value="custom"]',
)!;
/** The room's pool last shown; boxes a manager clicks stay until it changes. */
let shownPowers = -1;
/** Show a pool without submitting it. */
function showPowers(mask: number) {
  if (mask === shownPowers) return;
  shownPowers = mask;
  powerMask.value = String(mask);
  const mixed = mask !== 0 && mask !== ALL_POWERS;
  // "Some" only names a mixed pool; it is not a choice of its own.
  somePowers.hidden = !mixed;
  powerMode.value = mixed ? "custom" : String(mask);
  for (const input of powerInputs)
    input.checked = (mask & Number(input.dataset.bit)) !== 0;
}
function enablePowers(enabled: boolean) {
  powerMode.disabled = !enabled;
  for (const input of powerInputs) input.disabled = !enabled;
}
showPowers(DEFAULT_TUNING.powerUps);
const host = el<HTMLDivElement>("scene"),
  status = el<HTMLParagraphElement>("status"),
  start = el<HTMLButtonElement>("start"),
  reset = el<HTMLButtonElement>("reset"),
  retry = el<HTMLButtonElement>("retry");
const query = new URLSearchParams(location.search),
  muted = query.has("mute");
const store = sessionStore(() => sessionStorage);
let roomCode = query.get("room")?.trim().toUpperCase(),
  display = query.has("display"),
  selfId = "",
  creatorId = "",
  round = -1,
  restartRequested = false;
if (!roomCode || !validRoomCode(roomCode)) {
  roomCode = undefined;
  display = false;
}
let autoConnect = !!roomCode;
let connecting = false;
document.body.classList.toggle("display-only", display);
const effects = new EffectsAudio(muted, browserToneSink);
const radio = createRadio(
  document,
  import.meta.env.BASE_URL,
  new Audio(),
  muted,
);
const effectLabel = document.createElement("label"),
  effectVolume = document.createElement("input");
effectLabel.textContent = "Effects ";
effectVolume.type = "range";
effectVolume.min = "0";
effectVolume.max = "100";
effectVolume.value = "30";
effectVolume.disabled = muted;
effectVolume.setAttribute("aria-label", "Effects volume");
effectVolume.oninput = () =>
  effects.setVolume(Number(effectVolume.value) / 100);
effectLabel.append(effectVolume);
radio.element.append(effectLabel);
radio.element.dataset.radio = "";
el("status").after(radio.element);
document.addEventListener("pointerdown", () => effects.unlock());
document.addEventListener("keydown", () => effects.unlock());
el<HTMLAnchorElement>("home").href =
  import.meta.env.BASE_URL + (muted ? "?mute" : "");
el<HTMLAnchorElement>("study").href = `?showcase=1${muted ? "&mute" : ""}`;
const tuning = el<HTMLFormElement>("tuning");
const experiment = el<HTMLSelectElement>("experiment");
experiment.add(new Option("Arena ricochets · gentle", "ricochet"));
experiment.add(new Option("Arena ricochets · surge", "surge"));
const rulesSelect = el<HTMLSelectElement>("rules");
const mapSelect = el<HTMLSelectElement>("map");
let contestPhase = "";
const descriptions = {
  movement: "Explore the arena with jump and grapple.",
  target:
    "Aim at the brass effigy on a lower ledge. Hold until impact; release to rearm. Knock it off!",
  ball: "Split the amber orb into seven hits. The outlined field contains balls only: it cannot hold you or your hook.",
  ricochet:
    "Gentle arena ricochets: split orbs into smaller, faster colors. Ledges and walls bounce them; the line above the spikes rebounds balls only. Colors are cosmetic; balls do not hurt keepers.",
  surge:
    "Surge: twice the horizontal speed and higher bounces. Seven hits clear the family (up to four small orbs). The bottom line rebounds balls only; keepers still fall. Colors are cosmetic.",
};
for (const [key, [min, max]] of Object.entries(TUNING_BOUNDS)) {
  const label = document.createElement("label");
  // `pull` is the rope's reel-in speed since hook-havok-10.
  label.textContent =
    key === "pull" ? "Reel" : key[0]!.toUpperCase() + key.slice(1);
  const input = document.createElement("input");
  input.type = "number";
  input.name = key;
  input.min = String(min);
  input.max = String(max);
  input.step = "1";
  input.value = String(DEFAULT_TUNING[key as keyof typeof DEFAULT_TUNING]);
  label.append(input);
  tuning.append(label);
}
const apply = document.createElement("button");
apply.textContent = "Apply and restart";
apply.disabled = true;
tuning.append(apply);
const endpoints = createEndpoints(
  {
    basePath: `${import.meta.env.BASE_URL}hook-havok/`,
    apiOrigin: import.meta.env.VITE_API_ORIGIN,
  },
  location.origin,
);
let runtime: HookRuntime | undefined,
  scene: ShowcaseHandle | undefined,
  latest = toView(createWorld()),
  graphicsReady = false,
  attempt = 0,
  disposed = false,
  roomAttempt = 0;
let input: Input = { ...NEUTRAL };
let touch: TouchControls | undefined;
let mousePointer: number | undefined;
/** Mouse buttons held on the scene: 1 left (hook), 2 right (bomb). */
let mouseButtons = 0;
let touchState: TouchState | undefined;
const keyboard = new KeyboardInput();
host.dataset.controls = keyboard.mode;
let keyFire = false,
  keyBomb = false;
const chest = () => latest.feet - latest.body.height * 0.6;
const sampleKeyboard = () =>
  keyboard.sample(latest.x, chest(), (dx, dy) =>
    assistAim(latest.platforms, latest.x, chest(), dx, dy, latest.range),
  );
/** Merges keyboard intent; J or a left click holds the hook, K or a right click the bomb. */
function sampleKeys() {
  const sampled = sampleKeyboard();
  keyFire = sampled.fire ?? false;
  keyBomb = sampled.bomb ?? false;
  Object.assign(input, sampled);
  input.fire = keyFire || (mouseButtons & 1) !== 0;
  input.bomb = keyBomb || (mouseButtons & 2) !== 0;
}
/** Where a bomb released now would be aimed; drives the local arc preview only. */
function bombAim(): { x: number; y: number } | undefined {
  if (display) return;
  if (touchDeck.dataset.active === "true" && touchState) {
    const aim = touchAim(
      latest.x,
      chest(),
      bombDirection(touchState, latest.facing),
    );
    return { x: aim.aimX, y: aim.aimY };
  }
  if (keyboard.mode === "keyboard" && keyboard.aimSource === "keys") {
    const sampled = sampleKeyboard();
    if (sampled.aimX !== undefined && sampled.aimY !== undefined)
      return { x: sampled.aimX, y: sampled.aimY };
  }
  return { x: input.aimX, y: input.aimY };
}
let roomDeadline: ReturnType<typeof setTimeout> | undefined;
function clear() {
  const captured = mousePointer;
  mousePointer = undefined;
  mouseButtons = 0;
  keyFire = keyBomb = false;
  if (captured !== undefined && host.hasPointerCapture(captured))
    host.releasePointerCapture(captured);
  touch?.clear();
  keyboard.clear();
  input = { ...NEUTRAL, aimX: input.aimX, aimY: input.aimY };
  runtime?.clear();
}
function send() {
  runtime?.input(input);
}
const touchToggle = el<HTMLInputElement>("touch-toggle"),
  touchDeck = el("touch-deck"),
  bombButton = touchDeck.querySelector<HTMLElement>('[data-pad="bomb"]')!;
/** The bomb button dims while recharging and hides when bombs are off. */
function paintBombButton(view: WorldView) {
  const local = view.keepers.find((k) => k.id === selfId),
    off = view.bombMode === "off",
    ready = String(!!local && !local.cooldown);
  const control = bombButton.closest<HTMLElement>(".bomb-control")!;
  if (control.hidden !== off) control.hidden = off;
  if (bombButton.dataset.ready !== ready) bombButton.dataset.ready = ready;
}
touch = createTouchControls(
  touchDeck,
  (state) => {
    const wasFiring = input.fire,
      wasCharging = input.bomb,
      wasJumping = input.jump;
    touchState = state;
    input.move = state.move;
    input.jump = state.jump;
    input.drop = state.drop;
    input.fire = state.fire;
    input.bomb = state.bomb;
    if (state.fire && !wasFiring)
      Object.assign(input, touchAim(latest.x, chest(), state.direction));
    // The engine reads a throw's aim on the release tick, and a Dash bump's
    // on the jump press: both follow the aim pad's last direction.
    if ((wasCharging && !state.bomb) || (state.jump && !wasJumping))
      Object.assign(
        input,
        touchAim(latest.x, chest(), bombDirection(state, latest.facing)),
      );
    send();
  },
  clear,
);
function touchLayout() {
  clear();
  const enabled = touchToggle.checked;
  document.body.classList.toggle("touch-trial", enabled);
  touchDeck.hidden = !enabled;
  el("aim-label").hidden = !enabled;
  el("touch-help").hidden = !enabled;
  touch?.enable(enabled && status.dataset.state === "playing");
}
touchToggle.checked =
  query.has("touch") || matchMedia("(any-pointer: coarse)").matches;
touchToggle.onchange = touchLayout;
el<HTMLSelectElement>("aim-mode").onchange = (event) => {
  clear();
  touch?.mode(
    (event.target as HTMLSelectElement).value === "free" ? "free" : "eight",
  );
};
touchLayout();
window.addEventListener("resize", clear);
function sample(): WorldView {
  const timing = runtime?.frameTiming();
  if (!timing) return latest;
  return interpolate(
    timing.older && localView(timing.older),
    localView(timing.newer),
    timing.tick,
  );
}
function localView(view: WorldView): WorldView {
  const local = view.keepers.find((k) => k.id === selfId);
  return {
    ...(local?.body ?? view),
    keepers: view.keepers,
    hit: view.hit,
    contest: view.contest,
    powers: view.powers,
    pickups: view.pickups,
    pickupEvents: view.pickupEvents,
    shieldPops: view.shieldPops,
    bombs: view.bombs,
    blasts: view.blasts,
    knockouts: view.knockouts,
    localId: local?.id,
  };
}
function stopRoom() {
  matchShell.reset();
  knockoutFeed.reset();
  connecting = false;
  document.body.classList.remove("arena-focused");
  focusButton.textContent = "Focus arena";
  focusButton.setAttribute("aria-pressed", "false");
  focusButton.disabled = true;
  effects.pause();
  radio.pause();
  scene?.resetFeedback();
  roomAttempt++;
  clearTimeout(roomDeadline);
  clear();
  runtime?.stop();
  runtime = undefined;
  latest = toView(createWorld());
  paintRoster(latest, "");
  reset.disabled = true;
  apply.disabled = true;
  experiment.disabled = true;
  rulesSelect.disabled = true;
  mapSelect.disabled = true;
  jumpMode.disabled = wireMode.disabled = bombMode.disabled = true;
  enablePowers(false);
  touch?.enable(false);
  el<HTMLButtonElement>("restart-room").disabled = true;
  el("invitation").hidden = true;
}
function fail(message: string) {
  stopRoom();
  status.textContent = message;
  status.dataset.state = "error";
  start.disabled = !graphicsReady;
  start.textContent = "Retry connection";
  entrance.show();
  entrance.busy(false, graphicsReady);
}
async function graphics() {
  scene?.destroy();
  scene = undefined;
  graphicsReady = false;
  start.disabled = true;
  retry.hidden = true;
  entrance.show();
  entrance.busy(true, false);
  const token = ++attempt;
  const deadline = setTimeout(() => {
    if (token === attempt) {
      attempt++;
      scene?.destroy();
      scene = undefined;
      retry.hidden = false;
      fail("Graphics timed out. Retry graphics to try again.");
    }
  }, 15000);
  try {
    const { createShowcase } = await import("../render/scene.js");
    if (token !== attempt || disposed) return;
    scene = createShowcase(host, {
      paused: false,
      idleOnly: false,
      atmosphere: el<HTMLInputElement>("atmosphere").checked,
      view: sample,
      debug: () => el<HTMLInputElement>("debug").checked,
      keyboardAim: () =>
        !display &&
        keyboard.mode === "keyboard" &&
        keyboard.aimSource === "keys"
          ? keyboard.direction
          : undefined,
      bombAim,
      cue: (cue) => effects.cue(cue),
      ready() {
        if (token !== attempt) return;
        clearTimeout(deadline);
        graphicsReady = true;
        start.disabled = false;
        el<HTMLButtonElement>("join-room").disabled = false;
        el<HTMLButtonElement>("new-room").disabled = false;
        status.textContent = "Ready when you are.";
        status.dataset.state = "ready";
        start.textContent = roomCode ? "Enter room" : "Create room";
        entrance.busy(false, true);
        if (autoConnect) {
          autoConnect = false;
          start.click();
        }
      },
      failed(message) {
        if (token !== attempt) return;
        clearTimeout(deadline);
        graphicsReady = false;
        attempt++;
        scene?.destroy();
        scene = undefined;
        retry.hidden = false;
        fail(message);
      },
      phase: (label) => (el("phase").textContent = label),
      time: () => {},
    });
  } catch {
    clearTimeout(deadline);
    if (token === attempt) {
      retry.hidden = false;
      fail("Could not load the renderer.");
    }
  }
}
const enterRoom = async () => {
  if (connecting || !graphicsReady || disposed) return;
  stopRoom();
  connecting = true;
  entrance.show();
  entrance.busy(true, true);
  el<HTMLButtonElement>("new-room").disabled = true;
  round = -1;
  contestPhase = "";
  selfId = "";
  creatorId = "";
  experiment.value = DEFAULT_TUNING.experiment;
  rulesSelect.value = DEFAULT_TUNING.rules;
  mapSelect.value = DEFAULT_TUNING.map;
  jumpMode.value = DEFAULT_TUNING.jumpMode;
  wireMode.value = DEFAULT_TUNING.wire;
  bombMode.value = DEFAULT_TUNING.bomb;
  shownPowers = -1;
  showPowers(DEFAULT_TUNING.powerUps);
  for (const key of Object.keys(TUNING_BOUNDS)) {
    const field = tuning.elements.namedItem(key) as HTMLInputElement;
    field.value = String(DEFAULT_TUNING[key as keyof typeof DEFAULT_TUNING]);
  }
  effects.unlock();
  start.disabled = true;
  status.textContent = roomCode ? "Joining the belfry…" : "Opening your room…";
  status.dataset.state = "loading";
  const token = ++roomAttempt;
  try {
    const room = roomCode
      ? {
          code: roomCode,
          token: sessionToken(store, roomCode, display, memberToken),
        }
      : await createRoom(
          endpoints.apiUrl,
          (url, init) =>
            fetch(url, { ...init, signal: AbortSignal.timeout(10000) }),
          "hook-havok",
        );
    if (disposed || token !== roomAttempt || !graphicsReady) return;
    if (!roomCode) saveCreator(store, room.code, room.token);
    roomCode = room.code;
    history.replaceState(
      null,
      "",
      inviteUrl(location.href, room.code, display),
    );
    el<HTMLInputElement>("room-code").value = room.code;
    el<HTMLInputElement>("invite-url").value = inviteUrl(
      location.href,
      room.code,
    );
    el<HTMLAnchorElement>("display-link").href = inviteUrl(
      location.href,
      room.code,
      true,
    );
    el("invitation").hidden = false;
    let joined = false,
      started = false;
    runtime = new HookRuntime(
      room.code,
      DEFAULT_TUNING,
      {
        ready(id) {
          selfId = id;
        },
        event() {},
        status: (text) => {
          status.textContent = text;
        },
        state(frame, settings) {
          latest = localView(frame);
          const c = frame.contest;
          const localKeeper = frame.keepers.find((k) => k.id === selfId);
          const controllable =
            c.rules === "free" ||
            (c.phase === "active" && !!localKeeper?.playing);
          if (contestPhase !== c.phase) {
            contestPhase = c.phase;
            clear();
            // Preserve the final hit/exit transition when results arrive.
            if (c.phase !== "over") scene?.resetFeedback();
          }
          const local = frame.seats.find((s) => s.id === selfId),
            manager =
              !display &&
              (runtime?.creator ||
                roomManager(frame.seats, creatorId) === selfId);
          if (round !== frame.round) {
            round = frame.round;
            for (const key of Object.keys(TUNING_BOUNDS)) {
              const field = tuning.elements.namedItem(key) as HTMLInputElement;
              field.value = String(settings[key as keyof typeof settings]);
            }
            clear();
            scene?.resetFeedback();
          }
          touch?.enable(
            !display &&
              touchToggle.checked &&
              frame.stage === "running" &&
              controllable &&
              !!local?.connected,
          );
          paintBombButton(frame);
          if (!display && !joined) {
            joined = !!runtime?.command({
              type: "join",
              name:
                el<HTMLInputElement>("keeper-name").value.trim() ||
                "Lantern keeper",
            });
          }
          if (restartRequested && frame.stage === "lobby") {
            started = false;
            restartRequested = false;
          }
          if (manager && frame.stage === "lobby" && frame.seated && !started) {
            started = !!runtime?.command({ type: "action", action: "start" });
          }
          if (frame.stage === "running") {
            connecting = false;
            entrance.play();
            el<HTMLButtonElement>("new-room").disabled = false;
            el<HTMLButtonElement>("join-room").disabled = false;
            focusButton.disabled = false;
            clearTimeout(roomDeadline);
            status.dataset.state =
              display || local?.connected ? "playing" : "joining";
            setText(
              status,
              ["ball", "ricochet", "surge"].includes(frame.experiment) &&
                !frame.combat.balls.length
                ? "Field cleared. Restart the experiment to try again."
                : descriptions[frame.experiment],
            );
            reset.disabled = display || !local?.connected || c.rules !== "free";
            setText(
              reset,
              c.rules === "free"
                ? "Restart experiment"
                : "Reset disabled in rounds",
            );
            apply.disabled = !manager;
            experiment.disabled = !manager;
            rulesSelect.disabled = !manager;
            mapSelect.disabled = !manager;
            jumpMode.disabled =
              wireMode.disabled =
              bombMode.disabled =
                !manager;
            enablePowers(!!manager);
            el<HTMLButtonElement>("restart-room").disabled = !manager;
            setText(
              start,
              display ? "Shared display connected" : "Room running",
            );
            if (!display && !local)
              setText(
                status,
                frame.seats.length >= 5
                  ? "This room has five keepers. Open the shared display to watch, or join another room."
                  : "Joining the keepers…",
              );
          }
          experiment.value = settings.experiment;
          rulesSelect.value = settings.rules;
          mapSelect.value = settings.map;
          jumpMode.value = settings.jumpMode;
          wireMode.value = settings.wire;
          bombMode.value = settings.bomb;
          showPowers(settings.powerUps);
          setText(
            mapHelp,
            settings.map === "crossroads"
              ? "Crossroads · separated starts, outer climbs and a central grapple route. Changing arena restarts everyone."
              : "Lantern Belfry · the original climbing course. Changing arena restarts everyone.",
          );
          setText(
            el("rules-help"),
            c.rules === "free"
              ? "Respawn freely and explore."
              : c.rules === "elimination"
                ? "A fall or a bomb knockout puts you out. Last keeper wins · 60-second limit."
                : "Hook hit +1 · bomb knockout +1 · own bomb −1 more · fall or knockout −2 · respawn · highest score after 60 seconds. Props give no points. Last remaining entrant wins if others forfeit.",
          );
          const names = (ids: string[]) =>
            ids
              .map(
                (id) =>
                  `P${(c.entries.find((e) => e.id === id)?.slot ?? 0) + 1} ${frame.keepers.find((k) => k.id === id)?.name ?? "Keeper"}`,
              )
              .join(" & ");
          setText(
            el("round-status"),
            c.rules === "free"
              ? ""
              : c.phase === "waiting"
                ? "Waiting for a second keeper…"
                : c.phase === "countdown"
                  ? `Get ready · ${c.seconds}`
                  : c.phase === "over"
                    ? `${c.winners.length ? `${names(c.winners)} ${c.winners.length > 1 ? "share the win" : "wins"}` : "Draw — no keepers remain"}. ${manager ? "Choose Play again in Results for another round." : "Waiting for the room manager to start another round."}`
                    : `${c.seconds}s remaining${!display && !localKeeper?.playing ? " · Watching until the next round" : ""}`,
          );
          host.dataset.contest = JSON.stringify(c);
          host.dataset.round = String(frame.round);
          paintRoster(frame, selfId);
          knockoutFeed.update(frame, frame.round);
          matchShell.update(
            frame,
            selfId,
            !!manager,
            display,
            frame.round,
            room.code,
          );
          host.dataset.playerId = selfId;
          setText(el("experiment-help"), descriptions[frame.experiment]);
          setText(
            el("counter"),
            frame.experiment === "movement"
              ? `RETURNS ${latest.deaths}`
              : frame.experiment === "target"
                ? `HITS ${frame.combat.hits} · FALLS ${frame.combat.falls}`
                : `HITS ${frame.combat.hits}/7 · ORBS ${frame.combat.balls.length}`,
          );
        },
        ended: () => fail("The room ended. You can start again."),
        kicked: () => fail("The room closed. You can start again."),
      },
      {
        displayOnly: display,
        transport: (events) =>
          new PeerTransport(
            room.code,
            room.token,
            {
              ...events,
              welcome(id, creator) {
                creatorId = creator;
                events.welcome(id, creator);
              },
            },
            {
              apiUrl: endpoints.apiUrl,
              gameId: "hook-havok",
              maxFastBytes: MAX_PACKET_BYTES,
            },
          ),
      },
    );
    roomDeadline = setTimeout(() => {
      if (token === roomAttempt)
        fail("The room could not connect. Try entering again.");
    }, 15000);
    runtime.start();
    host.focus();
  } catch (error) {
    if (!disposed && token === roomAttempt)
      fail(
        error instanceof Error
          ? error.message
          : "Could not open a room. Try again.",
      );
  }
};
start.onclick = enterRoom;
el("new-room").onclick = () => {
  roomCode = undefined;
  display = false;
  document.body.classList.remove("display-only");
  void enterRoom();
};
el("join-room").onclick = () => {
  const code = el<HTMLInputElement>("room-code").value.trim().toUpperCase();
  if (!validRoomCode(code)) {
    status.textContent = "Enter a valid room code.";
    entrance.joinError("Enter a valid room code from your friend's invite.");
    return;
  }
  entrance.joinError("");
  roomCode = code;
  display = false;
  document.body.classList.remove("display-only");
  void enterRoom();
};
el("restart-room").onclick = () => {
  clear();
  restartRequested = !!runtime?.command({ type: "action", action: "lobby" });
};
el("leave-room").onclick = () => {
  stopRoom();
  roomCode = undefined;
  display = false;
  const url = new URL(location.href);
  url.searchParams.delete("room");
  url.searchParams.delete("display");
  location.href = url.href;
};
el("copy-invite").onclick = async () => {
  const field = el<HTMLInputElement>("invite-url");
  try {
    await navigator.clipboard.writeText(field.value);
    status.textContent = "Invite link copied.";
  } catch {
    field.focus();
    field.select();
    status.textContent = "Select and copy this invite link.";
  }
};
function resetExercise() {
  scene?.resetFeedback();
  clear();
  input.reset = true;
  send();
  input.reset = false;
  send();
  host.focus();
}
reset.onclick = resetExercise;
tuning.onsubmit = (e) => {
  e.preventDefault();
  const settings = parseTuning(
    Object.fromEntries(
      [...new FormData(tuning)].map(([k, v]) => [
        k,
        ["experiment", "rules", "map", "jumpMode", "wire", "bomb"].includes(k)
          ? v
          : Number(v),
      ]),
    ),
  );
  if (settings) {
    scene?.resetFeedback();
    clear();
    runtime?.command({ type: "settings", settings });
    host.focus();
  }
};
experiment.onchange = () => tuning.requestSubmit();
rulesSelect.onchange = () => tuning.requestSubmit();
mapSelect.onchange = () => tuning.requestSubmit();
jumpMode.onchange =
  wireMode.onchange =
  bombMode.onchange =
    () => tuning.requestSubmit();
powerMode.onchange = () => {
  // "Some" only names a mixed pool; the boxes change it.
  if (powerMode.value === "custom") return;
  powerMask.value = powerMode.value;
  tuning.requestSubmit();
};
for (const input of powerInputs)
  input.onchange = () => {
    powerMask.value = String(
      powerInputs.reduce(
        (mask, box) => (box.checked ? mask | Number(box.dataset.bit) : mask),
        0,
      ),
    );
    tuning.requestSubmit();
  };
keyboardMode.onchange = () => {
  clear();
  keyboard.mode = keyboardMode.value === "keyboard" ? "keyboard" : "mouse";
  el("control-help").textContent =
    keyboard.mode === "keyboard"
      ? KEYS_SHORT
      : "Mouse aims · left click hooks · right click bombs · Space jumps · S / ↓ drops.";
  host.dataset.controls = keyboard.mode;
  document.querySelector(".desktop-help")!.textContent =
    keyboard.mode === "keyboard" ? KEYS_HELP : mouseHelp;
  host.focus();
};
retry.onclick = () => void graphics();
el<HTMLInputElement>("atmosphere").checked = !matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;
el<HTMLInputElement>("atmosphere").onchange = (e) =>
  scene?.setAtmosphere((e.target as HTMLInputElement).checked);
host.addEventListener("keydown", (e) => {
  if (!keyboard.accepts(e.code)) return;
  e.preventDefault();
  if (e.repeat) return;
  if (touchDeck.dataset.active === "true") clear();
  keyboard.key(e.code, true);
  sampleKeys();
  send();
});
host.addEventListener("keyup", (e) => {
  if (!keyboard.accepts(e.code)) return;
  keyboard.key(e.code, false);
  if (touchDeck.dataset.active === "true") return;
  sampleKeys();
  send();
});
function aim(e: PointerEvent) {
  const box = host.querySelector("canvas")?.getBoundingClientRect();
  if (!box) return;
  input.aimX = Math.round(
    Math.max(0, Math.min(1600, ((e.clientX - box.left) * 1600) / box.width)),
  );
  input.aimY = Math.round(
    Math.max(0, Math.min(900, ((e.clientY - box.top) * 900) / box.height)),
  );
}
host.addEventListener("pointermove", (e) => {
  if (e.pointerType !== "mouse") return;
  if (keyboard.mode === "keyboard" && keyboard.aimSource === "keys") return;
  aim(e);
});
/**
 * Left holds the hook, right charges a bomb. A second button pressed or
 * released while the first is held arrives as a pointermove, so every mouse
 * event reconciles `buttons`. Aim travels with each change: the hook reads
 * it on the press, the bomb on the release.
 */
function mouseButtonsChanged(buttons: number): boolean {
  buttons &= 3;
  if (buttons === mouseButtons) return false;
  mouseButtons = buttons;
  input.fire = keyFire || (buttons & 1) !== 0;
  input.bomb = keyBomb || (buttons & 2) !== 0;
  return true;
}
host.addEventListener("contextmenu", (e) => e.preventDefault());
host.addEventListener("pointerdown", (e) => {
  if ((e.button !== 0 && e.button !== 2) || e.pointerType !== "mouse") return;
  if (touchDeck.dataset.active === "true") clear();
  e.preventDefault();
  host.focus();
  keyboard.aimSource = "mouse";
  mousePointer = e.pointerId;
  host.setPointerCapture(e.pointerId);
  aim(e);
  mouseButtonsChanged(e.buttons || (e.button === 2 ? 2 : 1));
  send();
});
host.addEventListener("pointermove", (e) => {
  if (e.pointerId !== mousePointer || !mouseButtonsChanged(e.buttons)) return;
  aim(e);
  send();
});
function releaseMouse(e: PointerEvent) {
  if (e.pointerId !== mousePointer) return;
  mousePointer = undefined;
  if (e.type === "pointerup" && keyboard.aimSource === "mouse") aim(e);
  mouseButtonsChanged(0);
  send();
}
host.addEventListener("pointerup", releaseMouse);
host.addEventListener("pointercancel", releaseMouse);
host.addEventListener("lostpointercapture", releaseMouse);
host.addEventListener("blur", clear);
window.addEventListener("blur", clear);
window.addEventListener("blur", () => {
  effects.pause();
  radio.pause();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    clear();
    effects.pause();
    radio.pause();
  }
});
window.addEventListener("pagehide", () => {
  effects.destroy();
  radio.destroy();
  disposed = true;
  attempt++;
  roomAttempt++;
  stopRoom();
  touch?.destroy();
  scene?.destroy();
  entrance.destroy();
});
window.addEventListener("pageshow", (e) => {
  if (e.persisted) location.reload();
});
const matchShell = createMatchShell();
const knockoutFeed = createKnockoutFeed(document.querySelector(".stage")!);
const entrance = createEntrance({
  main: document.querySelector("main")!,
  start,
  status,
  retry,
  name: el<HTMLInputElement>("keeper-name"),
  code: el<HTMLInputElement>("room-code"),
  join: el<HTMLButtonElement>("join-room"),
  radio: radio.element,
  atmosphere: el<HTMLInputElement>("atmosphere"),
  touch: touchToggle,
  controls: keyboardMode,
  fresh() {
    roomCode = undefined;
    display = false;
    document.body.classList.remove("display-only");
    void enterRoom();
  },
});
start.textContent = "Create room";
void graphics();
