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
import "./options.css";
import QRCode from "qrcode";
import {
  PeerTransport,
  createEndpoints,
  createRoom,
  installRoomLifecycle,
  validRoomCode,
} from "fuse-network-fe";
import { MAX_PACKET_BYTES, browserDependencies, uuid } from "fuse-netcode";
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
  RULES,
  SCORE_MODE,
  createLibrary,
  type Library,
  type Steps,
  type WorldView,
} from "../engine/index.js";
import { GAME_ID } from "../basics.js";
import {
  SESSION_LENGTHS,
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
import { songShape } from "./song-fx.js";
import {
  COLUMN_ACTIONS,
  MAX_OFFSET_MS,
  actionOf,
  keyLabel,
  loadPrefs,
  savePrefs,
  type Prefs,
} from "./prefs.js";
import { createOptionsMenu, createPlayOptions } from "./options.js";
import {
  bestText,
  holdText,
  present,
  type Model,
  type Row,
  type SessionModel,
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
import { createLatencyProbe, latencyText } from "./latency.js";
import { createFrameLead } from "./frame-lead.js";
import type { TimingLab } from "./timing-lab.js";
import {
  createHitCollector,
  loadHistory,
  measureBias,
  proposalText,
  propose,
  remember as rememberRun,
  saveHistory,
  type Proposal,
} from "./timing-bias.js";
import { createSongClock } from "./song-clock.js";
import { createSongStore } from "./song-cache.js";
import { SONG_LOAD_TRIES, createSongLoader } from "./song-load.js";
import { RESUME_MS, createPauseClock, resumeCount } from "./pause.js";
import {
  createRunLogger,
  runStats,
  statLines,
  type RunLog,
} from "./run-log.js";
import { drawTimingGraph } from "./timing-graph.js";
import { createSongPicker } from "./song-picker.js";
import { coverPath } from "./covers.js";
import { packsOf } from "./packs.js";

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
/** `?debugtiming`: the timing panel beside a game, and the Timing screen's details open. */
const debugTiming = new URLSearchParams(location.search).has("debugtiming");
/** `?audioclock=reported`: read the song position from the stepped audio clock, to compare with the clock pair. */
const pairedClock =
  new URLSearchParams(location.search).get("audioclock") !== "reported";
const app = document.querySelector<HTMLElement>("#app")!;
/** One sound bus for the page: the header's button, `M` and the remembered volumes are the shared module's. */
/** The songs' files stay in the browser between visits, so a song is downloaded once. */
const songStore = createSongStore({
  caches: typeof caches === "undefined" ? undefined : caches,
  fetch: (url) => fetch(url),
  prefix: "fusemania-songs-",
  version: RULES,
  absolute: (url) => new URL(url, location.href).href,
});
const audio = createGameAudio(
  {
    ...browserAudioDependencies(safeStorage(() => localStorage)),
    fetchAudio: (url) => songStore.fetch(url),
  },
  { forceMute: muted },
);
bindAudioInput(audio, document, window);
const audioControl = createAudioControl(document, audio);
const sfx = createSfx(audio);
let prefs: Prefs = loadPrefs(store);
const secret = () => uuid().replaceAll("-", "") + uuid().replaceAll("-", "");
/** A link within the game that keeps this page's developer flags. */
const withFlags = (path: string) => {
  let out = path;
  for (const flag of [muted ? "mute" : "", debugTiming ? "debugtiming" : ""])
    if (flag) out = `${out}${out.includes("?") ? "&" : "?"}${flag}`;
  return out;
};
const setText = (node: HTMLElement, value: string) => {
  if (node.textContent !== value) node.textContent = value;
};
const coarse = () => matchMedia("(pointer: coarse)").matches;
/** Keys the song select leaves alone: Tab is the browser's, and M is the shared mute. */
const PAGE_KEYS: ReadonlySet<string> = new Set(["Tab", "KeyM"]);
/** Where a song's audio is fetched from: the site's own files, or a file the player loaded. */
const songUrl = (path: string) =>
  /^(blob:|https?:)/.test(path) ? path : `${BASE}${path}`;
/** A song that exists only on this page: a loaded simfile. */
const localSong = (id: string) => id === CUSTOM;
/** A song's cover image, for the songs that ship with one. */
const coverUrl = (song: { id: string }): string | undefined => {
  const path = coverPath(song.id);
  return path && `${BASE}${path}`;
};

/** The id a loaded simfile's song goes by. */
const CUSTOM = "custom";
/** The landing select's wait before it fetches the song it stands on; a room starting cancels it. */
let landingFetch: ReturnType<typeof setTimeout> | undefined;
/** Called when what a song select shows about the songs' audio has changed. */
const audioWatchers = new Set<() => void>();
/** The library the songs on screen are from: the bundled one, or it with the player's own file. */
let songLibrary: Library | undefined;
/** Which songs this device has the audio of, for the page's whole life: the song selects and the room share it. */
const songs = createSongLoader({
  now: () => performance.now(),
  url: (id) => {
    const info = songLibrary?.song(id);
    return info && songUrl(info.audio);
  },
  load: (url) => audio.loadSong(url),
  enabled: () => !audio.forcedMute,
  hasClock: () => audio.clock() !== undefined,
  local: localSong,
  changed: () => {
    for (const watcher of audioWatchers) watcher();
  },
});
/** The songs of `library` are the ones on screen: the ones downloaded on an earlier visit are marked so. */
function useLibrary(library: Library): void {
  songLibrary = library;
  void songStore.stored().then((urls) => {
    const have = new Set(urls);
    songs.stored(
      library.songs
        .filter((info) =>
          have.has(new URL(songUrl(info.audio), location.href).href),
        )
        .map((info) => info.id),
    );
  });
}
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
  if (!localSong(choice.song)) store.setItem(names.song, choice.song);
  store.setItem(names.chart, String(choice.chart));
  store.setItem(names.mode, String(choice.mode));
}
const bestKey = (library: Library, song: string, chart: number) => {
  // A player's own file keeps no best: every loaded file would share the one key.
  const info = localSong(song) ? undefined : library.song(song)?.charts;
  const picked = info?.[Math.min(chart, info.length - 1)];
  return picked ? names.best(song, picked.name.toLowerCase()) : undefined;
};
const bestLookup = (library: Library) => (song: string, chart: number) => {
  const key = bestKey(library, song, chart);
  const rating = key ? bestRating(store, key) : undefined;
  return rating === undefined ? undefined : bestText(rating);
};

/** A song other than `current`, any of them as likely as the next: what RANDOM SONG picks. */
function randomSong(library: Library, current: string): string | undefined {
  const others = library.songs.filter(
    (song) => song.id !== current && song.id !== CUSTOM,
  );
  return others[Math.floor(Math.random() * others.length)]?.id;
}
/** A session's standings under their heading: in the lobby between two songs, and on the result. */
function sessionBlock() {
  const element = el("section", "", "fm-session"),
    title = el("h3"),
    list = el("ol");
  element.append(title, list);
  element.hidden = true;
  return {
    element,
    update(model: SessionModel | null) {
      element.hidden = !model;
      if (!model) return;
      setText(title, model.title);
      const rows = JSON.stringify(model.rows);
      if (list.dataset.rows === rows) return;
      list.dataset.rows = rows;
      list.replaceChildren(
        ...model.rows.map((row) => {
          const node = el("li", "", row.you ? "you" : "");
          if (row.slot >= 0) node.style.setProperty("--c", slotColor(row.slot));
          node.append(
            el("span", String(row.place)),
            el("b", row.you ? `${row.name} (you)` : row.name),
            el("small", row.wins),
            el("em", row.points),
          );
          return node;
        }),
      );
    },
  };
}

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
    // No shared radio here: the song being played is the music, on the audio clock the arrows follow.
    music: false,
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
  useLibrary(LIBRARY);
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
  // A solo select: this player's speed and a random song. Sessions are a room's.
  const options = createPlayOptions({
    document,
    onSpeed: (speed) => {
      sfx.blip();
      prefs = { ...prefs, speed };
      savePrefs(store, prefs);
      settings.refresh();
      showOptions();
    },
    onRandomSong: () => {
      const song = randomSong(library, choice.song);
      if (song) show({ ...choice, song });
    },
  });
  const picker = createSongPicker({
    document,
    songs: library.songs,
    onSong: (song) => show({ ...choice, song }),
    onChart: (chart) => show({ ...choice, chart }),
    onMode: (mode) => show({ ...choice, mode }),
    best: bestLookup(library),
    audio: songs.status,
    cover: coverUrl,
    packs: packsOf(library.songs, CUSTOM),
    tools: [options.random],
  });
  const show = (next: Choice) => {
    if (next.song !== choice.song || next.chart !== choice.chart) sfx.blip();
    choice = next;
    remember(choice);
    picker.update({ ...choice, host: true });
    preview.show(choice.song);
    // Downloaded while the player chooses, so PLAY does not wait for it; a carousel being turned fetches nothing.
    clearTimeout(landingFetch);
    landingFetch = setTimeout(() => songs.song(choice.song), 350);
  };
  const showOptions = () =>
    options.update({
      speed: prefs.speed,
      host: true,
      songs: 1,
      random: false,
    });
  const leaveLanding = () => {
    preview.stop();
    settings.dispose();
    card.menu.dispose();
    document.removeEventListener("keydown", onKey);
  };
  // PLAY and OPTIONS stay in the dialog's bar beside CLOSE: the select under them scrolls, they do not.
  const optionsMenu = createOptionsMenu({
    document,
    content: [options.element],
  });
  const card = createLandingCard({
    soloInBar: true,
    soloActions: [optionsMenu.element],
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
  // The Timing screen is on the front door: lining the game up with a device is not a setting to dig for.
  card.menu.addEntry("Sync timing", () => {
    leaveLanding();
    openTiming();
  });

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
  card.soloDetails.append(select, own);
  // A select that is opened again starts with the speeds put away.
  card.menu.dialog.addEventListener("close", () => optionsMenu.close());
  card.solo?.classList.add("fui-button-primary", "fm-solo-play");
  const settings = settingsPanel(() => {
    help.dispatchEvent(new Event("fm-refresh"));
    showOptions();
  });
  const help = keyHelp();
  card.menu.addSettings(settings.element);
  card.menu.help.append(help);
  /** The select sits in the menu's own dialog: only another one on top takes the keys away. */
  const otherDialogOpen = () =>
    [...document.querySelectorAll("dialog[open]")].some(
      (dialog) => !dialog.contains(picker.element),
    );
  const onKey = (event: KeyboardEvent) => {
    if (
      settings.busy ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      !picker.element.isConnected ||
      picker.element.offsetParent === null ||
      otherDialogOpen() ||
      // The speeds are open over the select: their keys are not the carousel's.
      !optionsMenu.panel.hidden ||
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
  showOptions();
  preview.show(choice.song);
  landingFetch = setTimeout(() => songs.song(choice.song), 350);
  // Until a room takes the page over (`room` clears the watchers and the timer).
  audioWatchers.add(() => picker.update({ ...choice, host: true }));
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

/** From the menu to the Timing screen without leaving the page, so the click that asked for it lets the tick out. */
function openTiming(): void {
  history.pushState(null, "", withFlags(endpoints.appUrl("?timing")));
  window.addEventListener("popstate", () => location.reload());
  audio.unlock();
  timing();
}

/** The Timing screen ("sync"): thirty seconds of a steady tick, then what to set. No song, no room. */
function timing(): void {
  const back = el("a", "← BACK TO THE MENU", "fm-ts-back");
  back.href = withFlags(endpoints.appUrl());
  const loading = el("p", "Loading…", "fm-connecting");
  app.replaceChildren(header(), loading);
  void import("./timing-screen.js").then(({ createTimingScreen }) => {
    const screen = createTimingScreen({
      doc: document,
      win: window,
      audio,
      prefs: () => prefs,
      setPrefs(next) {
        prefs = next;
        savePrefs(store, prefs);
      },
      now: () => performance.now(),
      createCanvas: browserCanvas,
      bpm: Number(new URLSearchParams(location.search).get("rate")),
      seconds: Number(new URLSearchParams(location.search).get("seconds")),
      details: debugTiming,
      back,
      pairing: pairedClock,
    });
    loading.replaceWith(screen.element);
    // For smokes and for an agent reading a session: what the panel shows, its log, and where the run is.
    Object.assign(window, {
      fusemania: {
        timing: () => screen.snapshot(),
        timingLog: () => screen.logText(),
        timingState: () => screen.state(),
      },
    });
  });
}

function room(solo: boolean, library: Library, first?: Choice): void {
  // The landing select is gone: its late fetch must not take the place of the song this room plays.
  clearTimeout(landingFetch);
  audioWatchers.clear();
  useLibrary(library);
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
  // ---- a solo song can be paused: its room clock is this one, and it stops ----
  const pauseClock = createPauseClock(() => performance.now());
  /** Stops a solo song that is playing, and takes the pause away without a count-in. */
  let pause = () => {},
    unpause = (_leaving = false) => {};
  /** When a menu last closed: the Escape that closed it is not also a pause key. */
  let menuClosedAt = Number.NEGATIVE_INFINITY;
  const menuMoved = (open: boolean) => {
    if (open) {
      letGoAll();
      pause();
    } else menuClosedAt = performance.now();
  };
  const menu = createGameMenu({
    ...guide(),
    onLobby: () => {
      unpause(true);
      runtime.command({ type: "action", action: "lobby" });
    },
    onLeave: leave,
    onOpenChange: menuMoved,
  });
  const roundControls = createRoundControls(quickGuide());
  const top = header([
    el("strong", solo ? "SOLO" : code, "fm-code"),
    status.element,
    menu.element,
  ]);
  createTopBar({
    music: false,
    element: top,
    onOpenChange: menuMoved,
  });
  const modalOpen = () => Boolean(document.querySelector("dialog[open]"));

  // Lobby: the invitation and the players on one side, the song select and START on the other.
  // A host's rooms start with the session it set last; a solo run is one song.
  const storedSongs = Number(store.getItem(names.songs));
  const sessionChoice = {
    songs: !solo && SESSION_LENGTHS.includes(storedSongs) ? storedSongs : 1,
    random: !solo && store.getItem(names.order) === "random",
  };
  let settings: Settings = { display: false, ...sessionChoice, ...choice };
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
  // Beside the song select: every player's own speed, and the host's random song and session.
  const options = createPlayOptions({
    document,
    ...(solo ? {} : { lengths: SESSION_LENGTHS }),
    onSpeed: (speed) => {
      sfx.blip();
      prefs = { ...prefs, speed };
      savePrefs(store, prefs);
      panel.refresh();
      showOptions();
    },
    onRandomSong: () => {
      const song = randomSong(library, settings.song);
      if (!song) return;
      sfx.blip();
      runtime.command({ type: "settings", settings: { ...settings, song } });
    },
    onSongs: (songs) => {
      store.setItem(names.songs, String(songs));
      runtime.command({ type: "settings", settings: { ...settings, songs } });
    },
    onOrder: (random) => {
      store.setItem(names.order, random ? "random" : "host");
      runtime.command({ type: "settings", settings: { ...settings, random } });
    },
  });
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
    audio: songs.status,
    cover: coverUrl,
    packs: packsOf(library.songs, CUSTOM),
    tools: [options.random],
  });
  options.element.hidden = display;
  const showOptions = () =>
    options.update({
      speed: prefs.speed,
      host: viewer.host,
      songs: settings.songs,
      random: settings.random,
    });
  const lobbySession = sessionBlock();
  const lobbyActions = el("div", "", "fm-actions");
  lobbyActions.append(tvLink, start);
  lobby.append(lobbyMain);
  const help = keyHelp();
  const panel = settingsPanel(() => {
    help.dispatchEvent(new Event("fm-refresh"));
    showOptions();
  });

  // The song: the canvas, the result over it, the touch pads under it.
  const stage = el("section", "", "fm-stage"),
    screen = el("div", "", "fm-screen"),
    canvas = el("canvas", "", "fm-canvas"),
    note = el("p", "", "fm-note"),
    unlock = el("p", "TAP OR PRESS A KEY FOR SOUND", "fm-unlock"),
    holdNote = el("p", "", "fm-unlock fm-hold"),
    loadFailed = button("THE SONG DID NOT LOAD · RETRY", "fm-unlock fm-retry");
  const card = el("section", "", "fm-card"),
    cardTitle = el("h2"),
    cardRows = el("ol", "", "fm-rows"),
    cardSession = sessionBlock(),
    cardReport = el("div", "", "fm-report"),
    cardSide = el("div", "", "fm-report-side"),
    cardOwn = el("div", "", "fm-own"),
    ownGrade = el("strong", "", "fm-grade fm-own-grade"),
    ownScore = el("em", "", "fm-own-score"),
    ownDetail = el("small", "", "fm-own-detail"),
    ownBadge = el("b", "", "fm-own-badge"),
    cardCounts = el("dl", "", "fm-counts"),
    cardLines = el("ul", "", "fm-lines"),
    cardGraph = el("div", "", "fm-report-graph"),
    graph = el("canvas", "", "fm-graph"),
    graphStats = el("dl", "", "fm-graph-stats"),
    cardFoot = el("p", "", "fm-card-foot"),
    cardTiming = el("section", "", "fm-card-timing"),
    timingText = el("p", ""),
    timingApply = button("APPLY", "fui-button-primary fm-timing-apply"),
    timingSkip = button("NO THANKS", "fm-timing-skip"),
    cardActions = el("div", "", "fm-actions"),
    rematch = button("PLAY AGAIN", "fui-button-primary fm-rematch"),
    toLobby = button("SONG SELECT", "fm-to-lobby"),
    toMenu = button("MENU", "fm-to-menu");
  cardActions.append(toMenu, toLobby, rematch);
  cardOwn.append(ownGrade, ownScore, ownDetail, ownBadge);
  cardSide.append(cardOwn, cardCounts, cardLines);
  graph.setAttribute("role", "img");
  cardGraph.append(graph, graphStats, cardTiming);
  cardGraph.hidden = true;
  cardReport.append(cardSide, cardGraph);
  card.append(
    cardTitle,
    cardRows,
    cardSession.element,
    cardReport,
    cardFoot,
    cardActions,
  );
  // The pause: over the field, with what a paused song can do next.
  const pauseCard = el("section", "", "fm-pause"),
    pauseTitle = el("h2", "PAUSED"),
    pauseSong = el("p", "", "fm-pause-song"),
    pauseCount = el("strong", "", "fm-pause-count"),
    pauseActions = el("div", "", "fm-actions fm-pause-actions"),
    pauseResume = button("RESUME", "fui-button-primary fm-pause-resume"),
    pauseRestart = button("RESTART", "fm-pause-restart"),
    pauseSelect = button("SONG SELECT", "fm-pause-select"),
    pauseHint = el("p", "ESC RESUMES", "fm-pause-hint"),
    pauseButton = button("II", "fm-pause-button");
  pauseCard.setAttribute("role", "dialog");
  pauseCard.setAttribute("aria-label", "Paused");
  pauseButton.setAttribute("aria-label", "Pause");
  pauseActions.append(pauseResume, pauseRestart, pauseSelect);
  pauseCard.append(pauseTitle, pauseSong, pauseCount, pauseActions, pauseHint);
  pauseCard.hidden = pauseButton.hidden = pauseCount.hidden = true;
  timingText.setAttribute("role", "status");
  cardTiming.append(timingText, timingApply, timingSkip);
  cardTiming.hidden = true;
  card.hidden = true;
  unlock.hidden = loadFailed.hidden = holdNote.hidden = true;
  holdNote.setAttribute("role", "status");
  loadFailed.onclick = () => songs.retry();
  // The result says what its buttons do: another go, a session's next song, or back to the song select.
  rematch.onclick = () => {
    const action = model?.result?.primary.action;
    if (action) runtime.command({ type: "action", action });
  };
  toLobby.onclick = () => runtime.command({ type: "action", action: "lobby" });
  toMenu.onclick = leave;
  screen.append(
    canvas,
    unlock,
    holdNote,
    loadFailed,
    pauseButton,
    pauseCard,
    card,
    roundControls.element,
  );

  // ---- keys and pads: every one is stamped with the song time this device heard it at ----
  /** What holds each column down right now: key codes and pads. */
  const held: Set<string>[] = Array.from(
    { length: COLUMNS },
    () => new Set<string>(),
  );
  const songClock = createSongClock({
    now: () => performance.now(),
    audio: () => audio.clock(),
    extraLatencyMs: () => prefs.audioMs,
    pairing: () => pairedClock,
  });
  const probe = createLatencyProbe();
  const frameLead = createFrameLead();
  /** The timing panel beside the game, on a `?debugtiming` page once its code has arrived. */
  let lab: TimingLab | undefined,
    labGone = false;
  /** A browser's stamp is used when it is one: not zero, and within half a second of now. */
  const stamped = (at: number, now: number) =>
    at > 0 && Math.abs(at - now) < 500;
  /** The song time of an event stamped `at` on the page's clock, as the judge hears it. */
  const stamp = (at: number, now = performance.now()): number =>
    songClock.songMs(stamped(at, now) ? at : now) - prefs.offsetMs;
  const press = (column: number, source: string, at: number) => {
    if (pauseClock.paused) return;
    const now = performance.now(),
      ms = stamp(at, now);
    probe.press(
      source.startsWith("fm-") ? "touch" : "key",
      at,
      now,
      stamped(at, now),
    );
    // A second finger on a column that is already down is a new step: up and down again at the same instant.
    if (held[column]!.size) runtime.key(column, false, ms);
    held[column]!.add(source);
    const logged = runtime.key(column, true, ms);
    lab?.press({
      source: source.startsWith("fm-") ? "touch" : "key",
      column,
      stamp: at,
      handled: now,
      used: stamped(at, now),
      songMs: ms,
      ...(logged && runtime.lastSlackMs !== undefined
        ? { slackMs: runtime.lastSlackMs }
        : {}),
    });
  };
  const lift = (column: number, source: string, at: number) => {
    if (!held[column]!.delete(source) || held[column]!.size) return;
    runtime.key(column, false, stamp(at));
  };
  const throwItem = (at: number) => {
    if (!pauseClock.paused) runtime.useItem(stamp(at));
  };
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
    modes: [picker.element, options.element, lobbySession.element],
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
  /** The song being played, decoded for the audio clock, once this device has it. */
  const songOf = (id: string): ClockedSong | undefined => songs.song(id);
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
  // ---- timing: this device's own hit errors, and what they say about its input offset ----
  const collector = createHitCollector();
  /** What the result offers, and what it says once answered. */
  let timingOffer: Extract<Proposal, { kind: "apply" }> | undefined,
    timingNote = "";
  const showTiming = () => {
    setText(timingText, timingNote);
    cardTiming.hidden = timingNote === "";
    timingApply.hidden = timingSkip.hidden = !timingOffer;
  };
  /** The song is over: measure the run, remember it, and offer a new input offset when the bias is clear. */
  const judgeTiming = (song: string) => {
    timingOffer = undefined;
    timingNote = "";
    const bias = measureBias(collector.hits());
    collector.reset();
    if (bias.verdict === "clear") {
      const run = {
        song,
        estimateMs: prefs.offsetMs + bias.biasMs,
        used: bias.used,
        at: Date.now(),
        // The audio offset is part of the device as the run heard it: a changed one starts the comparison over.
        deviceMs: (audio.clock()?.latency() ?? 0) * 1000 + prefs.audioMs,
      };
      const history = loadHistory(store);
      const proposal = propose(run, history, prefs.offsetMs, MAX_OFFSET_MS);
      saveHistory(store, rememberRun(history, run));
      timingNote = proposalText(proposal, bias.used);
      if (proposal.kind === "apply") timingOffer = proposal;
    }
    showTiming();
  };
  timingApply.onclick = () => {
    if (!timingOffer) return;
    const ms = timingOffer.offsetMs;
    prefs = { ...prefs, offsetMs: ms };
    savePrefs(store, prefs);
    timingOffer = undefined;
    timingNote = `Input offset set to ${ms > 0 ? "+" : ms < 0 ? "−" : ""}${Math.abs(ms)} ms. Settings has it if you want it back.`;
    showTiming();
  };
  timingSkip.onclick = () => {
    timingOffer = undefined;
    timingNote = "";
    showTiming();
  };
  // ---- the run as the result graphs it: every step's offset, the misses and the combo ----
  const runLogger = createRunLogger();
  /** The finished run on the result, and whether the song that just ended still has to be read into it. */
  let report: RunLog | undefined,
    reportEnd = 0,
    reportDue = false;
  const drawGraph = () => {
    const width = graph.clientWidth,
      height = graph.clientHeight;
    if (!report || !width || !height) return;
    const scale = Math.min(2, window.devicePixelRatio || 1);
    graph.width = Math.round(width * scale);
    graph.height = Math.round(height * scale);
    const context = graph.getContext("2d");
    if (!context) return;
    context.setTransform(scale, 0, 0, scale, 0, 0);
    drawTimingGraph(context, width, height, report, {
      endMs: reportEnd,
      font: getComputedStyle(graph).fontFamily,
    });
  };
  const showReport = (log: RunLog | undefined, endMs: number) => {
    report = log && (log.steps.length || log.misses.length) ? log : undefined;
    reportEnd = endMs;
    cardGraph.hidden = !report;
    card.classList.toggle("fm-card-graphed", !!report);
    if (!report) return;
    const stats = runStats(report.steps);
    graphStats.replaceChildren(
      ...statLines(stats).flatMap(([label, value]) => [
        el("dt", label),
        el("dd", value),
      ]),
    );
    graph.setAttribute(
      "aria-label",
      stats.hits
        ? `Timing of ${stats.hits} steps: mean ${stats.meanMs.toFixed(1)} ms, standard deviation ${stats.spreadMs.toFixed(1)} ms, ${report.misses.length} misses`
        : `${report.misses.length} misses`,
    );
    drawGraph();
  };
  // ---- the pause ----
  /** The song time the picture stands at while paused, and when RESUME's count-in ends (0: none is running). */
  /** A paused song was given up: it stays silent and still until the room has left it. */
  let leavingSong = false;
  let pausedMs = 0,
    resumeAt = 0;
  const pausable = () =>
    solo && !!model?.playing && runtime.songMs() !== undefined;
  pause = () => {
    if (pauseClock.paused || !pausable()) return;
    letGoAll();
    // Before the song clock has the room's position it reads 0: the room's own is the one to stand at.
    pausedMs = songClock.songMs() || (runtime.songMs() ?? 0);
    pauseClock.pause();
    // The song stops where it is; RESUME starts it again on the room's clock.
    songClock.stop();
    resumeAt = 0;
    setText(pauseSong, model?.title ?? "");
    pauseCount.hidden = true;
    pauseActions.hidden = pauseHint.hidden = false;
    pauseCard.hidden = false;
    pauseResume.focus();
  };
  unpause = (leaving = false) => {
    leavingSong = leaving && pauseClock.paused;
    resumeAt = 0;
    pauseCard.hidden = true;
    pauseClock.resume();
  };
  /** Counts in, so the hands are back on the keys when the arrows move again. */
  const resume = () => {
    if (!pauseClock.paused || resumeAt) return;
    resumeAt = performance.now() + RESUME_MS;
    pauseActions.hidden = pauseHint.hidden = true;
    pauseCount.hidden = false;
    setText(pauseCount, resumeCount(RESUME_MS));
  };
  pauseButton.onclick = () => pause();
  pauseResume.onclick = resume;
  pauseSelect.onclick = () => {
    unpause(true);
    runtime.command({ type: "action", action: "lobby" });
  };
  const latencyBox = new URLSearchParams(location.search).has("latency")
    ? el("pre", "", "fm-latency")
    : undefined;
  if (latencyBox) screen.append(latencyBox);
  const latencyContext = () => {
    const bias = measureBias(collector.hits()),
      detail = audio.clock()?.latencies?.();
    return {
      baseMs: detail?.base === undefined ? undefined : detail.base * 1000,
      outputMs: detail?.output === undefined ? undefined : detail.output * 1000,
      driftMs: songClock.drift,
      audible: songClock.audible,
      offsetMs: prefs.offsetMs,
      hits: bias,
    };
  };
  let latencyShown = 0;
  /** A solo song that began before the browser let sound out starts over once it does. */
  let restarting = false,
    startedSilent = false,
    heardEpoch = -1;
  pauseRestart.onclick = () => {
    unpause(true);
    // START is refused while the match runs: it is sent once the room is back at the song select.
    runtime.command({ type: "action", action: "lobby" });
    restarting = true;
  };
  const frame = (now: number) => {
    // Asked first, so one bad frame cannot stop the drawing for good.
    if (!over) requestAnimationFrame(frame);
    const began = performance.now();
    probe.frameStart(now, began);
    frameLead.frame(now);
    songClock.sample();
    const mapping = songClock.mapping();
    if (mapping) probe.clock(mapping.reading, mapping.smoothed);
    if (mapping?.pairedMs !== undefined) probe.pair(mapping.pairedMs);
    const state = runtime.roomState();
    const roomMs = runtime.songMs();
    const world = state?.world;
    // A phone that is a controller makes no music: the shared screen does.
    const song =
      world && roomMs !== undefined && model?.screen === "play"
        ? songOf(world.song)
        : undefined;
    // A started song waits for every device's audio: this one says when it is done getting it, or needs none (a
    // phone that is a pad makes no music).
    const held = runtime.held();
    if (held && world && model && model.screen !== "lobby")
      if (model.screen !== "play" || songs.settled(world.song)) runtime.ready();
    const paused = pauseClock.paused;
    if (paused && !pausable()) unpause();
    else if (paused && resumeAt) {
      if (now >= resumeAt) unpause();
      else setText(pauseCount, resumeCount(resumeAt - now));
    }
    // A paused song is silent and stays where it stood: it is not followed until the clock runs again.
    if (leavingSong && state?.stage !== "running") leavingSong = false;
    const still = pauseClock.paused || leavingSong;
    // Held, the song is silent at its first moment; it starts when the room lets it go.
    if (!still) songClock.follow(roomMs, held ? undefined : song);
    pauseButton.hidden =
      pauseClock.paused || !pausable() || !coarse() || display;
    if (restarting && state?.stage === "lobby") {
      restarting = false;
      // Should START be refused, the song select it was hidden behind is there again.
      lobby.hidden = model?.screen !== "lobby";
      runtime.command({ type: "action", action: "start" });
    }
    if (!model || model.screen === "lobby" || !world) {
      before = undefined;
      unlock.hidden = loadFailed.hidden = holdNote.hidden = true;
      return;
    }
    const waiting = held;
    holdNote.hidden = !waiting || model.screen !== "play";
    if (waiting && !holdNote.hidden)
      setText(holdNote, holdText(model.waiting, songs.settled(world.song)));
    const running = roomMs !== undefined;
    const silent =
      running &&
      model.screen === "play" &&
      !audio.forcedMute &&
      !audio.prefs.muted &&
      audio.clock()?.running === false;
    unlock.hidden = !silent || !!waiting;
    loadFailed.hidden =
      silent || !running || !!waiting || songs.failures() < SONG_LOAD_TRIES;
    // Sound that has been heard in this match and stops for a moment (a tab left and returned to) restarts nothing.
    const epoch = state?.epoch ?? -1;
    if (!silent && running && audio.clock()?.running) heardEpoch = epoch;
    if (silent && solo && heardEpoch !== epoch) startedSilent = true;
    else if (startedSilent && running) {
      startedSilent = false;
      if (world.ms < 30000) {
        // START is refused while the match runs: it is sent once the room is back at the song select.
        runtime.command({ type: "action", action: "lobby" });
        restarting = true;
      }
    }
    const heard = !running
      ? world.ms
      : still
        ? pausedMs
        : songClock.songMs(now);
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
    // Only what was played by ear counts: a silent page or a phone used as a pad plays to another clock.
    const mine = local === -1 ? undefined : view.players[local];
    if (mine && !mine.bot && running && songClock.audible)
      collector.observe(mine, `${epoch}:${prefs.offsetMs}`);
    if (mine && !mine.bot) {
      runLogger.observe(mine, String(epoch), heard - prefs.offsetMs);
      // The frame after the song ended has its last steps in it: that is the run the result graphs.
      if (reportDue && state?.stage === "over") {
        reportDue = false;
        const log = runLogger.log();
        showReport(
          {
            steps: [...log.steps],
            misses: [...log.misses],
            combo: [...log.combo],
            unplaced: log.unplaced,
          },
          view.endMs,
        );
      }
    }
    const timing = library.timing(view.song);
    // Fade and Ping-pong change this device's own song, for the rider playing on it. A shared screen plays one song
    // for everybody in the room, so there it is left alone.
    if (song) {
      const shape = mine
        ? songShape(mine.effects, heard, timing?.beatAt(heard / 1000) ?? 0)
        : undefined;
      song.shape(shape?.level ?? 1, shape?.pan ?? 0);
    }
    if (stage.hidden) return;
    // The frame is seen a refresh after it starts: the arrows are drawn where the sound will be then.
    const drawn = heard + frameLead.ms + prefs.visualMs;
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
      totals: model.totals,
      itemKey: coarse() ? "ITEM" : keyLabel(prefs.keys.item[0] ?? ""),
    });
    const done = performance.now();
    probe.frameEnd(done);
    lab?.frame(began, done, {
      mine: mine && !mine.bot ? mine : undefined,
      running,
      audible: songClock.audible,
      epoch,
      song: view.song,
      title: model.title,
    });
    if (latencyBox && done - latencyShown > 500) {
      latencyShown = done;
      latencyBox.textContent = latencyText(probe.report(), latencyContext());
    }
  };
  requestAnimationFrame(frame);
  if (debugTiming)
    void import("./timing-lab.js").then(({ createTimingLab }) => {
      if (labGone) return;
      lab = createTimingLab({
        mode: "game",
        doc: document,
        win: window,
        audio,
        songClock,
        probe,
        frameLead,
        prefs: () => prefs,
        setPrefs(next) {
          prefs = next;
          savePrefs(store, prefs);
          panel.refresh();
        },
        latencyContext,
        openScreen() {
          location.href = withFlags(endpoints.appUrl("?timing"));
        },
        now: () => performance.now(),
      });
      document.body.append(lab.element);
    });
  // For smokes and for a player's bug report: where the sound, the room and the picture are, read from the console.
  Object.assign(window, {
    fusemania: {
      clock: () => ({
        audible: songClock.audible,
        driftMs: songClock.drift,
        heardMs: songClock.songMs(),
        roomMs: runtime.songMs(),
        latencyMs: (audio.clock()?.latency() ?? 0) * 1000,
        loaded: songs.settled(runtime.roomState()?.world?.song ?? ""),
        held: runtime.held(),
      }),
      view: () => runtime.picture(songClock.songMs() - prefs.offsetMs),
      /** Press-to-handler and press-to-frame percentiles, the audio clock's figures and this run's hit errors. */
      latency: () => ({ ...probe.report(), ...latencyContext() }),
      latencyText: () => latencyText(probe.report(), latencyContext()),
      /** A `?debugtiming` page's whole session: what the panel shows, and its log as JSON lines. */
      timing: () => lab?.snapshot(),
      timingLog: () => lab?.logText() ?? "",
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
    // A restart passes through the song select for a moment: it is not shown.
    lobby.hidden = next.screen !== "lobby" || restarting;
    stage.hidden = next.screen !== "play";
    controller.hidden = next.screen !== "controller";
    nameEntry.form.hidden = !next.askName;
    // The song select's music plays in the lobby only; a match's song is the audio clock's.
    if (next.screen === "lobby" && !display && !restarting) {
      preview.show(view.settings.song);
      // Decoded while the players choose, so START rarely waits for it.
      songOf(view.settings.song);
    } else preview.stop();
    if (view.stage === "over" && lastStage === "running" && next.result)
      sfx.fanfare(
        !next.result.rows.some((row) => row.you && /^[CD]$/.test(row.grade)),
      );
    if (view.stage === "over" && lastStage === "running" && view.world) {
      judgeTiming(view.world.song);
      reportDue = true;
    } else if (view.stage !== "over") {
      if (timingOffer || timingNote) {
        timingOffer = undefined;
        timingNote = "";
        showTiming();
      }
      reportDue = false;
      if (report) showReport(undefined, 0);
    }
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
    setText(start, next.lobby.startText);
    lobbySession.update(next.lobby.session);
    showOptions();
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
      // Alone, the one row says nothing the big grade does not.
      cardRows.hidden = !!result.own && result.rows.length === 1;
      cardOwn.hidden = !result.own;
      card.classList.toggle("fm-card-own", !!result.own);
      if (result.own) {
        const own = result.own;
        setText(ownGrade, own.grade);
        ownGrade.className = `fm-grade fm-own-grade fm-grade-${own.grade.toLowerCase()}`;
        setText(ownScore, own.score);
        setText(ownDetail, own.detail);
        setText(ownBadge, own.badge);
        ownBadge.hidden = !own.badge;
      }
      const counts = JSON.stringify(result.counts);
      if (cardCounts.dataset.counts !== counts) {
        cardCounts.dataset.counts = counts;
        // The six judgments share one scale: each bar is its share of the steps.
        const steps = result.counts
          .slice(0, 6)
          .reduce((sum, [, value]) => sum + (Number(value) || 0), 0);
        cardCounts.replaceChildren(
          ...result.counts.map(([label, value], index) => {
            const row = el("div", "", "fm-count-row"),
              bar = el("i", "", "fm-count-bar"),
              kind = `fm-count-${label.toLowerCase().split(" ")[0]}`;
            // A judgment's bar is its share of the steps; the holds' bar is how many were kept.
            const [kept = 0, all = 0] = value.split(" / ").map(Number);
            const share =
              index < 6 ? (steps ? kept / steps : 0) : all ? kept / all : 0;
            bar.style.setProperty("--share", share.toFixed(4));
            bar.classList.add(kind);
            row.append(el("dt", label, kind), bar, el("dd", value));
            return row;
          }),
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
      // A session's standings: under the song's result, and above it once the session is over.
      cardSession.update(result.session);
      const anchor = result.final ? cardTitle : cardRows;
      if (cardSession.element.previousElementSibling !== anchor)
        anchor.after(cardSession.element);
      for (const [main, other] of [
        [rematch, toLobby],
        [controllerRematch, controllerLobby],
      ] as const) {
        setText(main, result.primary.text);
        other.hidden = !result.secondary;
        if (result.secondary) setText(other, result.secondary.text);
      }
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
    { display: shared, ...sessionChoice, ...choice },
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
          // Alone, the room keeps this page's time, and that can stand still.
          dependencies: { ...browserDependencies, now: pauseClock.now },
        },
  );
  installRoomLifecycle(window, {
    stop: () => runtime.stop(),
    destroy: () => {
      menu.dispose();
      panel.dispose();
      songClock.stop();
      scene.destroy();
      lab?.dispose();
      lab = undefined;
      labGone = true;
    },
    reload: () => location.reload(),
  });
  window.addEventListener("resize", () => {
    scene.resize();
    drawGraph();
  });

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
    // Escape pauses a solo song and takes the pause away again; the Escape that closed a menu does neither.
    if (event.code === "Escape" && (pauseClock.paused || pausable())) {
      event.preventDefault();
      if (event.repeat || performance.now() - menuClosedAt < 100) return;
      if (pauseClock.paused) resume();
      else pause();
      return;
    }
    // A paused song takes no steps; its buttons keep Enter, Space and Tab.
    if (pauseClock.paused) return;
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
        // A cover, an arrow or a chip that was just clicked keeps the focus: the carousel's keys still turn it.
        (!typing(event.target) ||
          (event.target instanceof HTMLButtonElement &&
            picker.element.contains(event.target))) &&
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
      // Nobody is watching the arrows: a solo song waits.
      pause();
    }
  });
  // A pinch or a double tap must never zoom the arrows away from under the thumbs.
  for (const type of ["gesturestart", "gesturechange", "dblclick"])
    for (const part of [stage, controller])
      part.addEventListener(type, (event) => event.preventDefault());
  runtime.start();
}

const query = new URLSearchParams(location.search);
if (query.has("timing") || query.has("sync")) timing();
else if (query.get("solo") === "1") room(true, LIBRARY);
else if (query.has("room")) room(false, LIBRARY);
else landing();
