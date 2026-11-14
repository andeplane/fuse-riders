import { createGameSocial } from "fuse-ui/social";
import "fuse-ui/social.css";
import { startGameAnalytics, createPlayMetrics } from "fuse-ui/play-metrics";
import "@fontsource/press-start-2p/latin.css";
import "fuse-ui/tokens.css";
import "fuse-ui/components.css";
import "fuse-ui/portal.css";
import "./elasto-fuse.css";
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
import { GAS, RESTART } from "../engine/input.js";
import { LEVELS, centiseconds } from "../engine/index.js";
import type { WorldView } from "../engine/view.js";
import { GAME_ID } from "../basics.js";
import {
  DEFAULT_SETTINGS,
  TOUR,
  type Settings,
  type View,
} from "../online/game.js";
import { seatName } from "../online/names.js";
import {
  ElastoFuseRuntime,
  type ElastoFuseCallbacks,
} from "../online/runtime.js";
import { cueGate, cuesBetween, type Cue } from "../render/cues.js";
import { slotColor, slotName } from "../render/palette.js";
import { createScene } from "../render/scene.js";
import { createSmoother } from "../render/smooth.js";
import {
  artBase,
  browserCanvas,
  browserImages,
  browserTint,
  loadArt,
} from "./art.js";
import { createSfx } from "./audio.js";
import {
  HeldControls,
  PadSet,
  TOUCH_BUTTONS,
  bindButton,
  type PadSurface,
} from "./controls.js";
import {
  blendViews,
  createLeadClock,
  forward,
  forwardInputs,
  stepsAhead,
} from "./forward.js";
import { GamepadInput, browserGamepads } from "./gamepad.js";
import {
  LEVEL_CHOICES,
  createFinishWatch,
  levelFrom,
  present,
  type Model,
  type Row,
  type Viewer,
} from "./presenter.js";
import { dueReports, sendReport } from "./reports.js";
import {
  NOT_OPEN,
  bestTime,
  createBestTimes,
  keys,
  roomFailure,
  safeStore,
  sessionFor,
} from "./session.js";
import { clockText } from "../render/hud.js";

/**
 * The Elasto Fuse page's glue: it reads the query, builds the screens from fuse-ui components, wires the runtime to
 * the transport, draws every animation frame and turns keys, touches and gamepads into held control bits. The
 * decisions live in the presenter, the renderer and the engine; nothing here changes the race.
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
/** The level a room's lobby last chose (the tour is −1). */
const roomLevelKey = `${GAME}-room-level`;
const query = new URLSearchParams(location.search);
const muted = query.has("mute");
const app = document.querySelector<HTMLElement>("#app")!;
const secret = () => uuid().replaceAll("-", "") + uuid().replaceAll("-", "");
/** A link within the game that keeps this page's developer flags. */
const withFlags = (path: string) =>
  muted ? `${path}${path.includes("?") ? "&" : "?"}mute` : path;
const setText = (node: HTMLElement, value: string) => {
  if (node.textContent !== value) node.textContent = value;
};
const coarse = () => matchMedia("(pointer: coarse)").matches;
/** The level solo rides: the link's, else the one ridden last, else the first. */
const soloLevel = (): number =>
  levelFrom(query.get("level") ?? store.getItem(names.level), 0);
/** The level a new room starts on: the last lobby's choice, else the tour. */
const roomLevel = (): number => {
  const stored = store.getItem(roomLevelKey);
  return stored === String(TOUR) ? TOUR : levelFrom(stored, TOUR);
};

const GUIDE = {
  controls: [
    { keys: "↑ / W", action: "Gas" },
    { keys: "↓ / S", action: "Brake" },
    { keys: "← → / A D", action: "Volt: rotate the bike left or right" },
    { keys: "SPACE", action: "Turn around" },
    { keys: "ENTER / R", action: "Restart from the start" },
    {
      keys: "GAMEPAD",
      action: "A gas, B brake, LB RB volt, X turn, Y restart",
    },
  ],
  touchControls: [
    {
      keys: "GAS / BRAKE",
      action: "Right thumb: hold to drive, brake to stop",
    },
    { keys: "⟲ ⟳", action: "Left thumb: rotate the bike in the air" },
    { keys: "TURN", action: "Face the other way" },
    { keys: "RESTART", action: "Back to the start" },
  ],
  goal: "Eat every apple, then touch the flower. Keep your head off the ground: the bike is springy and flips easily.",
} as const;

const QUICK_GUIDE = {
  controls: [
    { keys: "↑ ↓", action: "Gas, brake" },
    { keys: "← →", action: "Rotate" },
    { keys: "SPACE", action: "Turn around" },
    { keys: "ENTER", action: "Restart" },
  ],
  touchControls: [
    { keys: "GAS / BRAKE", action: "Drive" },
    { keys: "⟲ ⟳", action: "Rotate" },
    { keys: "TURN", action: "Turn around" },
  ],
  goal: "Every apple, then the flower. Mind your head.",
} as const;

function logo(): HTMLElement {
  const brand = el("a", "", "ef-brand");
  brand.href = withFlags(endpoints.appUrl());
  brand.append(
    el("b", "ELASTO", "ef-brand-elasto"),
    el("b", "FUSE", "ef-brand-fuse"),
    el("small", "SPRINGY BIKE TRIALS"),
  );
  return brand;
}
function header(extra: HTMLElement[] = []): HTMLElement {
  const bar = el("header", "", "ef-top");
  const portal = createAppPortal({
    document,
    current: GAME,
    base: import.meta.env.BASE_URL,
    search: location.search,
  });
  bar.append(portal.element, logo(), social.element(), ...extra);
  return bar;
}

function keyHelp(): HTMLElement {
  const list = el("dl", "", "ef-keys");
  for (const hint of GUIDE.controls)
    list.append(el("dt", hint.keys), el("dd", hint.action));
  return list;
}

/** The levels as buttons, with the tour first when `tour` is set; `onPick` hears a choice, `update` shows the room's. */
function createLevelPicker(tour: boolean, onPick: (level: number) => void) {
  const element = el("div", "", "ef-levels");
  element.setAttribute("role", "group");
  element.setAttribute("aria-label", "Level");
  const buttons = new Map<number, HTMLButtonElement>();
  for (const choice of LEVEL_CHOICES) {
    if (choice.level === TOUR && !tour) continue;
    const node = button("", "ef-level");
    node.dataset.level = String(choice.level);
    const best =
      choice.level === TOUR
        ? undefined
        : bestTime(store, names.best(LEVELS[choice.level]!.id));
    node.append(
      choice.level === TOUR
        ? choice.title
        : `${choice.level + 1} ${choice.title}`,
    );
    if (best !== undefined && !tour)
      node.append(el("br"), el("small", clockText(best)));
    node.title = choice.title;
    node.onclick = () => onPick(choice.level);
    buttons.set(choice.level, node);
    element.append(node);
  }
  return {
    element,
    update(selected: number, editable: boolean) {
      for (const [level, node] of buttons) {
        node.setAttribute("aria-pressed", String(level === selected));
        node.disabled = !editable && level !== selected;
      }
    },
  };
}

function landing(): void {
  const shared = el("label", "", "ef-shared"),
    toggle = el("input");
  toggle.type = "checkbox";
  toggle.checked = store.getItem(names.shared) === "1";
  toggle.onchange = () =>
    store.setItem(names.shared, toggle.checked ? "1" : "0");
  shared.append(toggle, el("span", "Shared TV: phones are the controllers"));
  let level = soloLevel();
  const card = createLandingCard({
    title: "ELASTO FUSE",
    tagline:
      "A springy motorbike, twelve neon tracks. Eat every apple, then touch the flower, and keep your head off the ground. Chase your best times alone, or race up to four friends: online, or on one TV with phones as controllers.",
    soloText: "PLAY SOLO",
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
      store.setItem(names.level, String(level));
      location.href = withFlags(endpoints.appUrl(`?solo=1&level=${level}`));
    },
    valid: validRoomCode,
    onJoin: (code) => {
      location.href = withFlags(endpoints.appUrl(`?room=${code}`));
    },
  });
  card.create.after(shared);
  const hero = el("img", "", "ef-hero");
  hero.src = `${artBase(import.meta.env.BASE_URL)}hero.webp`;
  hero.alt = "";
  hero.width = 1536;
  hero.height = 864;
  hero.decoding = "async";
  // The key art is optional: a missing file leaves no broken picture.
  hero.onerror = () => hero.remove();
  card.element.prepend(hero);
  const picker = createLevelPicker(false, (picked) => {
    level = picked;
    store.setItem(names.level, String(picked));
    picker.update(picked, true);
  });
  picker.update(level, true);
  const rules = el("section", "", "ef-landing-rules");
  rules.append(el("h2", "SOLO MAP", "fui-lobby-title"), picker.element);
  card.element.append(rules, keyHelp());
  const back = el("a", "← ALL GAMES", "ef-back");
  back.href = import.meta.env.BASE_URL + (muted ? "?mute" : "");
  const menu = createGameMenu(GUIDE);
  menu.update({ canLobby: false, canLeave: false, touch: coarse() });
  app.replaceChildren(header([back, menu.element]), card.element);
}

/** A real element as a touch button. */
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
    const back = el("a", "← BACK", "ef-back");
    back.href = withFlags(endpoints.appUrl());
    app.replaceChildren(
      header([back]),
      el("p", "That is not a room code: check it and try again.", "ef-error"),
    );
    return;
  }
  const code = session.kind === "room" ? session.code : "SOLO",
    role = session.kind === "room" ? session.role : "host",
    display = role === "display";
  document.body.classList.toggle("ef-display", display);
  const viewer: Viewer = { me: "", host: solo, solo, display };
  const sfx = createSfx(muted);
  const leave = () => {
    runtime.stop();
    location.href = withFlags(endpoints.appUrl());
  };

  // ---- the page ----
  const status = createNotice({ className: "ef-status" });
  const controls = new HeldControls((bits) => runtime.input(bits));
  /** Lets go of every key, button and pad: a menu opened, or the page lost focus. */
  let letGoAll = () => controls.clear();
  const menu = createGameMenu({
    ...GUIDE,
    onLobby: () => runtime.command({ type: "action", action: "lobby" }),
    onLeave: leave,
    onOpenChange: (open) => {
      if (open) letGoAll();
    },
  });
  const roundControls = createRoundControls(QUICK_GUIDE);
  const top = header([
    el("strong", solo ? "SOLO" : code, "ef-code"),
    status.element,
    menu.element,
  ]);

  // Lobby: the invitation and the riders on one side, the level and START on the other.
  let settings: Settings = { ...DEFAULT_SETTINGS };
  const lobby = el("section", "", "ef-lobby"),
    lobbyMain = el("div", "", "ef-panel"),
    lobbySide = el("aside", "", "ef-panel ef-lobby-side"),
    roster = createRoster({ emptyText: "No riders yet" }),
    start = button("START RACE", "fui-button-primary ef-start"),
    lobbyNote = el("p", "", "fui-lobby-note"),
    tvLink = button("OPEN TV SCREEN", "ef-tv");
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
  lobbyMain.append(el("h2", "RIDERS", "fui-lobby-title"), roster.element);
  start.onclick = () => runtime.command({ type: "action", action: "start" });
  tvLink.onclick = () =>
    window.open(
      withFlags(endpoints.appUrl(`?room=${code}&display=1`)),
      "_blank",
    );
  const levelPicker = createLevelPicker(true, (level) => {
    store.setItem(roomLevelKey, String(level));
    runtime.command({ type: "settings", settings: { ...settings, level } });
  });
  const lobbyActions = el("div", "", "ef-actions");
  lobbyActions.append(tvLink, start);
  lobbySide.append(
    el("h2", "MAP", "fui-lobby-title"),
    levelPicker.element,
    lobbyNote,
    lobbyActions,
    keyHelp(),
  );
  lobby.append(lobbyMain, lobbySide);

  // The race: the canvas, the card over it (the table between two races, the result) and the touch buttons.
  const stage = el("section", "", "ef-stage"),
    screen = el("div", "", "ef-screen"),
    canvas = el("canvas", "", "ef-canvas"),
    note = el("p", "", "ef-note");
  const card = el("section", "", "ef-card"),
    cardTitle = el("h2"),
    cardRows = el("ol", "", "ef-rows"),
    cardLines = el("ul", "", "ef-lines"),
    cardFoot = el("p", "", "ef-card-foot"),
    cardActions = el("div", "", "ef-actions"),
    rematch = button("REMATCH", "fui-button-primary ef-rematch"),
    toLobby = button("LOBBY", "ef-to-lobby"),
    nextMap = button("NEXT MAP", "ef-next-map"),
    toMenu = button("MENU", "ef-to-menu");
  cardActions.append(toMenu, toLobby, rematch, nextMap);
  card.append(cardTitle, cardRows, cardLines, cardFoot, cardActions);
  card.hidden = true;
  rematch.onclick = () =>
    runtime.command({ type: "action", action: "rematch" });
  toLobby.onclick = () => runtime.command({ type: "action", action: "lobby" });
  toMenu.onclick = leave;
  /** The result's main button: NEXT MAP after a solo map ridden home, otherwise another go. */
  const mainAction = () => (model?.result?.solo?.finished ? nextMap : rematch);
  nextMap.onclick = () => {
    const next = model?.result?.solo?.next;
    if (next === undefined) return;
    // The next level, then a rematch: both fold on the same tick, in this order.
    runtime.command({
      type: "settings",
      settings: { ...settings, level: next },
    });
    runtime.command({ type: "action", action: "rematch" });
    store.setItem(names.level, String(next));
    history.replaceState(
      null,
      "",
      withFlags(endpoints.appUrl(`?solo=1&level=${next}`)),
    );
  };
  screen.append(canvas, card, roundControls.element);

  // The touch buttons, twice: under a phone's own race, and filling the phone for a shared screen.
  const pads = (className: string) => {
    const row = el("div", "", className),
      left = el("div", "", "ef-cluster ef-cluster-left"),
      right = el("div", "", "ef-cluster ef-cluster-right");
    const set = new PadSet(controls);
    let restart: HTMLElement | undefined;
    for (const each of TOUCH_BUTTONS) {
      const node = el("div", each.label, `ef-pad ef-pad-${each.id}`);
      node.setAttribute("role", "button");
      node.setAttribute("aria-label", each.hint);
      set.add(
        bindButton(surface(node), each.bits, (bits) =>
          controls.hold(`${className}:${each.id}`, bits),
        ),
      );
      if (each.id === "restart") restart = node;
      else if (each.id === "gas" || each.id === "brake") right.append(node);
      else left.append(node);
    }
    row.append(left, right);
    return { row, set, restart: restart! };
  };
  const touch = pads("ef-touch"),
    controllerPads = pads("ef-controller-pads");
  controllerPads.row.prepend(controllerPads.restart);
  letGoAll = () => {
    touch.set.release();
    controllerPads.set.release();
    controls.clear();
  };
  // A phone's RESTART rides at the top of its picture, clear of both thumbs.
  stage.append(screen, touch.restart, note, touch.row);

  const controller = el("section", "", "ef-controller"),
    controllerHead = el("header", "", "ef-controller-head"),
    controllerName = el("b"),
    controllerState = el("span");
  controllerHead.append(controllerName, controllerState);
  const controllerResult = el("div", "", "ef-actions ef-controller-result"),
    controllerRematch = button("REMATCH", "fui-button-primary"),
    controllerLobby = button("LOBBY");
  controllerRematch.onclick = rematch.onclick;
  controllerLobby.onclick = toLobby.onclick;
  controllerResult.append(controllerLobby, controllerRematch);
  controller.append(controllerHead, controllerResult, controllerPads.row);

  const connecting = el("p", "Connecting to the room…", "ef-connecting"),
    closed = el("section", "", "ef-panel ef-closed"),
    closedRetry = button("TRY AGAIN", "ef-retry"),
    closedBack = el(
      "a",
      "BACK TO ELASTO FUSE",
      "fui-button-primary ef-closed-back",
    );
  closedBack.href = withFlags(endpoints.appUrl());
  closedRetry.onclick = () => location.reload();
  const closedActions = el("div", "", "ef-actions");
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
  const main = el("main", "", "ef-room");
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
    art: loadArt(import.meta.env.BASE_URL, browserImages, browserTint),
    createCanvas: browserCanvas,
  });
  const smoother = createSmoother();
  let padBits = 0;
  const gamepads = new GamepadInput(browserGamepads(navigator), (bits) => {
    // On a result, a pad's gas pressed afresh is the main button, as Enter is on the keys, and its restart a retry.
    const fresh = bits & ~padBits & (GAS | RESTART);
    padBits = bits;
    if (fresh && !model?.riding && model?.result?.host)
      (fresh & RESTART ? rematch : mainAction()).click();
    controls.hold("gamepad", bits);
  });
  let model: Model | undefined;
  const leadClock = createLeadClock();
  /** What to draw now: the forward run when the newest frame is the room's newest world, otherwise the two frames blended. */
  const picture = (): WorldView | undefined => {
    const timing = runtime.frameTiming();
    const newer = timing?.newer.world;
    if (!timing || !newer) return undefined;
    const state = runtime.roomState();
    let view: WorldView;
    if (
      state?.world &&
      state.simulationTick === timing.newer.tick &&
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
        forwardInputs(state, viewer.me, (step) => runtime.heldAhead(step)),
      );
    } else {
      const older = timing.older?.world;
      const span = timing.older ? timing.newer.tick - timing.older.tick : 0;
      view =
        older && span > 0
          ? blendViews(older, newer, (timing.tick - timing.older!.tick) / span)
          : newer;
    }
    return smoother.apply(
      view,
      timing.revision ?? 0,
      performance.now(),
      model?.localSlot ?? -1,
    );
  };
  /** What of the canvas the touch buttons float over (a phone on its side), in CSS pixels; nothing when they sit below it. */
  let covered: { left: number; right: number; bottom: number } | undefined;
  const measureCovered = () => {
    covered = undefined;
    const [left, right] = [...touch.row.children];
    if (touch.row.hidden || stage.hidden || !left || !right) return;
    const pads = touch.row.getBoundingClientRect(),
      picture = screen.getBoundingClientRect();
    const bottom =
      Math.min(picture.bottom, pads.bottom) - Math.max(picture.top, pads.top);
    if (bottom <= 0) return;
    covered = {
      left: Math.max(0, left.getBoundingClientRect().right - picture.left),
      right: Math.max(0, picture.right - right.getBoundingClientRect().left),
      bottom,
    };
  };
  /** A phone controller draws nothing, but still hears and feels its own bike: the cues read off its own views. */
  let felt: WorldView | undefined;
  const heard = cueGate();
  const frame = (now: number) => {
    // Asked first, so one bad frame cannot stop the drawing for good.
    if (!over) requestAnimationFrame(frame);
    gamepads.poll(!menu.isOpen() && !document.hidden && !over);
    const view = stage.hidden && controller.hidden ? undefined : picture();
    if (!view || !model) {
      sfx.engine(0, false, false);
      return;
    }
    const local = model.localSlot;
    let cues: readonly Cue[];
    if (stage.hidden) {
      cues = heard(cuesBetween(felt, view), now);
      felt = view;
      sfx.engine(0, false, false);
    } else {
      const drawn = scene.draw(view, now, {
        follow: model.follow,
        local,
        names: model.tags,
        title: model.title,
        ...(covered ? { covered } : {}),
      });
      cues = drawn.cues;
      sfx.engine(
        drawn.rev,
        drawn.gas,
        local !== -1 && view.phase === "racing" && !menu.isOpen(),
      );
    }
    for (const cue of cues) {
      // A rider hears its own apples and crashes; a shared screen and a watcher hear everyone's.
      const mine = !("slot" in cue) || local === -1 || cue.slot === local;
      if (!mine) continue;
      sfx.play(cue);
      if (cue.kind === "crash" && local !== -1) navigator.vibrate?.(40);
      if (cue.kind === "apple" && local !== -1) navigator.vibrate?.(10);
    }
  };
  requestAnimationFrame(frame);

  const rowNode = (row: Row) => {
    const node = el("li", "", row.you ? "you" : "");
    node.style.setProperty("--c", slotColor(row.slot));
    node.append(
      el("span", String(row.place)),
      el("b", row.you ? `${row.name} (you)` : row.name),
      el("span", row.detail),
      el("em", row.points),
    );
    return node;
  };
  const render = (next: Model, view: View) => {
    if (over) return;
    model = next;
    connecting.hidden = true;
    main.dataset.screen = next.screen;
    main.dataset.stage = view.stage;
    main.dataset.phase = view.world?.phase ?? "";
    main.dataset.level = view.world ? String(view.world.level) : "";
    main.dataset.round = String(view.round);
    main.dataset.riding = String(next.riding);
    lobby.hidden = next.screen !== "lobby";
    stage.hidden = next.screen !== "play";
    controller.hidden = next.screen !== "controller";
    nameEntry.form.hidden = !next.askName;
    // Lobby.
    roster.update(
      next.lobby.members.map((member) => ({
        id: member.id,
        name: member.you ? `${member.name} (you)` : member.name,
        color: slotColor(member.slot),
        status: member.connected ? slotName(member.slot) : "OFFLINE",
      })),
    );
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
    levelPicker.update(view.settings.level, next.lobby.editable);
    lobbySide.hidden = display;
    const touchGuide = coarse() || next.screen === "controller";
    const watching = display || (view.stage !== "lobby" && !next.riding);
    menu.update({
      canLobby: viewer.host && view.stage !== "lobby" && !display && !solo,
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
    // The race.
    setText(note, next.note);
    note.hidden = !next.note;
    const touchOn = coarse() && next.riding && !display;
    touch.row.hidden = touch.restart.hidden = !touchOn;
    main.dataset.touch = String(touchOn);
    touch.set.show(touchOn && !stage.hidden);
    controllerPads.set.show(!controller.hidden);
    scene.resize();
    measureCovered();
    // The phone controller.
    if (next.localSlot !== -1) {
      controller.style.setProperty("--c", slotColor(next.localSlot));
      setText(
        controllerName,
        `${slotName(next.localSlot)} · ${next.tags[next.localSlot] ?? ""}`,
      );
    }
    setText(controllerState, next.status);
    controllerResult.hidden = !(next.result && next.result.host);
    // The card: the table between two races, or the result.
    const shown = next.result ?? next.table;
    card.hidden = !shown || next.screen === "controller";
    card.dataset.kind = next.result ? "result" : next.table ? "table" : "";
    if (shown) {
      setText(cardTitle, shown.title);
      const rows = JSON.stringify(shown.rows);
      if (cardRows.dataset.rows !== rows) {
        cardRows.dataset.rows = rows;
        cardRows.replaceChildren(...shown.rows.map(rowNode));
      }
      cardRows.hidden = !shown.rows.length;
      const lines = next.result?.lines ?? [];
      const joined = lines.join("\n");
      if (cardLines.dataset.lines !== joined) {
        cardLines.dataset.lines = joined;
        cardLines.replaceChildren(
          ...lines.map((line) =>
            el("li", line, /^(NEW )?BEST/.test(line) ? "best" : ""),
          ),
        );
      }
      cardLines.hidden = !lines.length;
      setText(cardFoot, next.table?.next ?? next.result?.waiting ?? "");
      cardFoot.hidden = !cardFoot.textContent;
      const alone = !!next.result?.solo;
      cardActions.hidden = !next.result?.host;
      setText(rematch, alone ? "RETRY" : "REMATCH");
      // A map ridden home goes on to the next: NEXT MAP is the main button then, and RETRY the other.
      const onward = !!next.result?.solo?.finished;
      nextMap.classList.toggle("fui-button-primary", onward);
      rematch.classList.toggle("fui-button-primary", !onward);
      nextMap.hidden = toMenu.hidden = !alone;
      toLobby.hidden = alone;
    }
  };

  // ---- the runtime ----
  const sent = new Set<string>();
  const finishes = createFinishWatch();
  const bests = createBestTimes(store);
  const remembered = seatName(
    social.playerName(store.getItem(names.name)) ?? "",
  );
  let joinSent = false;
  const callbacks: ElastoFuseCallbacks = {
    state(frame, roomSettings) {
      const players =
        frame.stage === "lobby"
          ? frame.seats.filter((seat) => !seat.watcher)
          : frame.roster;
      const mode = solo ? "solo" : roomSettings.display ? "shared" : "online";
      reportPlay({
        matchId: frame.matchId,
        active: frame.stage === "running" || frame.stage === "between",
        ended: frame.stage === "over",
        playerCount: players.length,
        botCount: 0,
        seated: players.some((player) => player.id === viewer.me),
        mode,
        // A device that opens a tour midway joined a match; it did not start one.
        round: frame.round + 1,
      });
      for (const finish of finishes(frame, viewer.me))
        analytics.track("Race Finished", { ...finish, mode });
      settings = roomSettings;
      // A solo ride that is over settles its best time once, and keeps saying what the best was before it.
      let bestBefore: number | undefined;
      const world = frame.world;
      if (solo && frame.stage === "over" && world) {
        const rider = world.riders[0];
        bestBefore = bests.settle(
          frame.matchId,
          names.best(LEVELS[world.level]?.id ?? ""),
          rider?.status === "finished" ? centiseconds(rider.run) : undefined,
        );
      }
      const next = present(frame, viewer, bestBefore);
      if (next.askName && remembered && !joinSent) {
        joinSent = true;
        runtime.command({ type: "join", name: remembered });
      }
      if (next.seated) joinSent = false;
      render(next, frame);
      const state = runtime.roomState();
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
  const runtime = new ElastoFuseRuntime(
    code,
    { display: shared, level: solo ? soloLevel() : roomLevel() },
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
  );
  installRoomLifecycle(window, {
    stop: () => runtime.stop(),
    destroy: () => {
      menu.dispose();
      scene.destroy();
    },
    reload: () => location.reload(),
  });
  window.addEventListener("resize", () => {
    scene.resize();
    measureCovered();
  });

  // Keys: while this device rides, ours are swallowed so Space never scrolls or presses a focused button.
  const typing = (target: EventTarget | null) =>
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLButtonElement && !model?.riding);
  const captured = new Set<string>();
  document.addEventListener("keydown", (event) => {
    sfx.resume();
    if (
      menu.isOpen() ||
      typing(event.target) ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey
    )
      return;
    // A result that offers another go takes Enter as its main button and R as a retry, without the mouse.
    if (
      !model?.riding &&
      model?.result?.host &&
      !event.repeat &&
      (event.code === "Enter" || event.code === "KeyR")
    ) {
      event.preventDefault();
      (event.code === "KeyR" ? rematch : mainAction()).click();
      return;
    }
    // Only a race swallows keys: in the lobby Space and the arrows scroll and press as usual.
    if (!model?.riding) return;
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
  document.addEventListener("pointerdown", () => sfx.resume(), {
    passive: true,
  });
  window.addEventListener("gamepadconnected", () => sfx.resume());
  // A pinch or a double tap must never zoom the race away from under the thumbs.
  for (const type of ["gesturestart", "gesturechange", "dblclick"])
    stage.addEventListener(type, (event) => event.preventDefault());
  runtime.start();
}

if (query.get("solo") === "1") room(true);
else if (query.has("room")) room(false);
else landing();
