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
import { toView, type WorldView } from "../engine/view.js";
import type { ShowcaseHandle } from "../render/scene.js";
import { interpolate } from "../render/interpolation.js";
import { createTouchControls, type TouchControls } from "./touch-controls.js";
import { touchAim } from "./touch-input.js";
import { createRoster } from "./roster.js";
import { createEntrance } from "./entrance.js";
import { KeyboardInput } from "./keyboard-input.js";
import { createMatchShell } from "./match-shell.js";
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
<section id="touch-deck" aria-label="Touch controls" hidden><div class="thumb-control move-control"><div class="thumb-pad" data-pad="move" aria-label="Move pad: slide left or right, slide up to jump"><span class="pad-cross">↔</span><span class="thumb-knob"></span></div><span>MOVE · UP TO JUMP</span></div><div class="thumb-control aim-control"><div class="thumb-pad" data-pad="aim" aria-label="Hook pad: drag from center to aim and fire, release to let go"><span class="pad-cross">✧</span><span class="thumb-knob"></span></div><span>AIM · HOLD TO HOOK</span></div></section></div>
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
  "Left thumb: sideways to move, up to jump, down to drop through a ledge. Release down before dropping again. Right thumb: drag from center to aim and fire, hold to pull, release to let go.";
const mouseHelp =
  "A / D or ← / → to move · Space to jump through ledges · S / ↓ to drop through (one press per ledge) · Mouse to aim · Hold left mouse to hook and pull · Release to let go · R to reset. Click the scene to focus.";
document.querySelector(".desktop-help")!.textContent = mouseHelp;
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
trials.innerHTML = `<label>Jump <select id="jump-mode" name="jumpMode" form="tuning" disabled><option value="single">Single jump</option><option value="double">Double jump</option></select></label><label>Tether <select id="wire-mode" name="wire" form="tuning" disabled><option value="tip">Hook tip only</option><option value="spiked">Spiked wire</option></select></label><label>Your controls <select id="keyboard-mode"><option value="mouse">Mouse aim</option><option value="keyboard">Keyboard · J / K</option></select></label><span id="control-help">Mouse aims · Space jumps · S / ↓ drops.</span>`;
rulesPanel.after(trials);
const trialHelp = document.createElement("span");
trialHelp.textContent =
  "Jump / Tether changes restart the shared trial. Double jump: one extra leap before landing. Spiked wire: balls split on contact and the shot ends; rivals and the brass target still need the tip.";
trials.append(trialHelp);
const jumpMode = el<HTMLSelectElement>("jump-mode"),
  wireMode = el<HTMLSelectElement>("wire-mode"),
  keyboardMode = el<HTMLSelectElement>("keyboard-mode");
const powerLabel = document.createElement("label");
powerLabel.innerHTML = `Power-ups <select id="power-ups" name="powerUps" form="tuning" disabled><option value="off">Off</option><option value="on">Lift & Ward</option></select>`;
rulesPanel.append(powerLabel);
const powerMode = el<HTMLSelectElement>("power-ups");
const powerHelp = document.createElement("p");
powerHelp.id = "power-help";
powerHelp.textContent =
  "Lift: touch the green rune for an upward burst. Ward: blue rune blocks rival hooks for 5 seconds, not falls. Pads return after 10 seconds of active play. Changing this setting restarts everyone.";
powerHelp.hidden = true;
rulesPanel.append(powerHelp);
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
  label.textContent = key[0]!.toUpperCase() + key.slice(1);
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
const keyboard = new KeyboardInput();
let roomDeadline: ReturnType<typeof setTimeout> | undefined;
function clear() {
  const captured = mousePointer;
  mousePointer = undefined;
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
  touchDeck = el("touch-deck");
touch = createTouchControls(
  touchDeck,
  (state) => {
    const wasFiring = input.fire;
    input.move = state.move;
    input.jump = state.jump;
    input.drop = state.drop;
    input.fire = state.fire;
    if (state.fire && !wasFiring)
      Object.assign(
        input,
        touchAim(
          latest.x,
          latest.feet - latest.body.height * 0.6,
          state.direction,
        ),
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
    pickups: view.pickups,
    pickupEvents: view.pickupEvents,
    localId: local?.id,
  };
}
function stopRoom() {
  matchShell.reset();
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
  jumpMode.disabled = wireMode.disabled = true;
  powerMode.disabled = true;
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
        !display && keyboard.mode === "keyboard"
          ? keyboard.direction
          : undefined,
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
  powerMode.value = DEFAULT_TUNING.powerUps;
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
            jumpMode.disabled = wireMode.disabled = !manager;
            powerMode.disabled = !manager;
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
          powerMode.value = settings.powerUps;
          powerHelp.hidden = settings.powerUps !== "on";
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
                ? "A fall puts you out. Last keeper wins · 60-second limit."
                : "Player hit +1 · fall −2 · respawn · highest score after 60 seconds. Props give no points. Last remaining entrant wins if others forfeit.",
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
        ["experiment", "rules", "map", "jumpMode", "wire", "powerUps"].includes(
          k,
        )
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
jumpMode.onchange = wireMode.onchange = () => tuning.requestSubmit();
powerMode.onchange = () => tuning.requestSubmit();
keyboardMode.onchange = () => {
  clear();
  keyboard.mode = keyboardMode.value === "keyboard" ? "keyboard" : "mouse";
  el("control-help").textContent =
    keyboard.mode === "keyboard"
      ? "WASD / arrows aim (last direction stays) · J / Space jumps · hold K to hook, release to rearm · Shift+S or Shift+↓ drops."
      : "Mouse aims · Space jumps · S / ↓ drops.";
  host.dataset.controls = keyboard.mode;
  document.querySelector(".desktop-help")!.textContent =
    keyboard.mode === "keyboard"
      ? "A / D or ← / → to move · WASD / arrows aim in eight directions · J / Space to jump · Hold K to hook and pull · Release K to rearm · Shift+S or Shift+↓ to drop · R to reset. Click the scene to focus."
      : mouseHelp;
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
  Object.assign(
    input,
    keyboard.sample(latest.x, latest.feet - latest.body.height * 0.6),
  );
  send();
});
host.addEventListener("keyup", (e) => {
  if (!keyboard.accepts(e.code)) return;
  keyboard.key(e.code, false);
  if (touchDeck.dataset.active === "true") return;
  Object.assign(
    input,
    keyboard.sample(latest.x, latest.feet - latest.body.height * 0.6),
  );
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
  if (e.pointerType !== "mouse" || keyboard.mode === "keyboard") return;
  aim(e);
});
host.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || e.pointerType !== "mouse") return;
  if (touchDeck.dataset.active === "true") clear();
  e.preventDefault();
  host.focus();
  if (keyboard.mode === "keyboard") return;
  mousePointer = e.pointerId;
  host.setPointerCapture(e.pointerId);
  aim(e);
  input.fire = true;
  send();
});
function releaseMouse(e: PointerEvent) {
  if (e.pointerId !== mousePointer) return;
  mousePointer = undefined;
  input.fire = false;
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
