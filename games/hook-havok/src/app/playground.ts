import "./style.css";
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
let autoConnect = !!roomCode && validRoomCode(roomCode);
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
el("status").after(radio.element);
document.addEventListener("pointerdown", () => effects.unlock());
document.addEventListener("keydown", () => effects.unlock());
el<HTMLAnchorElement>("home").href =
  import.meta.env.BASE_URL + (muted ? "?mute" : "");
el<HTMLAnchorElement>("study").href = `?showcase=1${muted ? "&mute" : ""}`;
const tuning = el<HTMLFormElement>("tuning");
const experiment = el<HTMLSelectElement>("experiment");
const descriptions = {
  movement: "Explore the eight ledges with jump and grapple.",
  target:
    "Aim at the brass effigy on the first ledge. Hold until impact; release to rearm. Knock it off!",
  ball: "Split the amber orb into seven hits. The outlined field contains balls only: it cannot hold you or your hook.",
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
const keys = new Set<string>();
let roomDeadline: ReturnType<typeof setTimeout> | undefined;
function clear() {
  const captured = mousePointer;
  mousePointer = undefined;
  if (captured !== undefined && host.hasPointerCapture(captured))
    host.releasePointerCapture(captured);
  touch?.clear();
  keys.clear();
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
    localId: local?.id,
  };
}
function stopRoom() {
  effects.pause();
  radio.pause();
  scene?.resetFeedback();
  roomAttempt++;
  clearTimeout(roomDeadline);
  clear();
  runtime?.stop();
  runtime = undefined;
  latest = toView(createWorld());
  reset.disabled = true;
  apply.disabled = true;
  experiment.disabled = true;
  touch?.enable(false);
  el<HTMLButtonElement>("restart-room").disabled = true;
  el("invitation").hidden = true;
}
function fail(message: string) {
  stopRoom();
  status.textContent = message;
  status.dataset.state = "error";
  start.disabled = !graphicsReady;
  start.textContent = "Retry entering the belfry";
}
async function graphics() {
  scene?.destroy();
  scene = undefined;
  graphicsReady = false;
  start.disabled = true;
  retry.hidden = true;
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
      atmosphere: !matchMedia("(prefers-reduced-motion: reduce)").matches,
      view: sample,
      debug: () => el<HTMLInputElement>("debug").checked,
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
  stopRoom();
  round = -1;
  selfId = "";
  creatorId = "";
  experiment.value = DEFAULT_TUNING.experiment;
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
            clearTimeout(roomDeadline);
            status.dataset.state =
              display || local?.connected ? "playing" : "joining";
            status.textContent =
              frame.experiment === "ball" && !frame.combat.balls.length
                ? "Field cleared. Restart the experiment to try again."
                : descriptions[frame.experiment];
            reset.disabled = display || !local?.connected;
            apply.disabled = !manager;
            experiment.disabled = !manager;
            el<HTMLButtonElement>("restart-room").disabled = !manager;
            start.textContent = display
              ? "Shared display connected"
              : "Room running";
            if (!display && !local)
              status.textContent =
                frame.seats.length >= 5
                  ? "This room has five keepers. Open the shared display to watch, or join another room."
                  : "Joining the keepers…";
          }
          experiment.value = settings.experiment;
          el("roster").textContent = frame.keepers
            .map(
              (k) =>
                `P${k.slot + 1} ${k.name}${k.id === selfId ? " (you)" : ""}${k.connected ? "" : " · away"} · hits ${k.hits} · returns ${k.body.deaths}`,
            )
            .join("  |  ");
          host.dataset.playerId = selfId;
          el("experiment-help").textContent = descriptions[frame.experiment];
          el("counter").textContent =
            frame.experiment === "movement"
              ? `RETURNS ${latest.deaths}`
              : frame.experiment === "target"
                ? `HITS ${frame.combat.hits} · FALLS ${frame.combat.falls}`
                : `HITS ${frame.combat.hits}/7 · ORBS ${frame.combat.balls.length}`;
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
    return;
  }
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
        k === "experiment" ? v : Number(v),
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
retry.onclick = () => void graphics();
el<HTMLInputElement>("atmosphere").checked = !matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;
el<HTMLInputElement>("atmosphere").onchange = (e) =>
  scene?.setAtmosphere((e.target as HTMLInputElement).checked);
host.addEventListener("keydown", (e) => {
  if (
    !["KeyA", "KeyD", "ArrowLeft", "ArrowRight", "Space", "KeyR"].includes(
      e.code,
    )
  )
    return;
  e.preventDefault();
  if (touchDeck.dataset.active === "true") clear();
  keys.add(e.code);
  input.move = (Number(keys.has("KeyD") || keys.has("ArrowRight")) -
    Number(keys.has("KeyA") || keys.has("ArrowLeft"))) as Input["move"];
  input.jump = keys.has("Space");
  input.reset = keys.has("KeyR");
  send();
});
host.addEventListener("keyup", (e) => {
  keys.delete(e.code);
  if (touchDeck.dataset.active === "true") return;
  input.move = (Number(keys.has("KeyD") || keys.has("ArrowRight")) -
    Number(keys.has("KeyA") || keys.has("ArrowLeft"))) as Input["move"];
  input.jump = keys.has("Space");
  input.reset = keys.has("KeyR");
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
  aim(e);
});
host.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || e.pointerType !== "mouse") return;
  if (touchDeck.dataset.active === "true") clear();
  e.preventDefault();
  host.focus();
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
});
window.addEventListener("pageshow", (e) => {
  if (e.persisted) location.reload();
});
void graphics();
