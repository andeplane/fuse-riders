import { elementsFor } from "fuse-ui";
import type { BallRuntime } from "../online/runtime.js";
import type { ArenaRenderer } from "../render/arena.js";
import type { Callbacks } from "fuse-netcode";
import type { RoomView, Settings } from "../online/game.js";
import type { Impact } from "../engine/view.js";
import { colorCss, interpolate } from "../render/present.js";
import type { BallView } from "../engine/view.js";
import { view } from "../engine/view.js";
import { createArena } from "../engine/state.js";
import { Controls, keyboardButton, gameplayKey } from "./controls.js";
import type { Audio } from "./audio.js";
import { present } from "./presenter.js";
import { roomPanel } from "./room-panel.js";
import { roomModel } from "./room-model.js";
import { NAME_KEY, roomFailure, type Store } from "./session.js";
import { chosenAvatar } from "./avatars.js";
import type { Radio } from "./radio.js";

export type Client = Pick<
  BallRuntime,
  | "start"
  | "stop"
  | "cancel"
  | "input"
  | "command"
  | "frameTiming"
  | "self"
  | "canManage"
>;
export interface ScreenOptions {
  online?: {
    code: string;
    display: boolean;
    shared: boolean;
    link: string;
    displayLink: string;
  };
  store: Store;
  settings: Settings;
  qr(link: string): Promise<string>;
  audio: Pick<Audio, "muted" | "unlock" | "play" | "destroy">;
  radio?: Radio;
  renderer(parent: HTMLElement): ArenaRenderer;
  runtime(callbacks: Callbacks<RoomView, Impact, Settings>): Client;
  now(): number;
  frame(callback: (now: number) => void): number;
  cancelFrame(id: number): void;
  events: EventTarget;
  home(): void;
  retry(): void;
}
export function mountGame(root: HTMLElement, options: ScreenOptions) {
  const document = root.ownerDocument,
    el = elementsFor(document);
  const abort = new AbortController(),
    signal = abort.signal;
  const audio = options.audio;
  const top = el("header", "", "topbar"),
    home = el("a", "← FUSE ARCADE", "back");
  home.href = "../";
  const badge = el(
    "span",
    options.online ? `ROOM ${options.online.code}` : "SOLO + 4 BOTS",
    "eyebrow",
  );
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
  if (options.radio) top.append(options.radio.element);
  const retry = el("button", "RECONNECT", "quiet-button");
  retry.hidden = !options.online;
  retry.onclick = () => {
    cancel();
    runtime?.stop();
    options.retry();
  };
  const leave = el("button", "LEAVE", "quiet-button");
  leave.onclick = () => {
    cancel();
    runtime?.stop();
    options.home();
  };
  top.append(retry, leave);
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
    mapName = el("p", "CLASSIC CIRCUIT", "map-name"),
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
    mapName,
    status,
    instructions,
    keys,
    restart,
    el(
      "p",
      "Your ball collects powers for you. Shrink rivals · Bomb armor / stun paddles · Sticky catches · Thief repairs · Split doubles.",
      "footnote",
    ),
  );
  layout.append(arenaBox, side);
  const controlsRow = el("div", "", "touch-controls");
  root.append(top, heading, scoreboard, layout, controlsRow);
  let renderer = options.renderer(canvasHost),
    graphicsFailed = false;
  let runtime: Client | undefined,
    latest: BallView | undefined,
    frame = 0,
    playing = false;
  let shared = options.online?.shared ?? false,
    activeSettings = options.settings,
    lastMatch = "",
    stopped = false,
    joined = false;
  const panel = options.online
    ? roomPanel(root, {
        ...options.online,
        store: options.store,
        qr: options.qr,
        command: (command) => runtime?.command(command),
      })
    : undefined;
  if (panel) {
    layout.hidden = true;
    scoreboard.hidden = true;
    controlsRow.hidden = true;
    root.insertBefore(panel.element, layout);
    root.insertBefore(status, heading);
    status.classList.add("room-status");
  }
  const returnLobby = el("button", "BACK TO LOBBY", "quiet-button");
  returnLobby.hidden = true;
  returnLobby.onclick = () =>
    runtime?.command({ type: "action", action: "lobby" });
  overlay.append(returnLobby);
  const identity = el("p", "", "controller-identity");
  root.insertBefore(identity, controlsRow);
  const powers = el("p", "", "power-status");
  powers.setAttribute("aria-live", "polite");
  root.insertBefore(powers, controlsRow);
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
      const target =
        e.target && "closest" in e.target
          ? (e.target as HTMLElement)
          : undefined;
      const action = gameplayKey(
        e.code,
        !!(
          target?.isContentEditable ||
          target?.closest("input, textarea, select")
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
  options.events.addEventListener("blur", cancel, { signal });
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.hidden) cancel();
    },
    { signal },
  );

  let previousHud = "";
  function update(v: BallView | RoomView): void {
    latest = v;
    root.dataset.phase = "stage" in v ? v.stage : (v.arena?.phase ?? "loading");
    if ("stage" in v && options.online) {
      const m = roomModel(
        v,
        runtime?.self ?? "",
        runtime?.canManage ?? false,
        options.online.display,
        shared,
        activeSettings,
      );
      panel!.render(m);
      const remembered = options.store.getItem(NAME_KEY);
      if (m.askName && remembered && !joined) {
        joined = true;
        runtime?.command({
          type: "join",
          name: remembered,
          avatarId: chosenAvatar(options.store),
        });
      }
      if ((lastMatch && lastMatch !== v.matchId) || (playing && !m.controls))
        cancel();
      lastMatch = v.matchId;
      playing = m.controls;
      layout.hidden = m.lobby;
      scoreboard.hidden = m.lobby;
      controlsRow.hidden = !m.controls;
      root.classList.toggle("in-match", !m.lobby);
      root.classList.toggle("controller-mode", m.controller);
      options.radio?.enable(!shared || options.online.display);
      root.classList.toggle("display-mode", options.online.display);
      identity.textContent = m.name;
      identity.style.color = m.slot === undefined ? "" : colorCss(m.slot);
      identity.hidden = m.lobby || options.online.display;
      restart.hidden = true;
      start.hidden = !m.manage;
      returnLobby.hidden = !m.over || !m.manage;
      overlay.hidden = !m.over;
      if (m.lobby) {
        powers.textContent = "";
        powers.hidden = true;
        previousHud = "";
        return;
      }
      if (m.note) status.textContent = m.note;
    }
    const model = present(
      v,
      options.online ? (runtime?.self ?? "") : undefined,
    );
    if (!model) return;
    const key = JSON.stringify(model);
    if (key === previousHud) return;
    previousHud = key;
    cards.forEach((c) => (c.hidden = true));
    for (const player of model.cards) {
      const card = cards[player.slot]!;
      card.hidden = false;
      card.replaceChildren(
        el("span", player.name, "player-name"),
        el("strong", player.armor),
        el("span", player.label, "card-label"),
      );
      card.classList.toggle("eliminated", !player.alive);
    }
    clock.textContent = model.time;
    mapName.textContent = model.map;
    powers.textContent = model.effects;
    powers.hidden = !model.effects;
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
    if (options.online && runtime && !graphicsFailed) {
      runtime.command({ type: "action", action: "rematch" });
      return;
    }
    start.disabled = true;
    try {
      if (graphicsFailed) {
        renderer.destroy();
        renderer = options.renderer(canvasHost);
        graphicsFailed = false;
      }
      await renderer.ready;
      if (stopped) return;
      cancel();
      previousHud = "";
      audio.unlock();
      overlay.hidden = true;
      start.blur();
      playing = !options.online;
      restart.hidden = !!options.online;
      root.classList.add("in-match");
      restart.blur();
      if (runtime && latest?.arena?.phase === "over") {
        runtime.command({ type: "action", action: "rematch" });
        return;
      }
      runtime?.stop();
      runtime = options.runtime({
        ready: () => {},
        state: (f, settings) => {
          activeSettings = settings;
          shared = settings.display;
          update(f);
        },
        event: (e) => {
          renderer.impact(e, options.now());
          audio.play(e);
        },
        status: (text) => (status.textContent = roomFailure(text)),
        ended: () => {
          playing = false;
          cancel();
          controlsRow.hidden = true;
          status.textContent = "Room ended. Leave to create another room.";
        },
        kicked: () => {
          playing = false;
          cancel();
          controlsRow.hidden = true;
          status.textContent = "You were removed from the room.";
        },
      });
      runtime.start();
    } catch (error) {
      graphicsFailed = true;
      playing = false;
      overlay.hidden = false;
      layout.hidden = false;
      if (panel) panel.element.hidden = true;
      start.hidden = false;
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
      if (
        !graphicsFailed &&
        !document.hidden &&
        timing &&
        !root.classList.contains("controller-mode")
      )
        renderer.paint(
          interpolate(timing.older, timing.newer, timing.tick),
          now,
        );
      else if (
        !graphicsFailed &&
        !document.hidden &&
        latest &&
        !root.classList.contains("controller-mode")
      )
        renderer.paint(latest, now);
    } catch {
      graphicsFailed = true;
      cancel();
      runtime?.stop();
      runtime = undefined;
      playing = false;
      overlay.hidden = false;
      layout.hidden = false;
      if (panel) panel.element.hidden = true;
      start.hidden = false;
      start.textContent = "RETRY ARENA";
      status.textContent =
        "Arena rendering stopped. Retry to start a fresh round.";
    }
    frame = options.frame(paint);
  }
  frame = options.frame(paint);
  void begin();
  return () => {
    stopped = true;
    cancel();
    runtime?.stop();
    options.cancelFrame(frame);
    renderer.destroy();
    audio.destroy();
    options.radio?.destroy();
    abort.abort();
  };
}
