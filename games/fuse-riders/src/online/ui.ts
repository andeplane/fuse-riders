import { legendSrc } from "../client/legend-src.js";
import { VoiceChat } from "./voice-chat.js";
import { uuid } from "fuse-netcode";
import { showRoomSettings } from "./room-settings-menu.js";
import { keyboardShortcuts } from "./keyboard-shortcuts.js";
import { startAttract } from "./attract.js";
import { mountArenaPresentation } from "../render/phaser/presentation.js";
import { presentFrames } from "../render/time/present.js";
import { apiUrl, appUrl } from "./endpoints.js";
import { GAME_ID } from "../shared/game-id.js";
import { createAccountPanel } from "./account-panel.js";
import {
  accountUsername,
  fetchUsername,
  signedInToken,
  remembersSignIn,
} from "./account.js";
import {
  buildMatchReport,
  buildRoundReport,
  sendMatchReport,
} from "./match-report.js";
import { ControllerInputState } from "../client/controller-state.js";
import { ControllerKeyboardBindings } from "../client/controller-keyboard.js";
import { createControllerLayoutSetting } from "../client/controller-layout.js";
import "./mobile-play-layout.css";
import "./arcade-pads.css";
import { ControllerPointerBindings } from "../client/controller-pointers.js";
import {
  createAvatarPicker,
  createAvatarPortrait,
} from "../client/avatar-heads.js";
import {
  applyThemeProperties,
  themes,
  type ThemeDefinition,
  type ThemeId,
} from "../render/themes.js";
import { selectedTheme, storeTheme } from "../client/theme-choice.js";
import { createGameAudio, type GameAudio } from "../client/game-audio.js";
import {
  defaultRoomSettings,
  loadRoomSettings,
  parseRoomSettings,
  SETTINGS_KEY,
  type RoomSettings,
} from "../engine/room-settings.js";
import type { PickupType } from "../engine/game.js";
import type { WorldView } from "../engine/view.js";
import { renderMatchRecap } from "./match-recap-view.js";
import { ReplayDirector, describeClip } from "../client/replay.js";
import { createReplayOverlay } from "../client/replay-overlay.js";
import { RoomRuntime, type Callbacks } from "./room-runtime.js";
import {
  PeerTransport,
  createRoom,
  endRoom,
  formatLinkDiagnostics,
  installRoomLifecycle,
  validRoomCode,
} from "fuse-network-fe";
import { MAX_PACKET_BYTES } from "fuse-netcode";
import { NetStats } from "./net-stats.js";
import { Telemetry, telemetryEndpoint } from "./telemetry.js";
import type { AvatarId } from "../shared/avatars.js";
import QRCode from "qrcode";
import {
  button,
  el as node,
  createConfirm,
  createRadioGroup,
  createControllerRow,
  createDialog,
  createKeyList,
  createLobbyShell,
  createInviteCard,
  createJoinByCode,
  createRoster,
} from "fuse-ui";
import "./online.css";
import "./top-menu.css";
import { formatNetStats } from "./net-stats.js";
import { installMobilePlayLayout } from "./mobile-play-layout.js";
import {
  endedScreen,
  roomScreen,
  screenClasses,
  type RoomDevice,
  type RoomScreen,
  type RoomScreenInput,
} from "./room-screen.js";
import { presentRoom, presentStatus, recapReady } from "./room-presenter.js";
import { connectHint } from "./connect-hint.js";
import { createJoinCard, createJoinForm } from "./join-form.js";
import { safeStorage } from "../client/safe-storage.js";
import { reportGraphics, startAnalytics, track } from "./analytics.js";
import { createAnalyticsSetting } from "./analytics-setting.js";
import { connectStatus } from "./analytics-text.js";
import { createFunnel } from "./funnel.js";
import { POWERUP_GUIDE } from "../client/powerup-guide.js";
import { createPowerupGuide } from "../client/powerup-guide-view.js";
import { announcementFor, eliminationLine } from "../client/arena-announcer.js";
/** The blurred scene behind the lobby and results redraws at 10 fps. */
const BACKDROP_FRAME_MS = 100;
const LAST_ROOM_KEY = "fuse-last-room";
const reducedMotion = () =>
  matchMedia("(prefers-reduced-motion: reduce)").matches;
const storage = safeStorage(() => localStorage);
/** Fuse Riders' class names for the shared dialog shell; online.css styles them. */
const FUSE_DIALOG_CLASSES = {
  root: "game-dialog",
  bar: "dialog-bar",
  title: "",
  actions: "dialog-actions",
  close: "",
  body: "dialog-body",
};
const labels: Record<PickupType, string> = {
  stopwatch: "Shorter fuse",
  extraBomb: "Extra Bomb",
  power: "Power",
  triple: "Triple shot",
  five: "Five shot",
  gun: "Gun",
  shell: "Shell",
  beer: "Beer",
  ink: "Ink",
  orbitShield: "Shield",
  portal: "Portal",
  star: "Star",
  grip: "Grip",
  range: "Range",
  nitro: "Nitro",
  snail: "Snail",
  gravity: "Gravity",
};
// Storage only ever through `safeStorage`: Safari with "Block all cookies" throws on merely evaluating `localStorage`.
const read = (key: string) => storage.getItem(key);
const save = (key: string, value: string) => storage.setItem(key, value);
/** The transport's player-facing wording, in the game's voice. */
const TRANSPORT_COPY = {
  linking: "Connected · linking riders",
  protocolChanged: "Game protocol changed — reload this page",
  roomEnded: "Room ended — return to menu to start again",
  roomFull: "Room full (five players, five spectators and TV)",
  hostAbsent: "the creator is not in the room yet",
};
const secret = () => uuid().replaceAll("-", "") + uuid().replaceAll("-", "");
// One radio for the document's whole life. Entering a room from the landing page swaps the view in place rather than
// reloading (a page load costs the soundtrack: no browser will autoplay before the new page has been tapped), so a
// second createGameAudio would leave two <audio> elements playing the same track. Ctrl+A goes to whichever view is up.
let pageAudio: GameAudio | undefined, radioToggle: (() => void) | undefined;
// One wording for both views, since the same instance now serves whichever one is up: a room entered from the landing
// page would otherwise keep the label the landing page created it with.
const createPlayerAccountPanel = () =>
  createAccountPanel({
    historyUrl: (before) =>
      apiUrl(
        `/api/me/matches${before === undefined ? "" : `?before=${before}`}`,
      ),
    profileUrl: apiUrl("/api/me"),
    leaderboardUrl: apiUrl("/api/leaderboard"),
    localName: () => read("fuse-riders-player-name"),
    fetch: (input, init) => fetch(input, init),
    track,
  });

const sharedAudio = (): GameAudio =>
  (pageAudio ??= createGameAudio("Game", {
    background: true,
    toggleRadio: () => radioToggle?.(),
  }));
export async function startOnline(): Promise<void> {
  const app = document.querySelector<HTMLElement>("#app")!;
  app.className = "online-app";
  const url = new URL(location.href);
  const solo = url.searchParams.get("solo") === "1";
  const code = solo ? "SOLO" : url.searchParams.get("room")?.toUpperCase();
  if (!code) {
    app.classList.add("landing-app");
    startAnalytics({ role: "landing" });
    track("App Opened");
    const card = node("main", "", "landing");
    const link = (href: string, className: string, ...content: Node[]) => {
      const anchor = node("a", "", className);
      anchor.href = href;
      anchor.append(...content);
      return anchor;
    };
    const arena = node("canvas", "", "landing-arena");
    arena.setAttribute("aria-hidden", "true");
    const brand = link(appUrl(), "landing-brand");
    brand.append("FUSE", node("span", "RIDERS"));
    const musicButton = button("♫ MUSIC ON", "landing-audio"),
      muteButton = button("🔊 SOUND ON", "landing-mute"),
      topEnd = node("div", "", "landing-top-end game-top-menu");
    topEnd.append(
      node("span", "TINY RIDERS. BIG TROUBLE.", "landing-tag"),
      musicButton,
      muteButton,
    );
    const top = node("header", "", "landing-top");
    top.append(brand, topEnd);
    const eyebrow = node("p", "", "landing-eyebrow");
    eyebrow.append(node("span"), " A NEON ARENA PARTY GAME");
    const headline = node("h1");
    headline.append(
      "LEAVE A TRAIL.",
      node("br"),
      "MAKE A ",
      node("em", "MESS."),
    );
    const intro = node("p", "", "landing-intro");
    intro.append(
      "Outrun your friends. Blow up their plans.",
      node("br"),
      "One arena. Five riders. Absolutely no brakes.",
    );
    const soloLink = link(
      appUrl("?solo=1"),
      "solo-cta",
      node("span", "▶ \u00a0 PLAY SOLO"),
      node("small", "YOU VS. FOUR AI RIVALS"),
    );
    const form = node("div", "", "landing-multiplayer");
    form.append(node("p", "OR BRING YOUR FRIENDS", "landing-section-label"));
    const hint = node("p", "", "landing-hint");
    hint.append(
      "Phones are your controllers. A TV can be your arena.",
      node("br"),
      "On the same Wi-Fi? Even better.",
    );
    const content = node("section", "", "landing-content");
    content.append(
      eyebrow,
      headline,
      intro,
      soloLink,
      form,
      hint,
      link(
        `${appUrl()}dice/`,
        "landing-more",
        document.createTextNode("MORE GAMES: PIG ›"),
      ),
    );
    const live = node("aside", "", "landing-live");
    live.append(
      node("span", "", "live-dot"),
      " LIVE AI FREE-FOR-ALL ",
      node("small", "Real riders. Real explosions."),
    );
    const attractToggle = button("Ⅱ PAUSE BACKGROUND", "attract-toggle");
    const footerBar = node("footer", "", "landing-footer");
    footerBar.append(
      node("span", "STEER. CHARGE. RELEASE. SURVIVE."),
      attractToggle,
    );
    card.append(
      arena,
      node("div", "", "landing-shade"),
      top,
      content,
      live,
      footerBar,
    );
    const guide = node("section", "", "landing-guide"),
      guideTitle = node("h2", "POWER-UPS", "landing-section-label");
    guideTitle.id = "landing-guide-title";
    guide.setAttribute("aria-labelledby", guideTitle.id);
    guide.append(
      guideTitle,
      createPowerupGuide(POWERUP_GUIDE, {
        className: "landing-powerups",
        themeId: selectedTheme().id,
        offByDefaultNote: "(off by default, enable in room settings)",
      }).element,
    );
    content.append(guide);
    const { element: mode, value: chosenMode } = createRadioGroup({
      legend: "Where will you play?",
      name: "landing-mode",
      options: [
        { value: "devices", label: "Each device" },
        { value: "shared", label: "Shared TV" },
      ],
      selected: loadRoomSettings(storage).mode,
      className: "landing-mode",
    });
    const create = node("button", "CREATE ROOM");
    const error = node("p");
    // `enter` keeps the document, so Room Created no longer needs a send-before-unload flush: nothing unloads out from
    // under the request, and the room stops waiting up to 700ms for Mixpanel before it appears.
    create.onclick = async () => {
      create.disabled = true;
      try {
        const body = await createRoom(apiUrl, fetch, GAME_ID);
        save(`fuse-room-${body.code}`, body.token);
        const settings = loadRoomSettings(storage);
        settings.mode = chosenMode();
        save(SETTINGS_KEY, JSON.stringify(settings));
        track("Room Created", { mode: settings.mode });
        enter(`?room=${body.code}`);
      } catch (e) {
        error.textContent = String(e);
        create.disabled = false;
      }
    };
    error.setAttribute("role", "alert");
    const createRow = node("div", "", "landing-create");
    createRow.append(mode, create);
    // The last room this browser was in is one tap away; a closed room still lands on its ROOM CLOSED card, which forgets it.
    const lastRoom = read(LAST_ROOM_KEY);
    const { row: joinRow } = createJoinByCode({
      valid: validRoomCode,
      onJoin: (value) => enter(`?room=${value}`),
      onInvalid: (message) => {
        error.textContent = message;
      },
      ...(lastRoom && validRoomCode(lastRoom)
        ? {
            rejoin: {
              code: lastRoom,
              title: "Return to the room you were in last",
              onRejoin: (room: string) => {
                location.href = appUrl(`?room=${room}`);
              },
            },
          }
        : {}),
      classes: {
        root: "landing-join",
        input: "",
        button: "",
        rejoin: "landing-rejoin",
      },
    });
    form.append(createRow, joinRow, error);
    app.replaceChildren(card);
    let cleanup: (() => void) | undefined,
      ended = false;
    // Leaving the landing page for a room, keeping the document (and so the music) alive. Back goes through a reload,
    // which is what a fresh load of either view does anyway.
    const enter = (query: string) => {
      ended = true;
      cleanup?.();
      accountPanel.dispose();
      window.addEventListener("popstate", () => location.reload(), {
        once: true,
      });
      history.pushState(null, "", appUrl(query));
      void startOnline();
    };
    window.addEventListener(
      "pagehide",
      () => {
        ended = true;
        cleanup?.();
      },
      { once: true },
    );
    window.addEventListener("pageshow", (event) => {
      if (event.persisted) location.reload();
    });
    // The landing page has no room and no snapshots, so its music is background music the toggle owns outright.
    const landingAudio = sharedAudio();
    landingAudio.bindMusicToggle(musicButton);
    landingAudio.bindMuteToggle(muteButton);
    musicButton.before(landingAudio.controls);
    radioToggle = () => landingAudio.controls.toggleAttribute("open");
    // PLAY SOLO is a real link for a new tab or a bookmark; a plain click takes the in-place route with the music.
    soloLink.addEventListener("click", (event) => {
      if (
        event.button ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      event.preventDefault();
      enter("?solo=1");
    });
    // Settings before a game exists (#168): the same room settings CREATE ROOM and PLAY SOLO read from storage. The screen layout
    // stays disabled here because the radio buttons below choose it for the room being created.
    const landingSettings = node("button", "SETTINGS", "landing-settings");
    landingSettings.type = "button";
    const { dialog: landingDialog, body: landingBody } = createDialog({
      title: "SETTINGS",
      label: "Settings",
      classes: FUSE_DIALOG_CLASSES,
    });
    // This device's privacy choice sits under the room settings draft rather than in it: it is not the room's.
    const landingPrivacy = createAnalyticsSetting({ collapsed: true });
    landingDialog.append(landingPrivacy.element);
    // `solo:true` disables the screen-layout fieldset, which is what keeps CREATE ROOM's own `settings.mode=selectedMode` from fighting
    // this dialog over the same stored key: the page's radios remain the only writer of `mode`.
    landingSettings.onclick = () => {
      landingPrivacy.render();
      showRoomSettings(
        landingBody,
        loadRoomSettings(storage),
        true,
        labels,
        (draft) => {
          if (!parseRoomSettings(draft)) return false; // no room authority behind this save: a draft the loader would reject later must never reach storage, or every setting resets on the next load
          save(SETTINGS_KEY, JSON.stringify(draft));
          track("Settings Changed", {
            mode: draft.mode,
            match: draft.match,
            matchLength: draft.length,
            bombChargeTicks: draft.bombChargeTicks,
            chainReaction: draft.chainReaction,
            aimBounce: draft.aimBounce,
            map: draft.map,
            powerupTypes: Object.values(draft.weights).filter(
              (weight) => weight > 0,
            ).length,
          });
          return true;
        },
        () => landingDialog.close(),
      );
      landingDialog.showModal();
    };
    topEnd.append(landingSettings);
    card.append(landingDialog);
    // Optional sign-in and match history. A guest who never opens it never downloads the sign-in SDK.
    const accountPanel = createPlayerAccountPanel();
    topEnd.append(accountPanel.leaderboardButton, accountPanel.button);
    card.append(accountPanel.dialog);
    window.addEventListener("pagehide", accountPanel.dispose, { once: true });
    // The attract loop stays Fuse Riders' own: it runs the game's engine and renderer behind the landing page.
    void startAttract(arena, attractToggle)
      .then((stop) => {
        if (ended) stop();
        else cleanup = stop;
      })
      .catch(() => {
        live.remove();
      });
    return;
  }
  if (!solo && !validRoomCode(code)) {
    app.textContent = "Invalid room code";
    return;
  }
  const displayOnly = !solo && url.searchParams.has("display");
  // CREATE ROOM is the only writer of fuse-room-<code>: its presence makes this browser the host's. Everyone else is a joiner with a separate peer identity.
  const hostToken = solo || displayOnly ? null : read(`fuse-room-${code}`);
  const role: "solo" | "display" | "host" | "joiner" = solo
    ? "solo"
    : displayOnly
      ? "display"
      : hostToken
        ? "host"
        : "joiner";
  const token = solo ? "" : displayOnly ? secret() : hostToken || peerToken();
  function peerToken() {
    const key = `fuse-peer-${code}`;
    const token = read(key) || secret();
    save(key, token);
    return token;
  }
  const forgetHostToken = () => storage.removeItem(`fuse-room-${code}`);
  if (!solo && !displayOnly) save(LAST_ROOM_KEY, code);
  let id = "",
    isHost = false,
    joined = false,
    // This device has a place in the room's watching list: in the room, with no seat and no controls.
    watching = false,
    settings = loadRoomSettings(storage),
    snapshot: WorldView | undefined;
  let readyPlayers: readonly string[] = [];
  startAnalytics({ role, mode: settings.mode, solo });
  track("App Opened");
  // When Match Started, Kill / Miss, Seat Taken and Match Ended fire is `funnel.ts`; the render callback only feeds it.
  const funnel = createFunnel(track, { now: () => Date.now(), storage });
  const frameTimes: number[] = [];
  const inputTimes: number[] = [];
  let previousFrame = performance.now(),
    inputAt = 0;
  let lastRatedRound = "";
  let lastRecap = "",
    rejoinPending = false,
    recapIsReady = false;
  const benchmark = url.searchParams.get("benchmark") === "1";
  let benchmarkInput: { seq: number; at: number } | undefined,
    lastBenchmarkRender = 0,
    lastBackdropRender = 0,
    lastControls = "";
  const sample = (detail: object) => {
    if (benchmark)
      window.dispatchEvent(new CustomEvent("fuse-benchmark", { detail }));
  };
  // Development diagnostics: every device posts its runtime metrics and status changes to the dev server once a second.
  const telemetry = new Telemetry(solo ? undefined : telemetryEndpoint());
  // A saved draft is the room's settings once its log entry folds, a tick or two later; until the folded settings move (or a second passes) the draft stays current.
  let pendingSettings:
    { draft: RoomSettings; before: string; at: number } | undefined;
  // A terminal room close (4004) freezes this client: no further snapshots are applied and no input may leave, whatever a stale pointer or key does next.
  let roomEnded = false;
  const header = node("header", "", "online-header");
  const title = node("strong", "", "room-brand"),
    status = node("span", "Connecting…", "online-status"),
    results = node("button", "RESULTS"),
    menu = node("button", solo ? "EXIT" : "ROOM"),
    prefsButton = node("button", "SETTINGS");
  // Players read three link states (connected / connecting / trouble); the runtime's full wording stays in the tooltip and the ROOM diagnostics.
  const statusAction = node("button", "RETRY", "online-status-action");
  statusAction.hidden = true;
  statusAction.onclick = () => location.reload();
  const roundChip = node("span", "", "online-round");
  roundChip.hidden = true;
  let rawStatus = "",
    replacedHost = false;
  title.append(node("span", "FUSE"), node("span", "RIDERS"));
  title.setAttribute("aria-label", `Fuse Riders · ${code}`);
  // The brand is the way home on every screen. A closed room goes straight to the menu; anything live opens the same exit confirmation as EXIT / ROOM.
  const goHome = () => {
    if (roomEnded) location.href = appUrl();
    else menu.click();
  };
  title.setAttribute("role", "link");
  title.tabIndex = 0;
  title.title = "Back to the main menu";
  title.onclick = goHome;
  title.onkeydown = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      goHome();
    }
  };
  results.hidden = true;
  results.title = "Reopen the match results";
  header.append(title, status, statusAction, roundChip, results);
  const joinForm = createJoinForm(
    storage,
    (playerName, avatarId) =>
      runtime.command({ type: "join", name: playerName, avatarId }),
    accountUsername(),
    // Solo is one rider and four AI on this device: there is no room to watch.
    solo
      ? undefined
      : (playerName) => runtime.command({ type: "spectate", name: playerName }),
  );
  // Signed in on this browser but never opened MY GAMES here (an invite link on a new phone): learn the username while the form is still up.
  if (!solo && remembersSignIn() && !accountUsername())
    void fetchUsername(apiUrl("/api/me"), (input, init) =>
      fetch(input, init),
    ).then((username) => {
      if (username && !joined) joinForm.useAccountName(username);
    });
  const bootNote = node("p", "Warming up the arena…", "room-boot-note");
  const booting = node("div", "", "room-boot");
  booting.setAttribute("role", "status");
  booting.append(
    node("p", "PREPARING ROOM", "room-boot-title"),
    node("strong", code, "shared-room-code"),
  );
  // A joiner never mounts the host's boot card or QR lobby: until it holds a seat its whole page is the join card, with the same connect hint under the form.
  const joinPanel =
    role === "joiner"
      ? createJoinCard(code, joinForm.element, bootNote)
      : joinForm.element;
  if (role !== "joiner")
    joinForm.element.prepend(node("p", "JOIN THE RACE", "lobby-join-title"));
  if (role !== "joiner") booting.append(bootNote);
  // A room that never sends a snapshot must stop claiming progress: the note escalates to the same-network hint once the link stalls or ICE fails.
  const bootAt = performance.now();
  let connectFailed = false,
    booted = false;
  // 20s is where connectHint gives up on progress and says "different network": the one drop-off the funnel cannot otherwise see.
  const bootTick = () => {
    const waited = performance.now() - bootAt;
    bootNote.textContent = connectHint(rawStatus, waited);
    if (waited >= 20000 && !connectFailed) {
      connectFailed = true;
      track("Connect Failed", {
        status: connectStatus(rawStatus),
        secondsWaiting: Math.round(waited / 1000),
      });
    }
  };
  const bootPoll = setInterval(bootTick, 1000);
  // The first frame (or the room ending) takes the boot card down; the screen derived next drops `.booting`.
  const bootDone = () => {
    if (booted) return;
    booted = true;
    clearInterval(bootPoll);
    booting.remove();
    bootNote.remove();
  };
  const overCard = node("div", "", "room-boot room-over-card"),
    overNote = node(
      "p",
      "Room ended — return to menu to start again",
      "room-boot-note",
    ),
    overHome = node("a", "BACK TO MENU", "room-over-home");
  overCard.setAttribute("role", "status");
  overHome.href = appUrl();
  overCard.append(
    node("p", "ROOM CLOSED", "room-boot-title"),
    node("strong", code, "shared-room-code"),
    overNote,
    overHome,
  );
  app.replaceChildren(header, role === "joiner" ? joinPanel : booting);
  let canvas = node("canvas", "", "online-arena");
  let renderScope = code;
  const presentation = mountArenaPresentation(
    canvas,
    (replacement) => {
      canvas = replacement;
    },
    reportGraphics,
  );
  let theme: ThemeDefinition = selectedTheme();
  // Both styles' textures are preloaded by the Phaser arena and every palette is read per frame, so switching needs no reload.
  applyThemeProperties(theme);
  const styleIds = Object.keys(themes) as ThemeId[];
  // Visual style is one of the device preferences behind SETTINGS: two pressed/unpressed options instead of a cycling header button.
  const styleHeading = node("h3", "VISUAL STYLE", "settings-group"),
    styleRow = node("div", "", "settings-style");
  const applyStyle = (next: ThemeDefinition) => {
    theme = next;
    storeTheme(next.id);
    applyThemeProperties(next);
    paintStyle();
  };
  const styleOptions = styleIds.map((styleId) => {
    const option = node("button", themes[styleId].label.toUpperCase());
    option.type = "button";
    option.setAttribute("aria-label", `Visual style: ${themes[styleId].label}`);
    option.onclick = () => applyStyle(themes[styleId]);
    styleRow.append(option);
    return option;
  });
  const paintStyle = () => {
    styleOptions.forEach((option, index) =>
      option.setAttribute("aria-pressed", String(styleIds[index] === theme.id)),
    );
  };
  paintStyle();
  // Instant replay (ADR 044): presentation only. A controller-only phone has no arena and records nothing.
  const replay = new ReplayDirector(),
    replayOverlay = createReplayOverlay();
  document.body.append(replayOverlay.element);
  let replayKey = "",
    reopenRecap = false;
  const powerStatus = node("div", "", "online-power-status");
  powerStatus.hidden = true;
  const notice = node("div", "", "online-notice");
  // In-arena moments (countdown, round result, overtime, final) and the elimination feed, shared by desktop, solo and the phone thirds.
  const announcer = node("div", "", "online-announce");
  announcer.hidden = true;
  const announceSmall = node("span", "", "announce-small"),
    announceBig = node("strong"),
    announceRows = node("div", "", "announce-rows"),
    announceHint = node("p", "", "announce-hint"),
    announceAction = node("button", "PLAY AGAIN", "announce-action");
  announceAction.hidden = true;
  announceBig.setAttribute("aria-live", "polite");
  announceBig.setAttribute("aria-atomic", "true");
  announcer.append(
    announceSmall,
    announceBig,
    announceRows,
    announceHint,
    announceAction,
  );
  const feed = node("div", "", "online-feed");
  feed.setAttribute("aria-live", "polite");
  const hud = node("div", "", "mobile-hud");
  const hudWho = node("span", "", "hud-who"),
    hudFire = node("span", "", "hud-fire"),
    hudWins = node("span", "", "hud-wins"),
    hudRound = node("span", "", "hud-round");
  hud.append(hudWho, hudFire, hudWins, hudRound);
  let hudAvatar: AvatarId | undefined;
  let lastAnnouncement = "";
  const touchInput =
    navigator.maxTouchPoints > 0 || matchMedia("(pointer: coarse)").matches;
  const showAnnouncement = (state: WorldView, visible: boolean) => {
    const announcement = announcementFor(state, id, touchInput);
    const key = JSON.stringify(announcement) + visible + isHost;
    if (key === lastAnnouncement) return;
    lastAnnouncement = key;
    announcer.hidden = !visible || announcement.kind === "hidden";
    announcer.className = "online-announce";
    if (announcement.kind !== "hidden")
      announcer.classList.add(announcement.kind);
    app.classList.toggle("announcing", !announcer.hidden);
    announceRows.replaceChildren();
    announceHint.textContent = "";
    announceAction.hidden = true;
    if (announcement.kind === "countdown") {
      announceSmall.textContent = `ROUND ${announcement.round}`;
      announceBig.textContent = announcement.count;
      announceHint.textContent = announcement.hint;
    } else if (announcement.kind === "overtime") {
      announceSmall.textContent = "";
      announceBig.textContent = announcement.text;
    } else if (announcement.kind === "round") {
      announceSmall.textContent = announcement.last
        ? `FINAL ROUND · ROUND ${announcement.round}`
        : `ROUND ${announcement.round}`;
      announceBig.textContent = announcement.title;
      for (const line of announcement.placements)
        announceRows.append(node("span", line));
      announceHint.textContent = announcement.next;
    } else if (announcement.kind === "final") {
      announceSmall.textContent = announcement.subtitle;
      announceBig.textContent = announcement.title;
      announceAction.hidden =
        !isHost || replacedHost || announcement.subtitle !== "MATCH COMPLETE";
    }
  };
  const feedLine = (text: string) => {
    const line = node("span", text);
    feed.prepend(line);
    while (feed.childElementCount > 4) feed.lastElementChild?.remove();
    setTimeout(() => line.remove(), 2600);
  };
  const shake = () => {
    if (screen.arenaHidden || reducedMotion()) return;
    canvas.animate(
      [
        { transform: "translate(4px,-3px)", filter: "brightness(1.7)" },
        { transform: "translate(-4px,3px)" },
        { transform: "translate(2px,1px)" },
        { transform: "none", filter: "brightness(1)" },
      ],
      { duration: 220 },
    );
  };
  const lobbyHeading = node("h1");
  lobbyHeading.append("SCAN.", node("br"), "STEER.", node("br"), "SURVIVE.");
  const joinLink = new URL(appUrl(`?room=${code}`), location.origin).href;
  // The link lives next to the QR so a rider who cannot scan can still be handed the room: one tap copies it, and the label reports back.
  const { element: qrCard } = createInviteCard({
    code,
    link: joinLink,
    showLink: !solo,
    ...(solo ? {} : { qr: (link: string) => QRCode.toDataURL(link) }),
    classes: {
      root: "room-qr-card",
      qr: "",
      caption: "",
      code: "shared-room-code",
      link: "room-qr-link",
      url: "room-qr-url",
      copy: "room-qr-copy",
    },
  });
  qrCard.hidden = solo;
  const lobbyRoster = createRoster({
    emptyText: "Your crew belongs here. Share the code to get started.",
    avatar: (avatarId) => createAvatarPortrait(avatarId as AvatarId),
    classes: {
      root: "room-riders",
      empty: "room-empty",
      row: "room-rider",
      info: "",
      name: "",
      status: "",
    },
  });
  const lobbyRiders = lobbyRoster.element;
  const lobbyCount = node("span", "Waiting for riders");
  // The watching list: the rider row's height in neutral grey, no colour, no avatar and no READY, so the five seats stay
  // the thing being read. It lives inside the rider column (the lobby grid has one cell per column) and CSS `order` keeps it last.
  const watchers = createRoster({
    title: "WATCHING",
    avatar: () => {
      const glyph = node("span", "👁", "watcher-glyph");
      glyph.setAttribute("aria-hidden", "true");
      return glyph;
    },
    classes: {
      root: "room-watchers",
      title: "room-watchers-title",
      row: "room-rider room-watcher",
      info: "",
      name: "",
      status: "",
    },
  });
  const lobbyWatchers = watchers.element;
  lobbyWatchers.hidden = true;
  lobbyWatchers.setAttribute("aria-label", "Watching");
  lobbyRiders.append(lobbyWatchers);
  const lobbyShell = createLobbyShell({
    intro: [
      node("p", "PHONE PARTY // 2–5 RIDERS", "room-eyebrow"),
      lobbyHeading,
      node(
        "p",
        "Pick your avatar. Grab your phone. Carve neon trails and blow up your friends’ plans.",
        "room-intro",
      ),
      node("p", "STEER  ◀ ▶     HOLD · AIM · RELEASE", "room-howto"),
    ],
    invite: qrCard,
    roster: lobbyRiders,
    footer: [lobbyCount],
    classes: {
      root: "shared-lobby room-lobby",
      intro: "room-lobby-copy",
      footer: "room-lobby-footer",
    },
  });
  const sharedLobby = lobbyShell.element,
    lobbyFooter = lobbyShell.footer!;
  sharedLobby.hidden = true;
  // Pointer and keyboard input bind to these buttons through ControllerPointerBindings, not the row's own handlers.
  const {
    element: controls,
    buttons: [leftButton, fireButton, rightButton],
  } = createControllerRow({
    className: "online-controls",
    buttons: [
      { label: "◀", keys: "ArrowLeft A", title: "Steer left (ArrowLeft A)" },
      {
        label: "HOLD TO FIRE",
        keys: "Space",
        title: "Hold to charge, release to fire (Space)",
      },
      { label: "▶", keys: "ArrowRight D", title: "Steer right (ArrowRight D)" },
    ],
  });
  leftButton.classList.add("pad-left");
  rightButton.classList.add("pad-right");
  fireButton.classList.add("pad-bomb");
  leftButton.setAttribute("aria-label", "Steer left");
  rightButton.setAttribute("aria-label", "Steer right");
  const fireLabel = node("span", "HOLD TO FIRE", "pad-feedback");
  fireButton.replaceChildren(fireLabel);
  let fireArtwork = "";
  const arcadeHeader = node("div", "", "arcade-header");
  const arcadeIdentity = node("strong", "YOU", "arcade-identity");
  const arcadeConnection = node("span", "Connecting…", "arcade-connection");
  arcadeHeader.append(arcadeIdentity, arcadeConnection);
  app.append(arcadeHeader);
  const controllerLayoutSetting = createControllerLayoutSetting(
    app,
    storage,
    () => clearControls(),
  );
  const roster = node("div", "", "online-roster");
  const hostControls = node("div", "", "online-host");
  let startLabel = "START RACE";
  const start = node("button", startLabel),
    reset = node("button", "BACK TO LOBBY"),
    settingsButton = node("button", "ROOM SETTINGS"),
    share = node("button", "TV VIEW"),
    addAI = node("button", "ADD AI");
  const readyButton = node("button", "READY");
  readyButton.type = "button";
  readyButton.className = "room-ready-button";
  readyButton.hidden = true;
  hostControls.append(readyButton, start, reset, settingsButton, share, addAI);
  const controllerRematch = node("section", "", "controller-rematch");
  controllerRematch.hidden = true;
  controllerRematch.setAttribute("aria-label", "Ready for another race");
  const controllerReadyCount = node("p", "", "controller-ready-count");
  controllerReadyCount.setAttribute("role", "status");
  controllerRematch.append(node("h2", "MATCH COMPLETE"), controllerReadyCount);
  app.append(controllerRematch);
  const rosterEntries = new Map<
    string,
    {
      entry: HTMLElement;
      label: HTMLElement;
      head: HTMLElement;
      avatar: AvatarId;
      remove: HTMLButtonElement;
      /** The name and points last written. */
      shown: string;
    }
  >();
  const help = node("button", "?", "desktop-help");
  help.setAttribute("aria-label", "Keyboard controls");
  help.title = "Keyboard controls";
  const avatarButton = node("button", "AVATAR");
  avatarButton.hidden = true;
  header.append(avatarButton, prefsButton, menu, help);
  const {
    dialog,
    title: dialogTitle,
    actions: dialogActions,
    close,
    body: dialogBody,
    show: showDialog,
  } = createDialog({
    title: "GAME MENU",
    label: "Game menu",
    classes: { ...FUSE_DIALOG_CLASSES, close: "dialog-close" },
  });
  // One dialog serves every menu. Which one is up is kept here, never inferred from its classes or contents:
  // the results stay "open" until the dialog closes, and the avatar picker is the node the AVATAR button mounted.
  let recapOpen = false,
    avatarPicker: HTMLElement | undefined;
  const rematch = node("button", "REMATCH");
  rematch.type = "button";
  rematch.setAttribute("aria-label", "REMATCH");
  rematch.hidden = true;
  rematch.title = "Play the same match again";
  dialogActions.prepend(rematch);
  const readySummary = node("span", "", "ready-summary");
  readySummary.setAttribute("role", "status");
  readySummary.hidden = true;
  dialogActions.prepend(readySummary);
  const fullStats = node("button", "View full stats ↗", "recap-stats-toggle");
  fullStats.type = "button";
  fullStats.hidden = true;
  fullStats.setAttribute("aria-controls", "match-full-stats");
  fullStats.onclick = () => {
    const details = dialogBody.querySelector<HTMLElement>(".recap-details");
    if (!details) return;
    details.hidden = !details.hidden;
    fullStats.setAttribute("aria-expanded", String(!details.hidden));
    fullStats.textContent = details.hidden
      ? "View full stats ↗"
      : "Hide full stats ↗";
    if (!details.hidden) details.scrollIntoView({ block: "start" });
    else dialogBody.scrollTop = 0;
  };
  const recapLobby = node("button", "Back to lobby", "recap-lobby");
  recapLobby.type = "button";
  recapLobby.hidden = true;
  recapLobby.onclick = () => {
    dialog.close();
    reset.click();
  };
  dialogActions.prepend(recapLobby);
  dialogTitle.after(fullStats);
  dialog.addEventListener("close", () => {
    rematch.hidden = true;
    fullStats.hidden = recapLobby.hidden = true;
    close.hidden = false;
    close.textContent = "✕  CLOSE";
    close.setAttribute("aria-label", "CLOSE");
    recapOpen = false;
    dialog.classList.remove("recap-dialog");
  });
  // Desktop hides the on-screen controls entirely, so a first-timer has only the ? button. One fading reminder on the first countdown of the session.
  const keyHint = node("div", "", "key-hint");
  keyHint.hidden = true;
  keyHint.setAttribute("aria-hidden", "true");
  keyHint.append(
    node("span", "◀ ▶  —  STEER"),
    node("span", "SPACE  —  HOLD TO CHARGE, RELEASE TO FIRE"),
  );
  keyHint.addEventListener("animationend", () => {
    keyHint.hidden = true;
  });
  let keyHintShown = false;
  const scoreboard = node("div", "", "online-scoreboard");
  scoreboard.append(notice, roster);
  const footer = node("footer", "", "online-footer");
  footer.append(controls, hostControls);
  // A joiner's card is already on screen and may hold focus with a half-typed name (#132): build the room around it. Detaching a focused
  // input blurs it, and keystrokes that follow land nowhere, so an early typist lost their name and JOIN sent nothing.
  // header and joinPanel are app's only children here (line 116, and nothing else attaches before this point).
  if (role === "joiner") {
    header.after(canvas, sharedLobby, scoreboard);
    joinPanel.after(footer, keyHint, announcer, feed, hud, dialog);
  } else
    app.replaceChildren(
      header,
      booting,
      canvas,
      sharedLobby,
      scoreboard,
      joinPanel,
      footer,
      keyHint,
      announcer,
      feed,
      hud,
      dialog,
    );
  app.append(powerStatus);
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  help.onclick = () =>
    showDialog({
      title: "SHORTCUTS",
      label: "Keyboard shortcuts",
      content: [
        node("h2", "Keyboard shortcuts"),
        ...createKeyList(
          keyboardShortcuts({ mac, canConfigure: isHost || solo, solo }),
          { classes: { group: "shortcut-group", list: "shortcut-list" } },
        ),
      ],
    });
  // Move the existing actions, keeping their handlers and mobile/lobby destinations intact.
  const desktopQuery = matchMedia(
    "(min-width: 1000px) and (hover: hover) and (pointer: fine)",
  );
  // Where the movable parts of the page sit on this screen. Pure placement: what the screen is was decided by `roomScreen`.
  const placeElements = (screen: RoomScreen) => {
    // Keep the creator's seat invitation beside the riders while the lobby is
    // visible. Outside the lobby it must remain reachable for mid-game joins.
    if (role !== "joiner") {
      const joinParent = screen.lobbyCard ? lobbyRiders : app;
      if (joinPanel.parentElement !== joinParent) {
        if (joinParent === app) {
          joinForm.element.querySelector("input")!.after(joinForm.submitButton);
          scoreboard.after(joinPanel);
        } else {
          joinForm.element.append(joinForm.submitButton);
          lobbyRiders.prepend(joinPanel);
        }
        // Both ways in stay together wherever the seat invitation lands.
        joinForm.submitButton.after(joinForm.spectateButton);
      }
    }
    const { desktop, sideStandings: side } = screen;
    // Keep the same account control visible beside MENU during full-screen phone play.
    const accountParent = screen.mobile.active ? app : topMenu;
    if (roomAccount.button.parentElement !== accountParent)
      accountParent.append(roomAccount.button);
    // Desktop play keeps the standings in a fixed column right of the arena (its width lives in online.css), so the game bar holds actions only.
    const rosterParent = side ? app : desktop ? header : scoreboard;
    if (roster.parentElement !== rosterParent) {
      if (side) app.append(roster);
      else if (desktop) header.insertBefore(roster, topMenu);
      else scoreboard.append(roster);
    }
    const actionsParent = screen.lobbyCard
      ? lobbyFooter
      : desktop
        ? header
        : footer;
    if (hostControls.parentElement !== actionsParent) {
      if (desktop) header.insertBefore(hostControls, topMenu);
      else actionsParent.append(hostControls);
    }
    const noticeParent = desktop ? header : scoreboard;
    if (notice.parentElement !== noticeParent) noticeParent.append(notice);
  };
  // The standings column starts under the game bar, whose height changes as its buttons wrap or hide; measured on change, never per snapshot.
  new ResizeObserver(() =>
    app.style.setProperty(
      "--standings-top",
      `${header.offsetTop + header.offsetHeight}px`,
    ),
  ).observe(header);
  const device = (): RoomDevice => ({
    touch:
      navigator.maxTouchPoints > 0 || matchMedia("(pointer: coarse)").matches,
    width: innerWidth,
    height: innerHeight,
    desktopPointer: desktopQuery.matches,
  });
  const screenInput = (): RoomScreenInput => ({
    role,
    booted,
    joined,
    watching,
    phase: snapshot?.phase ?? "lobby",
    recapReady: recapIsReady,
    shared: settings.mode === "shared",
    device: device(),
  });
  // Every class the room screen implies is set here, from the derived screen, and nothing reads one back.
  let screen: RoomScreen = roomScreen(screenInput());
  const showScreen = (next: RoomScreen, resized = false) => {
    screen = next;
    for (const [name, on] of Object.entries(screenClasses(next)))
      app.classList.toggle(name, on);
    app.dataset.screen = next.kind;
    canvas.hidden = next.arenaHidden;
    sharedLobby.hidden = !next.lobbyCard;
    roster.hidden = next.lobbyCard;
    // VISUAL STYLE only changes the arena, which a shared-TV controller never draws, lobby included.
    styleHeading.hidden = styleRow.hidden = next.arenaController;
    controllerLayoutSetting.hidden = !next.arenaController;
    mobileLayout.update(
      next.mobile,
      snapshot?.phase ?? "lobby",
      next.kind !== "ended" && recapIsReady,
      resized,
      next.controllerOnly,
    );
    const controllerResults = next.controllerOnly && next.kind === "recap";
    controllerRematch.hidden = !controllerResults;
    if (controllerResults) {
      if (readyButton.parentElement !== controllerRematch)
        controllerRematch.append(readyButton);
    } else if (readyButton.parentElement !== hostControls)
      hostControls.prepend(readyButton);
    placeElements(next);
  };
  // A rotation or a resize changes the screen now, not at the next frame; after the room closed only the desktop bar follows it.
  const resizeScreen = () =>
    showScreen(
      roomEnded ? endedScreen(screen, device()) : roomScreen(screenInput()),
      true,
    );
  window.addEventListener("resize", resizeScreen);
  window.visualViewport?.addEventListener("resize", resizeScreen);
  desktopQuery.addEventListener("change", resizeScreen);

  const openRadio = () => {
    audio.unlock();
    audio.controls.setAttribute("open", "");
    showDialog({
      title: "RADIO",
      label: "Radio",
      content: [node("h2", "Fuse Riders Radio"), audio.controls],
    });
  };
  const roomAccount = createPlayerAccountPanel();
  roomAccount.button.classList.add("player-account");
  app.append(roomAccount.dialog);
  const topMenu = node("nav", "", "game-top-menu");
  topMenu.setAttribute("aria-label", "Player menu");
  const topRadio = node("button", "♫ RADIO"),
    topMusic = node("button"),
    topMute = node("button");
  topRadio.type = topMusic.type = topMute.type = "button";
  topRadio.onclick = () => openRadio();
  topMenu.append(
    topRadio,
    topMusic,
    topMute,
    prefsButton,
    roomAccount.leaderboardButton,
    roomAccount.button,
  );
  header.append(topMenu);
  topMenu.append(results, avatarButton, menu, help);
  for (const extra of [
    topRadio,
    topMusic,
    topMute,
    roomAccount.leaderboardButton,
    results,
  ])
    extra.classList.add("controller-menu-extra");
  const refreshAccount = () => {
    if (!document.hidden) roomAccount.refresh();
  };
  window.addEventListener("focus", refreshAccount);
  document.addEventListener("visibilitychange", refreshAccount);
  window.addEventListener(
    "pagehide",
    () => {
      roomAccount.dispose();
      window.removeEventListener("focus", refreshAccount);
      document.removeEventListener("visibilitychange", refreshAccount);
    },
    { once: true },
  );
  const audio = sharedAudio();
  audio.bindMusicToggle(topMusic);
  audio.bindMuteToggle(topMute);
  radioToggle = () => {
    if (!dialog.open) openRadio();
    else if (dialogBody.contains(audio.controls))
      dialog.close(); /* Another open dialog (results, a settings draft) is left alone. */
  };
  // Device preferences: music, effects, radio, visual style and fullscreen are this device's own and change nothing shared, so
  // they sit behind one SETTINGS button instead of five in the header. Built once; the dialog body adopts the same nodes each open.
  const prefs = node("div", "", "settings-list");
  const musicButton = node("button"),
    effectsButton = node("button"),
    muteButton = node("button"),
    radioButton = node("button", "♫ RADIO"),
    fullscreen = node("button", "FULLSCREEN");
  audio.bindMusicToggle(musicButton);
  audio.bindEffectsToggle(effectsButton);
  audio.bindMuteToggle(muteButton);
  radioButton.onclick = openRadio; // The same ♫ MUSIC ON / OFF toggle as the landing page.
  // iPhone Safari has no element fullscreen (#142): a button that can do nothing is not shown.
  fullscreen.hidden = !document.fullscreenEnabled;
  fullscreen.onclick = () =>
    void (
      document.fullscreenElement
        ? document.exitFullscreen()
        : document.documentElement.requestFullscreen()
    )?.catch(() => {});
  document.addEventListener("fullscreenchange", () => {
    fullscreen.textContent = document.fullscreenElement
      ? "EXIT FULLSCREEN"
      : "FULLSCREEN";
  });
  const privacy = createAnalyticsSetting();
  prefs.append(
    musicButton,
    effectsButton,
    muteButton,
    radioButton,
    styleHeading,
    styleRow,
    fullscreen,
    privacy.element,
    controllerLayoutSetting,
  );
  const voice = solo ? undefined : new VoiceChat();
  if (voice) {
    prefs.prepend(node("h3", "GAME AUDIO", "settings-group"));
    muteButton.title =
      "Music and effects only; use DEAFEN in voice chat to silence voice.";
    prefs.append(voice.controls);
    topMenu.insertBefore(voice.button, prefsButton);
    voice.button.onclick = () =>
      showDialog({
        title: "VOICE CHAT",
        label: "Voice chat",
        content: [voice.controls],
      });
    voice.setChanged(() => {
      for (const [playerId, row] of rosterEntries)
        row.entry.dataset.voice = voice.indicator(playerId);
      for (const [playerId, entry] of lobbyRoster.entries())
        entry.dataset.voice = voice.indicator(playerId);
    });
  }
  prefsButton.onclick = () => {
    privacy.render();
    if (voice) prefs.append(voice.controls);
    showDialog({ title: "SETTINGS", label: "Settings", content: [prefs] });
  };
  const openRecap = () => {
    if (!snapshot) return;
    const recap = renderMatchRecap(snapshot.matchStats, snapshot.moments, {
      playerId: id,
      canWatch: (key) => !screen.arenaHidden && !!replay.recorder.clip(key),
      watch: (key) => {
        const clip = replay.recorder.clip(key);
        if (!clip) return;
        audio.unlock();
        reopenRecap = true;
        dialog.close();
        replay.play(clip, performance.now());
      },
    });
    recapOpen = true;
    dialog.classList.add("recap-dialog");
    rematch.hidden = solo ? !isHost : !joined || displayOnly;
    recapLobby.hidden = !isHost;
    close.textContent = "✕";
    fullStats.hidden = !snapshot.matchStats.length;
    fullStats.textContent = "View full stats ↗";
    fullStats.setAttribute("aria-expanded", "false");
    // Opened last, once the buttons it shows are settled: the modal focuses the first one that is visible.
    showDialog({
      title: "MATCH RESULTS",
      label: "Match results",
      content: [recap],
    });
    dialogBody.scrollTop = 0;
  };
  results.onclick = () => {
    track("Recap Reopened");
    openRecap();
  };
  const callbacks: Callbacks = {
    // A host key the server rejects is a stale guest identity from an older build or a reused code: keep the identity under the peer key and re-enter as a joiner.
    ready: (peerId, host) => {
      if (role === "host" && !host) {
        save(`fuse-peer-${code}`, token);
        forgetHostToken();
        location.reload();
        return;
      }
      id = peerId;
      isHost = host;
      joinForm.ready();
      hostControls.hidden = !host;
      telemetry.identify({
        room: code,
        id: peerId,
        role: host ? "creator" : displayOnly ? "display" : "guest",
        ua: navigator.userAgent.slice(0, 80),
      });
    },
    // The change guard compares raw wordings, not the displayed one: three flattened states would log a "change" for every distinct runtime message and hide the one that actually changed.
    status: (text) => {
      if (rawStatus !== text) telemetry.log("status", { text });
      rawStatus = text;
      const view = presentStatus(text);
      status.textContent = view.text;
      status.title = view.raw;
      status.dataset.raw = view.raw;
      status.dataset.tone = view.tone;
      arcadeConnection.textContent = view.text;
      arcadeConnection.dataset.tone = view.tone;
      arcadeConnection.title = view.raw;
      // A replaced host tab cannot act on the room any more: its actions go away and one button reclaims hosting (a reload re-authenticates with the stored token).
      statusAction.hidden = !view.action;
      statusAction.textContent = view.action ?? "RETRY";
      if (view.replaced) {
        replacedHost = true;
        hostControls.hidden = true;
        announceAction.hidden = true;
      }
      if (!booted) bootTick();
      if (roomEnded) {
        notice.textContent = text;
        overNote.textContent = text;
      }
    },
    // An ended room is no longer joined play (#44): the thirds controller gives way to the ordinary header so the status
    // reads without opening ☰ MENU. `controller-only` is only ever recomputed from a state update, and none arrives after the end.
    ended: () => {
      powerStatus.hidden = true;
      bootDone();
      roomEnded = true;
      replay.cancel();
      replayOverlay.stop(canvas);
      app.classList.remove("replaying");
      replayKey = "";
      reopenRecap = false;
      if (role === "host") forgetHostToken();
      if (read(LAST_ROOM_KEY) === code) storage.removeItem(LAST_ROOM_KEY);
      announcer.hidden = true;
      hud.hidden = true;
      app.classList.remove("announcing");
      clearControls();
      controls.hidden = true;
      joinPanel.hidden = true;
      hostControls.hidden = true;
      if (canvas.isConnected) canvas.after(overCard);
      else app.append(overCard);
      showScreen(endedScreen(screen));
    },
    event: (event, matchId, round, tick) => {
      audio.director.message({ type: "event", matchId, round, tick, event });
      sample({
        kind: "event",
        at: performance.now(),
        event,
        matchId,
        round,
        tick,
      });
      telemetry.log("event", { type: event.type, matchId, round, tick });
      if (event.type === "moment") replay.moment(event.moment, matchId, round);
      if (roomEnded) return;
      if (event.type === "explosion") shake();
      const line = eliminationLine(
        event,
        snapshot?.players ?? [],
        id,
        snapshot?.map,
      );
      if (line) {
        feedLine(line);
        if (event.type === "playerEliminated" && event.playerId === id) {
          shake();
          if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(180);
        }
      }
    },
    state: (state, rules) => {
      if (roomEnded) return;
      bootDone();
      if (snapshot && snapshot.phase !== state.phase) clearControls();
      funnel.onFrame(state, {
        playerId: id,
        host: isHost,
        confirmedTick: runtime.confirmedTick(),
        rules,
      });
      const roundReport =
        solo && !remembersSignIn()
          ? undefined
          : buildRoundReport(state.decidedRound, id, runtime.confirmedTick());
      const ratingKey = roundReport
        ? JSON.stringify([
            roundReport.result.matchId,
            roundReport.result.round,
            id,
          ])
        : "";
      if (roundReport && ratingKey !== lastRatedRound) {
        lastRatedRound = ratingKey;
        void sendMatchReport(
          apiUrl(
            solo ? "/api/me/round-results" : `/api/rooms/${code}/round-results`,
          ),
          roundReport,
          {
            fetch: (input, init) => fetch(input, init),
            roomToken: token,
            identityToken: signedInToken,
          },
        ).then(() => roomAccount.refresh());
      }
      const matchId = state.matchId;
      snapshot = state;
      readyPlayers = state.readyPlayers;
      renderScope = `${matchId}:${state.round}`;
      if (
        pendingSettings &&
        (JSON.stringify(rules) !== pendingSettings.before ||
          performance.now() - pendingSettings.at > 1000)
      )
        pendingSettings = undefined;
      settings = pendingSettings?.draft ?? rules;
      sample({
        kind: "snapshot",
        at: performance.now(),
        authorityScope: renderScope,
        matchId,
        round: state.round,
        tick: state.tick,
        phase: state.phase,
        phaseEndsAtTick: state.phaseEndsAtTick,
        playerId: id,
        heldMotion: runtime.heldControls(id),
        players: state.players.map((p) => ({
          id: p.id,
          alive: p.alive,
          x: p.x,
          y: p.y,
          angle: p.angle,
          bombReadyAtTick: p.bombReadyAtTick,
          bombChargeStartedTick: p.bombChargeStartedTick,
        })),
        leaderboard: state.leaderboard,
        metrics: runtime.metrics(),
      });
      audio.director.message({
        type: "snapshot",
        matchId,
        round: state.round,
        tick: state.tick,
        state,
      });
      const player = state.players.find((player) => player.id === id);
      // The final-round pause keeps the arena visible until phaseEndsAtTick; the report opens once per match afterwards and stays reopenable.
      recapIsReady = recapReady(state);
      results.hidden = !recapIsReady;
      // Every device dismisses the report when the shared state moves on, including peers that did not click REMATCH.
      if (!recapIsReady && dialog.open && recapOpen) dialog.close();
      if (state.phase === "lobby") lastRecap = "";
      joined = Boolean(player);
      // A watcher is in the room, not queuing at its door: it gets the arena and the lists, never the join card or the controls.
      const watcher = state.spectators.find((seat) => seat.id === id);
      watching = Boolean(watcher);
      // The screen, once per frame: every class and every arena/lobby visibility below follows from it.
      showScreen(roomScreen(screenInput()));
      const view = presentRoom({
        state,
        spectators: state.spectators,
        readyPlayers,
        playerId: id,
        host: isHost,
        replacedHost,
        solo,
        displayOnly,
        lobbyCard: screen.lobbyCard,
        joining: screen.joining,
        phoneLobby: screen.mobile.lobby,
        mobileActive: screen.mobile.active,
        bombHeld: inputState.isHeld("bomb"),
      });
      joinPanel.hidden = view.joinPanelHidden;
      /* Avatars are a lobby choice: before a seat the join form carries it, the button leaves with the lobby, and a picker left open closes when the round starts. */ avatarButton.hidden =
        view.avatarHidden;
      if (
        avatarButton.hidden &&
        dialog.open &&
        avatarPicker &&
        dialogBody.contains(avatarPicker)
      )
        dialog.close();
      controls.hidden = view.controlsHidden;
      // A rider the room still lists as offline (page reload mid-round) reconnects by itself; anyone absent goes through the join card.
      // A watcher the room still lists does the same, asking for its place in the watching list back rather than for a seat.
      if (player && !player.connected && !displayOnly) {
        if (!rejoinPending) {
          rejoinPending = true;
          runtime.command({
            type: "join",
            name: player.name,
            avatarId: player.avatarId,
          });
        }
      } else if (watcher && !watcher.connected && !displayOnly) {
        if (!rejoinPending) {
          rejoinPending = true;
          runtime.command({ type: "spectate", name: watcher.name });
        }
      } else rejoinPending = false;
      lobbyCount.textContent = view.lobby.count;
      lobbyRoster.update(
        view.lobby.riders.map((p) => ({
          id: p.id,
          name: p.name,
          status: p.status,
          color: p.color,
          avatar: p.avatarId,
        })),
      );
      lobbyWatchers.hidden = view.lobby.watchersHidden;
      watchers.update(
        view.lobby.watchers.map((seat) => ({
          id: seat.id,
          name: seat.name,
          status: seat.status,
          avatar: "watcher",
        })),
      );
      if (!screen.arenaHidden)
        replay.observe(state, state.matchId, performance.now());
      if (
        state.phase === "countdown" &&
        joined &&
        !keyHintShown &&
        screen.desktop
      ) {
        keyHintShown = true;
        keyHint.hidden = false;
      }
      // Opened after the layout above so the close button can say where it lands.
      if (recapIsReady && lastRecap !== String(state.phaseEndsAtTick)) {
        lastRecap = String(state.phaseEndsAtTick);
        if (!screen.controllerOnly) openRecap();
        // Every rider's device reports the result it computed; the room service keeps one that a majority agree on
        // (README, "Login and match history"). Only state the match froze goes in: devices open the recap at different moments.
        const report = solo
          ? undefined
          : buildMatchReport(
              {
                matchId,
                matchLength: state.matchLength,
                ...(state.matchWinnerId === undefined
                  ? {}
                  : { matchWinnerId: state.matchWinnerId }),
                matchStats: state.matchStats,
                matchFinishers: state.matchFinishers,
                players: state.players,
              },
              id,
            );
        if (report)
          void sendMatchReport(apiUrl(`/api/rooms/${code}/results`), report, {
            fetch: (input, init) => fetch(input, init),
            roomToken: token,
            identityToken: signedInToken,
          });
      }
      powerStatus.hidden = view.power.hidden;
      powerStatus.textContent = view.power.text;
      fireButton.classList.toggle("gun-armed", view.fire.gunReady);
      hudFire.classList.toggle("gun-armed", view.fire.gunReady);
      fireButton.title = view.fire.title;
      const weapon = view.fire.weapon;
      const artwork = legendSrc(
        theme.id,
        weapon === "bomb" ? "bomb" : `pickup-${weapon}`,
      );
      if (artwork !== fireArtwork) {
        fireArtwork = artwork;
        fireButton.style.setProperty("--bomb-art", `url("${artwork}")`);
        fireButton.dataset.weapon = weapon.toUpperCase();
      }
      fireButton.setAttribute(
        "aria-label",
        `${fireButton.dataset.weapon}: ${view.fire.label ?? "Hold to fire"}`,
      );
      if (view.playerColor)
        app.style.setProperty("--player-color", view.playerColor);
      if (view.fire.label !== undefined)
        fireLabel.textContent = view.fire.label;
      notice.textContent = view.notice;
      for (const [playerId, row] of rosterEntries)
        if (!state.players.some((p) => p.id === playerId)) {
          row.entry.remove();
          rosterEntries.delete(playerId);
        }
      // Standings: cards are ordered with CSS `order`, so the DOM and its handlers stay put.
      for (const p of view.standings) {
        let row = rosterEntries.get(p.id);
        if (!row) {
          const entry = node("span", "", "online-score-card"),
            label = node("span"),
            head = createAvatarPortrait(p.avatarId),
            remove = node("button", "×");
          entry.append(head, label, remove);
          remove.onclick = () =>
            runtime.command({ type: "bot", action: "remove", id: p.id });
          row = { entry, label, head, avatar: p.avatarId, remove, shown: "" };
          rosterEntries.set(p.id, row);
          roster.append(entry);
        }
        if (row.shown !== `${p.name}${p.points}`) {
          row.shown = `${p.name}${p.points}`;
          row.label.className = "online-score-label";
          row.label.replaceChildren(
            node("span", p.name, "online-score-name"),
            node("span", p.points, "online-score-points"),
          );
        }
        row.label.title = p.title;
        row.label.setAttribute("aria-label", row.label.title);
        row.entry.style.color = p.color;
        row.entry.style.setProperty("--rider-color", p.color);
        row.entry.classList.toggle("out", p.out);
        row.entry.style.order = String(p.rank);
        row.entry.dataset.rank = String(p.rank);
        row.entry.classList.toggle("leader", p.leader);
        row.entry.style.setProperty("--lead", p.lead);
        if (row.avatar !== p.avatarId) {
          const head = createAvatarPortrait(p.avatarId);
          row.head.replaceWith(head);
          row.head = head;
          row.avatar = p.avatarId;
        }
        const removeParent = screen.lobbyCard
          ? lobbyRoster.row(p.id)!
          : row.entry;
        if (row.remove.parentElement !== removeParent)
          removeParent.append(row.remove);
        row.remove.hidden = p.remove.hidden;
        row.remove.disabled = p.remove.disabled;
        row.remove.setAttribute("aria-label", p.remove.label);
        row.remove.title = p.remove.title;
      }
      addAI.disabled = view.actions.addAIDisabled;
      if (startLabel !== view.actions.start.label)
        start.textContent = startLabel = view.actions.start.label;
      start.disabled = view.actions.start.disabled;
      const waitingRiders = state.players.filter(
        (p) => p.connected && !p.id.startsWith("bot:"),
      );
      readySummary.hidden = solo || !recapOpen || !recapIsReady;
      readySummary.textContent = `${waitingRiders.filter((p) => readyPlayers.includes(p.id)).length}/${waitingRiders.length} ready`;
      if (controllerReadyCount.textContent !== readySummary.textContent)
        controllerReadyCount.textContent = readySummary.textContent;
      start.hidden = !solo;
      readyButton.hidden = view.actions.ready.hidden;
      readyButton.textContent = view.actions.ready.label;
      readyButton.setAttribute(
        "aria-pressed",
        String(view.actions.ready.pressed),
      );
      rematch.textContent = solo ? "REMATCH" : view.actions.ready.label;
      rematch.setAttribute("aria-label", rematch.textContent);
      rematch.setAttribute("aria-pressed", String(view.actions.ready.pressed));
      rematch.hidden =
        !recapOpen || (solo ? !isHost : view.actions.ready.hidden);
      settingsButton.hidden = !isHost || replacedHost;
      addAI.hidden = !isHost || replacedHost;
      hostControls.hidden = view.actions.hidden;
      reset.disabled = view.actions.reset.disabled;
      reset.hidden = !isHost || replacedHost || view.actions.reset.hidden;
      share.hidden = !isHost || replacedHost || view.actions.shareHidden;
      voice?.setRoster(id, state.players);
      for (const [playerId, row] of rosterEntries)
        if (voice) row.entry.dataset.voice = voice.indicator(playerId);
      for (const [playerId, entry] of lobbyRoster.entries())
        if (voice) entry.dataset.voice = voice.indicator(playerId);
      roundChip.textContent = view.roundClock;
      roundChip.hidden = view.roundChipHidden;
      showAnnouncement(state, view.announcerVisible && !screen.controllerOnly);
      if (!solo) {
        announceAction.hidden =
          view.actions.ready.hidden || state.phase !== "matchOver";
        announceAction.textContent = view.actions.ready.label;
      }
      // Phone HUD: who you are, what the fire button would do, match points and the clock. The thirds themselves stay transparent.
      hud.hidden = view.hudHidden;
      if (player) arcadeIdentity.textContent = player.name;
      if (player && view.hud) {
        if (hudAvatar !== player.avatarId) {
          hudWho.replaceChildren(
            createAvatarPortrait(player.avatarId),
            node("b", "YOU"),
          );
          hudAvatar = player.avatarId;
        }
        hudFire.textContent = view.hud.fire;
        hudWins.textContent = view.hud.wins;
        hudRound.textContent = view.hud.clock;
      }
    },
  };
  // Solo is the same runtime with no transport: one rider and four AI riders fold the log locally.
  const runtime = new RoomRuntime(
    code,
    settings,
    callbacks,
    solo
      ? { humanName: read("fuse-riders-player-name") ?? undefined }
      : {
          transport: (events) =>
            new PeerTransport(code, token, events, {
              extension: voice,
              apiUrl,
              gameId: GAME_ID,
              maxFastBytes: MAX_PACKET_BYTES,
              copy: TRANSPORT_COPY,
            }),
          displayOnly,
        },
  );
  readyButton.onclick = () => {
    void audio.unlock();
    runtime.command({ type: "ready", ready: !readyPlayers.includes(id) });
  };
  start.onclick = () => {
    void audio.unlock();
    runtime.command({
      type: "action",
      action: snapshot?.phase === "matchOver" ? "rematch" : "start",
    });
  };
  announceAction.onclick = () => (solo ? start.click() : readyButton.click());
  addAI.onclick = () => runtime.command({ type: "bot", action: "add" });
  // Link quality for the player: hidden unless asked for (?stats=1 or the menu), so a bad Wi-Fi is a fact, not a guess.
  const statsPanel = node("pre", "", "net-stats");
  statsPanel.hidden = solo || !url.searchParams.has("stats");
  app.append(statsPanel);
  reset.onclick = () => runtime.command({ type: "action", action: "lobby" });
  rematch.onclick = () => {
    if (solo) start.click();
    else readyButton.click();
  };
  menu.onclick = () => {
    const {
      question,
      choices,
      confirm: leave,
      cancel: stay,
    } = createConfirm({
      question: solo
        ? "End this solo run and go back to the menu?"
        : isHost
          ? "End this room for everyone?"
          : "Leave this room?",
      confirmText: solo ? "END RUN" : isHost ? "END ROOM" : "LEAVE ROOM",
      cancelText: solo ? "KEEP PLAYING" : "STAY",
      onCancel: () => dialog.close(),
      onConfirm: () => endOrLeave(),
      classes: {
        question: "",
        choices: "exit-choices",
        confirm: "exit-confirm",
        cancel: "",
      },
    });
    const menuBody: Node[] = [question, choices];
    const endOrLeave = async () => {
      leave.disabled = stay.disabled = true;
      leave.textContent = "LEAVING…";
      runtime.stop();
      if (isHost && !solo) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2500);
        try {
          await endRoom(apiUrl, code, token, {
            signal: controller.signal,
            keepalive: true,
          });
        } catch {
          /* Host heartbeat expiry also closes the room if the network is unavailable. */
        } finally {
          clearTimeout(timer);
        }
        forgetHostToken();
      }
      if (read(LAST_ROOM_KEY) === code) storage.removeItem(LAST_ROOM_KEY);
      location.href = appUrl();
    };
    const standings = [...(snapshot?.leaderboard ?? [])].sort(
      (a, b) =>
        b.totalScoreUnits - a.totalScoreUnits ||
        b.matchWins - a.matchWins ||
        a.name.localeCompare(b.name),
    );
    if (standings.length) {
      const list = node("div", "", "session-board");
      list.append(node("h2", "Session standings"));
      let rank = 0,
        previous: number | undefined;
      standings.forEach((entry, index) => {
        if (entry.totalScoreUnits !== previous) rank = index + 1;
        previous = entry.totalScoreUnits;
        const row = node("div", "", "session-row");
        if (entry.id === id) row.classList.add("is-you");
        const points = entry.totalScoreUnits / 60;
        row.append(
          node("b", `#${rank}`),
          node("span", entry.id === id ? `${entry.name} (you)` : entry.name),
          node(
            "strong",
            `${Number.isInteger(points) ? points : points.toFixed(1)} PTS`,
          ),
          node(
            "small",
            `${entry.matchWins} ${entry.matchWins === 1 ? "MATCH" : "MATCHES"} · ${entry.roundWins} ${entry.roundWins === 1 ? "ROUND" : "ROUNDS"}`,
          ),
        );
        list.append(row);
      });
      list.append(
        node(
          "p",
          "Round points: +1 per opponent outlasted, +1 for the sole survivor. Same-tick deaths tie.",
          "session-key",
        ),
      );
      menuBody.push(list);
    }
    if (!solo) {
      const diagnostics = node("pre", "", "link-diagnostics");
      diagnostics.textContent =
        app.dataset.linkDiagnostics ?? "collecting link diagnostics…";
      const statsToggle = node(
        "button",
        statsPanel.hidden ? "SHOW NETWORK STATS" : "HIDE NETWORK STATS",
      );
      statsToggle.onclick = () => {
        statsPanel.hidden = !statsPanel.hidden;
        dialog.close();
      };
      menuBody.push(
        statsToggle,
        node(
          "p",
          "LINK DIAGNOSTICS (redacted: candidate types and states, no addresses)",
        ),
        diagnostics,
      );
      const refresh = setInterval(() => {
        if (!dialog.open) {
          clearInterval(refresh);
          return;
        }
        diagnostics.textContent =
          app.dataset.linkDiagnostics ?? diagnostics.textContent;
      }, 1000);
    }
    showDialog({
      title: solo ? "EXIT" : "ROOM",
      label: solo ? "Exit" : "Room",
      content: menuBody,
    });
  };
  avatarButton.onclick = () => {
    const picker = createAvatarPicker(storage, (chosen) => {
      joinForm.picker.sync(chosen);
      if (joined) runtime.command({ type: "avatar", avatarId: chosen });
      dialog.close();
    });
    // Avatars other riders already wear are marked, not blocked: two foxes are allowed, but nobody picks one by accident.
    picker.element
      .querySelectorAll<HTMLButtonElement>(".avatar-option")
      .forEach((option) => {
        const owner = snapshot?.players.find(
          (p) => p.id !== id && p.avatarId === option.dataset.avatarId,
        );
        option.classList.toggle("taken", Boolean(owner));
        option.title = owner ? `${owner.name} has this one` : "";
      });
    avatarPicker = picker.element;
    showDialog({
      title: "AVATAR",
      label: "Avatar",
      content: [node("h2", "Your avatar"), picker.element],
    });
  };
  // The lobby card already carries the QR and the copyable link, so this opens the shared-screen display directly instead of a dialog that repeats them.
  share.title = "Open this room on a shared screen";
  share.onclick = () => {
    window.open(appUrl(`?room=${code}&display=1`), "_blank", "noopener");
  };
  const openSettings = (start: "main" | "powerups" = "main") => {
    showRoomSettings(
      dialogBody,
      settings,
      solo,
      labels,
      (draft) => {
        if (!runtime.command({ type: "settings", settings: draft }))
          return false;
        pendingSettings = {
          draft,
          before: JSON.stringify(settings),
          at: performance.now(),
        };
        settings = draft;
        save(SETTINGS_KEY, JSON.stringify(draft));
        track("Settings Changed", {
          mode: draft.mode,
          match: draft.match,
          matchLength: draft.length,
          bombChargeTicks: draft.bombChargeTicks,
          chainReaction: draft.chainReaction,
          aimBounce: draft.aimBounce,
          map: draft.map,
          powerupTypes: Object.values(draft.weights).filter(
            (weight) => weight > 0,
          ).length,
        });
        return true;
      },
      () => dialog.close(),
      start,
    );
    if (!dialog.open) dialog.showModal();
  };
  settingsButton.onclick = () => openSettings();
  // Ctrl+P (⌘P on a Mac) goes to the power-ups page instead of the browser's print dialog (#168). The key is only taken when it will act:
  // a joiner, a display or an ended room keeps the browser's print dialog, and an open dialog keeps its own chrome.
  window.addEventListener("keydown", (event) => {
    if (
      event.code !== "KeyP" ||
      event.repeat ||
      event.altKey ||
      event.shiftKey ||
      (mac ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey)
    )
      return;
    if (
      document.activeElement?.closest(
        'input,textarea,select,[contenteditable]:not([contenteditable="false"])',
      )
    )
      return;
    if (
      dialog.open ||
      roomAccount.dialog.open ||
      roomEnded ||
      !(isHost || solo)
    )
      return;
    event.preventDefault();
    openSettings("powerups");
  });
  const inputState = new ControllerInputState({
    send: (message) => {
      if (roomEnded) return false;
      const controlsKey = `${message.left}:${message.right}:${message.bomb}`,
        changed = controlsKey !== lastControls;
      if (changed) {
        inputAt = performance.now();
        benchmarkInput = { seq: message.seq, at: inputAt };
        lastControls = controlsKey;
      }
      const sent = runtime.command(message);
      if (benchmark)
        sample({
          kind: "input",
          at: performance.now(),
          seq: message.seq,
          left: message.left,
          right: message.right,
          bomb: message.bomb,
          bombAction: message.bombAction,
          sent,
          tick: runtime.tick,
        });
      if (changed || message.bombAction)
        telemetry.log("input", {
          seq: message.seq,
          left: message.left,
          right: message.right,
          bomb: message.bomb,
          bombAction: message.bombAction,
          sent,
          tick: runtime.tick,
        });
      return sent;
    },
  });
  const bindings = new ControllerPointerBindings(
    inputState,
    [
      [leftButton, "left"],
      [fireButton, "bomb"],
      [rightButton, "right"],
    ],
    window,
    () => {},
    (x, y) => {
      const target = document.elementFromPoint(x, y);
      return [leftButton, fireButton, rightButton].find(
        (button) =>
          target === button || Boolean(target && button.contains(target)),
      );
    },
  );
  const keyboard = new ControllerKeyboardBindings(
    inputState,
    () =>
      joined &&
      !roomEnded &&
      !mobileLayout.blocked() &&
      !dialog.open &&
      !roomAccount.dialog.open &&
      !document.hidden &&
      !leftButton.disabled &&
      !Boolean(
        document.activeElement?.closest(
          'input,textarea,select,[contenteditable]:not([contenteditable="false"])',
        ),
      ),
    () => {
      for (const [button, control] of [
        [leftButton, "left"],
        [fireButton, "bomb"],
        [rightButton, "right"],
      ] as const)
        button.classList.toggle("active", inputState.isHeld(control));
    },
  );
  window.addEventListener("keydown", (event) => keyboard.down(event));
  window.addEventListener("keyup", (event) => keyboard.up(event));
  const clearControls = () => {
    keyboard.clear();
    bindings.clear(true, true);
  };
  const mobileLayout = installMobilePlayLayout(app, clearControls, [dialog]);
  showScreen(screen); // A phone booting a room is already on the lobby screen (#134): the header takes its lobby shape before the first snapshot.
  window.addEventListener("blur", clearControls);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clearControls();
  });
  dialog.addEventListener("focusin", clearControls);
  roomAccount.dialog.addEventListener("focusin", clearControls);
  document.addEventListener("focusin", () => {
    if (
      document.activeElement?.closest(
        'input,textarea,select,[contenteditable]:not([contenteditable="false"])',
      )
    )
      keyboard.clear();
  });
  const dialogsObserver = new MutationObserver(() => {
    if (dialog.open || roomAccount.dialog.open) clearControls();
  });
  for (const modal of [dialog, roomAccount.dialog])
    dialogsObserver.observe(modal, {
      attributes: true,
      attributeFilter: ["open"],
    });
  window.addEventListener("pagehide", clearControls);
  setInterval(() => {
    if (joined && !roomEnded) inputState.resend();
    audio.director.update();
  }, 50);
  runtime.start();
  // Every device simulates and links to every other, so every device has its own link quality to show.
  const netStats = new NetStats(() => performance.now());
  if (!solo)
    setInterval(() => {
      netStats.record(runtime.metrics());
      if (statsPanel.hidden) return;
      let path = "none";
      try {
        const m = JSON.parse(app.dataset.metrics ?? "{}");
        path = m.direct ? "direct" : m.relayed ? "relay" : "none";
      } catch {
        // Display only: unreadable metrics show as path "none".
      }
      statsPanel.textContent = formatNetStats(netStats.summary(), path);
    }, 500);
  setInterval(() => {
    void (
      runtime.transport?.stats() ??
      Promise.resolve({ direct: 0, relayed: 0, buffered: 0 })
    )
      .then((connection) => {
        const percentile = (values: number[], p: number) =>
          [...values].sort((a, b) => a - b)[
            Math.min(values.length - 1, Math.floor(values.length * p))
          ] ?? 0;
        const metrics = runtime.metrics();
        telemetry.log("metrics", { ...metrics });
        app.dataset.metrics = JSON.stringify({
          ...connection,
          frameP95: percentile(frameTimes, 0.95),
          inputP95: percentile(inputTimes, 0.95),
          ...metrics,
        });
        return runtime.transport instanceof PeerTransport
          ? runtime.transport.diagnostics()
          : undefined;
      })
      .then((report) => {
        if (report)
          app.dataset.linkDiagnostics = formatLinkDiagnostics(
            report.links,
            report.ice,
            report.socket,
          );
      });
  }, 1000);
  // `id` marks the local rider in the arena (the YOU ring); every render path passes it as the last argument, replays included.
  /** A running replay takes over the arena: its clip renders under a scope of its own, the overlay dresses it, and live play returns on `done`. */
  function replayFrame(now: number, predicted: WorldView | undefined): boolean {
    const update = replay.frame(now);
    if (!update) return false;
    // The arena left the screen under a replay (MAIN MENU, a controller-only seat): take the dressing down and forget the clip.
    if (screen.arenaHidden) {
      replay.cancel();
      replay.frame(now);
      replayOverlay.stop(canvas);
      app.classList.remove("replaying");
      replayKey = "";
      reopenRecap = false;
      return false;
    }
    if (update.clip.key !== replayKey) {
      replayKey = update.clip.key;
      const { card, color } = describeClip(update.clip);
      replayOverlay.start(card, color);
    }
    app.classList.toggle(
      "replaying",
      update.stage !== "hold" && update.stage !== "done",
    );
    for (const cue of update.cues) audio.director.replayCue(cue);
    const shown = update.snapshot ?? predicted;
    if (shown) {
      presentation.render(
        shown,
        now,
        theme,
        update.snapshot
          ? `${renderScope}:replay:${update.clip.key}`
          : renderScope,
        id,
        update.snapshot !== undefined,
      );
      replayOverlay.update(update, canvas, {
        width: shown.width,
        height: shown.height,
      });
    }
    if (update.stage === "done") {
      replayKey = "";
      if (reopenRecap) {
        reopenRecap = false;
        if (snapshot?.phase === "matchOver") openRecap();
      }
    }
    return true;
  }
  function frame() {
    const now = performance.now();
    frameTimes.push(now - previousFrame);
    previousFrame = now;
    if (frameTimes.length > 300) frameTimes.shift();
    if (inputAt) {
      inputTimes.push(now - inputAt);
      inputAt = 0;
      if (inputTimes.length > 100) inputTimes.shift();
    }
    const frames = runtime.presentation();
    const predicted = frames && presentFrames(frames);
    if (replayFrame(now, predicted)) {
      requestAnimationFrame(frame);
      return;
    }
    // Behind the lobby and results the scene is blurred and dimmed, so ten frames a second are enough. This saves power
    // on lobby screens and load on crowded CI runners. It is not a startup fix: the TV draws nothing until Phaser is
    // ready, and the shared-room smoke passes without it in default headless Chromium (#333's controller fix is what counts).
    const backdrop = screen.sceneBackground;
    if (
      predicted &&
      !screen.arenaHidden &&
      !(backdrop && now - lastBackdropRender < BACKDROP_FRAME_MS)
    ) {
      if (backdrop) lastBackdropRender = now;
      presentation.render(predicted, now, theme, renderScope, id);
      if (benchmark && (benchmarkInput || now - lastBenchmarkRender >= 100)) {
        const p = predicted.players.find((p) => p.id === id);
        sample({
          kind: "prediction",
          renderAt: now,
          tick: predicted.tick,
          inputSeq: benchmarkInput?.seq,
          inputAt: benchmarkInput?.at,
          pose: p ? { x: p.x, y: p.y, angle: p.angle } : undefined,
        });
        benchmarkInput = undefined;
        lastBenchmarkRender = now;
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  installRoomLifecycle(window, {
    stop: () => runtime.stop(),
    destroy: () => presentation.destroy(),
    reload: () => location.reload(),
  });
}
