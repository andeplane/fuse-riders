import "@fontsource-variable/nunito";
import "fuse-ui/tokens.css";
import "fuse-ui/components.css";
import "fuse-ui/portal.css";
import "./fuseLane.css";
import QRCode from "qrcode";
import {
  PeerTransport,
  createEndpoints,
  installRoomLifecycle,
  validRoomCode,
} from "fuse-network-fe";
import { MAX_PACKET_BYTES, uuid } from "fuse-netcode";
import {
  button,
  createAppPortal,
  createInviteCard,
  createNameEntry,
  createNotice,
  createRoster,
  el,
} from "fuse-ui";
import {
  DEFAULT_SETTINGS,
  GOAL_MAX,
  GOAL_MIN,
  GOAL_NAMES,
  WEEK_SECONDS,
  CITY,
  PLACES,
  fuseLaneGame,
  seatName,
  type FuseLaneSettings,
  type FuseLaneView,
} from "../game/index.js";
import { createArt, siteBase, type ArtImage } from "./art.js";
import { drawBoard } from "./board.js";
import { boardView, centreOn } from "./layout.js";
import { LocalMatch } from "./local.js";
import { LocalRuntime } from "./local-runtime.js";
import {
  SETUP_KEY,
  chooseSetup,
  createMenu,
  parseStoredSetup,
  playedChoice,
  rememberPlayed,
  type MenuChoice,
} from "./menu.js";
import { present, type Viewer } from "./presenter.js";
import { dueReports, sendReport } from "./reports.js";
import { FuseLaneRuntime, type FuseLaneCallbacks } from "./runtime.js";
import { markToured, owesTour, tourSteps } from "./tour.js";
import {
  advance,
  checklistModel,
  hideChecklist,
  loadChecklist,
  saveChecklist,
} from "./checklist.js";
import { createGameScreen, text } from "./screen.js";
import {
  NOT_OPEN,
  keys,
  roomFailure,
  safeStore,
  sessionFor,
} from "./session.js";

/**
 * The Fusetown page (game id `fuse-lane`): the menu, a match on this device (solo or pass-and-play, driven by `LocalRuntime`) and, by
 * link only for now, an online room on the shared netcode. The decisions live in the presenter, the menu's pure
 * helpers, the local match and the board's geometry; this file wires them to the page.
 */
const GAME = fuseLaneGame.id;
/** The site root, also under a relative base (a static preview copied to any folder). */
const BASE = siteBase(import.meta.env.BASE_URL, import.meta.url);
const endpoints = createEndpoints(
  {
    basePath: `${BASE}${GAME}/`,
    apiOrigin: import.meta.env.VITE_API_ORIGIN,
  },
  location.origin,
);
const store = safeStore(() => localStorage);
/** `?debug-roads`: draw the street graph and the tap outlines over the map. */
const screenOptions = {
  debugRoads: new URLSearchParams(location.search).has("debug-roads"),
};
const names = keys(GAME);
const secret = () => uuid().replaceAll("-", "") + uuid().replaceAll("-", "");
const art = createArt(BASE, () => new Image() as unknown as ArtImage);
const app = document.querySelector<HTMLElement>("#app")!;
const localDeps = {
  now: () => performance.now(),
  every: (callback: () => void, ms: number) => {
    const handle = setInterval(callback, ms);
    return () => clearInterval(handle);
  },
  store,
};

/**
 * The top bar. `allGames` adds an "ALL GAMES" button that opens the app portal's list of games: the site root is
 * Fuse Riders itself, not a list of games, so the button must not link there.
 */
function header(extra: HTMLElement[] = [], allGames = false): HTMLElement {
  const bar = el("header", "", "fl-top"),
    brand = el("a", "", "fl-brand");
  brand.href = endpoints.appUrl();
  brand.append(el("span", "FUSETOWN"), el("small", "A FUSE GAME"));
  const portal = createAppPortal({
    document,
    current: GAME,
    base: BASE,
    search: location.search,
  });
  bar.append(portal.element, brand, ...extra);
  if (allGames) {
    const button = el("button", "ALL GAMES", "fl-back");
    button.type = "button";
    button.addEventListener("click", () => portal.open());
    bar.append(button);
  }
  return bar;
}

/** A still picture of the city for the menu: the board with nobody on it, redrawn while its pictures load. */
function cityPicture(): HTMLElement {
  const frame = el("div", "", "fl-city"),
    canvas = el("canvas");
  canvas.setAttribute("aria-hidden", "true");
  frame.append(canvas);
  const places = PLACES.map((place, index) => ({
    index,
    id: place.id,
    name: place.name,
    hours: 0,
    here: false,
    dest: false,
    work: false,
  }));
  const paint = () => {
    const box = frame.getBoundingClientRect();
    if (box.width < 10 || box.height < 10) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(box.width * ratio);
    canvas.height = Math.round(box.height * ratio);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const view = boardView(box.width, box.height, CITY.map, undefined, false);
    drawBoard(
      context,
      view,
      centreOn(view, [CITY.map.width / 2, CITY.map.height / 2]),
      {
        places,
        players: [],
        before: new Map(),
        fraction: 1,
        time: 0,
        hover: -1,
      },
      art,
      ratio,
    );
  };
  for (const ms of [0, 250, 800, 2000, 4000]) setTimeout(paint, ms);
  return frame;
}

// ---- the menu --------------------------------------------------------------------------------------------------

function summary(match: LocalMatch): string {
  const room = match.room,
    seats = [...room.seats.values()].filter((seat) => !seat.watcher);
  const people = seats.filter((seat) => !seat.bot).map((seat) => seat.name),
    bots = seats.length - people.length;
  return `Week ${room.week} · ${people.join(", ")}${bots ? ` vs ${bots} AI` : ""}`;
}

function menu(): void {
  const saved = LocalRuntime.saved(store);
  app.replaceChildren(
    header([], true),
    createMenu({
      art,
      store,
      ...(saved ? { saved: summary(saved) } : {}),
      onStart: (choice) => startLocal(choice),
      onResume: () => {
        const match = LocalRuntime.saved(store);
        if (match) local(match, true);
        else menu();
      },
      onDiscard: () => LocalRuntime.forget(store),
    }),
  );
  app.querySelector(".fl-hero")?.append(cityPicture());
  window.scrollTo(0, 0);
}

// ---- a match on this device ------------------------------------------------------------------------------------

const seed = () => `lane-${uuid().slice(0, 12)}`;
function startLocal(choice: MenuChoice): void {
  const match = LocalMatch.create(chooseSetup(choice, seed()));
  rememberPlayed(store, match.room.matchId, choice);
  local(match);
}

let leaveLocal: (() => void) | undefined;
/** Plays `match` on this device; a `resumed` save opens on the PAUSED card, as does a page opened in the background. */
function local(match: LocalMatch, resumed = false): void {
  leaveLocal?.();
  const viewer: Viewer = {
    me: "",
    host: true,
    solo: true,
    display: false,
    shared: false,
    local: true,
  };
  const pause = button("", "fl-icon-button fl-pause"),
    quit = button("", "fl-icon-button fl-quit");
  quit.setAttribute("aria-label", "Save and go to the menu");
  quit.append(el("span", "", "fl-icon-menu"));
  const checks = loadChecklist(store, match.room.matchId);
  const screen = createGameScreen(
    art,
    viewer,
    () => runtime,
    {
      controls: [pause, quit],
      checklist: {
        fold: (open) => {
          checks.open = open;
          saveChecklist(store, checks);
        },
        hide: (owner, hidden) => {
          hideChecklist(checks, owner, hidden);
          saveChecklist(store, checks);
        },
      },
      again: {
        label: "PLAY AGAIN",
        run: () => startLocal(playedChoice(store, match.room.matchId)),
      },
      back: { label: "MENU", run: () => toMenu() },
    },
    screenOptions,
  );
  const paused = el("section", "", "fl-sheet fl-paused"),
    resume = button("RESUME", "fl-primary"),
    howTo = button("HOW TO PLAY"),
    saveQuit = button("SAVE AND QUIT");
  paused.append(
    el("h2", "PAUSED", "fl-banner"),
    el(
      "p",
      "The clock is stopped. Your game is saved on this device.",
      "fl-hint",
    ),
    resume,
    howTo,
    saveQuit,
  );
  paused.hidden = true;
  screen.centre.append(paused);
  const main = el("main", "", "fl-room fl-playing");
  main.append(...screen.elements);
  // The clock is stopped: a tap on the map, a place, a place's card or CALL IT A WEEK would do nothing, so it points
  // at RESUME instead of being swallowed. The pause and menu buttons, the you panel, closing a panel, the checklist
  // and the tip still work.
  main.addEventListener(
    "click",
    (event) => {
      if (!runtime.paused || screen.touring() || paused.hidden) return;
      const target = event.target as Element | null;
      if (
        !target?.closest?.(
          ".fl-stage, .fl-strip, .fl-end-week, .fl-panel:not(.fl-you) .fl-card",
        )
      )
        return;
      event.stopPropagation();
      event.preventDefault();
      paused.classList.remove("nudge");
      void paused.offsetWidth; // restart the animation
      paused.classList.add("nudge");
      resume.focus();
    },
    true,
  );
  app.replaceChildren(main);
  window.scrollTo(0, 0);

  // The first game on this device opens with the tour, once someone's week is on screen, with the clock stopped.
  let owed = owesTour(store);
  const showTour = (view: FuseLaneView, then: () => void) => {
    screen.tour(tourSteps(view), then);
    showPaused();
  };
  const showPaused = () => {
    const touring = screen.touring();
    paused.hidden = !runtime.paused || touring;
    screen.game.classList.toggle("paused", runtime.paused && !touring);
  };
  const runtime = new LocalRuntime(
    match,
    (view) => {
      const model = present(view, viewer);
      // Whoever plays on this device now ticks off their own "Getting started" steps.
      const who =
        view.current || view.players.find((player) => !player.bot)?.id || "";
      const me = view.players.find((player) => player.id === who)?.state;
      if (model.hud && me) {
        if (advance(checks, who, me)) saveChecklist(store, checks);
        model.checklist = checklistModel(checks, who, me);
      }
      main.dataset.phase = view.phase;
      main.dataset.week = String(view.week);
      main.dataset.part = view.part;
      main.dataset.current = view.current;
      screen.render(model);
      if (owed && model.hud && view.part === "week" && !resumed) {
        owed = false;
        runtime.setPaused(true);
        showTour(view, () => {
          markToured(store);
          runtime.setPaused(false);
        });
      }
      showPaused();
      pause.classList.toggle("on", runtime.paused);
      pause.setAttribute(
        "aria-label",
        runtime.paused ? "Resume the clock" : "Pause the clock",
      );
      pause.hidden = view.phase !== "running";
    },
    localDeps,
  );
  const setPaused = (on: boolean) => runtime.setPaused(on);
  pause.onclick = () => setPaused(!runtime.paused);
  resume.onclick = () => setPaused(false);
  howTo.onclick = () => showTour(match.view(), showPaused);
  const toMenu = () => {
    runtime.stop();
    leaveLocal = undefined;
    cleanup();
    menu();
  };
  quit.onclick = toMenu;
  saveQuit.onclick = toMenu;
  // A phone that locks or switches app pauses the clock rather than burning a turn.
  const onVisibility = () => {
    if (document.hidden && match.room.stage === "running") setPaused(true);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.repeat) return;
    if (screen.touring()) {
      // The tour's own keys (arrows, Escape); Enter on its focused button already presses it.
      if (!(event.key === "Enter" && event.target instanceof HTMLButtonElement))
        screen.keydown(event);
      return;
    }
    // Typing in a field, or Enter/Space pressing a focused button, is not a game key.
    if (
      event.target instanceof HTMLInputElement ||
      (event.target instanceof HTMLButtonElement &&
        (event.key === "Enter" || event.key === " "))
    )
      return;
    if (event.key === "p") {
      if (match.room.stage === "running") setPaused(!runtime.paused);
    }
    // The clock is stopped: no key plays (or skips a handoff) until RESUME.
    else if (!runtime.paused) screen.keydown(event);
  };
  const onHide = () => runtime.save();
  document.addEventListener("visibilitychange", onVisibility);
  document.addEventListener("keydown", onKey);
  window.addEventListener("pagehide", onHide);
  const cleanup = () => {
    screen.destroy();
    document.removeEventListener("visibilitychange", onVisibility);
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("pagehide", onHide);
  };
  leaveLocal = () => {
    runtime.stop();
    cleanup();
  };
  runtime.start(resumed || document.hidden);
}

// ---- an online room (by link: ?room=CODE) ---------------------------------------------------------------------

function room(): void {
  const session = sessionFor(
    location.search,
    store,
    GAME,
    validRoomCode,
    secret,
  );
  if (session.kind !== "room") {
    app.replaceChildren(header(), el("p", "Invalid room code", "fl-error"));
    return;
  }
  const { code, role } = session,
    display = role === "display";
  document.body.classList.toggle("fl-display", display);
  const viewer: Viewer = {
    me: "",
    host: false,
    solo: false,
    display,
    shared: false,
  };
  let settings: FuseLaneSettings = { ...DEFAULT_SETTINGS };

  const status = createNotice({ className: "fl-status" }),
    leave = button("LEAVE", "fl-leave");
  leave.onclick = () => {
    runtime.stop();
    location.href = endpoints.appUrl();
  };
  const top = header([el("strong", code, "fl-code"), status.element, leave]);

  // Lobby: invitation, roster, goals, week length, start.
  const lobby = el("section", "", "fl-lobby fl-sheet"),
    roster = createRoster({ emptyText: "Nobody has joined yet" }),
    addBot = button("+ ADD BOT", "fl-add-bot"),
    start = button("START MATCH", "fui-button-primary fl-start"),
    lobbyNote = el("p", "", "fui-lobby-note");
  lobby.append(
    createInviteCard({
      code,
      link: endpoints.appUrl(`?room=${code}`),
      qr: (value) => QRCode.toDataURL(value, { margin: 1, width: 360 }),
    }).element,
  );
  const goalPicker = el("div", "", "fl-goal-picker");
  const goalInputs = GOAL_NAMES.map((name) => {
    const row = el("label", "", "fl-goal-pick"),
      input = el("input"),
      value = el("b", "");
    input.type = "range";
    input.min = String(GOAL_MIN);
    input.max = String(GOAL_MAX);
    input.step = "10";
    input.oninput = () => text(value, input.value);
    input.onchange = () =>
      runtime.setGoals(goalInputs.map((goal) => Number(goal.input.value)));
    row.append(el("span", name), input, value);
    goalPicker.append(row);
    return { input, value };
  });
  const weekPicker = el("div", "", "fl-segmented");
  const weekButtons = WEEK_SECONDS.map((seconds) => {
    const choice = button(`${seconds}s`, "fl-segment");
    choice.onclick = () =>
      runtime.command({
        type: "settings",
        settings: { ...settings, weekSeconds: seconds },
      });
    weekPicker.append(choice);
    return { seconds, choice };
  });
  const nameEntry = createNameEntry({
    normalize: (raw) => seatName(raw) ?? "",
    initial: store.getItem(names.name) ?? "",
    onInput: (value) => store.setItem(names.name, value),
    buttonText: "JOIN",
    onSubmit: (name) => {
      store.setItem(names.name, name);
      runtime.command({ type: "join", name });
    },
  });
  const lobbyActions = el("div", "", "fl-actions");
  lobbyActions.append(addBot, start);
  lobby.append(
    el("h2", "PLAYERS", "fui-lobby-title"),
    roster.element,
    el("h2", "YOUR GOALS", "fui-lobby-title"),
    goalPicker,
    el("h2", "WEEK LENGTH", "fui-lobby-title"),
    weekPicker,
    lobbyNote,
    lobbyActions,
  );
  addBot.onclick = () => runtime.command({ type: "bot", action: "add" });
  start.onclick = () => runtime.command({ type: "action", action: "start" });

  const leaveGame = button("", "fl-icon-button fl-quit");
  leaveGame.setAttribute("aria-label", "Leave the room");
  leaveGame.append(el("span", "", "fl-icon-menu"));
  leaveGame.onclick = () => leave.click();
  const screen = createGameScreen(
    art,
    viewer,
    () => runtime,
    {
      controls: [leaveGame],
      again: {
        label: "REMATCH",
        run: () => runtime.command({ type: "action", action: "rematch" }),
      },
      back: {
        label: "LOBBY",
        run: () => runtime.command({ type: "action", action: "lobby" }),
      },
    },
    screenOptions,
  );
  const main = el("main", "", "fl-room");
  main.append(nameEntry.form, lobby, ...screen.elements);
  app.replaceChildren(top, main);

  const sent = new Set<string>();
  const remembered = seatName(store.getItem(names.name) ?? "");
  let joinSent = false;
  const callbacks: FuseLaneCallbacks = {
    state(frame, roomSettings) {
      settings = roomSettings;
      viewer.shared = roomSettings.display;
      const model = present(frame, viewer);
      main.dataset.phase = frame.phase;
      main.dataset.week = String(frame.week);
      main.dataset.part = frame.part;
      lobby.hidden = model.screen !== "lobby";
      screen.game.hidden = model.screen === "lobby";
      nameEntry.form.hidden = !model.askName;
      roster.update(model.lobby.members);
      for (const [id, row] of roster.entries()) {
        let remove = row.querySelector<HTMLButtonElement>(".fl-remove");
        const removable = model.lobby.removable.includes(id);
        if (removable && !remove) {
          remove = button("×", "fl-remove");
          remove.setAttribute("aria-label", "Remove bot");
          remove.onclick = () =>
            runtime.command({ type: "bot", action: "remove", id });
          row.append(remove);
        }
        if (remove) remove.hidden = !removable;
      }
      addBot.hidden = !model.lobby.canAddBot;
      start.hidden = !model.lobby.showStart;
      start.disabled = !model.lobby.canStart;
      text(lobbyNote, model.lobby.note);
      lobbyNote.hidden = !model.lobby.note;
      goalInputs.forEach((goal, index) => {
        goal.input.disabled = !model.lobby.canPickGoals;
        if (document.activeElement !== goal.input) {
          goal.input.value = String(model.lobby.goals[index]);
          text(goal.value, String(model.lobby.goals[index]));
        }
      });
      for (const { seconds, choice } of weekButtons) {
        choice.classList.toggle("on", model.lobby.weekSeconds === seconds);
        choice.disabled = !model.lobby.canSetWeek;
      }
      if (model.askName && remembered && !joinSent) {
        joinSent = true;
        runtime.command({ type: "join", name: remembered });
      }
      if (model.seated) joinSent = false;
      screen.render(model);
      const state = runtime.roomState();
      if (role !== "display" && state)
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
              fetch: (input, init) => fetch(input, init),
              roomToken: session.token,
            },
          );
        }
    },
    event() {
      // Everything shown comes from the view: a rollback can undo a hire after its event was emitted.
    },
    status(message) {
      const shown = roomFailure(message);
      status.show(shown, shown === message ? "info" : "error");
    },
    ready(id, host) {
      viewer.me = id;
      viewer.host = host;
    },
    ended() {
      status.show("Room ended", "error");
      void fetch(endpoints.apiUrl(`/api/games/${GAME}/leaderboard`))
        .then(async (response) => {
          const body = (await response.json()) as { error?: unknown };
          const shown = roomFailure(String(body.error ?? ""));
          if (shown === NOT_OPEN) status.show(shown, "error");
        })
        .catch(() => {
          /* offline: "Room ended" stands */
        });
    },
  };
  const runtime = new FuseLaneRuntime(
    code,
    {
      ...DEFAULT_SETTINGS,
      display: role === "host" && store.getItem(names.shared) === "1",
    },
    callbacks,
    {
      transport: (events) =>
        new PeerTransport(code, session.token, events, {
          apiUrl: endpoints.apiUrl,
          gameId: GAME,
          maxFastBytes: MAX_PACKET_BYTES,
        }),
      displayOnly: display,
    },
  );
  installRoomLifecycle(window, {
    stop: () => runtime.stop(),
    destroy: () => {},
    reload: () => location.reload(),
  });
  document.addEventListener("keydown", (event) => {
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLButtonElement ||
      event.repeat
    )
      return;
    screen.keydown(event);
  });
  runtime.start();
}

const query = new URLSearchParams(location.search);
if (query.has("room")) room();
else if (query.get("solo") === "1") {
  // A quick game with the remembered setup (or one player against one AI): the menu's START without the menu.
  // A reload (pull to refresh, a discarded tab) picks the saved game up again rather than overwriting it.
  const saved = LocalRuntime.saved(store);
  if (saved) local(saved, true);
  else startLocal(parseStoredSetup(store.getItem(SETUP_KEY)));
} else menu();
