import { requestedRoomSlot } from "fuse-ui";
import { createGameSocial } from "fuse-ui/social";
import "fuse-ui/social.css";
import { startGameAnalytics, createPlayMetrics } from "fuse-ui/play-metrics";
import "@fontsource/press-start-2p/latin.css";
import "fuse-ui/tokens.css";
import "fuse-ui/components.css";
import "fuse-ui/portal.css";
import {
  bindAudioInput,
  browserAudioDependencies,
  createAudioControl,
  createGameAudio,
} from "fuse-ui/game-audio";
import "fuse-ui/game-audio.css";
import { safeStorage } from "fuse-ui/safe-storage";
import "./fuse-surge.css";
import QRCode from "qrcode";
import {
  PeerTransport,
  createEndpoints,
  createRoom,
  installRoomLifecycle,
  validRoomCode,
} from "fuse-network-fe";
import { MAX_PACKET_BYTES, uuid } from "fuse-netcode";
import {
  button,
  createAppPortal,
  createGameMenu,
  createInviteCard,
  createLandingCard,
  createRoomLayout,
  createNameEntry,
  createNotice,
  createRoster,
  createRoundControls,
  el,
} from "fuse-ui";
import { DUCK, JUMP, botInput } from "../engine/index.js";
import type { WorldView } from "../engine/view.js";
import { CAPACITY, GAME_ID } from "../basics.js";
import {
  DEFAULT_SETTINGS,
  fuseSurgeGame,
  parseSettings,
  type Settings,
  type View,
} from "../online/game.js";
import { seatName } from "../online/names.js";
import {
  FuseSurgeRuntime,
  type FuseSurgeCallbacks,
} from "../online/runtime.js";
import { createCueWatch, type Cue } from "../render/cues.js";
import { laneColor, laneName } from "../render/palette.js";
import { createScene } from "../render/scene.js";
import { createSmoother } from "../render/smooth.js";
import { createSfx } from "./audio.js";
import {
  HeldControls,
  PadSet,
  autopilotBits,
  bindButton,
  type PadSurface,
} from "./controls.js";
import {
  blendViews,
  createLeadClock,
  forward,
  memoBot,
  forwardInputs,
  stepsAhead,
} from "./forward.js";
import { GamepadInput, browserGamepads } from "./gamepad.js";
import {
  BOT_CHOICES,
  HIT_CHOICES,
  PACE_CHOICES,
  RECOVER_CHOICES,
  TARGET_CHOICES,
  TIME_CHOICES,
  createRoundWatch,
  present,
  type Model,
  type Viewer,
} from "./presenter.js";
import { dueReports, sendReport } from "./reports.js";
import {
  NOT_OPEN,
  keys,
  roomFailure,
  safeStore,
  sessionFor,
  settingsFrom,
  settingsQuery,
  settingsToSave,
} from "./session.js";

/**
 * The Fuse Surge page's glue: it reads the query, builds the screens from fuse-ui components, wires the runtime to
 * the transport, draws every animation frame and turns keys, touches and gamepads into held control bits. The
 * decisions live in the presenter, the renderer and the engine; nothing here changes the match.
 */
const GAME = GAME_ID;
const analytics = startGameAnalytics(GAME);
const reportPlay = createPlayMetrics(analytics.track, () => performance.now());
const endpoints = createEndpoints(
  {
    basePath: `${import.meta.env.BASE_URL}${GAME}/`,
    apiOrigin: import.meta.env.VITE_API_ORIGIN,
  },
  location.origin,
);
const social = createGameSocial({
  gameId: GAME,
  base: import.meta.env.BASE_URL,
  apiOrigin: import.meta.env.VITE_API_ORIGIN,
  document,
  window,
  fetch: (input, init) => fetch(input, init),
  track: analytics.track,
});
const store = safeStore(() => localStorage);
const names = keys(GAME);
const settingsKey = `${GAME}-settings`;
const query = new URLSearchParams(location.search);
const muted = query.has("mute");
/** One sound bus for the page: the mute and volumes are remembered across games, `?mute` keeps a preview silent. */
const audio = createGameAudio(
  browserAudioDependencies(safeStorage(() => localStorage)),
  { forceMute: muted },
);
bindAudioInput(audio, document, window);
const audioControl = createAudioControl(document, audio);
const app = document.querySelector<HTMLElement>("#app")!;
const secret = () => uuid().replaceAll("-", "") + uuid().replaceAll("-", "");
/** For smokes and demos: `?autopilot` plays this device's rider with the bot's answers, through the same held controls. */
const autopilot = query.has("autopilot");
/** `?lead=local` draws this device's own rider with the keys held right now instead of the ones last logged. */
const localLead = query.get("lead") === "local";
/** `?debug` puts the room's view and a settings setter on `window.fuseSurge`, for tuning a match by hand. */
const debug = query.has("debug");
/** A link within the game that keeps this page's developer flags. */
const withFlags = (path: string) => {
  const kept = ["mute", "autopilot", "debug"].filter((flag) => query.has(flag));
  const lead = localLead ? ["lead=local"] : [];
  const all = [...kept, ...lead];
  return all.length
    ? `${path}${path.includes("?") ? "&" : "?"}${all.join("&")}`
    : path;
};
const setText = (node: HTMLElement, value: string) => {
  if (node.textContent !== value) node.textContent = value;
};
const coarse = () => matchMedia("(pointer: coarse)").matches;
/** A phone may buzz once its player has touched the page; a browser refuses (and complains) before that. */
const canBuzz = () =>
  coarse() && navigator.userActivation?.hasBeenActive === true;

/** The settings this browser last chose, with anything the link asks for on top. */
const chosenSettings = (): Settings =>
  settingsFrom(location.search, store.getItem(settingsKey));
const remember = (settings: Settings) =>
  store.setItem(settingsKey, settingsToSave(settings));

const GUIDE = {
  controls: [
    { keys: "W / ↑ / SPACE", action: "Jump: tap to hop, hold to jump high" },
    { keys: "S / ↓ / SHIFT", action: "Duck; in the air, dive back down" },
    { keys: "GAMEPAD", action: "A or up jumps, B or down ducks" },
  ],
  touchControls: [
    { keys: "JUMP", action: "Tap to hop, hold to jump high" },
    { keys: "DUCK", action: "Duck; in the air, dive back down" },
  ],
  goal: "Jump the red surges and duck the violet ones. Every hit throws you a step toward the pit; five clean dodges win a step back. Last rider standing takes the round.",
} as const;

const QUICK_GUIDE = {
  controls: [
    { keys: "W / ↑ / SPACE", action: "Jump the red" },
    { keys: "S / ↓ / SHIFT", action: "Duck the violet" },
  ],
  touchControls: [
    { keys: "JUMP", action: "Jump the red" },
    { keys: "DUCK", action: "Duck the violet" },
  ],
  goal: "Stay on the deck. Last rider standing wins the round.",
} as const;

function logo(): HTMLElement {
  const brand = el("a", "", "fs-brand");
  brand.href = withFlags(endpoints.appUrl());
  brand.append(
    el("b", "FUSE", "fs-brand-fuse"),
    el("b", "SURGE", "fs-brand-surge"),
    el("small", "JUMP IT · DUCK IT"),
  );
  return brand;
}
function header(extra: HTMLElement[] = []): HTMLElement {
  const bar = el("header", "", "fs-top");
  const portal = createAppPortal({
    document,
    current: GAME,
    base: import.meta.env.BASE_URL,
    search: location.search,
  });
  bar.append(
    portal.element,
    logo(),
    social.element(),
    audioControl.element,
    ...extra,
  );
  return bar;
}

function keyHelp(): HTMLElement {
  const list = el("dl", "", "fs-keys");
  for (const hint of GUIDE.controls)
    list.append(el("dt", hint.keys), el("dd", hint.action));
  return list;
}

type SettingKey = Exclude<keyof Settings, "display">;
interface Choice<V> {
  readonly value: V;
  readonly title: string;
}
const SETTING_ROWS: readonly {
  key: SettingKey;
  label: string;
  choices: readonly Choice<number | boolean>[];
}[] = [
  { key: "hits", label: "HITS", choices: HIT_CHOICES },
  { key: "seconds", label: "ROUND", choices: TIME_CHOICES },
  { key: "pace", label: "PACE", choices: PACE_CHOICES },
  { key: "target", label: "FIRST TO", choices: TARGET_CHOICES },
  { key: "recover", label: "COMEBACK", choices: RECOVER_CHOICES },
  { key: "bot", label: "BOTS", choices: BOT_CHOICES },
];

/** The match settings as rows of small buttons; `onPick` hears the settings a press asks for, `update` shows the room's. */
function createSettingsPicker(onPick: (settings: Settings) => void) {
  const element = el("div", "", "fs-settings");
  let current: Settings = { ...DEFAULT_SETTINGS };
  const rows = SETTING_ROWS.map((row) => {
    const line = el("div", "", "fs-setting"),
      group = el("div", "", "fs-levels");
    line.dataset.setting = row.key;
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", row.label);
    const buttons = row.choices.map((choice) => {
      const node = button(choice.title, "fs-level");
      node.dataset.value = String(choice.value);
      node.onclick = () => {
        const next = parseSettings({ ...current, [row.key]: choice.value });
        if (next) onPick(next);
      };
      group.append(node);
      return node;
    });
    line.append(el("span", row.label), group);
    element.append(line);
    return { row, line, buttons };
  });
  return {
    element,
    update(settings: Settings, editable: boolean, bots = true) {
      current = settings;
      for (const { row, line, buttons } of rows) {
        line.hidden = row.key === "bot" && !bots;
        buttons.forEach((node, index) => {
          const mine = row.choices[index]!.value === settings[row.key];
          node.setAttribute("aria-pressed", String(mine));
          node.disabled = !editable && !mine;
        });
      }
    },
  };
}

function landing(): void {
  const shared = el("label", "", "fs-shared"),
    toggle = el("input");
  toggle.type = "checkbox";
  toggle.checked = store.getItem(names.shared) === "1";
  toggle.onchange = () =>
    store.setItem(names.shared, toggle.checked ? "1" : "0");
  shared.append(toggle, el("span", "Shared TV: phones are the controllers"));
  let chosen = chosenSettings();
  const card = createLandingCard({
    background: async (host) =>
      (await import("./attract.js")).createAttract(host),
    title: "FUSE SURGE",
    tagline:
      "Surges sweep the deck, faster and faster. Jump the low ones, duck the high ones: every hit throws you a step toward the pit. Two to five riders: friends online, on one TV with phones as pads, or bots.",
    soloText: "PLAY SOLO VS BOTS",
    async onCreate() {
      const room = await createRoom(endpoints.apiUrl, fetch, GAME).catch(
        (error: unknown) => {
          throw new Error(
            roomFailure(error instanceof Error ? error.message : String(error)),
          );
        },
      );
      store.setItem(names.host(room.code), room.token);
      location.href = withFlags(endpoints.appUrl(`?room=${room.code}`));
    },
    onSolo: () => {
      location.href = withFlags(
        endpoints.appUrl(`?solo=1&${settingsQuery(chosen)}`),
      );
    },
    valid: validRoomCode,
    onJoin: (code) => {
      location.href = withFlags(endpoints.appUrl(`?room=${code}`));
    },
  });
  card.create.after(shared);
  const picker = createSettingsPicker((next) => {
    chosen = next;
    remember(next);
    picker.update(next, true);
  });
  picker.update(chosen, true);
  const rules = el("section", "", "fs-landing-rules");
  rules.append(el("h2", "MATCH", "fui-lobby-title"), picker.element);
  card.menu.addSettings(rules);
  card.menu.help.append(keyHelp());
  const back = el("a", "← ALL GAMES", "fs-back");
  back.href = import.meta.env.BASE_URL + (muted ? "?mute" : "");
  const menu = createGameMenu(GUIDE);
  menu.update({ canLobby: false, canLeave: false, touch: coarse() });
  app.replaceChildren(header([back, menu.element]), card.element);
}

/** A real element as a pad. */
function surface(node: HTMLElement): PadSurface {
  node.addEventListener("contextmenu", (event) => event.preventDefault());
  return {
    on(kind, listener) {
      const types =
        kind === "down"
          ? ["pointerdown"]
          : ["pointerup", "pointercancel", "lostpointercapture"];
      for (const type of types)
        node.addEventListener(type, (event) => listener(event as PointerEvent));
    },
    capture: (pointerId) => node.setPointerCapture(pointerId),
    show: (held) => node.classList.toggle("held", held),
  };
}

function room(solo: boolean): void {
  const session = solo
    ? ({ kind: "solo" } as const)
    : sessionFor(location.search, store, GAME, validRoomCode, secret);
  if (session.kind === "invalid" || session.kind === "landing") {
    const back = el("a", "← BACK", "fs-back");
    back.href = withFlags(endpoints.appUrl());
    app.replaceChildren(
      header([back]),
      el("p", "That is not a room code: check it and try again.", "fs-error"),
    );
    return;
  }
  const code = session.kind === "room" ? session.code : "SOLO",
    role = session.kind === "room" ? session.role : "host",
    display = role === "display";
  document.body.classList.toggle("fs-display", display);
  const viewer: Viewer = { me: "", host: solo, solo, display };
  const sfx = createSfx(audio);

  // ---- the page ----
  const status = createNotice({ className: "fs-status" });
  const controls = new HeldControls((bits) => runtime.input(bits));
  /** Lets go of every key, pad and button: a menu opened, or the page lost focus. */
  let letGoAll = () => controls.clear();
  const menu = createGameMenu({
    ...GUIDE,
    onLobby: () => runtime.command({ type: "action", action: "lobby" }),
    onLeave: () => {
      runtime.stop();
      location.href = withFlags(endpoints.appUrl());
    },
    onOpenChange: (open) => {
      if (open) letGoAll();
    },
  });
  const roundControls = createRoundControls(QUICK_GUIDE);
  const top = header([
    el("strong", solo ? "SOLO" : code, "fs-code"),
    status.element,
    menu.element,
  ]);

  // Lobby: the invitation and the riders on one side, the match settings and START on the other.
  let settings: Settings = chosenSettings();
  const lobby = el("section", "", "fs-lobby"),
    lobbyMain = el("div", "", "fs-panel"),
    lobbySide = el("aside", "", "fs-panel fs-lobby-side"),
    roster = createRoster({ emptyText: "No riders yet" }),
    addBot = button("+ ADD BOT", "fs-add-bot"),
    start = button("START MATCH", "fui-button-primary fs-start"),
    lobbyNote = el("p", "", "fui-lobby-note"),
    tvLink = button("OPEN TV SCREEN", "fs-tv");
  if (!solo) {
    const invite = createInviteCard({
      code,
      link: endpoints.appUrl(`?room=${code}`),
      qr: (text) => QRCode.toDataURL(text, { margin: 1, width: 360 }),
    });
    lobbyMain.append(invite.element);
  }
  const nameEntry = createNameEntry({
    normalize: (raw) => seatName(raw) ?? "",
    initial: social.playerName(store.getItem(names.name)) ?? "",
    onInput: (value) => store.setItem(names.name, value),
    buttonText: "JOIN",
    onSubmit: (name) => {
      store.setItem(names.name, name);
      runtime.command({
        type: "join",
        name,
        slot: requestedRoomSlot(nameEntry.form),
      });
    },
  });
  lobbyMain.append(
    el("h2", "RIDERS", "fui-lobby-title"),
    roster.element,
    addBot,
  );
  addBot.onclick = () =>
    runtime.command({
      type: "bot",
      action: "add",
      slot: requestedRoomSlot(addBot),
    });
  start.onclick = () => runtime.command({ type: "action", action: "start" });
  tvLink.onclick = () =>
    window.open(
      withFlags(endpoints.appUrl(`?room=${code}&display=1`)),
      "_blank",
    );
  const picker = createSettingsPicker((next) => {
    remember(next);
    runtime.command({
      type: "settings",
      settings: { ...next, display: settings.display },
    });
  });
  const lobbyActions = el("div", "", "fs-actions");
  lobbyActions.append(tvLink, start);
  lobbySide.append(
    el("h2", "MATCH", "fui-lobby-title"),
    picker.element,
    lobbyNote,
    lobbyActions,
    keyHelp(),
  );
  lobby.append(lobbyMain, lobbySide);

  // The deck: the canvas, the result card and a line for a device that is not playing.
  const stage = el("section", "", "fs-stage"),
    screen = el("div", "", "fs-screen"),
    canvas = el("canvas", "", "fs-canvas"),
    note = el("p", "", "fs-note");
  const result = el("section", "", "fs-result"),
    resultTitle = el("h2"),
    resultLines = el("ol"),
    resultWaiting = el("p", "", "fui-lobby-note"),
    resultActions = el("div", "", "fs-actions"),
    rematch = button("REMATCH", "fui-button-primary fs-rematch"),
    toLobby = button("LOBBY", "fs-to-lobby");
  resultActions.append(toLobby, rematch);
  result.append(resultTitle, resultLines, resultWaiting, resultActions);
  result.hidden = true;
  rematch.onclick = () =>
    runtime.command({ type: "action", action: "rematch" });
  toLobby.onclick = () => runtime.command({ type: "action", action: "lobby" });
  screen.append(canvas, result, roundControls.element);

  // A duck button and a jump button, twice: under a phone's own deck, and filling the phone for a shared screen.
  const pads = (className: string) => {
    const row = el("div", "", className),
      duck = el("div", "DUCK", "fs-duck"),
      jump = el("div", "JUMP", "fs-jump");
    duck.setAttribute("role", "button");
    duck.setAttribute("aria-label", "Duck");
    jump.setAttribute("role", "button");
    jump.setAttribute("aria-label", "Jump");
    row.append(duck, jump);
    const set = new PadSet(controls);
    set.add(
      bindButton(surface(duck), DUCK, (bits) =>
        controls.hold(`${className}:duck`, bits),
      ),
    );
    set.add(
      bindButton(surface(jump), JUMP, (bits) =>
        controls.hold(`${className}:jump`, bits),
      ),
    );
    return { row, set };
  };
  const { row: touch, set: touchPads } = pads("fs-touch"),
    controllerPads = pads("fs-controller-pads");
  letGoAll = () => {
    touchPads.release();
    controllerPads.set.release();
    controls.clear();
  };
  stage.append(screen, note, touch);

  const controller = el("section", "", "fs-controller"),
    controllerHead = el("header", "", "fs-controller-head"),
    controllerName = el("b"),
    controllerState = el("span");
  controllerHead.append(controllerName, controllerState);
  const controllerResult = el("div", "", "fs-actions fs-controller-result"),
    controllerRematch = button("REMATCH", "fui-button-primary"),
    controllerLobby = button("LOBBY");
  controllerRematch.onclick = rematch.onclick;
  controllerLobby.onclick = toLobby.onclick;
  controllerResult.append(controllerLobby, controllerRematch);
  controller.append(controllerHead, controllerResult, controllerPads.row);

  const connecting = el("p", "Connecting to the room…", "fs-connecting"),
    closed = el("section", "", "fs-panel fs-closed"),
    closedRetry = button("TRY AGAIN", "fs-retry"),
    closedBack = el(
      "a",
      "BACK TO FUSE SURGE",
      "fui-button-primary fs-closed-back",
    );
  closedBack.href = withFlags(endpoints.appUrl());
  closedRetry.onclick = () => location.reload();
  const closedActions = el("div", "", "fs-actions");
  closedActions.append(closedRetry, closedBack);
  closed.append(
    el("h2", "ROOM CLOSED", "fui-lobby-title"),
    el(
      "p",
      "This room has ended, or it never existed. Try again, start a new one, or play solo.",
    ),
    closedActions,
  );
  closed.hidden = true;
  const main = el("main", "", "fs-room");
  main.append(connecting, closed, nameEntry.form, lobby, stage, controller);
  app.replaceChildren(top, main);
  const roomLayout = createRoomLayout({
    primaryAction: start,
    playerName: () => social.playerName(undefined) ?? undefined,
    slotColor: (slot) => laneColor(slot),
    slotLabel: (slot) => `${laneName(slot)} · Lane ${slot + 1}`,
    background: async (host) =>
      (await import("./attract.js")).createAttract(host),
    element: lobby,
    roster,
    capacity: CAPACITY,
    join: nameEntry.form,
    addAI: addBot,
    modes: [],
    settings: [picker.element],
    actions: [lobbyNote, tvLink, start],
  });
  lobby.hidden = true;
  stage.hidden = true;
  controller.hidden = true;
  nameEntry.form.hidden = true;
  let over = false;

  // ---- drawing: the newest folded world played forward to the clock, once per animation frame ----
  const scene = createScene(canvas, {
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
  });
  const smoother = createSmoother();
  const gamepads = new GamepadInput(browserGamepads(navigator), (bits) =>
    controls.hold("gamepad", bits),
  );
  let model: Model | undefined;
  const leadClock = createLeadClock();
  const drawBot = memoBot(botInput);
  /** What to draw now: the forward run when the newest frame is the room's newest world, otherwise the two frames blended. */
  const picture = (): WorldView | undefined => {
    const timing = runtime.frameTiming();
    const newer = timing?.newer.world;
    if (!timing || !newer) return undefined;
    const state = runtime.roomState();
    const local = model?.localSlot ?? -1;
    let view: WorldView;
    if (
      state?.world &&
      state.world.step === newer.step &&
      state.stage !== "lobby"
    ) {
      const ahead = leadClock(
        stepsAhead(timing, timing.newer.tick),
        timing.newer.tick,
        performance.now(),
      );
      view = forward(
        state.world,
        ahead,
        forwardInputs(state, viewer.me, runtime.heldNow, localLead, drawBot),
      );
    } else {
      const older = timing.older?.world;
      const span = timing.older ? timing.newer.tick - timing.older.tick : 0;
      view =
        older && span > 0
          ? blendViews(older, newer, (timing.tick - timing.older!.tick) / span)
          : newer;
    }
    return smoother.apply(view, timing.revision ?? 0, performance.now(), local);
  };
  /** A phone controller draws nothing, but still feels its rider struck: the same cues, read off the same views. */
  const feel: (view: WorldView) => readonly Cue[] = createCueWatch();
  const frame = (now: number) => {
    // Asked first, so one bad frame cannot stop the drawing for good.
    requestAnimationFrame(frame);
    gamepads.poll(!menu.isOpen() && !document.hidden && !over);
    const view = stage.hidden && controller.hidden ? undefined : picture();
    if (!view) return;
    const local = model?.localSlot ?? -1;
    const cues = stage.hidden
      ? feel(view)
      : scene.draw(view, now, local, model?.names);
    for (const cue of cues) {
      // The TV makes the room's sound; a phone held as a pad only buzzes when its own rider is struck.
      if (!stage.hidden) sfx.play(cue, local);
      if (cue.kind === "hit" && cue.slot === local && canBuzz())
        navigator.vibrate?.(cue.out ? [30, 40, 60] : 25);
    }
  };
  requestAnimationFrame(frame);

  const render = (next: Model, view: View) => {
    if (over) return;
    model = next;
    connecting.hidden = true;
    main.dataset.screen = next.screen;
    main.dataset.stage = view.stage;
    main.dataset.phase = view.world?.phase ?? "";
    main.dataset.round = String(view.world?.round ?? 0);
    main.dataset.riding = String(next.riding);
    lobby.hidden = next.screen !== "lobby";
    stage.hidden = next.screen !== "play";
    controller.hidden = next.screen !== "controller";
    nameEntry.form.hidden = !next.askName;
    // Lobby.
    roster.update(
      next.lobby.members.map((member) => ({
        id: member.id,
        slot: member.slot,
        name: member.you ? `${member.name} (you)` : member.name,
        color: laneColor(member.slot),
        status: member.bot
          ? "BOT"
          : member.connected
            ? laneName(member.slot)
            : "OFFLINE",
      })),
    );
    for (const [id, row] of roster.entries()) {
      let remove = row.querySelector<HTMLButtonElement>(".fs-remove");
      const removable = next.lobby.removable.includes(id);
      if (removable && !remove) {
        remove = button("×", "fs-remove");
        remove.setAttribute("aria-label", "Remove bot");
        remove.onclick = () =>
          runtime.command({ type: "bot", action: "remove", id });
        row.append(remove);
      }
      if (remove) remove.hidden = !removable;
    }
    addBot.hidden = !next.lobby.canAddBot;
    start.hidden = !next.lobby.showStart;
    start.disabled = !next.lobby.canStart;
    setText(lobbyNote, next.lobby.note);
    lobbyNote.hidden = !next.lobby.note;
    tvLink.hidden = !(
      view.settings.display &&
      viewer.host &&
      !display &&
      !solo
    );
    picker.update(view.settings, next.lobby.editable);
    roomLayout.update(next.lobby.members.length, CAPACITY);
    lobbySide.hidden = display;
    const touchGuide = coarse() || next.screen === "controller";
    const watching = display || (view.stage !== "lobby" && !next.riding);
    menu.update({
      canLobby: viewer.host && view.stage !== "lobby" && !display,
      touch: touchGuide,
      spectator: watching && view.stage === "running",
      display,
    });
    roundControls.update({
      round: next.guideKey,
      visible: next.controlsVisible,
      touch: touchGuide,
      spectator: watching,
      display,
    });
    const guideParent = next.screen === "controller" ? controller : screen;
    if (roundControls.element.parentElement !== guideParent)
      guideParent.append(roundControls.element);
    // The deck.
    setText(note, next.note);
    note.hidden = !next.note;
    touch.hidden = !(coarse() && next.riding && !display);
    main.dataset.touch = String(!touch.hidden);
    touchPads.show(!touch.hidden && !stage.hidden);
    controllerPads.set.show(!controller.hidden);
    scene.resize();
    // The phone controller.
    const mine = next.riders.find((rider) => rider.you);
    if (mine) {
      controller.style.setProperty("--c", laneColor(mine.slot));
      setText(controllerName, `${laneName(mine.slot)} · ${mine.name}`);
    }
    setText(controllerState, next.status);
    controllerResult.hidden = !(next.result && next.result.host);
    // Result.
    result.hidden = !next.result || next.screen === "controller";
    if (next.result) {
      setText(resultTitle, next.result.title);
      const lines = next.result.lines.join("\n");
      if (resultLines.dataset.lines !== lines) {
        resultLines.dataset.lines = lines;
        resultLines.replaceChildren(
          ...next.result.lines.map((line) => el("li", line)),
        );
      }
      resultActions.hidden = !next.result.host;
      setText(resultWaiting, next.result.waiting);
      resultWaiting.hidden = !next.result.waiting;
    }
  };

  // ---- the runtime ----
  const sent = new Set<string>();
  const rounds = createRoundWatch();
  const remembered = seatName(
    social.playerName(store.getItem(names.name)) ?? "",
  );
  let joinSent = false;
  let lastFrame: View | undefined;
  const callbacks: FuseSurgeCallbacks = {
    state(frame, roomSettings) {
      lastFrame = frame;
      const players =
        frame.stage === "lobby"
          ? frame.seats.filter((seat) => !seat.watcher)
          : frame.roster;
      reportPlay({
        matchId: frame.matchId,
        active: frame.stage === "running",
        ended: frame.stage === "over",
        playerCount: players.length,
        botCount: players.filter((player) => player.bot).length,
        seated: players.some((player) => player.id === viewer.me),
        mode: solo ? "solo" : roomSettings.display ? "shared" : "online",
      });
      for (const round of rounds(frame, viewer.me))
        analytics.track("Round Ended", { ...round });
      settings = roomSettings;
      const next = present(frame, viewer);
      if (next.askName && remembered && !joinSent && !viewer.host) {
        joinSent = true;
        runtime.command({
          type: "join",
          slot: requestedRoomSlot(nameEntry.form),
          name: remembered,
        });
      }
      if (next.seated) joinSent = false;
      render(next, frame);
      const state = runtime.roomState();
      if (autopilot)
        controls.hold("autopilot", autopilotBits(state, viewer.me));
      runtime.flush();
      if (session.kind === "room" && !display && state)
        for (const report of dueReports(
          state,
          runtime.self,
          runtime.confirmedTick(),
          sent,
        )) {
          sent.add(report.key);
          void sendReport(
            endpoints.apiUrl(`/api/games/${GAME}/rooms/${code}/${report.path}`),
            report,
            { fetch: social.reportFetch, roomToken: session.token },
          );
        }
    },
    event() {
      // Everything shown comes from the view: a rollback can change an outcome after its event.
    },
    status(text) {
      const shown = roomFailure(text);
      status.show(shown, shown === text ? "info" : "error");
    },
    ready(id, host) {
      viewer.me = id;
      viewer.host = host;
    },
    kicked() {
      status.show("The host removed you from the room", "error");
    },
    ended() {
      status.show("Room ended", "error");
      over = true;
      controls.clear();
      for (const part of [connecting, nameEntry.form, lobby, stage, controller])
        part.hidden = true;
      closed.hidden = false;
      void fetch(endpoints.apiUrl(`/api/games/${GAME}/leaderboard`))
        .then(async (response) => {
          const body = (await response.json()) as { error?: unknown };
          if (roomFailure(String(body.error ?? "")) === NOT_OPEN)
            status.show(NOT_OPEN, "error");
        })
        .catch(() => {
          /* offline: "Room ended" stands */
        });
    },
  };
  const shared =
    !solo && role === "host" && store.getItem(names.shared) === "1";
  const runtime = new FuseSurgeRuntime(
    code,
    { ...settings, display: shared },
    callbacks,
    session.kind === "room"
      ? {
          transport: (events) =>
            social.transport(
              code,
              session.token,
              events,
              (events) =>
                new PeerTransport(code, session.token, events, {
                  apiUrl: endpoints.apiUrl,
                  gameId: GAME,
                  maxFastBytes: MAX_PACKET_BYTES,
                }),
            ),
          displayOnly: display,
        }
      : {
          humanName: social.playerName(store.getItem(names.name)) ?? undefined,
        },
    fuseSurgeGame,
  );
  if (debug)
    Object.assign(window, {
      fuseSurge: {
        /** The newest frame the room showed this page. */
        view: () => lastFrame,
        /** Asks the room for other settings (the host, in the lobby); any value the rules allow, listed or not. */
        set(patch: Partial<Settings>) {
          const next = parseSettings({ ...settings, ...patch });
          if (next) runtime.command({ type: "settings", settings: next });
          return next;
        },
      },
    });
  installRoomLifecycle(window, {
    stop: () => runtime.stop(),
    destroy: () => {
      menu.dispose();
      scene.destroy();
    },
    reload: () => location.reload(),
  });
  window.addEventListener("resize", () => scene.resize());

  // Keys: while this device plays, ours are swallowed so Space never scrolls or presses a focused button.
  const typing = (target: EventTarget | null) =>
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLButtonElement && !model?.riding);
  const captured = new Set<string>();
  document.addEventListener("keydown", (event) => {
    if (
      menu.isOpen() ||
      typing(event.target) ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      // Only play swallows keys: in the lobby Space and the arrows scroll and press as usual.
      !model?.riding
    )
      return;
    if (controls.press(event.code)) {
      captured.add(event.code);
      event.preventDefault();
    }
  });
  document.addEventListener("keyup", (event) => {
    controls.release(event.code);
    if (captured.delete(event.code)) event.preventDefault();
  });
  window.addEventListener("blur", () => {
    letGoAll();
    gamepads.letGo();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      letGoAll();
      gamepads.letGo();
    }
  });
  runtime.start();
}

if (query.get("solo") === "1") room(true);
else if (query.has("room")) room(false);
else landing();
