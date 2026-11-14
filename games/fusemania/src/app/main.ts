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
  type ClockedSong,
} from "fuse-ui/game-audio";
import "fuse-ui/game-audio.css";
import { safeStorage } from "fuse-ui/safe-storage";
import "./fusemania.css";
import "./song-picker.css";
import "./settings.css";
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
  createTopBar,
  el,
} from "fuse-ui";
import {
  BATTLE_MODE,
  CAPACITY,
  COLUMNS,
  MAX_SIMFILE_BYTES,
  SCORE_MODE,
  createLibrary,
  type Library,
  type Steps,
  type WorldView,
} from "../engine/index.js";
import { GAME_ID } from "../basics.js";
import {
  createFusemaniaGame,
  type Settings,
  type View,
} from "../online/game.js";
import { seatName } from "../online/names.js";
import {
  FusemaniaRuntime,
  type FusemaniaCallbacks,
} from "../online/runtime.js";
import { slotColor } from "../render/palette.js";
import { createScene } from "../render/scene.js";
import { LIBRARY, SONGS_DATA } from "../songs.js";
import { browserCanvas } from "./attract.js";
import { createSfx, cuesBetween } from "./audio.js";
import {
  COLUMN_ACTIONS,
  actionOf,
  keyLabel,
  loadPrefs,
  savePrefs,
  type Prefs,
} from "./prefs.js";
import {
  bestText,
  present,
  type Model,
  type Row,
  type Viewer,
} from "./presenter.js";
import { dueReports, sendReport } from "./reports.js";
import {
  NOT_OPEN,
  bestRating,
  createBests,
  keys,
  roomFailure,
  safeStore,
  sessionFor,
} from "./session.js";
import { createSettingsPanel } from "./settings.js";
import { createSongClock } from "./song-clock.js";
import { createSongPicker } from "./song-picker.js";

/**
 * The Fusemania page's glue: it reads the query, builds the screens from fuse-ui components, wires the runtime to
 * the transport, keeps the song on the room's clock, stamps every key with the song time it was heard at and draws
 * every animation frame. The decisions live in the presenter, the renderer and the engine; nothing here judges.
 */
const GAME = GAME_ID;
const BASE = import.meta.env.BASE_URL;
const analytics = startGameAnalytics(GAME);
const reportPlay = createPlayMetrics(analytics.track, () => performance.now());
const endpoints = createEndpoints(
  { basePath: `${BASE}${GAME}/`, apiOrigin: import.meta.env.VITE_API_ORIGIN },
  location.origin,
);
const social = createGameSocial({
  gameId: GAME,
  base: BASE,
  apiOrigin: import.meta.env.VITE_API_ORIGIN,
  document,
  window,
  fetch: (input, init) => fetch(input, init),
  track: analytics.track,
});
const store = safeStore(() => localStorage);
const names = keys(GAME);
const muted = new URLSearchParams(location.search).has("mute");
const app = document.querySelector<HTMLElement>("#app")!;
/** One sound bus for the page: the header's button, `M` and the remembered volumes are the shared module's. */
const audio = createGameAudio(
  browserAudioDependencies(safeStorage(() => localStorage)),
  { forceMute: muted },
);
bindAudioInput(audio, document, window);
const audioControl = createAudioControl(document, audio);
const sfx = createSfx(audio);
let prefs: Prefs = loadPrefs(store);
const secret = () => uuid().replaceAll("-", "") + uuid().replaceAll("-", "");
/** A link within the game that keeps this page's developer flags. */
const withFlags = (path: string) =>
  muted ? `${path}${path.includes("?") ? "&" : "?"}mute` : path;
const setText = (node: HTMLElement, value: string) => {
  if (node.textContent !== value) node.textContent = value;
};
const coarse = () => matchMedia("(pointer: coarse)").matches;
/** Keys the song select leaves alone: Tab is the browser's, and M is the shared mute. */
const PAGE_KEYS: ReadonlySet<string> = new Set(["Tab", "KeyM"]);
/** How often a song's audio is fetched again by itself before the page asks the player. */
const SONG_LOAD_TRIES = 3;
/** Where a song's audio is fetched from: the site's own files, or a file the player loaded. */
const songUrl = (path: string) =>
  /^(blob:|https?:)/.test(path) ? path : `${BASE}${path}`;

/** The id a loaded simfile's song goes by. */
const CUSTOM = "custom";
interface Choice {
  song: string;
  chart: number;
  mode: number;
}
/** What this device plays next: the link's choice, else the one played last, else the first song on Medium. */
function chosen(library: Library): Choice {
  const query = new URLSearchParams(location.search);
  const song =
    [query.get("song"), store.getItem(names.song)].find(
      (id) => !!id && !!library.song(id),
    ) ??
    library.songs[0]?.id ??
    "";
  const charts = library.song(song)?.charts.length ?? 1;
  const raw = Number(query.get("chart") ?? store.getItem(names.chart) ?? 1);
  const chart = Math.min(
    Number.isInteger(raw) && raw >= 0 ? raw : 1,
    charts - 1,
  );
  const mode =
    Number(query.get("mode") ?? store.getItem(names.mode)) === BATTLE_MODE
      ? BATTLE_MODE
      : SCORE_MODE;
  return { song, chart, mode };
}
function remember(choice: Choice): void {
  if (choice.song !== CUSTOM) store.setItem(names.song, choice.song);
  store.setItem(names.chart, String(choice.chart));
  store.setItem(names.mode, String(choice.mode));
}
const bestKey = (library: Library, song: string, chart: number) => {
  // A player's own file keeps no best: every loaded file would share the one key.
  const info = song === CUSTOM ? undefined : library.song(song)?.charts;
  const picked = info?.[Math.min(chart, info.length - 1)];
  return picked ? names.best(song, picked.name.toLowerCase()) : undefined;
};
const bestLookup = (library: Library) => (song: string, chart: number) => {
  const key = bestKey(library, song, chart);
  const rating = key ? bestRating(store, key) : undefined;
  return rating === undefined ? undefined : bestText(rating);
};

/** The song select's music: the chosen song on the shared radio, a moment after the choice settles. */
function createPreview(library: Library) {
  let shown = "",
    timer: ReturnType<typeof setTimeout> | undefined;
  return {
    show(id: string) {
      if (id === shown) {
        if (!timer) audio.startMusic();
        return;
      }
      shown = id;
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        const info = library.song(id);
        // A loaded file has no address the radio can play from.
        if (!info || /^(blob:|https?:)/.test(info.audio)) {
          audio.setSongs([], BASE);
          return;
        }
        audio.setSongs([{ id, title: info.title, path: info.audio }], BASE);
        audio.startMusic();
      }, 350);
    },
    stop() {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
        shown = "";
      }
      audio.stopMusic();
    },
  };
}

const guide = () => ({
  controls: [
    ...COLUMN_ACTIONS.map((action) => ({
      keys: prefs.keys[action].map(keyLabel).join(" / "),
      action: `${action[0]!.toUpperCase()}${action.slice(1)} arrow`,
    })),
    {
      keys: prefs.keys.item.map(keyLabel).join(" / ") || "—",
      action: "Throw your power-up (battle)",
    },
  ],
  touchControls: [
    {
      keys: "← ↓ ↑ →",
      action: "Tap the pad when its arrow reaches the target",
    },
    { keys: "ITEM", action: "Throw your power-up (battle)" },
  ],
  goal: "Hit each arrow as it reaches the targets, on the beat. Hold the long ones, keep off the mines.",
});
const quickGuide = () => ({
  ...guide(),
  goal: "Hit the arrows on the beat. Hold the long ones, keep off the mines.",
});

function logo(): HTMLElement {
  const brand = el("a", "", "fm-brand");
  brand.href = withFlags(endpoints.appUrl());
  brand.append(
    el("b", "FUSE", "fm-brand-fuse"),
    el("b", "MANIA", "fm-brand-mania"),
    el("small", "ARROWS ON THE BEAT"),
  );
  return brand;
}
function header(extra: HTMLElement[] = []): HTMLElement {
  const bar = el("header", "", "fm-top");
  const portal = createAppPortal({
    document,
    current: GAME,
    base: BASE,
    search: location.search,
  });
  bar.append(
    portal.element,
    logo(),
    social.element(),
    audioControl.element,
    ...extra,
  );
  return createTopBar({
    element: bar,
    gameId: GAME,
    sound: audioControl.sound,
  });
}

function keyHelp(): HTMLElement {
  const list = el("dl", "", "fm-keys");
  const fill = () =>
    list.replaceChildren(
      ...guide().controls.flatMap((hint) => [
        el("dt", hint.keys),
        el("dd", hint.action),
      ]),
    );
  fill();
  list.addEventListener("fm-refresh", fill);
  return list;
}

/** The keys, the scroll and the timing offsets, saved the moment they change. */
function settingsPanel(onChange?: () => void) {
  return createSettingsPanel({
    document,
    prefs: () => prefs,
    onChange(next) {
      prefs = next;
      savePrefs(store, next);
      onChange?.();
    },
    audio,
    now: () => performance.now(),
    every(run, ms) {
      const id = setInterval(run, ms);
      return () => clearInterval(id);
    },
  });
}

function landing(): void {
  const library = LIBRARY;
  let choice = chosen(library);
  const preview = createPreview(library);
  const shared = el("label", "", "fm-shared"),
    toggle = el("input");
  toggle.type = "checkbox";
  toggle.checked = store.getItem(names.shared) === "1";
  toggle.onchange = () =>
    store.setItem(names.shared, toggle.checked ? "1" : "0");
  shared.append(toggle, el("span", "Shared TV: phones are the controllers"));
  const picker = createSongPicker({
    document,
    songs: library.songs,
    onSong: (song) => show({ ...choice, song }),
    onChart: (chart) => show({ ...choice, chart }),
    onMode: (mode) => show({ ...choice, mode }),
    best: bestLookup(library),
  });
  const show = (next: Choice) => {
    if (next.song !== choice.song || next.chart !== choice.chart) sfx.blip();
    choice = next;
    remember(choice);
    picker.update({ ...choice, host: true });
    preview.show(choice.song);
  };
  const leaveLanding = () => {
    preview.stop();
    settings.dispose();
    card.menu.dispose();
    document.removeEventListener("keydown", onKey);
  };
  const card = createLandingCard({
    background: async (host) =>
      (await import("./attract.js")).createAttract(host),
    title: "FUSEMANIA",
    tagline:
      "Four arrows, one beat. Play the whole Fuse soundtrack at four levels, chase a perfect score alone, or battle up to four friends with power-ups that bend, hide and booby-trap their arrows.",
    soloText: "PLAY",
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
      leaveLanding();
      startSolo(library, choice);
    },
    valid: validRoomCode,
    onJoin: (code) => {
      location.href = withFlags(endpoints.appUrl(`?room=${code}`));
    },
  });
  card.create.after(shared);

  // A player's own simfile: any 4-panel .sm or .ssc with its music, for a solo run on this device.
  const own = el("details", "", "fm-own"),
    ownChart = el("input"),
    ownAudio = el("input"),
    ownPlay = button("PLAY THIS SIMFILE", "fm-own-play"),
    ownError = el("p", "", "fm-own-error");
  ownChart.type = ownAudio.type = "file";
  ownChart.accept = ".sm,.ssc,text/plain";
  ownAudio.accept = "audio/*,.ogg,.mp3,.m4a,.wav";
  ownError.setAttribute("role", "alert");
  const field = (label: string, input: HTMLInputElement) => {
    const row = el("label", "", "fm-own-field");
    row.append(el("span", label), input);
    return row;
  };
  own.append(
    el("summary", "PLAY YOUR OWN STEPMANIA FILE"),
    el(
      "p",
      "Pick a simfile (.sm or .ssc) and its music. They stay on this device.",
    ),
    field("Simfile", ownChart),
    field("Music", ownAudio),
    ownPlay,
    ownError,
  );
  ownPlay.onclick = async () => {
    const chart = ownChart.files?.[0],
      music = ownAudio.files?.[0];
    if (!chart || !music) {
      ownError.textContent = "Pick both the simfile and its music file.";
      return;
    }
    if (chart.size > MAX_SIMFILE_BYTES) {
      ownError.textContent = "That simfile is too large.";
      return;
    }
    // One start however often the button is pressed while the file is read.
    ownPlay.disabled = true;
    const ssc = await chart.text().catch(() => "");
    if (!createLibrary([{ id: CUSTOM, audio: "", ssc }]).song(CUSTOM)) {
      ownPlay.disabled = false;
      ownError.textContent =
        "No 4-panel (dance-single) chart could be read from that file.";
      return;
    }
    const source = { id: CUSTOM, audio: URL.createObjectURL(music), ssc };
    leaveLanding();
    startSolo(createLibrary([...SONGS_DATA, source]), {
      song: CUSTOM,
      chart: choice.chart,
      mode: choice.mode,
    });
  };
  const select = el("section", "", "fm-landing-select");
  select.append(picker.element);
  card.solo?.before(select);
  card.solo?.classList.add("fui-button-primary", "fm-solo-play");
  card.solo?.after(own);
  const settings = settingsPanel(() =>
    help.dispatchEvent(new Event("fm-refresh")),
  );
  const help = keyHelp();
  card.menu.addSettings(settings.element);
  card.menu.help.append(help);
  const onKey = (event: KeyboardEvent) => {
    if (
      settings.busy ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      !picker.element.isConnected ||
      picker.element.offsetParent === null ||
      document.querySelector("dialog[open]") ||
      menu.isOpen() ||
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement ||
      event.target instanceof HTMLSelectElement
    )
      return;
    // Tab stays the browser's: the picker is one stop among the page's controls.
    if (!PAGE_KEYS.has(event.code) && picker.key(event.code))
      event.preventDefault();
  };
  document.addEventListener("keydown", onKey);
  const back = el("a", "← ALL GAMES", "fm-back");
  back.href = BASE + (muted ? "?mute" : "");
  const menu = createGameMenu(guide());
  menu.update({ canLobby: false, canLeave: false, touch: coarse() });
  app.replaceChildren(header([back, menu.element]), card.element);
  picker.update({ ...choice, host: true });
  preview.show(choice.song);
}

/** From the menu into a solo song without leaving the page, so the click that asked for it is what lets sound out. */
function startSolo(library: Library, choice: Choice): void {
  remember(choice);
  const song = choice.song === CUSTOM ? "" : `&song=${choice.song}`;
  history.pushState(
    null,
    "",
    withFlags(
      endpoints.appUrl(
        `?solo=1${song}&chart=${choice.chart}&mode=${choice.mode}`,
      ),
    ),
  );
  window.addEventListener("popstate", () => location.reload());
  audio.unlock();
  room(true, library, choice);
}

function room(solo: boolean, library: Library, first?: Choice): void {
  const session = solo
    ? ({ kind: "solo" } as const)
    : sessionFor(location.search, store, GAME, validRoomCode, secret);
  if (session.kind === "invalid" || session.kind === "landing") {
    const back = el("a", "← BACK", "fm-back");
    back.href = withFlags(endpoints.appUrl());
    app.replaceChildren(
      header([back]),
      el("p", "That is not a room code: check it and try again.", "fm-error"),
    );
    return;
  }
  const code = session.kind === "room" ? session.code : "SOLO",
    role = session.kind === "room" ? session.role : "host",
    display = role === "display";
  document.body.classList.toggle("fm-display", display);
  const viewer: Viewer = { me: "", host: solo, solo, display };
  const choice = first ?? chosen(library);
  const preview = createPreview(library);
  const leave = () => {
    runtime.stop();
    location.href = withFlags(endpoints.appUrl());
  };

  // ---- the page ----
  const status = createNotice({ className: "fm-status" });
  /** Lets go of every key and pad: a menu opened, or the page lost focus. */
  let letGoAll = () => {};
  const menu = createGameMenu({
    ...guide(),
    onLobby: () => runtime.command({ type: "action", action: "lobby" }),
    onLeave: leave,
    onOpenChange: (open) => {
      if (open) letGoAll();
    },
  });
  const roundControls = createRoundControls(quickGuide());
  const top = header([
    el("strong", solo ? "SOLO" : code, "fm-code"),
    status.element,
    menu.element,
  ]);
  createTopBar({
    element: top,
    onOpenChange: (open) => {
      if (open) letGoAll();
    },
  });
  const modalOpen = () => Boolean(document.querySelector("dialog[open]"));

  // Lobby: the invitation and the players on one side, the song select and START on the other.
  let settings: Settings = { display: false, ...choice };
  const lobby = el("section", "", "fm-lobby"),
    lobbyMain = el("div", "", "fm-panel"),
    roster = createRoster({ emptyText: "No players yet" }),
    addBot = button("+ ADD AI RIVAL", "fm-add-bot"),
    start = button("START", "fui-button-primary fm-start"),
    lobbyNote = el("p", "", "fui-lobby-note"),
    tvLink = button("OPEN TV SCREEN", "fm-tv");
  let inviteCard: HTMLElement | undefined;
  if (!solo) {
    const invite = createInviteCard({
      code,
      link: endpoints.appUrl(`?room=${code}`),
      qr: (text) => QRCode.toDataURL(text, { margin: 1, width: 360 }),
    });
    inviteCard = invite.element;
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
    el("h2", "PLAYERS", "fui-lobby-title"),
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
  const picker = createSongPicker({
    document,
    songs: library.songs,
    onSong: (song) => {
      sfx.blip();
      runtime.command({ type: "settings", settings: { ...settings, song } });
    },
    onChart: (chart) => {
      sfx.blip();
      store.setItem(names.chart, String(chart));
      runtime.pick(chart);
      // The host's chart is also what a seat without a choice of its own plays, the AI rivals included.
      if (viewer.host)
        runtime.command({ type: "settings", settings: { ...settings, chart } });
    },
    onMode: (mode) =>
      runtime.command({ type: "settings", settings: { ...settings, mode } }),
    best: bestLookup(library),
  });
  const lobbyActions = el("div", "", "fm-actions");
  lobbyActions.append(tvLink, start);
  lobby.append(lobbyMain);
  const help = keyHelp();
  const panel = settingsPanel(() =>
    help.dispatchEvent(new Event("fm-refresh")),
  );

  // The song: the canvas, the result over it, the touch pads under it.
  const stage = el("section", "", "fm-stage"),
    screen = el("div", "", "fm-screen"),
    canvas = el("canvas", "", "fm-canvas"),
    note = el("p", "", "fm-note"),
    unlock = el("p", "TAP OR PRESS A KEY FOR SOUND", "fm-unlock"),
    loadFailed = button("THE SONG DID NOT LOAD · RETRY", "fm-unlock fm-retry");
  const card = el("section", "", "fm-card"),
    cardTitle = el("h2"),
    cardRows = el("ol", "", "fm-rows"),
    cardCounts = el("dl", "", "fm-counts"),
    cardLines = el("ul", "", "fm-lines"),
    cardFoot = el("p", "", "fm-card-foot"),
    cardActions = el("div", "", "fm-actions"),
    rematch = button("PLAY AGAIN", "fui-button-primary fm-rematch"),
    toLobby = button("SONG SELECT", "fm-to-lobby"),
    toMenu = button("MENU", "fm-to-menu");
  cardActions.append(toMenu, toLobby, rematch);
  card.append(
    cardTitle,
    cardRows,
    cardCounts,
    cardLines,
    cardFoot,
    cardActions,
  );
  card.hidden = true;
  unlock.hidden = loadFailed.hidden = true;
  loadFailed.onclick = () => {
    if (playing) playing.failures = playing.retryAt = 0;
  };
  rematch.onclick = () =>
    runtime.command({ type: "action", action: "rematch" });
  toLobby.onclick = () => runtime.command({ type: "action", action: "lobby" });
  toMenu.onclick = leave;
  screen.append(canvas, unlock, loadFailed, card, roundControls.element);

  // ---- keys and pads: every one is stamped with the song time this device heard it at ----
  /** What holds each column down right now: key codes and pads. */
  const held: Set<string>[] = Array.from(
    { length: COLUMNS },
    () => new Set<string>(),
  );
  const songClock = createSongClock({
    now: () => performance.now(),
    audio: () => audio.clock(),
  });
  /** The song time of an event stamped `at` on the page's clock, as the judge hears it. */
  const stamp = (at: number): number => {
    const now = performance.now();
    return (
      songClock.songMs(at > 0 && Math.abs(at - now) < 500 ? at : now) -
      prefs.offsetMs
    );
  };
  const press = (column: number, source: string, at: number) => {
    const ms = stamp(at);
    // A second finger on a column that is already down is a new step: up and down again at the same instant.
    if (held[column]!.size) runtime.key(column, false, ms);
    held[column]!.add(source);
    runtime.key(column, true, ms);
  };
  const lift = (column: number, source: string, at: number) => {
    if (!held[column]!.delete(source) || held[column]!.size) return;
    runtime.key(column, false, stamp(at));
  };
  const throwItem = (at: number) => runtime.useItem(stamp(at));
  const pads = (className: string) => {
    const row = el("div", "", className);
    [0, 1, 2, 3].forEach((column) => {
      // A drawn arrow: the arrow characters come from different fonts on a phone and do not match.
      const node = el("div", "", `fm-pad fm-pad-${column}`);
      node.append(el("span", "", "fm-pad-arrow"));
      node.setAttribute("role", "button");
      node.setAttribute("aria-label", `${COLUMN_ACTIONS[column]} arrow`);
      node.addEventListener("contextmenu", (event) => event.preventDefault());
      node.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        node.setPointerCapture(event.pointerId);
        node.classList.add("held");
        press(
          column,
          `${className}:${column}:${event.pointerId}`,
          event.timeStamp,
        );
      });
      for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
        node.addEventListener(type, (event) => {
          const id = (event as PointerEvent).pointerId;
          lift(column, `${className}:${column}:${id}`, event.timeStamp);
          if (!held[column]!.size) node.classList.remove("held");
        });
      row.append(node);
    });
    const item = el("div", "ITEM", "fm-pad fm-pad-item");
    item.setAttribute("role", "button");
    item.setAttribute("aria-label", "Throw your power-up");
    item.addEventListener("contextmenu", (event) => event.preventDefault());
    item.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      throwItem(event.timeStamp);
    });
    row.append(item);
    return { row, item };
  };
  const touch = pads("fm-touch"),
    controllerPads = pads("fm-controller-pads");
  letGoAll = () => {
    for (const set of held) set.clear();
    for (const node of document.querySelectorAll(".fm-pad.held"))
      node.classList.remove("held");
    runtime.letGo(stamp(0));
  };
  stage.append(screen, note, touch.row);

  const controller = el("section", "", "fm-controller"),
    controllerHead = el("header", "", "fm-controller-head"),
    controllerName = el("b"),
    controllerState = el("span");
  controllerHead.append(controllerName, controllerState);
  const controllerResult = el("div", "", "fm-actions fm-controller-result"),
    controllerRematch = button("PLAY AGAIN", "fui-button-primary"),
    controllerLobby = button("SONG SELECT");
  controllerRematch.onclick = rematch.onclick;
  controllerLobby.onclick = toLobby.onclick;
  controllerResult.append(controllerLobby, controllerRematch);
  controller.append(controllerHead, controllerResult, controllerPads.row);

  const connecting = el("p", "Connecting to the room…", "fm-connecting"),
    closed = el("section", "", "fm-panel fm-closed"),
    closedRetry = button("TRY AGAIN", "fm-retry"),
    closedBack = el(
      "a",
      "BACK TO FUSEMANIA",
      "fui-button-primary fm-closed-back",
    );
  closedBack.href = withFlags(endpoints.appUrl());
  closedRetry.onclick = () => location.reload();
  const closedActions = el("div", "", "fm-actions");
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
  const main = el("main", "", "fm-room");
  main.append(connecting, closed, nameEntry.form, lobby, stage, controller);
  app.replaceChildren(top, main);
  const roomLayout = createRoomLayout({
    primaryAction: start,
    playerName: () => social.playerName(undefined) ?? undefined,
    slotColor,
    slotLabel: (slot) => `Player ${slot + 1}`,
    background: async (host) =>
      (await import("./attract.js")).createAttract(host),
    element: lobby,
    ...(inviteCard ? { invite: inviteCard } : {}),
    roster,
    capacity: CAPACITY,
    join: nameEntry.form,
    addAI: addBot,
    settings: [panel.element, help],
    modes: [picker.element],
    actions: [lobbyNote, lobbyActions],
  });
  lobby.hidden = true;
  stage.hidden = true;
  controller.hidden = true;
  nameEntry.form.hidden = true;
  let over = false;

  // ---- drawing: the room's newest world, this device's own keys played ahead to what it hears, once per frame ----
  const scene = createScene(canvas, {
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
    createCanvas: browserCanvas,
  });
  let model: Model | undefined;
  /** The song being played, decoded for the audio clock; the shared module keeps the last few. */
  let playing:
    | {
        id: string;
        song?: ClockedSong;
        loading: boolean;
        retryAt: number;
        failures: number;
      }
    | undefined;
  const songOf = (id: string, now: number): ClockedSong | undefined => {
    if (playing?.id !== id)
      playing = { id, loading: false, retryAt: 0, failures: 0 };
    const mine = playing;
    if (
      !mine.song &&
      !mine.loading &&
      now >= mine.retryAt &&
      mine.failures < SONG_LOAD_TRIES &&
      !audio.forcedMute
    ) {
      const info = library.song(id);
      mine.loading = true;
      void (info ? audio.loadSong(songUrl(info.audio)) : Promise.resolve())
        .catch(() => undefined)
        .then((song) => {
          mine.loading = false;
          if (song) mine.song = song;
          // No clock yet (no gesture) is not a failure of the file: ask again without counting it.
          else if (audio.clock()) mine.failures++;
          mine.retryAt = performance.now() + (song ? 0 : 5000);
        });
    }
    return mine.song;
  };
  let stepsKey = "",
    steps: Steps[] = [];
  const stepsOf = (view: WorldView): readonly Steps[] => {
    const key = `${view.song}:${view.players.map((each) => each.chart).join()}`;
    if (key !== stepsKey) {
      stepsKey = key;
      steps = view.players.flatMap(
        (each) => library.steps(view.song, each.chart) ?? [],
      );
    }
    return steps;
  };
  let before: WorldView | undefined;
  /** A solo song that began before the browser let sound out starts over once it does. */
  let startedSilent = false,
    heardEpoch = -1;
  const frame = (now: number) => {
    // Asked first, so one bad frame cannot stop the drawing for good.
    if (!over) requestAnimationFrame(frame);
    songClock.sample();
    const state = runtime.roomState();
    const roomMs = runtime.songMs();
    const world = state?.world;
    // A phone that is a controller makes no music: the shared screen does.
    const song =
      world && roomMs !== undefined && model?.screen === "play"
        ? songOf(world.song, now)
        : undefined;
    songClock.follow(roomMs, song);
    if (!model || model.screen === "lobby" || !world) {
      before = undefined;
      unlock.hidden = loadFailed.hidden = true;
      return;
    }
    const running = roomMs !== undefined;
    const silent =
      running &&
      model.screen === "play" &&
      !audio.forcedMute &&
      !audio.prefs.muted &&
      audio.clock()?.running === false;
    unlock.hidden = !silent;
    loadFailed.hidden =
      silent || !running || (playing?.failures ?? 0) < SONG_LOAD_TRIES;
    // Sound that has been heard in this match and stops for a moment (a tab left and returned to) restarts nothing.
    const epoch = state?.epoch ?? -1;
    if (!silent && running && audio.clock()?.running) heardEpoch = epoch;
    if (silent && solo && heardEpoch !== epoch) startedSilent = true;
    else if (startedSilent && running) {
      startedSilent = false;
      if (world.ms < 30000) {
        runtime.command({ type: "action", action: "lobby" });
        runtime.command({ type: "action", action: "start" });
      }
    }
    const heard = running ? songClock.songMs(now) : world.ms;
    const view = runtime.picture(heard - prefs.offsetMs);
    if (!view) return;
    const local = model.localSlot;
    for (const player of local === -1 ? view.players : [view.players[local]!]) {
      for (const cue of cuesBetween(before?.players[player.slot], player)) {
        sfx.play(cue);
        if (local !== -1 && (cue === "struck" || cue === "mine"))
          navigator.vibrate?.(40);
      }
    }
    before = view;
    if (stage.hidden) return;
    const drawn = heard + prefs.visualMs;
    const timing = library.timing(view.song);
    const beat = timing?.beatAt(drawn / 1000) ?? 0;
    scene.draw(view, {
      songMs: drawn,
      beat,
      bpm: timing?.bpmAt(beat) ?? 120,
      steps: stepsOf(view),
      names: model.names,
      local,
      speed: prefs.speed,
      down: prefs.down,
      title: model.title,
      chartNames: model.chartNames,
      itemKey: coarse() ? "ITEM" : keyLabel(prefs.keys.item[0] ?? ""),
    });
  };
  requestAnimationFrame(frame);
  // For smokes and for a player's bug report: where the sound, the room and the picture are, read from the console.
  Object.assign(window, {
    fusemania: {
      clock: () => ({
        audible: songClock.audible,
        driftMs: songClock.drift,
        heardMs: songClock.songMs(),
        roomMs: runtime.songMs(),
        latencyMs: (audio.clock()?.latency() ?? 0) * 1000,
        loaded: !!playing?.song,
      }),
      view: () => runtime.picture(songClock.songMs() - prefs.offsetMs),
      /** This device's own notes in the song being played: `[ms, column, kind]`. */
      notes: () => {
        const world = runtime.roomState()?.world;
        const mine = world?.players.find((each) => each.id === viewer.me);
        const chart = world && mine && library.steps(world.song, mine.chart);
        return (chart?.notes ?? []).map((note) => [
          note.ms,
          note.column,
          note.kind,
        ]);
      },
    },
  });

  const rowNode = (row: Row) => {
    const node = el("li", "", row.you ? "you" : "");
    node.style.setProperty("--c", slotColor(row.slot));
    const who = el("div", "", "fm-row-who");
    who.append(
      el("b", row.you ? `${row.name} (you)` : row.name),
      el("small", `${row.detail} · ${row.combo}`),
    );
    node.append(
      el("span", String(row.place), "fm-row-place"),
      el("strong", row.grade, `fm-grade fm-grade-${row.grade.toLowerCase()}`),
      who,
      el("em", row.score),
    );
    return node;
  };
  let lastStage = "";
  const render = (next: Model, view: View) => {
    if (over) return;
    model = next;
    connecting.hidden = true;
    main.dataset.screen = next.screen;
    main.dataset.stage = view.stage;
    main.dataset.song = view.world?.song ?? view.settings.song;
    main.dataset.playing = String(next.playing);
    lobby.hidden = next.screen !== "lobby";
    stage.hidden = next.screen !== "play";
    controller.hidden = next.screen !== "controller";
    nameEntry.form.hidden = !next.askName;
    // The song select's music plays in the lobby only; a match's song is the audio clock's.
    if (next.screen === "lobby" && !display) {
      preview.show(view.settings.song);
      // Decoded while the players choose, so START never waits for it.
      songOf(view.settings.song, performance.now());
    } else preview.stop();
    if (view.stage === "over" && lastStage === "running" && next.result)
      sfx.fanfare(
        !next.result.rows.some((row) => row.you && /^[CD]$/.test(row.grade)),
      );
    // A calibration or a key capture left open takes every key: it ends when the room moves on.
    if (view.stage !== lastStage) panel.cancel();
    lastStage = view.stage;
    // Lobby.
    roster.update(
      next.lobby.members.map((member) => ({
        id: member.id,
        slot: member.slot,
        name: member.you ? `${member.name} (you)` : member.name,
        color: slotColor(member.slot),
        status: !member.connected
          ? "OFFLINE"
          : member.bot
            ? `AI · ${member.chart}`
            : member.chart,
      })),
    );
    for (const [id, row] of roster.entries()) {
      let remove = row.querySelector<HTMLButtonElement>(".fm-remove");
      const removable = next.lobby.removable.includes(id);
      if (removable && !remove) {
        remove = button("×", "fm-remove");
        remove.setAttribute("aria-label", "Remove AI rival");
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
    picker.update({
      song: view.settings.song,
      chart: next.chart,
      mode: view.settings.mode,
      host: next.lobby.editable,
    });
    roomLayout.update(next.lobby.members.length, CAPACITY);
    const touchGuide = coarse() || next.screen === "controller";
    const watching = display || (view.stage !== "lobby" && !next.playing);
    menu.update({
      canLobby: viewer.host && view.stage !== "lobby" && !display,
      touch: touchGuide,
      spectator: watching && view.stage === "running",
      display,
      controls: guide().controls,
    });
    roundControls.update({
      round: view.matchId,
      visible: view.stage === "running" && !!view.world && view.world.ms < 0,
      touch: touchGuide,
      spectator: watching,
      display,
      controls: guide().controls,
    });
    const guideParent = next.screen === "controller" ? controller : screen;
    if (roundControls.element.parentElement !== guideParent)
      guideParent.append(roundControls.element);
    // The song.
    setText(note, next.note);
    note.hidden = !next.note;
    const touchOn = coarse() && next.playing && !display;
    touch.row.hidden = !touchOn;
    const battle = view.play.mode === BATTLE_MODE;
    touch.item.hidden = controllerPads.item.hidden = !battle;
    main.dataset.touch = String(touchOn);
    scene.resize();
    // The phone controller.
    if (next.localSlot !== -1) {
      controller.style.setProperty("--c", slotColor(next.localSlot));
      setText(controllerName, next.names[next.localSlot] ?? "");
    }
    setText(controllerState, next.status);
    controllerResult.hidden = !(next.result && next.result.host);
    // The result.
    const result = next.result;
    card.hidden = !result || next.screen === "controller";
    if (result) {
      setText(cardTitle, result.title);
      const rows = JSON.stringify(result.rows);
      if (cardRows.dataset.rows !== rows) {
        cardRows.dataset.rows = rows;
        cardRows.replaceChildren(...result.rows.map(rowNode));
      }
      const counts = JSON.stringify(result.counts);
      if (cardCounts.dataset.counts !== counts) {
        cardCounts.dataset.counts = counts;
        cardCounts.replaceChildren(
          ...result.counts.flatMap(([label, value]) => [
            el("dt", label, `fm-count-${label.toLowerCase().split(" ")[0]}`),
            el("dd", value),
          ]),
        );
      }
      cardCounts.hidden = !result.counts.length;
      const joined = result.lines.join("\n");
      if (cardLines.dataset.lines !== joined) {
        cardLines.dataset.lines = joined;
        cardLines.replaceChildren(
          ...result.lines.map((line) =>
            el("li", line, /^(NEW BEST|FIRST)/.test(line) ? "best" : ""),
          ),
        );
      }
      cardLines.hidden = !result.lines.length;
      setText(cardFoot, result.waiting);
      cardFoot.hidden = !result.waiting;
      cardActions.hidden = !result.host;
      toMenu.hidden = !result.solo;
    }
  };

  // ---- the runtime ----
  const sent = new Set<string>();
  const bests = createBests(store);
  let finished = "";
  const remembered = seatName(
    social.playerName(store.getItem(names.name)) ?? "",
  );
  let joinSent = false,
    pickSent = false;
  const callbacks: FusemaniaCallbacks = {
    state(frame, roomSettings) {
      const players =
        frame.stage === "lobby"
          ? frame.seats.filter((seat) => !seat.watcher)
          : frame.roster;
      const mode = solo ? "solo" : roomSettings.display ? "shared" : "online";
      reportPlay({
        matchId: frame.matchId,
        active: frame.stage === "running",
        ended: frame.stage === "over",
        playerCount: players.length,
        botCount: players.filter((player) => player.bot).length,
        seated: players.some((player) => player.id === viewer.me),
        mode,
        round: 1,
      });
      settings = roomSettings;
      // A song that is over settles this device's best on its chart once, and keeps saying what the best was.
      let bestBefore: number | undefined;
      const world = frame.world;
      const mine = world?.players.find((each) => each.id === viewer.me);
      if (frame.stage === "over" && world && mine && !mine.bot) {
        const key = bestKey(library, world.song, mine.chart);
        const decided = runtime.roomState()?.decided?.clock;
        const confirmed =
          solo || (decided !== undefined && decided <= runtime.confirmedTick());
        if (key)
          bestBefore = confirmed
            ? bests.settle(frame.matchId, key, mine.rating)
            : bestRating(store, key);
        if (finished !== frame.matchId) {
          finished = frame.matchId;
          analytics.track("Song Finished", {
            song: world.song === CUSTOM ? "custom" : world.song,
            chart: mine.chart,
            rating: mine.rating,
            battle: world.mode === BATTLE_MODE,
            mode,
          });
        }
      }
      const next = present(library, frame, viewer, bestBefore);
      if (next.askName && remembered && !joinSent && !viewer.host) {
        joinSent = true;
        runtime.command({
          type: "join",
          slot: requestedRoomSlot(nameEntry.form),
          name: remembered,
        });
      }
      if (next.seated) joinSent = false;
      // A seat starts on the chart this device played last.
      if (next.seated && !pickSent && !solo) {
        pickSent = true;
        if (next.chart !== choice.chart) runtime.pick(choice.chart);
      }
      render(next, frame);
      const state = runtime.roomState();
      if (session.kind === "room" && !display && state)
        for (const report of dueReports(
          library,
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
      songClock.stop();
      preview.stop();
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
  const runtime = new FusemaniaRuntime(
    code,
    { display: shared, ...choice },
    callbacks,
    // A solo battle needs someone to throw things at: three AI rivals.
    createFusemaniaGame(library, solo && choice.mode === BATTLE_MODE ? 3 : 0),
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
      panel.dispose();
      songClock.stop();
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
    (target instanceof HTMLButtonElement && !model?.playing);
  const captured = new Set<string>();
  document.addEventListener("keydown", (event) => {
    if (
      menu.isOpen() ||
      modalOpen() ||
      panel.busy ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey
    )
      return;
    if (!model?.playing) {
      if (event.repeat) return;
      // A result that offers another go takes Enter as its main button, without the mouse.
      if (
        model?.result?.host &&
        event.code === "Enter" &&
        !(event.target instanceof HTMLButtonElement)
      ) {
        event.preventDefault();
        rematch.click();
      } else if (
        model?.screen === "lobby" &&
        !typing(event.target) &&
        picker.element.offsetParent !== null &&
        !PAGE_KEYS.has(event.code) &&
        picker.key(event.code)
      )
        event.preventDefault();
      return;
    }
    if (typing(event.target)) return;
    const action = actionOf(prefs, event.code);
    if (!action) return;
    event.preventDefault();
    captured.add(event.code);
    if (event.repeat) return;
    if (action === "item") throwItem(event.timeStamp);
    else press(COLUMN_ACTIONS.indexOf(action), event.code, event.timeStamp);
  });
  document.addEventListener("keyup", (event) => {
    for (let column = 0; column < COLUMNS; column++)
      lift(column, event.code, event.timeStamp);
    if (captured.delete(event.code)) event.preventDefault();
  });
  window.addEventListener("blur", () => letGoAll());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      letGoAll();
      panel.cancel();
    }
  });
  // A pinch or a double tap must never zoom the arrows away from under the thumbs.
  for (const type of ["gesturestart", "gesturechange", "dblclick"])
    for (const part of [stage, controller])
      part.addEventListener(type, (event) => event.preventDefault());
  runtime.start();
}

const query = new URLSearchParams(location.search);
if (query.get("solo") === "1") room(true, LIBRARY);
else if (query.has("room")) room(false, LIBRARY);
else landing();
