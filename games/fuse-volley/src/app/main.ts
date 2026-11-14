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
import "./fuse-volley.css";
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
  createNameEntry,
  createNotice,
  createRoster,
  createRoundControls,
  el,
} from "fuse-ui";
import {
  JUMP,
  SCORINGS,
  botInput,
  isBotLevel,
  type BotLevel,
  type Scoring,
} from "../engine/index.js";
import type { WorldView } from "../engine/view.js";
import { GAME_ID } from "../basics.js";
import {
  DEFAULT_SETTINGS,
  createFuseVolleyGame,
  fuseVolleyGame,
  type Settings,
  type View,
} from "../online/game.js";
import { seatName } from "../online/names.js";
import {
  FuseVolleyRuntime,
  type FuseVolleyCallbacks,
} from "../online/runtime.js";
import { SIDE_NAMES, sideColor } from "../render/palette.js";
import type { Cue } from "../render/cues.js";
import { createScene } from "../render/scene.js";
import { createSmoother } from "../render/smooth.js";
import { artBase, browserImages, loadArt } from "./art.js";
import { createSfx, VOLLEY_SONGS } from "./audio.js";
import {
  HeldControls,
  PadSet,
  autopilotBits,
  bindButton,
  bindRocker,
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
  MODE_CHOICES,
  SCORING_CHOICES,
  createPointWatch,
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
} from "./session.js";

/**
 * The Fuse Volley page's glue: it reads the query, builds the screens from fuse-ui components, wires the runtime to
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
const scoringKey = `${GAME}-scoring`,
  botKey = `${GAME}-bot`,
  doublesKey = `${GAME}-doubles`;
const query = new URLSearchParams(location.search);
const muted = query.has("mute");
/** One sound bus for the page: the mute and volumes are remembered across games, `?mute` keeps a preview silent. */
const audio = createGameAudio(
  browserAudioDependencies(safeStorage(() => localStorage)),
  { forceMute: muted },
);
audio.setSongs(VOLLEY_SONGS, import.meta.env.BASE_URL);
audio.startMusic();
bindAudioInput(audio, document, window);
const audioControl = createAudioControl(document, audio);
const app = document.querySelector<HTMLElement>("#app")!;
const secret = () => uuid().replaceAll("-", "") + uuid().replaceAll("-", "");
/** For smokes and demos: `?autopilot` plays this device's blob with the bot's answers, through the same held controls. */
const autopilot = query.has("autopilot");
/** `?lead=local` draws this device's own blob with the keys held right now instead of the ones last logged. */
const localLead = query.get("lead") === "local";
/** `?trace` keeps the last few seconds of drawn positions on `window.fuseVolleyTrace`, for smoothness checks. */
const trace:
  | {
      t: number;
      bx: number;
      by: number;
      x0: number;
      x1: number;
      y0: number;
      y1: number;
      ahead: number;
      tick: number;
      forward: boolean;
    }[]
  | undefined = query.has("trace") ? [] : undefined;
if (trace) Object.assign(window, { fuseVolleyTrace: trace });
/** A link within the game that keeps this page's developer flags. */
const withFlags = (path: string) => {
  const kept = ["mute", "autopilot"].filter((flag) => query.has(flag));
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
const chosenScoring = (): Scoring => {
  const asked = query.get("scoring") ?? store.getItem(scoringKey);
  return SCORINGS.find((known) => known === asked) ?? DEFAULT_SETTINGS.scoring;
};
const chosenDoubles = (): boolean =>
  (query.get("doubles") ?? store.getItem(doublesKey)) === "1";
const chosenBot = (): BotLevel => {
  const raw = Number(query.get("bot") ?? store.getItem(botKey) ?? NaN);
  return isBotLevel(raw) ? raw : DEFAULT_SETTINGS.bot;
};

const GUIDE = {
  controls: [
    { keys: "A D / ← →", action: "Run" },
    { keys: "W / ↑ / SPACE", action: "Jump: hold it to jump the highest" },
    { keys: "GAMEPAD", action: "Stick or d-pad runs, any face button jumps" },
  ],
  touchControls: [
    { keys: "LEFT PAD", action: "Slide your thumb left or right to run" },
    { keys: "JUMP", action: "Jump: hold it to jump the highest" },
  ],
  goal: "Bounce the ball over the net with your blob. It must not touch the sand on your side, and three touches in a row is a fault.",
} as const;

const QUICK_GUIDE = {
  controls: [
    { keys: "A D / ← →", action: "Run" },
    { keys: "W / ↑ / SPACE", action: "Jump" },
  ],
  touchControls: [
    { keys: "LEFT PAD", action: "Slide to run" },
    { keys: "JUMP", action: "Jump" },
  ],
  goal: "Keep the ball off your sand. Three touches at most.",
} as const;

function logo(): HTMLElement {
  const brand = el("a", "", "fv-brand");
  brand.href = withFlags(endpoints.appUrl());
  brand.append(
    el("b", "FUSE", "fv-brand-fuse"),
    el("b", "VOLLEY", "fv-brand-volley"),
    el("small", "NEON BLOB VOLLEYBALL"),
  );
  return brand;
}
function header(extra: HTMLElement[] = []): HTMLElement {
  const bar = el("header", "", "fv-top");
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
  const list = el("dl", "", "fv-keys");
  for (const hint of GUIDE.controls)
    list.append(el("dt", hint.keys), el("dd", hint.action));
  return list;
}

/** The two scoring rules as cards; `onPick` hears a choice, `update` shows the room's. */
function createScoringPicker(onPick: (id: Scoring) => void) {
  const element = el("div", "", "fv-choices");
  element.setAttribute("role", "group");
  element.setAttribute("aria-label", "Scoring");
  const buttons = new Map<Scoring, HTMLButtonElement>();
  for (const choice of SCORING_CHOICES) {
    const node = button("", "fv-choice");
    node.dataset.scoring = choice.id;
    node.append(el("strong", choice.title), el("small", choice.blurb));
    node.onclick = () => onPick(choice.id);
    buttons.set(choice.id, node);
    element.append(node);
  }
  return {
    element,
    update(selected: Scoring, editable: boolean) {
      for (const [id, node] of buttons) {
        node.setAttribute("aria-pressed", String(id === selected));
        node.disabled = !editable && id !== selected;
        node.classList.toggle("fv-locked", !editable);
      }
    },
  };
}

/** One a side or two a side, as two small buttons. */
function createModePicker(onPick: (doubles: boolean) => void) {
  const element = el("div", "", "fv-levels fv-modes");
  element.setAttribute("role", "group");
  element.setAttribute("aria-label", "Players");
  const buttons = MODE_CHOICES.map((choice) => {
    const node = button(choice.title, "fv-level fv-mode");
    node.dataset.doubles = String(choice.doubles);
    node.onclick = () => onPick(choice.doubles);
    element.append(node);
    return node;
  });
  return {
    element,
    update(doubles: boolean, editable: boolean) {
      buttons.forEach((node, index) => {
        const mine = MODE_CHOICES[index]!.doubles === doubles;
        node.setAttribute("aria-pressed", String(mine));
        node.disabled = !editable && !mine;
      });
    },
  };
}

/** The bot's level as three small buttons. */
function createBotPicker(onPick: (level: BotLevel) => void) {
  const element = el("div", "", "fv-levels");
  element.setAttribute("role", "group");
  element.setAttribute("aria-label", "Bot level");
  const buttons = BOT_CHOICES.map((choice) => {
    const node = button(choice.title, "fv-level");
    node.dataset.level = String(choice.level);
    node.onclick = () => onPick(choice.level);
    element.append(node);
    return node;
  });
  return {
    element,
    update(selected: BotLevel, editable: boolean) {
      buttons.forEach((node, level) => {
        node.setAttribute("aria-pressed", String(level === selected));
        node.disabled = !editable && level !== selected;
      });
    },
  };
}

function landing(): void {
  const shared = el("label", "", "fv-shared"),
    toggle = el("input");
  toggle.type = "checkbox";
  toggle.checked = store.getItem(names.shared) === "1";
  toggle.onchange = () =>
    store.setItem(names.shared, toggle.checked ? "1" : "0");
  shared.append(toggle, el("span", "Shared TV: phones are the controllers"));
  const solo = () =>
    withFlags(
      endpoints.appUrl(
        `?solo=1&scoring=${chosenScoring()}&bot=${chosenBot()}${chosenDoubles() ? "&doubles=1" : ""}`,
      ),
    );
  const card = createLandingCard({
    title: "FUSE VOLLEY",
    tagline:
      "Jelly blobs, one ball, one net. Bounce the ball over to the other side and keep it off your own sand: three touches a side at most. Play one on one or two on two: friends online, on one TV with phones as pads, or bots.",
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
      location.href = solo();
    },
    valid: validRoomCode,
    onJoin: (code) => {
      location.href = withFlags(endpoints.appUrl(`?room=${code}`));
    },
  });
  card.create.after(shared);
  const hero = el("img", "", "fv-hero");
  hero.src = `${artBase(import.meta.env.BASE_URL)}hero.webp`;
  hero.alt = "";
  hero.width = 1536;
  hero.height = 864;
  hero.decoding = "async";
  card.element.prepend(hero);
  const scoring = createScoringPicker((id) => {
    store.setItem(scoringKey, id);
    scoring.update(id, true);
  });
  scoring.update(chosenScoring(), true);
  const bots = createBotPicker((level) => {
    store.setItem(botKey, String(level));
    bots.update(level, true);
  });
  bots.update(chosenBot(), true);
  const modes = createModePicker((doubles) => {
    store.setItem(doublesKey, doubles ? "1" : "0");
    modes.update(doubles, true);
  });
  modes.update(chosenDoubles(), true);
  const rules = el("section", "", "fv-landing-rules");
  rules.append(
    el("h2", "PLAYERS", "fui-lobby-title"),
    modes.element,
    el("h2", "SCORING", "fui-lobby-title"),
    scoring.element,
    el("h2", "SOLO BOT", "fui-lobby-title"),
    bots.element,
  );
  card.element.append(rules, keyHelp());
  const back = el("a", "← ALL GAMES", "fv-back");
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
          : kind === "move"
            ? ["pointermove"]
            : ["pointerup", "pointercancel", "lostpointercapture"];
      for (const type of types)
        node.addEventListener(type, (event) => listener(event as PointerEvent));
    },
    capture: (pointerId) => node.setPointerCapture(pointerId),
    box: () => node.getBoundingClientRect(),
    show({ held, way }) {
      node.classList.toggle("held", held);
      node.dataset.way = way < 0 ? "left" : way > 0 ? "right" : "";
    },
  };
}

function room(solo: boolean): void {
  const session = solo
    ? ({ kind: "solo" } as const)
    : sessionFor(location.search, store, GAME, validRoomCode, secret);
  if (session.kind === "invalid" || session.kind === "landing") {
    const back = el("a", "← BACK", "fv-back");
    back.href = withFlags(endpoints.appUrl());
    app.replaceChildren(
      header([back]),
      el("p", "That is not a room code: check it and try again.", "fv-error"),
    );
    return;
  }
  const code = session.kind === "room" ? session.code : "SOLO",
    role = session.kind === "room" ? session.role : "host",
    display = role === "display";
  document.body.classList.toggle("fv-display", display);
  const viewer: Viewer = { me: "", host: solo, solo, display };
  const sfx = createSfx(audio);

  // ---- the page ----
  const status = createNotice({ className: "fv-status" });
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
    el("strong", solo ? "SOLO" : code, "fv-code"),
    status.element,
    menu.element,
  ]);

  // Lobby: the invitation and the players on one side, the rules and START on the other.
  let settings: Settings = { ...DEFAULT_SETTINGS };
  const lobby = el("section", "", "fv-lobby"),
    lobbyMain = el("div", "", "fv-panel"),
    lobbySide = el("aside", "", "fv-panel fv-lobby-side"),
    roster = createRoster({ emptyText: "No players yet" }),
    addBot = button("+ ADD BOT", "fv-add-bot"),
    start = button("START MATCH", "fui-button-primary fv-start"),
    lobbyNote = el("p", "", "fui-lobby-note"),
    tvLink = button("OPEN TV SCREEN", "fv-tv");
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
      runtime.command({ type: "join", name });
    },
  });
  lobbyMain.append(
    el("h2", "PLAYERS", "fui-lobby-title"),
    roster.element,
    addBot,
  );
  addBot.onclick = () => runtime.command({ type: "bot", action: "add" });
  start.onclick = () => {
    // Doubles starts with whoever is seated: bots take the empty seats first, in the same tick as the start.
    for (let i = 0; i < (model?.lobby.fill ?? 0); i++)
      runtime.command({ type: "bot", action: "add" });
    runtime.command({ type: "action", action: "start" });
  };
  tvLink.onclick = () =>
    window.open(
      withFlags(endpoints.appUrl(`?room=${code}&display=1`)),
      "_blank",
    );
  const scoringPicker = createScoringPicker((scoring) => {
    store.setItem(scoringKey, scoring);
    runtime.command({ type: "settings", settings: { ...settings, scoring } });
  });
  const modePicker = createModePicker((doubles) => {
    store.setItem(doublesKey, doubles ? "1" : "0");
    runtime.command({ type: "settings", settings: { ...settings, doubles } });
  });
  const botPicker = createBotPicker((bot) => {
    store.setItem(botKey, String(bot));
    runtime.command({ type: "settings", settings: { ...settings, bot } });
  });
  const botTitle = el("h2", "BOT LEVEL", "fui-lobby-title");
  const lobbyActions = el("div", "", "fv-actions");
  lobbyActions.append(tvLink, start);
  lobbySide.append(
    el("h2", "PLAYERS", "fui-lobby-title"),
    modePicker.element,
    el("h2", "SCORING", "fui-lobby-title"),
    scoringPicker.element,
    botTitle,
    botPicker.element,
    lobbyNote,
    lobbyActions,
    keyHelp(),
  );
  lobby.append(lobbyMain, lobbySide);

  // The court: who is playing, the canvas and the result card.
  const stage = el("section", "", "fv-stage"),
    sidesRow = el("div", "", "fv-sides"),
    sideNodes = [0, 1].map((slot) => {
      const node = el("span", "", "fv-side");
      node.style.setProperty("--c", sideColor(slot));
      return node;
    }),
    scoringName = el("small", "", "fv-scoring-name"),
    screen = el("div", "", "fv-screen"),
    canvas = el("canvas", "", "fv-canvas"),
    note = el("p", "", "fv-note");
  sidesRow.append(sideNodes[0]!, scoringName, sideNodes[1]!);
  const result = el("section", "", "fv-result"),
    resultTitle = el("h2"),
    resultLines = el("ol"),
    resultWaiting = el("p", "", "fui-lobby-note"),
    resultActions = el("div", "", "fv-actions"),
    rematch = button("REMATCH", "fui-button-primary fv-rematch"),
    toLobby = button("LOBBY", "fv-to-lobby");
  resultActions.append(toLobby, rematch);
  result.append(resultTitle, resultLines, resultWaiting, resultActions);
  result.hidden = true;
  rematch.onclick = () =>
    runtime.command({ type: "action", action: "rematch" });
  toLobby.onclick = () => runtime.command({ type: "action", action: "lobby" });
  screen.append(canvas, result, roundControls.element);

  // A rocker and a jump button, twice: under a phone's own court, and filling the phone for a shared screen.
  const pads = (className: string) => {
    const row = el("div", "", className),
      rocker = el("div", "", "fv-rocker"),
      jump = el("div", "JUMP", "fv-jump");
    rocker.append(
      el("i", "◀", "fv-rocker-left"),
      el("i", "▶", "fv-rocker-right"),
    );
    rocker.setAttribute("role", "application");
    rocker.setAttribute("aria-label", "Run: slide your thumb left or right");
    jump.setAttribute("role", "button");
    jump.setAttribute("aria-label", "Jump");
    row.append(rocker, jump);
    const set = new PadSet(controls);
    set.add(
      bindRocker(surface(rocker), (bits) =>
        controls.hold(`${className}:rocker`, bits),
      ),
    );
    set.add(
      bindButton(surface(jump), JUMP, (bits) =>
        controls.hold(`${className}:jump`, bits),
      ),
    );
    return { row, set };
  };
  const { row: touch, set: touchPads } = pads("fv-touch"),
    controllerPads = pads("fv-controller-pads");
  letGoAll = () => {
    touchPads.release();
    controllerPads.set.release();
    controls.clear();
  };
  stage.append(sidesRow, screen, note, touch);

  const controller = el("section", "", "fv-controller"),
    controllerHead = el("header", "", "fv-controller-head"),
    controllerName = el("b"),
    controllerState = el("span");
  controllerHead.append(controllerName, controllerState);
  const controllerResult = el("div", "", "fv-actions fv-controller-result"),
    controllerRematch = button("REMATCH", "fui-button-primary"),
    controllerLobby = button("LOBBY");
  controllerRematch.onclick = rematch.onclick;
  controllerLobby.onclick = toLobby.onclick;
  controllerResult.append(controllerLobby, controllerRematch);
  controller.append(controllerHead, controllerResult, controllerPads.row);

  const connecting = el("p", "Connecting to the room…", "fv-connecting"),
    closed = el("section", "", "fv-panel fv-closed"),
    closedRetry = button("TRY AGAIN", "fv-retry"),
    closedBack = el(
      "a",
      "BACK TO FUSE VOLLEY",
      "fui-button-primary fv-closed-back",
    );
  closedBack.href = withFlags(endpoints.appUrl());
  closedRetry.onclick = () => location.reload();
  const closedActions = el("div", "", "fv-actions");
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
  const main = el("main", "", "fv-room");
  main.append(connecting, closed, nameEntry.form, lobby, stage, controller);
  app.replaceChildren(top, main);
  lobby.hidden = true;
  stage.hidden = true;
  controller.hidden = true;
  nameEntry.form.hidden = true;
  let over = false;

  // ---- drawing: the newest folded world played forward to the clock, once per animation frame ----
  const scene = createScene(canvas, {
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
    art: loadArt(import.meta.env.BASE_URL, browserImages),
  });
  const smoother = createSmoother();
  const gamepads = new GamepadInput(browserGamepads(navigator), (bits) =>
    controls.hold("gamepad", bits),
  );
  let model: Model | undefined;
  /** What to draw now: the forward run when the newest frame is the room's newest world, otherwise the two frames blended. */
  let drawn = { ahead: 0, tick: 0, forward: false };
  const leadClock = createLeadClock();
  const drawBot = memoBot(botInput);
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
      drawn = { ahead, tick: timing.newer.tick, forward: true };
      view = forward(
        state.world,
        ahead,
        forwardInputs(state, viewer.me, runtime.heldNow, localLead, drawBot),
      );
    } else {
      drawn = { ahead: -1, tick: timing.newer.tick, forward: false };
      const older = timing.older?.world;
      const span = timing.older ? timing.newer.tick - timing.older.tick : 0;
      view =
        older && span > 0
          ? blendViews(older, newer, (timing.tick - timing.older!.tick) / span)
          : newer;
    }
    return smoother.apply(view, timing.revision ?? 0, performance.now(), local);
  };
  let felt = -1;
  /** A phone controller draws nothing, but still feels its own touches: read off the hit counter as the scene does. */
  const feel = (view: WorldView): readonly Cue[] => {
    const was = felt;
    felt = view.hitCounter;
    return was !== -1 && was !== view.hitCounter && view.lastTouch !== -1
      ? [
          {
            kind: "hit",
            side: view.lastTouch,
            slot: -1,
            x: 0,
            y: 0,
            speed: 0,
            touches: 0,
          },
        ]
      : [];
  };
  const frame = (now: number) => {
    // Asked first, so one bad frame cannot stop the drawing for good.
    requestAnimationFrame(frame);
    gamepads.poll(!menu.isOpen() && !document.hidden && !over);
    const view = stage.hidden && controller.hidden ? undefined : picture();
    if (view) {
      const local = model?.localSlot ?? -1;
      if (trace) {
        trace.push({
          t: now,
          bx: view.ball.x,
          by: view.ball.y,
          x0: view.blobs[0]?.x ?? 0,
          x1: view.blobs[1]?.x ?? 0,
          y0: view.blobs[0]?.y ?? 0,
          y1: view.blobs[1]?.y ?? 0,
          ...drawn,
        });
        if (trace.length > 1200) trace.splice(0, trace.length - 1200);
      }
      const cues = stage.hidden
        ? feel(view)
        : scene.draw(view, now, local, model?.names, model?.tags);
      const localSide = model?.localSide ?? -1;
      for (const cue of cues) {
        if (!stage.hidden) sfx.play(cue);
        // A phone feels its own side's touches: it cannot tell which teammate touched without drawing.
        if (cue.kind === "hit" && cue.side === localSide && !controller.hidden)
          navigator.vibrate?.(12);
      }
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
    main.dataset.score = view.world ? view.world.score.join("-") : "";
    main.dataset.riding = String(next.riding);
    main.dataset.doubles = String(view.world?.court.team === 2);
    lobby.hidden = next.screen !== "lobby";
    stage.hidden = next.screen !== "play";
    controller.hidden = next.screen !== "controller";
    nameEntry.form.hidden = !next.askName;
    // Lobby.
    roster.update(
      next.lobby.members.map((member) => ({
        id: member.id,
        name: member.you ? `${member.name} (you)` : member.name,
        color: sideColor(member.slot % 2),
        status: member.bot
          ? "BOT"
          : member.connected
            ? SIDE_NAMES[member.slot % 2 === 1 ? 1 : 0]
            : "OFFLINE",
      })),
    );
    for (const [id, row] of roster.entries()) {
      let remove = row.querySelector<HTMLButtonElement>(".fv-remove");
      const removable = next.lobby.removable.includes(id);
      if (removable && !remove) {
        remove = button("×", "fv-remove");
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
    scoringPicker.update(view.settings.scoring, next.lobby.editable);
    modePicker.update(view.settings.doubles, next.lobby.editable);
    botPicker.update(view.settings.bot, next.lobby.editable);
    botTitle.hidden = botPicker.element.hidden =
      !next.lobby.hasBot && !next.lobby.fill;
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
    // The court.
    ([0, 1] as const).forEach((team) => {
      const node = sideNodes[team]!;
      const members = next.sides.filter((side) => side.side === team);
      setText(
        node,
        members
          .map(
            (side) =>
              `${side.name}${side.you ? " (you)" : ""}${side.away ? " · away" : ""}`,
          )
          .join(" & "),
      );
      node.classList.toggle(
        "you",
        members.some((side) => side.you),
      );
    });
    // The court says the rule on its sand; the controller's status line carries the score.
    setText(scoringName, "");
    setText(note, next.note);
    note.hidden = !next.note;
    touch.hidden = !(coarse() && next.riding && !display);
    main.dataset.touch = String(!touch.hidden);
    touchPads.show(!touch.hidden && !stage.hidden);
    controllerPads.set.show(!controller.hidden);
    scene.resize();
    // The phone controller.
    const mine = next.sides.find((side) => side.you);
    if (mine) {
      controller.style.setProperty("--c", sideColor(mine.side));
      setText(controllerName, `${SIDE_NAMES[mine.side]} · ${mine.name}`);
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
  const points = createPointWatch();
  const remembered = seatName(
    social.playerName(store.getItem(names.name)) ?? "",
  );
  let joinSent = false;
  const callbacks: FuseVolleyCallbacks = {
    state(frame, roomSettings) {
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
      for (const point of points(frame, viewer.me))
        analytics.track("Point Scored", { ...point });
      settings = roomSettings;
      const next = present(frame, viewer);
      if (next.askName && remembered && !joinSent) {
        joinSent = true;
        runtime.command({ type: "join", name: remembered });
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
  const runtime = new FuseVolleyRuntime(
    code,
    {
      display: shared,
      scoring: chosenScoring(),
      bot: chosenBot(),
      doubles: chosenDoubles(),
    },
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
    // Solo doubles seats three bots beside the player.
    solo && chosenDoubles()
      ? createFuseVolleyGame(botInput, 3)
      : fuseVolleyGame,
  );
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
