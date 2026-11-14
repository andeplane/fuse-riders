import { createGameSocial } from "fuse-ui/social";
import type { Frame, RuntimeMetrics } from "fuse-netcode";
import "fuse-ui/social.css";
import { startGameAnalytics, createPlayMetrics } from "fuse-ui/play-metrics";
import "@fontsource/press-start-2p/latin.css";
import "fuse-ui/tokens.css";
import "fuse-ui/components.css";
import "fuse-ui/portal.css";
import "./killer-fuse.css";
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
  createRadioGroup,
  el,
} from "fuse-ui";
import { MAPS } from "../engine/index.js";
import {
  DEFAULT_SETTINGS,
  KillerFuseRuntime,
  killerFuseGame,
  seatName,
  type KillerFuseCallbacks,
  type View,
  type Settings,
} from "../online/index.js";
import { createArenaView } from "../render/index.js";
import { ArenaDriver } from "./arena.js";
import {
  Controls,
  HOLD_TO_FLAP_KEY,
  Keys,
  Pads,
  Touch,
  gameKey,
  holdToFlapFrom,
} from "./controls.js";
import {
  readIconSheets,
  unitIcons,
  winIcons,
  type Icon,
  type IconSheets,
} from "./art.js";
import { buttonLabel, cardKey, countdownCard, deviceFor } from "./briefing.js";
import { highlightUntil, type UnitSnap } from "./highlight.js";
import { lobbyTips, tipIndex } from "./tips.js";
import {
  FRESH,
  LESSONS,
  advance,
  bestTime,
  factsOf,
  lessonById,
  playSeconds,
  recordTime,
  setupAction,
  stepText,
  tutorialSettings,
  type Progress,
} from "./tutorial.js";
import {
  CONTROLS,
  DEVICE_CONTROLS,
  DEVICE_NAMES,
  GOAL,
  HOLD_TO_FLAP,
  RULES,
  TOUCH_CONTROLS,
  UNITS,
  WINS,
  type Device,
} from "./guide.js";
import { createGameMetrics } from "./metrics.js";
import {
  BOT_LEVELS,
  present,
  seatTitle,
  type PageModel,
  type SeatModel,
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

/** The page's state for a browser smoke, on `window.__killerFuse` when the address has `?debug`. */
interface KillerFuseDebug {
  frame(): Frame<View> | undefined;
  metrics(): RuntimeMetrics;
  confirmedTick(): number;
  me(): string;
}
declare global {
  interface Window {
    __killerFuse?: KillerFuseDebug;
  }
}

/**
 * The Killer Fuse page's glue: it reads the query, builds the screens from fuse-ui components, wires the runtime to
 * the transport the way Fuse Riders does, and puts what `present` decides on the page. The decisions live in the
 * presenter, the controls, the arena driver, the reports, the metrics and the session modules, which are
 * unit-tested; this file only connects them to the browser.
 */
const GAME = killerFuseGame.id;
const analytics = startGameAnalytics(GAME);
const reportPlay = createPlayMetrics(analytics.track, () => performance.now());
const reportGame = createGameMetrics(analytics.track);
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
const MUTED = `${GAME}-muted`;
const ART_URL = `${import.meta.env.BASE_URL}${GAME}/art/`;
const query = new URLSearchParams(location.search);
const secret = () => uuid().replaceAll("-", "") + uuid().replaceAll("-", "");
const app = document.querySelector<HTMLElement>("#app")!;

function header(extra: HTMLElement[] = []): HTMLElement {
  const bar = el("header", "", "kf-top"),
    brand = el("a", "", "kf-brand");
  brand.href = endpoints.appUrl();
  brand.append(el("span", "KILLER FUSE"), el("small", "A FUSE GAME"));
  // Every game opens the app portal top left; it lists the games that have a portal.json.
  const portal = createAppPortal({
    document,
    current: GAME,
    base: import.meta.env.BASE_URL,
    search: location.search,
  });
  bar.append(portal.element, brand, social.element(), ...extra);
  return bar;
}

/** The art sheets, fetched once for the page's pictures; none when the manifest cannot be had. */
let manifest: Promise<IconSheets> | undefined;
let sheets: IconSheets = {};
const loadManifest = () =>
  (manifest ??= fetch(`${ART_URL}manifest.json`)
    .then(async (response) => (sheets = readIconSheets(await response.json())))
    .catch(() => ({})));
/** Draws `icon` as the background of `slot`. */
function paint(slot: HTMLElement, icon: Icon | undefined): void {
  if (!icon) return;
  Object.assign(slot.style, {
    width: `${icon.width}px`,
    height: `${icon.height}px`,
    backgroundImage: `url("${icon.url}")`,
    backgroundSize: icon.size,
    backgroundPosition: icon.position,
  });
}

/** This device's "Hold to flap" choice, kept in local storage; the room's controls follow a change at once. */
let holdToFlap = holdToFlapFrom(store.getItem(HOLD_TO_FLAP_KEY));
let onHoldToFlap: (on: boolean) => void = () => undefined;
function holdToFlapToggle(): HTMLElement {
  const label = el("label", "", "kf-shared kf-hold"),
    box = el("input");
  box.type = "checkbox";
  box.checked = holdToFlap;
  box.onchange = () => {
    holdToFlap = box.checked;
    store.setItem(HOLD_TO_FLAP_KEY, holdToFlap ? "1" : "0");
    onHoldToFlap(holdToFlap);
  };
  label.title = HOLD_TO_FLAP.how;
  label.append(box, el("span", HOLD_TO_FLAP.label));
  return label;
}

/**
 * How to play: a button for the landing page and the lobby that opens the whole guide in a dialog (Escape or CLOSE
 * shuts it). `#how-to-play` in the address opens it on load.
 */
function howToPlay(): HTMLElement {
  const open = button("HOW TO PLAY", "kf-how-open"),
    dialog = el("dialog", "", "fui-dialog kf-how"),
    bar = el("div", "", "fui-dialog-bar"),
    title = el("h2", "HOW TO PLAY", "fui-dialog-title kf-how-title"),
    close = button("CLOSE", "fui-dialog-close"),
    body = el("div", "", "fui-dialog-body kf-how-body");
  title.id = "kf-how-title";
  dialog.setAttribute("aria-labelledby", title.id);
  open.setAttribute("aria-haspopup", "dialog");
  bar.append(title, close);
  const list = (rows: readonly { name: string; how: string }[]) => {
    const items = el("dl", "", "kf-how-list");
    for (const row of rows) items.append(el("dt", row.name), el("dd", row.how));
    return items;
  };
  const units = el("div", "", "kf-how-units");
  const icons: { art: (typeof UNITS)[number]["art"]; slot: HTMLElement }[] = [];
  for (const unit of UNITS) {
    const row = el("article", "", "kf-how-unit"),
      icon = el("i", "", "kf-how-icon"),
      text = el("div");
    icon.setAttribute("aria-hidden", "true");
    text.append(
      el("strong", unit.name),
      el("p", `Can: ${unit.can}`),
      el("p", `Cannot: ${unit.cannot}`, "kf-how-cannot"),
    );
    row.append(icon, text);
    units.append(row);
    icons.push({ art: unit.art, slot: icon });
  }
  const controls = el("div", "", "kf-how-devices");
  for (const device of ["keys", "pad", "touch"] as const) {
    const group = el("div");
    const rows = el("dl", "", "kf-how-list kf-how-controls");
    for (const hint of DEVICE_CONTROLS[device])
      rows.append(el("dt", hint.keys), el("dd", hint.action));
    group.append(el("h4", DEVICE_NAMES[device]), rows);
    controls.append(group);
  }
  body.append(
    el("p", GOAL, "kf-how-goal"),
    el("h3", "THREE WAYS TO WIN"),
    list(WINS),
    el("h3", "THE UNITS"),
    units,
    ...RULES.flatMap((section) => {
      const lines = el("ul", "", "kf-how-rules");
      lines.append(...section.lines.map((line) => el("li", line)));
      return [el("h3", section.title), lines];
    }),
    el("h3", "CONTROLS"),
    controls,
    el("h4", HOLD_TO_FLAP.label.toUpperCase()),
    el("p", HOLD_TO_FLAP.how, "kf-how-goal"),
  );
  dialog.append(bar, body);
  const show = () => {
    if (dialog.open) return;
    dialog.showModal();
    close.focus();
    void loadManifest().then((art) => {
      const drawn = unitIcons(art, ART_URL, 0, 48);
      for (const { art: name, slot } of icons)
        if (!slot.style.backgroundImage) paint(slot, drawn[name]);
    });
  };
  open.onclick = show;
  close.onclick = () => dialog.close();
  // A click on the backdrop (outside the panel) closes it as well.
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", () => {
    if (location.hash === "#how-to-play")
      history.replaceState(null, "", location.pathname + location.search);
    open.focus();
  });
  const wrap = el("div", "", "kf-how-entry");
  wrap.append(open, holdToFlapToggle(), dialog);
  if (location.hash === "#how-to-play") queueMicrotask(show);
  return wrap;
}

/** The solo tutorial's lessons, each with its best time on this device. */
function tutorialList(): HTMLElement {
  const box = el("section", "", "kf-tutorial"),
    list = el("ol", "", "kf-tutorial-list");
  for (const lesson of LESSONS) {
    const item = el("li"),
      link = el("a", lesson.title, "fui-button kf-tutorial-link"),
      best = bestTime(store, lesson.id);
    link.href = endpoints.appUrl(`?solo=1&tutorial=${lesson.id}`);
    item.append(
      link,
      el("span", best === undefined ? "not done yet" : `best ${best} s`),
    );
    list.append(item);
  }
  box.append(
    el("h2", "TUTORIAL", "kf-tutorial-title"),
    el("p", "Short solo lessons against easy bots.", "kf-how-goal"),
    list,
  );
  return box;
}

function landing(): void {
  const shared = el("label", "", "kf-shared"),
    toggle = el("input");
  toggle.type = "checkbox";
  toggle.checked = store.getItem(names.shared) === "1";
  toggle.onchange = () =>
    store.setItem(names.shared, toggle.checked ? "1" : "0");
  shared.append(toggle, el("span", "Shared TV: phones are the controllers"));
  const card = createLandingCard({
    title: "KILLER FUSE",
    tagline:
      "Three against three in one arena. Kill the Queen, fill the hive or ride the snail home. Bots play every empty seat.",
    soloText: "PLAY SOLO WITH BOTS",
    async onCreate() {
      const room = await createRoom(endpoints.apiUrl, fetch, GAME).catch(
        (error: unknown) => {
          throw new Error(
            roomFailure(error instanceof Error ? error.message : String(error)),
          );
        },
      );
      store.setItem(names.host(room.code), room.token);
      location.href = endpoints.appUrl(`?room=${room.code}`);
    },
    onSolo: () => {
      location.href = endpoints.appUrl("?solo=1");
    },
    valid: validRoomCode,
    onJoin: (code) => {
      location.href = endpoints.appUrl(`?room=${code}`);
    },
  });
  card.create.after(shared);
  const back = el("a", "← FUSE RIDERS", "kf-back");
  back.href = import.meta.env.BASE_URL;
  const page = el("main", "", "kf-landing");
  page.append(card.element, howToPlay(), tutorialList());
  app.replaceChildren(header([back]), page);
}

/** One seat of the lobby: its role, who holds it, and the button that takes it or asks for it. */
function createSeatCard(act: (seat: SeatModel) => void) {
  const root = el("article", "", "kf-seat"),
    role = el("small", "", "kf-seat-role"),
    name = el("strong", "", "kf-seat-name"),
    note = el("p", "", "kf-seat-note"),
    action = button("", "kf-seat-action");
  root.append(role, name, note, action);
  let shown: SeatModel | undefined;
  action.onclick = () => shown && act(shown);
  return {
    root,
    render(seat: SeatModel) {
      shown = seat;
      root.dataset.kind = seat.kind;
      root.dataset.role = seat.role.toLowerCase();
      role.textContent = seat.role;
      name.textContent =
        seat.kind === "you"
          ? `${seat.name} (you)`
          : seat.kind === "away"
            ? `${seat.name} (away)`
            : seat.name;
      note.textContent = seat.note;
      note.hidden = !seat.note;
      action.textContent = seat.label;
      action.hidden = seat.action === "none";
    },
  };
}

function room(solo: boolean): void {
  const session = solo
    ? ({ kind: "solo" } as const)
    : sessionFor(location.search, store, GAME, validRoomCode, secret);
  if (session.kind === "invalid" || session.kind === "landing") {
    app.replaceChildren(header(), el("p", "Invalid room code", "kf-error"));
    return;
  }
  const code = session.kind === "room" ? session.code : "SOLO",
    role = session.kind === "room" ? session.role : "host",
    display = role === "display";
  document.body.classList.toggle("kf-display", display);
  const viewer: Viewer = { me: "", solo, display };
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  // A tutorial lesson (`?solo=1&tutorial=<id>`): an ordinary solo room the page steers into the lesson's seat.
  const lesson = solo ? lessonById(query.get("tutorial")) : undefined;
  let lastFrame: Frame<View> | undefined;
  // The outline on this device's unit: until when, and the unit as the last frame showed it.
  let highlightEnd = 0,
    lastSnap: UnitSnap | undefined;
  let attacks = 0,
    presses = 0,
    progress: Progress = FRESH,
    lessonMatch = "",
    asked = { key: "", at: 0 },
    recorded = false;
  const padConnected = () =>
    typeof navigator.getGamepads === "function" &&
    navigator.getGamepads().some((pad) => pad !== null);

  // ---- controls ----
  const controls = new Controls(
      {
        input: (bits) => runtime.input(bits),
        press: () => {
          if (runtime.press()) presses += 1;
        },
        attack: () => {
          if (runtime.attack()) attacks += 1;
        },
      },
      () => performance.now(),
    ),
    keyboard = new Keys(controls),
    pads = new Pads(controls),
    touch = new Touch(controls);
  controls.setHoldToFlap(holdToFlap);
  const lessonDevice = (): Device =>
    deviceFor({
      last: controls.lastUsed(),
      pad: padConnected(),
      coarse,
      controller: false,
    });
  onHoldToFlap = (on) => controls.setHoldToFlap(on);

  // ---- the page ----
  const status = createNotice({ className: "kf-status" });
  const menu = createGameMenu({
    controls: CONTROLS,
    touchControls: TOUCH_CONTROLS,
    goal: GOAL,
    onLobby: () => runtime.command({ type: "action", action: "lobby" }),
    onLeave: () => {
      runtime.stop();
      location.href = endpoints.appUrl();
    },
    onOpenChange: (open) => {
      if (open) {
        keyboard.clear();
        controls.release();
      }
    },
  });
  // Over the countdown: this seat's controls and the three ways to win.
  const card = el("aside", "", "kf-brief"),
    cardTitle = el("strong", "", "kf-brief-title"),
    cardSub = el("p", "", "kf-brief-sub"),
    cardWins = el("ul", "", "kf-brief-wins"),
    cardControls = el("p", "", "kf-brief-controls");
  card.append(cardTitle, cardSub, cardWins, cardControls);
  card.setAttribute("role", "status");
  card.hidden = true;
  void loadManifest();
  // While people wait in the lobby, a tip every 15 s; the first is the controls of the device last used.
  const tipBox = el("section", "", "kf-tip"),
    tipTitle = el("h3", "", "kf-tip-title"),
    tipHints = el("dl", "", "kf-how-list kf-tip-hints"),
    tipText = el("p", "", "kf-tip-text");
  tipBox.append(tipTitle, tipHints, tipText);
  let lobbySince = performance.now(),
    tipShown = "";
  // `?mute` (previews, smoke runs) silences the page whatever was stored.
  const forcedMute = query.has("mute");
  let muted = forcedMute || store.getItem(MUTED) === "1";
  const mute = button("", "kf-mute");
  const showMute = () => {
    mute.textContent = muted ? "SOUND OFF" : "SOUND ON";
    mute.setAttribute("aria-pressed", String(muted));
    mute.title = muted ? "Turn the sound on" : "Turn the sound off";
  };
  showMute();
  mute.onclick = () => {
    muted = !muted;
    store.setItem(MUTED, muted ? "1" : "0");
    showMute();
    if (model)
      driver.update({
        names: model.arena.names,
        localSlot: model.arena.localSlot,
        muted,
        highlight: performance.now() < highlightEnd,
      });
    mute.blur();
  };
  const codeChip = el("strong", solo ? "SOLO" : code, "kf-code");
  const top = header([codeChip, status.element, mute, menu.element]);

  // Lobby: invitation, the two teams, settings, start.
  const lobby = el("section", "", "kf-lobby"),
    teams = el("div", "", "kf-teams"),
    watchers = el("p", "", "kf-watchers"),
    takeSeat = button("JOIN THE GAME", "kf-take-seat"),
    settingsBox = el("div", "", "kf-settings"),
    settingsLine = el("p", "", "kf-settings-line"),
    start = button("START", "fui-button-primary kf-start"),
    lobbyNote = el("p", "", "fui-lobby-note"),
    tvLink = button("OPEN TV SCREEN", "kf-tv"),
    lobbyActions = el("div", "", "kf-actions");
  if (!solo)
    lobby.append(
      createInviteCard({
        code,
        link: endpoints.appUrl(`?room=${code}`),
        qr: (text) => QRCode.toDataURL(text, { margin: 1, width: 360 }),
      }).element,
    );
  let settings: Settings = DEFAULT_SETTINGS;
  const change = (patch: Partial<Settings>) =>
    runtime.command({ type: "settings", settings: { ...settings, ...patch } });
  const cards = [0, 1].map((team) => {
    const column = el("div", "", `kf-team kf-team-${team ? "pink" : "cyan"}`);
    column.append(el("h3", team ? "PINK" : "CYAN", "kf-team-name"));
    const own = [0, 1, 2].map(() =>
      createSeatCard((seat) => {
        // Asking for the seat this device holds takes a wish back.
        const mine = model?.arena.localSlot ?? -1;
        runtime.seat(
          seat.action === "withdraw" && mine >= 0 ? mine : seat.slot,
        );
      }),
    );
    column.append(...own.map((card) => card.root));
    teams.append(column);
    return own;
  });
  const levelGroup = createRadioGroup({
    legend: "BOTS",
    name: "kf-bots",
    options: BOT_LEVELS,
    selected: settings.botLevel,
    onChange: (botLevel) => change({ botLevel }),
  });
  const mapGroup = createRadioGroup({
    legend: "MAP",
    name: "kf-map",
    options: [
      { value: "0", label: "ROTATE" },
      ...([1, 2, 3] as const).map((id) => ({
        value: String(id),
        label: MAPS[id].name.toUpperCase(),
      })),
    ],
    selected: String(settings.map),
    onChange: (value) => {
      const map = Number(value);
      if (map === 0 || map === 1 || map === 2 || map === 3) change({ map });
    },
  });
  const winsGroup = createRadioGroup({
    legend: "FIRST TO",
    name: "kf-wins",
    options: [1, 2, 3].map((wins) => ({
      value: String(wins),
      label: `${wins} ${wins === 1 ? "WIN" : "WINS"}`,
    })),
    selected: String(settings.wins),
    onChange: (value) => change({ wins: Number(value) }),
  });
  const groups = [
    { group: levelGroup, value: (s: Settings) => s.botLevel },
    { group: mapGroup, value: (s: Settings) => String(s.map) },
    { group: winsGroup, value: (s: Settings) => String(s.wins) },
  ];
  settingsBox.append(...groups.map(({ group }) => group.element));
  lobbyActions.append(tvLink, start);
  lobby.append(
    el("h2", "PICK A SEAT", "fui-lobby-title"),
    teams,
    watchers,
    takeSeat,
    settingsBox,
    settingsLine,
    lobbyNote,
    lobbyActions,
    tipBox,
    howToPlay(),
  );
  start.onclick = () => runtime.command({ type: "action", action: "start" });
  tvLink.onclick = () =>
    window.open(endpoints.appUrl(`?room=${code}&display=1`), "_blank");

  const remembered = seatName(
    social.playerName(store.getItem(names.name)) ?? "",
  );
  const nameEntry = createNameEntry({
    normalize: (raw) => seatName(raw) ?? "",
    initial: social.playerName(store.getItem(names.name)) ?? "",
    onInput: (value) => store.setItem(names.name, value),
    buttonText: "JOIN",
    onSubmit: (name) => {
      store.setItem(names.name, name);
      runtime.command({ type: "join", name });
    },
    secondary: {
      text: "WATCH",
      title: "Watch without a seat",
      onSubmit: (name) => {
        store.setItem(names.name, name);
        runtime.command({ type: "spectate", name });
      },
    },
  });
  takeSeat.onclick = () => {
    const name = seatName(nameEntry.input.value) ?? remembered;
    if (name) runtime.command({ type: "join", name });
  };

  // Arena: the renderer's canvas, the set's score, the banner between games, and the touch controls.
  const arena = el("section", "", "kf-arena"),
    scoreLine = el("p", "", "kf-score"),
    stage = el("div", "", "kf-stage"),
    canvasHost = el("div", "", "kf-canvas"),
    banner = el("div", "", "kf-banner"),
    bannerTitle = el("strong"),
    bannerDetail = el("span"),
    seatLine = el("p", "", "kf-seat-line"),
    touchRow = el("div", "", "kf-touch"),
    stick = el("div", "", "kf-stick"),
    knob = el("i", "", "kf-knob"),
    flap = button("FLAP", "kf-flap"),
    strike = button("ATTACK", "kf-strike");
  strike.hidden = true;
  banner.append(bannerTitle, bannerDetail);
  banner.setAttribute("role", "status");
  stick.append(knob);
  stick.setAttribute("aria-label", "Move: slide left, right or down");
  const buttons = el("div", "", "kf-buttons");
  buttons.append(strike, flap);
  touchRow.append(stick, buttons);
  const lessonBar = el("div", "", "kf-lesson"),
    lessonText = el("p", "", "kf-lesson-text"),
    lessonActions = el("div", "", "kf-lesson-actions");
  lessonBar.append(lessonText, lessonActions);
  lessonBar.setAttribute("role", "status");
  lessonBar.hidden = !lesson;
  stage.append(canvasHost, banner, card, lessonBar);

  // The result of a set, over the arena.
  const result = el("section", "", "kf-result"),
    resultTitle = el("h2", "", "kf-result-title"),
    resultGames = el("ol", "", "kf-result-games"),
    resultPlayers = el("ul", "", "kf-result-players"),
    rematch = button("REMATCH", "fui-button-primary"),
    toLobby = button("LOBBY"),
    resultWaiting = el("p", "", "fui-lobby-note"),
    resultActions = el("div", "", "kf-actions");
  resultActions.append(toLobby, rematch);
  result.append(
    resultTitle,
    resultGames,
    resultPlayers,
    resultWaiting,
    resultActions,
  );
  result.hidden = true;
  stage.append(result);
  arena.append(scoreLine, stage, seatLine, touchRow);
  rematch.onclick = () =>
    runtime.command({ type: "action", action: "rematch" });
  toLobby.onclick = () => runtime.command({ type: "action", action: "lobby" });

  const main = el("main", "", "kf-room");
  main.tabIndex = -1;
  main.append(nameEntry.form, lobby, arena);
  app.replaceChildren(top, main);
  arena.hidden = true;
  nameEntry.form.hidden = true;

  const driver = new ArenaDriver({
    create: createArenaView,
    host: canvasHost,
    artUrl: ART_URL,
    timing: () => runtime.frameTiming(),
  });

  // Touch: the pad follows the thumb from where it came down; the button is the whole right side.
  let stickPointer = -1,
    origin = { x: 0, y: 0 };
  const stickRadius = () => stick.clientWidth / 2;
  stick.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    stickPointer = event.pointerId;
    stick.setPointerCapture(event.pointerId);
    origin = { x: event.clientX, y: event.clientY };
    touch.move(0, 0, stickRadius());
  });
  stick.addEventListener("pointermove", (event) => {
    if (event.pointerId !== stickPointer) return;
    const radius = stickRadius(),
      dx = event.clientX - origin.x,
      dy = event.clientY - origin.y,
      clamp = (value: number) => Math.max(-radius, Math.min(radius, value));
    knob.style.transform = `translate(${clamp(dx)}px, ${clamp(dy)}px)`;
    touch.move(dx, dy, radius);
  });
  const restStick = (event: PointerEvent) => {
    if (event.pointerId !== stickPointer) return;
    stickPointer = -1;
    knob.style.transform = "";
    touch.rest();
  };
  stick.addEventListener("pointerup", restStick);
  stick.addEventListener("pointercancel", restStick);
  flap.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    touch.hold(true);
  });
  for (const type of ["pointerup", "pointercancel", "pointerleave"] as const)
    flap.addEventListener(type, () => touch.hold(false));
  strike.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    touch.strike(true);
  });
  for (const type of ["pointerup", "pointercancel", "pointerleave"] as const)
    strike.addEventListener(type, () => touch.strike(false));
  touchRow.addEventListener("contextmenu", (event) => event.preventDefault());

  let model: PageModel | undefined;
  const render = (next: PageModel) => {
    const first = model?.screen !== next.screen;
    model = next;
    main.dataset.layout = next.layout;
    main.dataset.screen = next.screen;
    lobby.hidden = next.screen !== "lobby";
    arena.hidden = next.screen !== "arena";
    nameEntry.form.hidden = !next.askName;
    nameEntry.submit.hidden = !next.canJoin;
    // Lobby.
    next.lobby.teams.forEach((team, index) =>
      team.seats.forEach((seat, row) => cards[index]![row]!.render(seat)),
    );
    watchers.textContent = next.lobby.watchers.length
      ? `Watching: ${next.lobby.watchers.join(", ")}`
      : "";
    watchers.hidden = next.lobby.watchers.length === 0;
    takeSeat.hidden = !(next.watching && next.canJoin);
    const editable = next.lobby.settings.editable;
    settingsBox.hidden = !editable;
    settingsLine.hidden = editable;
    settingsLine.textContent = next.lobby.settings.summary;
    for (const { group, value } of groups)
      for (const input of group.inputs)
        input.checked = input.value === value(settings);
    start.hidden = !next.lobby.showStart;
    start.disabled = !next.lobby.canStart;
    lobbyNote.textContent = next.lobby.note;
    const offerTv = settings.display && next.host && !solo;
    tvLink.hidden = !offerTv;
    // Arena.
    scoreLine.textContent = next.arena.line;
    banner.hidden = !next.arena.banner;
    banner.dataset.team =
      next.arena.banner?.team === undefined
        ? ""
        : String(next.arena.banner.team);
    bannerTitle.textContent = next.arena.banner?.title ?? "";
    bannerDetail.textContent = next.arena.banner?.detail ?? "";
    seatLine.textContent =
      next.arena.localSlot >= 0
        ? `You are the ${seatTitle(next.arena.localSlot)}`
        : next.screen === "arena"
          ? "Watching"
          : "";
    // The controls card: shown while a game is about to start, for the role and the device this page plays with.
    const device: Device = deviceFor({
      last: controls.lastUsed(),
      pad: padConnected(),
      coarse,
      controller: next.layout === "controller",
    });
    const countdown = next.arena.countdown,
      mySlot = next.seated ? next.arena.localSlot : -1,
      shown = countdown
        ? countdownCard(countdown, mySlot, device, countdown.map)
        : undefined;
    card.hidden = !shown;
    // The card counts down; the banner is for the pause after a game.
    if (shown) banner.hidden = true;
    if (shown) {
      const key = cardKey(shown) + String(Object.keys(sheets).length);
      if (card.dataset.key !== key) {
        card.dataset.key = key;
        card.dataset.team = shown.team === undefined ? "" : String(shown.team);
        card.dataset.first = String(shown.first);
        cardTitle.textContent = shown.title;
        cardTitle.hidden = !shown.title;
        cardSub.textContent = shown.subtitle;
        const pictures = winIcons(sheets, ART_URL, shown.team ?? -1, 40);
        cardWins.replaceChildren(
          ...shown.wins.map((win) => {
            const item = el("li", "", "kf-brief-win"),
              picture = el("i", "", "kf-brief-icon");
            picture.setAttribute("aria-hidden", "true");
            paint(picture, pictures[win.kind]);
            item.dataset.kind = win.kind;
            item.append(picture, el("span", win.caption));
            return item;
          }),
        );
        cardWins.hidden = shown.wins.length === 0;
        cardControls.replaceChildren(
          ...shown.controls.flatMap((hint, index) => [
            ...(index ? [el("span", " · ", "kf-brief-dot")] : []),
            el("kbd", hint.keys),
            el("span", ` ${hint.action}`),
          ]),
        );
        cardControls.hidden = shown.controls.length === 0;
      }
    }
    // Lobby tips.
    if (next.screen !== "lobby") lobbySince = performance.now();
    else {
      const tips = lobbyTips(device),
        index = tipIndex(performance.now() - lobbySince, tips.length),
        tip = tips[index]!,
        key = `${index}:${device}`;
      if (tipShown !== key) {
        tipShown = key;
        tipTitle.textContent = `TIP · ${tip.title}`;
        tipHints.replaceChildren(
          ...tip.hints.flatMap((hint) => [
            el("dt", hint.keys),
            el("dd", hint.action),
          ]),
        );
        tipHints.hidden = tip.hints.length === 0;
        tipText.textContent = tip.text;
        tipText.hidden = !tip.text;
      }
    }
    touchRow.hidden = !(
      next.seated &&
      next.arena.localSlot >= 0 &&
      !next.result &&
      (coarse || next.layout === "controller")
    );
    // Result.
    result.hidden = !next.result;
    if (next.result) {
      result.dataset.team = String(next.result.team);
      resultTitle.textContent = next.result.title;
      const key = [...next.result.games, ...next.result.players].join("\n");
      if (result.dataset.lines !== key) {
        result.dataset.lines = key;
        resultGames.replaceChildren(
          ...next.result.games.map((line) => el("li", line)),
        );
        resultPlayers.replaceChildren(
          ...next.result.players.map((line) => el("li", line)),
        );
      }
      resultActions.hidden = !next.result.host;
      resultWaiting.textContent = next.result.waiting;
      resultWaiting.hidden = !next.result.waiting;
    }
    // START keeps the focus when the game begins; Space must flap, not press it again.
    if (first && next.screen === "arena") {
      if (document.activeElement instanceof HTMLElement)
        document.activeElement.blur();
      main.focus({ preventScroll: true });
    }
  };

  // ---- the runtime ----
  const sent = new Set<string>();
  let joinSent = false;
  const callbacks: KillerFuseCallbacks = {
    state(frame, roomSettings) {
      lastFrame = frame;
      settings = roomSettings;
      const next = present(frame, viewer),
        mode = solo ? "solo" : roomSettings.display ? "shared" : "online",
        between = frame.stage === "running" || frame.stage === "between";
      reportPlay({
        matchId: frame.matchId,
        active: between,
        ended: frame.stage === "over",
        round: Math.max(1, frame.round),
        playerCount: next.humans + next.bots,
        botCount: next.bots,
        seated: next.seated,
        mode,
      });
      reportGame(frame, viewer.me, runtime.confirmedTick(), mode);
      const spectator = display || !next.seated;
      menu.update({
        canLobby: next.host && frame.stage !== "lobby",
        display,
        touch: coarse || roomSettings.display,
        spectator,
      });
      // For the browser smoke and the stylesheet.
      main.dataset.stage = frame.stage;
      main.dataset.round = String(frame.round);
      main.dataset.winner = frame.stage === "over" ? String(frame.winner) : "";
      // A page that loads into a room with a name remembered from before (a reload frees a lobby seat) joins under
      // it once; a name typed on this page joins only through JOIN.
      if (next.askName && next.canJoin && remembered && !joinSent) {
        joinSent = true;
        runtime.command({ type: "join", name: remembered });
      }
      if (next.seated) joinSent = false;
      render(next);
      if (lesson) {
        const mine = frame.seats.find((seat) => seat.id === viewer.me),
          action = setupAction(
            {
              stage: frame.stage,
              slot: mine && !mine.watcher ? mine.slot : -1,
              settings: roomSettings,
            },
            lesson,
            progress.outcome,
          );
        if (frame.matchId !== lessonMatch) {
          lessonMatch = frame.matchId;
          progress = FRESH;
          recorded = false;
        }
        const key = `${action}:${frame.stage}:${frame.matchId}`,
          now = performance.now();
        if (action !== "none" && (asked.key !== key || now - asked.at > 1500)) {
          asked = { key, at: now };
          if (action === "seat") runtime.seat(lesson.slot);
          else if (action === "settings")
            runtime.command({
              type: "settings",
              settings: tutorialSettings(roomSettings, lesson),
            });
          else runtime.command({ type: "action", action });
        }
        const world = frame.world,
          facts =
            world && next.arena.localSlot === lesson.slot && next.playing
              ? factsOf(world, lesson.slot, {
                  kills: frame.stats[viewer.me]?.kills ?? 0,
                  presses,
                  attacks,
                })
              : undefined;
        if (facts && action === "none")
          progress = advance(lesson, progress, facts);
        let line = stepText(lesson, progress, lessonDevice());
        if (progress.outcome === "won" && world) {
          const seconds = playSeconds(world.step);
          const best = recorded
            ? (bestTime(store, lesson.id) ?? seconds)
            : recordTime(store, lesson.id, seconds);
          recorded = true;
          line = `${line} in ${seconds} s · best ${best} s`;
        }
        lessonText.textContent = line;
        const done = progress.outcome === "won",
          following = LESSONS[LESSONS.indexOf(lesson) + 1];
        if (lessonActions.dataset.done !== String(done)) {
          lessonActions.dataset.done = String(done);
          const links: HTMLElement[] = [];
          if (done && following) {
            const next = el("a", `NEXT: ${following.title}`, "fui-button");
            next.href = endpoints.appUrl(`?solo=1&tutorial=${following.id}`);
            links.push(next);
          }
          const back = el("a", "LESSONS", "fui-button");
          back.href = endpoints.appUrl();
          links.push(back);
          lessonActions.replaceChildren(...links);
        }
        lessonBar.dataset.outcome = progress.outcome;
      }
      const kind = frame.world?.units[next.arena.localSlot]?.kind;
      flap.textContent = buttonLabel(kind);
      // Workers have no sword.
      strike.hidden = kind === undefined || kind === "worker";
      const unit = frame.world?.units[next.arena.localSlot],
        snap: UnitSnap | undefined = unit && {
          game: `${frame.matchId}:${frame.round}`,
          live: frame.stage === "running" && frame.logTick >= frame.startAt,
          dead: unit.dead,
          kind: unit.kind,
          speed: unit.speed,
        };
      highlightEnd = highlightUntil(
        lastSnap,
        snap,
        performance.now(),
        highlightEnd,
      );
      lastSnap = snap;
      driver.update({
        names: next.arena.names,
        localSlot: next.arena.localSlot,
        muted,
        highlight: performance.now() < highlightEnd,
      });
      driver.feed(frame, next.layout === "arena");
      const state = runtime.roomState();
      if (session.kind === "room" && role !== "display" && state)
        for (const report of dueReports(
          state,
          viewer.me,
          runtime.confirmedTick(),
          sent,
        )) {
          sent.add(report.key);
          void sendReport(
            endpoints.apiUrl(`/api/games/${GAME}/rooms/${code}/${report.path}`),
            report,
            {
              fetch: social.reportFetch,
              roomToken: session.token,
            },
          );
        }
    },
    event() {
      // Everything shown comes from the view: a rollback can undo what an event said.
    },
    status(text) {
      const shown = roomFailure(text);
      status.show(shown, shown === text ? "info" : "error");
    },
    ready(id) {
      viewer.me = id;
    },
    ended() {
      status.show("Room ended", "error");
      // A service that does not host this game closes the socket the same way: its game routes say which it was.
      void fetch(endpoints.apiUrl(`/api/games/${GAME}/leaderboard`))
        .then(async (response) => {
          const body = (await response.json()) as { error?: unknown };
          const text = roomFailure(String(body.error ?? ""));
          if (text === NOT_OPEN) status.show(text, "error");
        })
        .catch(() => {
          /* offline: "Room ended" stands */
        });
    },
  };
  const shared =
    !solo && role === "host" && store.getItem(names.shared) === "1";
  const runtime = new KillerFuseRuntime(
    code,
    { ...DEFAULT_SETTINGS, display: shared },
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
  // `?debug`: what a browser smoke reads (the newest frame and the netcode's own health, hash checks included).
  if (query.has("debug"))
    window.__killerFuse = {
      frame: () => lastFrame,
      metrics: () => runtime.metrics(),
      confirmedTick: () => runtime.confirmedTick(),
      me: () => viewer.me,
    };
  let frameRequest = 0;
  const loop = () => {
    frameRequest = requestAnimationFrame(loop);
    if (!menu.isOpen()) pads.poll(navigator.getGamepads());
    controls.pulse();
    runtime.flush();
    driver.draw();
  };
  installRoomLifecycle(window, {
    stop: () => runtime.stop(),
    destroy: () => {
      cancelAnimationFrame(frameRequest);
      driver.close();
      menu.dispose();
    },
    reload: () => location.reload(),
  });
  // The keys play only while a game is on: in the lobby and on the result, Space presses the focused button.
  const inGame = () =>
    (main.dataset.stage === "running" || main.dataset.stage === "between") &&
    !menu.isOpen();
  document.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLInputElement || !inGame()) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (!gameKey(event.code)) return;
    event.preventDefault();
    if (!event.repeat) keyboard.press(event.code);
  });
  document.addEventListener("keyup", (event) => keyboard.lift(event.code));
  window.addEventListener("blur", () => {
    keyboard.clear();
    controls.release();
  });
  window.addEventListener("resize", () => driver.resize());
  runtime.start();
  frameRequest = requestAnimationFrame(loop);
}

if (query.get("solo") === "1") room(true);
else if (query.has("room")) room(false);
else landing();
