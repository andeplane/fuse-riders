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
  fuseLaneGame,
  seatName,
  type FuseLaneSettings,
} from "../game/index.js";
import { createArt, type ArtImage } from "./art.js";
import { LocalMatch } from "./local.js";
import { LocalRuntime } from "./local-runtime.js";
import {
  SETUP_KEY,
  chooseSetup,
  createMenu,
  parseStoredSetup,
  type MenuChoice,
} from "./menu.js";
import { present, type Viewer } from "./presenter.js";
import { dueReports, sendReport } from "./reports.js";
import { FuseLaneRuntime, type FuseLaneCallbacks } from "./runtime.js";
import { createGameScreen, text } from "./screen.js";
import {
  NOT_OPEN,
  keys,
  roomFailure,
  safeStore,
  sessionFor,
} from "./session.js";

/**
 * The Fuse Lane page: the menu, a match on this device (solo or pass-and-play, driven by `LocalRuntime`) and, by
 * link only for now, an online room on the shared netcode. The decisions live in the presenter, the menu's pure
 * helpers, the local match and the board's geometry; this file wires them to the page.
 */
const GAME = fuseLaneGame.id;
const endpoints = createEndpoints(
  {
    basePath: `${import.meta.env.BASE_URL}${GAME}/`,
    apiOrigin: import.meta.env.VITE_API_ORIGIN,
  },
  location.origin,
);
const store = safeStore(() => localStorage);
const names = keys(GAME);
const secret = () => uuid().replaceAll("-", "") + uuid().replaceAll("-", "");
const art = createArt(
  import.meta.env.BASE_URL,
  () => new Image() as unknown as ArtImage,
);
const app = document.querySelector<HTMLElement>("#app")!;
const localDeps = {
  now: () => performance.now(),
  every: (callback: () => void, ms: number) => {
    const handle = setInterval(callback, ms);
    return () => clearInterval(handle);
  },
  store,
};

function header(extra: HTMLElement[] = []): HTMLElement {
  const bar = el("header", "", "fl-top"),
    brand = el("a", "", "fl-brand");
  brand.href = endpoints.appUrl();
  brand.append(el("span", "FUSE LANE"), el("small", "A FUSE GAME"));
  const portal = createAppPortal({
    document,
    current: GAME,
    base: import.meta.env.BASE_URL,
    search: location.search,
  });
  bar.append(portal.element, brand, ...extra);
  return bar;
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
  const back = el("a", "← ALL GAMES", "fl-back");
  back.href = import.meta.env.BASE_URL;
  app.replaceChildren(
    header([back]),
    createMenu({
      art,
      store,
      ...(saved ? { saved: summary(saved) } : {}),
      onStart: (choice) => startLocal(choice),
      onResume: () => {
        const match = LocalRuntime.saved(store);
        if (match) local(match);
        else menu();
      },
      onDiscard: () => LocalRuntime.forget(store),
    }),
  );
  window.scrollTo(0, 0);
}

// ---- a match on this device ------------------------------------------------------------------------------------

const seed = () => `lane-${uuid().slice(0, 12)}`;
function startLocal(choice: MenuChoice): void {
  local(LocalMatch.create(chooseSetup(choice, seed())));
}

let leaveLocal: (() => void) | undefined;
function local(match: LocalMatch): void {
  leaveLocal?.();
  const viewer: Viewer = {
    me: "",
    host: true,
    solo: true,
    display: false,
    shared: false,
    local: true,
  };
  const pause = button("PAUSE", "fl-leave fl-pause"),
    quit = button("MENU", "fl-leave");
  const top = header([pause, quit]);
  const screen = createGameScreen(art, viewer, () => runtime, {
    again: {
      label: "PLAY AGAIN",
      run: () => startLocal(parseStoredSetup(store.getItem(SETUP_KEY))),
    },
    back: { label: "MENU", run: () => toMenu() },
  });
  const paused = el("section", "", "fl-overlay fl-paused"),
    pausedCard = el("div", "", "fl-sheet fl-paused-card"),
    resume = button("RESUME", "fui-button-primary"),
    saveQuit = button("SAVE AND QUIT");
  pausedCard.append(
    el("h2", "PAUSED", "fl-result-title"),
    el(
      "p",
      "The clock is stopped. Your game is saved on this device.",
      "fl-hint",
    ),
    resume,
    saveQuit,
  );
  paused.append(pausedCard);
  paused.hidden = true;
  const main = el("main", "", "fl-room");
  main.append(...screen.elements, paused);
  app.replaceChildren(top, main);
  window.scrollTo(0, 0);

  const runtime = new LocalRuntime(
    match,
    (view) => {
      const model = present(view, viewer);
      main.dataset.phase = view.phase;
      main.dataset.week = String(view.week);
      main.dataset.part = view.part;
      main.dataset.current = view.current;
      screen.render(model);
      paused.hidden = !runtime.paused;
      text(pause, runtime.paused ? "RESUME" : "PAUSE");
      pause.hidden = view.phase !== "running";
    },
    localDeps,
  );
  const setPaused = (on: boolean) => runtime.setPaused(on);
  pause.onclick = () => setPaused(!runtime.paused);
  resume.onclick = () => setPaused(false);
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
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLButtonElement ||
      event.repeat
    )
      return;
    if (event.key === "p") setPaused(!runtime.paused);
    else screen.keydown(event);
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
  runtime.start();
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

  const screen = createGameScreen(art, viewer, () => runtime, {
    again: {
      label: "REMATCH",
      run: () => runtime.command({ type: "action", action: "rematch" }),
    },
    back: {
      label: "LOBBY",
      run: () => runtime.command({ type: "action", action: "lobby" }),
    },
  });
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
else if (query.get("solo") === "1")
  // A quick game with the remembered setup (or one player against one AI): the menu's START without the menu.
  startLocal(parseStoredSetup(store.getItem(SETUP_KEY)));
else menu();
