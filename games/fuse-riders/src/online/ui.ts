import { legendSrc } from "../client/legend-src.js";
import { VoiceChat } from "./voice-chat.js";
import { uuid } from "fuse-netcode";
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
  createColorPicker,
  riderColorIndex,
  type RiderColorId,
} from "../client/rider-colors.js";
import {
  applyThemeProperties,
  themes,
  type ThemeDefinition,
  type ThemeId,
} from "../render/themes.js";
import { selectedTheme, storeTheme } from "../client/theme-choice.js";
import { createGameAudio, type GameAudio } from "../client/game-audio.js";
import {
  loadRoomSettings,
  SETTINGS_KEY,
  type RoomSettings,
} from "../engine/room-settings.js";
import type { WorldView } from "../engine/view.js";
import { renderMatchRecap } from "./match-recap-view.js";
import { node, setAttributeIfChanged, setIfChanged } from "./dom.js";
import { showLanding } from "./landing.js";
import {
  displayQuery,
  hostTokenKey,
  LAST_ROOM_KEY,
  onlineRoute,
} from "./landing-route.js";
import { PICKUP_LABELS } from "./pickup-labels.js";
import { createAvatarDialog } from "./dialogs/avatar.js";
import {
  createColorDialog,
  type ColorDialogOptions,
} from "./dialogs/rider-color.js";
import { createNameDialog } from "./dialogs/rider-name.js";
import { createMenuDialog } from "./dialogs/menu.js";
import { createRadioDialog } from "./dialogs/radio.js";
import { createRecapDialog } from "./dialogs/recap.js";
import { createDialogRegistry, type RoomDialogId } from "./dialogs/registry.js";
import { createRoomSettingsDialog } from "./dialogs/room-settings.js";
import { createSettingsDialog } from "./dialogs/settings.js";
import { createShortcutsDialog } from "./dialogs/shortcuts.js";
import { createVoiceDialog } from "./dialogs/voice.js";
import { ReplayDirector, describeClip } from "../client/replay.js";
import { createReplayOverlay } from "../client/replay-overlay.js";
import { RoomRuntime, type Callbacks } from "./room-runtime.js";
import {
  PeerTransport,
  endRoom,
  formatLinkDiagnostics,
  installRoomLifecycle,
} from "fuse-network-fe";
import { MAX_PACKET_BYTES } from "fuse-netcode";
import { NetStats } from "./net-stats.js";
import { Telemetry, telemetryEndpoint } from "./telemetry.js";
import type { AvatarId } from "../engine/avatar-id.js";
import QRCode from "qrcode";
import {
  createControllerRow,
  createInviteCard,
  createLobbyShell,
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
import {
  presentRoom,
  presentStatus,
  recapReady,
  type RemoveView,
  type SwitchView,
} from "./room-presenter.js";
import { connectHint } from "./connect-hint.js";
import { createJoinCard, createJoinForm } from "./join-form.js";
import { createNameEntry } from "fuse-ui";
import { MAX_LOGGED_NAME_UNITS, seatRiderName } from "../engine/rider-name.js";
import { safeStorage } from "../client/safe-storage.js";
import { reportGraphics, startAnalytics, track } from "./analytics.js";
import { createAnalyticsSetting } from "./analytics-setting.js";
import { connectStatus } from "./analytics-text.js";
import { createFunnel } from "./funnel.js";
import { announcementFor, eliminationLine } from "../client/arena-announcer.js";
/** The blurred scene behind the lobby and results redraws at 10 fps. */
const BACKDROP_FRAME_MS = 100;
const reducedMotion = () =>
  matchMedia("(prefers-reduced-motion: reduce)").matches;
const storage = safeStorage(() => localStorage);
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
  // Before a room exists the page is the landing page (landing.ts); a room code, a solo run or a TV display is a room.
  const route = onlineRoute(url.search, (code) => read(hostTokenKey(code)));
  if (route.kind === "landing") {
    showLanding({
      app,
      storage,
      audio: sharedAudio(),
      setRadioToggle: (toggle) => {
        radioToggle = toggle;
      },
      accountPanel: createPlayerAccountPanel,
      startRoom: () => void startOnline(),
    });
    return;
  }
  if (route.kind === "invalid") {
    app.textContent = "Invalid room code";
    return;
  }
  const { code, solo, displayOnly, role, hostToken } = route;
  const token = solo ? "" : displayOnly ? secret() : hostToken || peerToken();
  function peerToken() {
    const key = `fuse-peer-${code}`;
    const token = read(key) || secret();
    save(key, token);
    return token;
  }
  const forgetHostToken = () => storage.removeItem(hostTokenKey(code));
  if (!solo && !displayOnly) save(LAST_ROOM_KEY, code);
  let id = "",
    isHost = false,
    // Who runs the room as the fold sees it, and whether that is this device. The creator holds it while it is here;
    // the delegate holds it while the creator is away, and hands it straight back (ADR 047 §9).
    managerId = "",
    manages = false,
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
  /** The room's watching list from the last frame: the side-switch buttons read a name from it when pressed. */
  let latestWatchers: readonly { id: string; name: string }[] = [];
  /** A colour asked for in the join form, sent once the room has seated this rider; the fold decides whether it sticks. */
  let wantedColor: number | undefined;
  /**
   * The name this device takes its seat under, without asking: its account's, the one it last played under on this
   * browser, or a plain one for a browser that has never played. None of them is a commitment — the room is where a
   * rider settles its name now, and NAME on its own row changes it until it is ready.
   */
  const openingName = (seated: number): string =>
    accountUsername() ??
    read("fuse-riders-player-name") ??
    `Rider ${seated + 1}`;
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
    (playerName, avatarId, colorIndex) => {
      // The seat comes from the room's generic join, which carries no colour; the colour the rider asked for follows
      // as its own entry the moment the room seats it (`wantedColor` below). Asking for one it cannot have is safe:
      // the fold refuses it and the rider keeps the free colour the join gave it.
      // Only held for a join the runtime accepted. A refused one (room full, still loading) leaves nothing behind to
      // recolour a seat this device might take minutes later for another reason.
      const sent = runtime.command({
        type: "join",
        name: playerName,
        avatarId,
      });
      wantedColor = sent ? colorIndex : undefined;
      return sent;
    },
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
  // Every role now waits on the boot card, so the connect hint belongs to it rather than to the join card: an invited
  // phone whose host is on another network must still be told that, and told it where it is looking.
  const joinNote = node("p", "", "room-join-note");
  joinNote.hidden = true;
  const joinPanel =
    role === "joiner"
      ? createJoinCard(code, joinForm.element, joinNote)
      : joinForm.element;
  if (role !== "joiner")
    joinForm.element.prepend(node("p", "JOIN THE RACE", "lobby-join-title"));
  // A seat that vanishes on its own is a bug; a seat the host took back is a decision, so the join card says which it was.
  const kickedNote = node(
    "p",
    "The host removed you from the room. You can join again.",
    "join-kicked",
  );
  kickedNote.hidden = true;
  kickedNote.setAttribute("role", "status");
  joinForm.element.prepend(kickedNote);
  // The removal message reaches this page a little before the entry that frees the seat does, so the note cannot be
  // cleared by "still seated": it stands until this device is back in the room.
  let kickedFromRoom = false,
    wasInRoom = false,
    /**
     * This page has seen the room list this device at least once. It latches: once the room has held us, an absence
     * is a removal rather than an arrival, and only an arrival seats itself. Separate from `wasInRoom`, which is the
     * previous frame's membership and is rewritten every frame.
     */
    everInRoom = false,
    /** When this device first asked for a seat, so an arrival that is never seated stops waiting silently. */
    seatingSince = 0,
    /** The account name has been offered to the room once; a refusal is its answer and is not asked again. */
    accountNameSent = false;
  /**
   * How long an arrival holds the boot card while its seat is granted. A seat normally lands in one round trip; past
   * this the room is refusing it (full, or a manager that never answered) and the join card comes up instead, where
   * the reason is shown and JOIN AS SPECTATOR is offered. Without it a full room would leave a phone reading
   * PREPARING ROOM with no way to watch.
   */
  const SEATING_GRACE_MS = 8000;
  booting.append(bootNote);
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
  // Every role opens on the boot card now: an invited device takes its own seat as soon as the room arrives, and the
  // join card is what it falls back to when the room will not seat it (kicked, or full).
  app.replaceChildren(header, booting, joinPanel);
  joinPanel.hidden = true;
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
    const key = JSON.stringify(announcement) + visible + manages;
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
        !manages || announcement.subtitle !== "MATCH COMPLETE";
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
      host: "host-badge",
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
      host: "host-badge",
    },
  });
  const lobbyWatchers = watchers.element;
  lobbyWatchers.hidden = true;
  lobbyWatchers.setAttribute("aria-label", "Watching");
  lobbyRiders.append(lobbyWatchers);
  /** The manager's × on each watcher row: the roster owns the row, the game owns the button on it. */
  const watcherRemoves = new Map<string, HTMLButtonElement>();
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
      /** This row's remove button asks twice: it belongs to a person, not an AI rider. */
      confirms: boolean;
      /** The name and points last written. */
      shown: string;
    }
  >();
  /**
   * Removing a friend is one tap away from removing an AI rider, and much worse to get wrong, so a human row asks
   * twice: the first tap turns the button into KICK? for two seconds and only the second one sends the command.
   */
  const KICK_CONFIRM_MS = 2000;
  const arming = new Map<HTMLButtonElement, ReturnType<typeof setTimeout>>();
  const disarm = (button: HTMLButtonElement) => {
    const timer = arming.get(button);
    if (timer === undefined) return;
    clearTimeout(timer);
    arming.delete(button);
    button.textContent = "×";
    button.classList.remove("arming");
  };
  const removeTapped = (
    button: HTMLButtonElement,
    confirms: boolean,
    act: () => void,
  ) => {
    if (!confirms || arming.has(button)) {
      disarm(button);
      act();
      return;
    }
    button.textContent = "KICK?";
    button.classList.add("arming");
    arming.set(
      button,
      setTimeout(() => disarm(button), KICK_CONFIRM_MS),
    );
  };
  /** One update for every remove button: the AI rider's, the friend's and the watcher's. */
  const showRemove = (button: HTMLButtonElement, view: RemoveView) => {
    setIfChanged(button, "hidden", view.hidden);
    setIfChanged(button, "disabled", view.disabled);
    setAttributeIfChanged(button, "aria-label", view.label);
    setIfChanged(button, "title", view.title);
    // A button that just went away or went dead must not stay armed: the next tap would kick without asking.
    if (view.hidden || view.disabled) disarm(button);
  };
  /**
   * This device's own change-sides button, one per row it has ever appeared on. The roster diffs its rows and never
   * rebuilds them, so the button is built once, parented into the row it belongs to and updated in place.
   */
  const sideSwitches = new Map<string, HTMLButtonElement>();
  const sideSwitch = (key: string, act: () => void): HTMLButtonElement => {
    let button = sideSwitches.get(key);
    if (!button) {
      button = node("button", "", "room-switch");
      button.onclick = act;
      sideSwitches.set(key, button);
    }
    return button;
  };
  const showSwitch = (button: HTMLButtonElement, view: SwitchView) => {
    setIfChanged(button, "hidden", view.hidden);
    setIfChanged(button, "disabled", view.disabled);
    setIfChanged(button, "textContent", view.label);
    setAttributeIfChanged(button, "aria-label", view.title);
    setIfChanged(button, "title", view.title);
  };
  /** Buttons for rows the lobby no longer lists go with them, so a member that left leaves nothing behind. */
  const pruneSwitches = (live: ReadonlySet<string>) => {
    for (const [key, button] of sideSwitches)
      if (!live.has(key)) {
        button.remove();
        sideSwitches.delete(key);
      }
  };
  const help = node("button", "?", "desktop-help");
  help.setAttribute("aria-label", "Keyboard controls");
  help.title = "Keyboard controls";
  const avatarButton = node("button", "AVATAR");
  avatarButton.hidden = true;
  // Colour sits beside the avatar and follows the same rule: a lobby choice, gone once the round starts.
  const colorButton = node("button", "COLOUR");
  colorButton.hidden = true;
  // And the name, which nothing asks for before the seat any more: the room is where a rider settles all three.
  const nameButton = node("button", "NAME");
  nameButton.hidden = true;
  header.append(nameButton, avatarButton, colorButton, prefsButton, menu, help);
  // Every menu is its own dialog (dialogs/*), and which one is open is the registry's state: never read from a
  // dialog's title, classes or contents. They sit where the one shared dialog used to, right after the phone HUD.
  const dialogs = createDialogRegistry<RoomDialogId>();
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
  // A joiner's card is built around rather than over. Its original reason has gone — nobody types a name into it on
  // the way in any more (#132), because an arriving device is seated without one — but it is still the screen a
  // kicked or refused device lands on, so it keeps its place rather than being rebuilt under one.
  // `header`, `booting` and `joinPanel` are app's only children here; nothing else attaches before this point.
  if (role === "joiner") {
    header.after(canvas, sharedLobby, scoreboard);
    joinPanel.after(footer, keyHint, announcer, feed, hud);
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
    );
  app.append(powerStatus);
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const shortcutsDialog = createShortcutsDialog(dialogs, {
    mac,
    solo,
    canConfigure: () => manages || solo,
  });
  help.onclick = () => shortcutsDialog.open();
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
    // An arrival on its way to a seat, not a device waiting at the door: the same condition the auto-join fires on,
    // so the join card comes up only for one the room will not seat.
    seating:
      role === "joiner" &&
      !everInRoom &&
      !displayOnly &&
      !kickedFromRoom &&
      !roomEnded &&
      (seatingSince === 0 ||
        performance.now() - seatingSince < SEATING_GRACE_MS),
    phase: snapshot?.phase ?? "lobby",
    recapReady: recapIsReady,
    shared: settings.mode === "shared",
    device: device(),
  });
  // Every class the room screen implies is set here, from the derived screen, and nothing reads one back.
  let screen: RoomScreen = roomScreen(screenInput()),
    shownKind: RoomScreen["kind"] | undefined;
  const showScreen = (next: RoomScreen, resized = false) => {
    screen = next;
    for (const [name, on] of Object.entries(screenClasses(next)))
      app.classList.toggle(name, on);
    // Nothing reads it back; it names the screen for a person in the inspector, so it is written only when it changes.
    if (next.kind !== shownKind) app.dataset.screen = shownKind = next.kind;
    setIfChanged(canvas, "hidden", next.arenaHidden);
    setIfChanged(sharedLobby, "hidden", !next.lobbyCard);
    setIfChanged(roster, "hidden", next.lobbyCard);
    // VISUAL STYLE only changes the arena, which a shared-TV controller never draws, lobby included.
    setIfChanged(styleHeading, "hidden", next.arenaController);
    setIfChanged(styleRow, "hidden", next.arenaController);
    setIfChanged(controllerLayoutSetting, "hidden", !next.arenaController);
    mobileLayout.update(
      next.mobile,
      snapshot?.phase ?? "lobby",
      next.kind !== "ended" && recapIsReady,
      resized,
      next.controllerOnly,
    );
    const controllerResults = next.controllerOnly && next.kind === "recap";
    setIfChanged(controllerRematch, "hidden", !controllerResults);
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

  const roomAccount = createPlayerAccountPanel();
  roomAccount.button.classList.add("player-account");
  app.append(roomAccount.dialog);
  const topMenu = node("nav", "", "game-top-menu");
  topMenu.setAttribute("aria-label", "Player menu");
  const topRadio = node("button", "♫ RADIO"),
    topMusic = node("button"),
    topMute = node("button");
  topRadio.type = topMusic.type = topMute.type = "button";
  topRadio.onclick = () => radioDialog.open();
  topMenu.append(
    topRadio,
    topMusic,
    topMute,
    prefsButton,
    roomAccount.leaderboardButton,
    roomAccount.button,
  );
  header.append(topMenu);
  topMenu.append(results, nameButton, avatarButton, colorButton, menu, help);
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
  const radioDialog = createRadioDialog(dialogs, audio);
  radioToggle = radioDialog.toggle;
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
  radioButton.onclick = radioDialog.open; // The same ♫ MUSIC ON / OFF toggle as the landing page.
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
  const voiceDialog = voice
    ? createVoiceDialog(dialogs, voice.controls)
    : undefined;
  if (voice && voiceDialog) {
    prefs.prepend(node("h3", "GAME AUDIO", "settings-group"));
    muteButton.title =
      "Music and effects only; use DEAFEN in voice chat to silence voice.";
    prefs.append(voice.controls);
    topMenu.insertBefore(voice.button, prefsButton);
    voice.button.onclick = voiceDialog.open;
    voice.setChanged(() => {
      for (const [playerId, row] of rosterEntries)
        row.entry.dataset.voice = voice.indicator(playerId);
      for (const [playerId, entry] of lobbyRoster.entries())
        entry.dataset.voice = voice.indicator(playerId);
    });
  }
  const settingsDialog = createSettingsDialog(dialogs, {
    content: prefs,
    ...(voice ? { voiceControls: voice.controls } : {}),
    beforeOpen: () => privacy.render(),
  });
  prefsButton.onclick = settingsDialog.open;
  const recapDialog = createRecapDialog(dialogs, {
    rematch: () => {
      if (solo) start.click();
      else readyButton.click();
    },
    backToLobby: () => reset.click(),
  });
  const openRecap = () => {
    if (!snapshot) return;
    recapDialog.open(
      renderMatchRecap(snapshot.matchStats, snapshot.moments, {
        playerId: id,
        canWatch: (key) => !screen.arenaHidden && !!replay.recorder.clip(key),
        watch: (key) => {
          const clip = replay.recorder.clip(key);
          if (!clip) return;
          audio.unlock();
          reopenRecap = true;
          dialogs.close("recap");
          replay.play(clip, performance.now());
        },
      }),
      {
        hasStats: snapshot.matchStats.length > 0,
        rematchHidden: solo ? !manages : !joined || displayOnly,
        lobbyHidden: !manages,
      },
    );
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
    kicked: () => {
      kickedFromRoom = true;
      kickedNote.hidden = false;
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
      // Every replica folds the same log, so every screen names the same host — including the host's own screen.
      managerId = state.managerId;
      // The creator's own page keeps its controls even where the log hands the crown on: a creator that took no seat is
      // in the room and can see it, and the fold accepts its management entries whatever it says about the crown.
      manages = id !== "" && (managerId === id || isHost) && !replacedHost;
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
      setIfChanged(results, "hidden", !recapIsReady);
      // Every device dismisses the report when the shared state moves on, including peers that did not click REMATCH.
      if (!recapIsReady) dialogs.close("recap");
      if (state.phase === "lobby") lastRecap = "";
      joined = Boolean(player);
      // Seated at last: ask for the colour the join form chose, once. The join gave this rider the lowest free colour,
      // so it already has one; this is the preference on top, and a single attempt is right because the fold's answer
      // is final — a colour someone else holds stays theirs rather than being retried every frame.
      if (player && wantedColor !== undefined) {
        const asked = wantedColor;
        wantedColor = undefined;
        if (riderColorIndex(player.color) !== asked)
          runtime.command({ type: "color", colorIndex: asked });
      }
      // What this rider actually wears is what the browser remembers, so the next room opens on the name, colour and
      // head it wore rather than on ones it asked for and did not get.
      if (player) {
        joinForm.colors.sync(player.color as RiderColorId);
        joinForm.picker.sync(player.avatarId);
        if (read("fuse-riders-player-name") !== player.name)
          storage.setItem("fuse-riders-player-name", player.name);
        // A signed-in rider rides under its account's name. The username can arrive after the seat did (an invite
        // link on a new phone fetches it), and there is no form left to write it into, so the room is told instead —
        // once, while this rider is still deciding, because a refusal is the room's answer and not worth repeating.
        const account = accountUsername();
        if (
          account &&
          account !== player.name &&
          !accountNameSent &&
          state.phase === "lobby" &&
          !readyPlayers.includes(id)
        ) {
          accountNameSent = true;
          runtime.command({ type: "join", name: account });
        }
      }
      // A watcher is in the room, not queuing at its door: it gets the arena and the lists, never the join card or the controls.
      const watcher = state.spectators.find((seat) => seat.id === id);
      watching = Boolean(watcher);
      if ((joined || watching) && !wasInRoom) kickedFromRoom = false;
      wasInRoom = joined || watching;
      if (wasInRoom) everInRoom = true;
      setIfChanged(kickedNote, "hidden", !kickedFromRoom);
      // The screen, once per frame: every class and every arena/lobby visibility below follows from it.
      showScreen(roomScreen(screenInput()));
      const view = presentRoom({
        state,
        spectators: state.spectators,
        readyPlayers,
        playerId: id,
        manages,
        managerId,
        replacedHost,
        creator: isHost,
        hostPresent: runtime.hostPresent,
        solo,
        displayOnly,
        lobbyCard: screen.lobbyCard,
        joining: screen.joining,
        phoneLobby: screen.mobile.lobby,
        mobileActive: screen.mobile.active,
        bombHeld: inputState.isHeld("bomb"),
      });
      // Every write below goes through setIfChanged: the view is rewritten each frame, and an unchanged value must not touch the DOM.
      setIfChanged(joinPanel, "hidden", view.joinPanelHidden);
      // Name, head and colour are one choice in three parts: all three are offered while this rider is in the lobby
      // and not yet ready, all three leave together, and a picker left open closes when the round starts.
      setIfChanged(avatarButton, "hidden", view.avatarHidden);
      setIfChanged(colorButton, "hidden", view.avatarHidden);
      setIfChanged(nameButton, "hidden", view.avatarHidden);
      if (view.avatarHidden) {
        dialogs.close("avatar");
        dialogs.close("riderColor");
        dialogs.close("riderName");
      }
      setIfChanged(controls, "hidden", view.controlsHidden);
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
      } else if (
        // The room is the join screen: an invited device the room does not list yet takes a seat by itself, wearing
        // whatever it wore last, and settles its name, head, colour and side in the room rather than in a form in
        // front of it (`docs/design/room-is-the-join-screen.md`).
        //
        // Only on arrival, which is what `wasInRoom` says: a device this page has already seen listed and no longer
        // does was taken out of the room, and taking itself straight back in would undo that. A kick is the case that
        // matters, and the `kicked` message is no use for it — the manager sends it only after folding the `LEAVE`,
        // so it is a network hop behind the fold that both replicas apply at the same instant, and an auto-join keyed
        // on the message would already be at the manager before the notice arrived. It is also what keeps a watcher
        // the room dropped (a phone asleep across a round boundary, `dropAbsentSpectators`) from coming back as a
        // rider it never asked to be. Both land on the join card instead, which is what that card is for now. A page
        // reload clears this and seats the device again: reloading is asking to come back.
        role === "joiner" &&
        !joined &&
        !watching &&
        !everInRoom &&
        !displayOnly &&
        !kickedFromRoom &&
        !roomEnded
      ) {
        if (seatingSince === 0) seatingSince = performance.now();
        if (!rejoinPending) {
          rejoinPending = true;
          wantedColor = riderColorIndex(joinForm.colors.selected());
          runtime.command({
            type: "join",
            name: openingName(state.players.length),
            avatarId: joinForm.picker.selected(),
          });
        }
      } else rejoinPending = false;
      setIfChanged(lobbyCount, "textContent", view.lobby.count);
      lobbyRoster.update(
        view.lobby.riders.map((p) => ({
          id: p.id,
          name: p.name,
          status: p.status,
          color: p.color,
          avatar: p.avatarId,
          host: p.host,
        })),
      );
      // The two sides of the room are one command apart: the rider gives its seat up, the watcher takes a free one,
      // and neither leaves the room to do it. Only this device's own row carries the button (`switchSide.hidden`).
      const liveSwitches = new Set<string>();
      for (const rider of view.lobby.riders) {
        const row = lobbyRoster.row(rider.id);
        if (!row) continue;
        const key = `rider:${rider.id}`,
          riderId = rider.id,
          fallback = rider.name;
        // The name is read when the button is pressed, not when its row was first drawn: a rider may rename itself
        // while it sits there, and carrying the name it had at boot into the watching list would undo that.
        const button = sideSwitch(key, () =>
          runtime.command({
            type: "spectate",
            name:
              snapshot?.players.find((p) => p.id === riderId)?.name ?? fallback,
          }),
        );
        liveSwitches.add(key);
        if (button.parentElement !== row) row.append(button);
        showSwitch(button, rider.switchSide);
      }
      latestWatchers = view.lobby.watchers;
      setIfChanged(lobbyWatchers, "hidden", view.lobby.watchersHidden);
      watchers.update(
        view.lobby.watchers.map((seat) => ({
          id: seat.id,
          name: seat.name,
          status: seat.status,
          avatar: "watcher",
          host: seat.host,
        })),
      );
      for (const seat of view.lobby.watchers) {
        const row = watchers.row(seat.id);
        if (!row) continue;
        let remove = watcherRemoves.get(seat.id);
        if (!remove) {
          // A row can now carry two buttons, so each says which it is rather than being "the button in the row".
          const button = node("button", "×", "room-remove"),
            watcherId = seat.id;
          button.onclick = () =>
            removeTapped(button, true, () =>
              runtime.command({ type: "kick", id: watcherId }),
            );
          watcherRemoves.set(seat.id, (remove = button));
        }
        if (remove.parentElement !== row) row.append(remove);
        showRemove(remove, seat.remove);
        const key = `watcher:${seat.id}`,
          watcherId = seat.id,
          fallbackName = seat.name;
        // The remembered avatar, since the watching list carries none: the seat is taken as this device always rides.
        // The name is read on the press for the same reason the rider's is: it may have changed since this row was
        // drawn, and the seat should be taken under the name the room shows now.
        const take = sideSwitch(key, () =>
          runtime.command({
            type: "join",
            name:
              latestWatchers.find((w) => w.id === watcherId)?.name ??
              fallbackName,
            avatarId: joinForm.picker.selected(),
          }),
        );
        liveSwitches.add(key);
        if (take.parentElement !== row) row.append(take);
        showSwitch(take, seat.switchSide);
      }
      pruneSwitches(liveSwitches);
      for (const [watcherId, button] of watcherRemoves)
        if (!view.lobby.watchers.some((seat) => seat.id === watcherId)) {
          button.remove();
          watcherRemoves.delete(watcherId);
        }
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
      setIfChanged(powerStatus, "hidden", view.power.hidden);
      setIfChanged(powerStatus, "textContent", view.power.text);
      fireButton.classList.toggle("gun-armed", view.fire.gunReady);
      hudFire.classList.toggle("gun-armed", view.fire.gunReady);
      setIfChanged(fireButton, "title", view.fire.title);
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
      setAttributeIfChanged(
        fireButton,
        "aria-label",
        `${fireButton.dataset.weapon}: ${view.fire.label ?? "Hold to fire"}`,
      );
      if (view.playerColor)
        app.style.setProperty("--player-color", view.playerColor);
      if (view.fire.label !== undefined)
        setIfChanged(fireLabel, "textContent", view.fire.label);
      setIfChanged(notice, "textContent", view.notice);
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
            remove = node("button", "×", "room-remove"),
            memberId = p.id;
          entry.append(head, label, remove);
          // The same button frees an AI seat and sends a friend home; which command it is follows from who sits there.
          remove.onclick = () =>
            removeTapped(
              remove,
              rosterEntries.get(memberId)?.confirms === true,
              () =>
                runtime.command(
                  rosterEntries.get(memberId)?.confirms
                    ? { type: "kick", id: memberId }
                    : { type: "bot", action: "remove", id: memberId },
                ),
            );
          row = {
            entry,
            label,
            head,
            avatar: p.avatarId,
            remove,
            confirms: p.remove.confirms,
            shown: "",
          };
          rosterEntries.set(p.id, row);
          roster.append(entry);
        }
        row.confirms = p.remove.confirms;
        if (row.shown !== `${p.name}${p.points}`) {
          row.shown = `${p.name}${p.points}`;
          row.label.className = "online-score-label";
          row.label.replaceChildren(
            node("span", p.name, "online-score-name"),
            node("span", p.points, "online-score-points"),
          );
        }
        setIfChanged(row.label, "title", p.title);
        setAttributeIfChanged(row.label, "aria-label", p.title);
        row.entry.style.color = p.color;
        row.entry.style.setProperty("--rider-color", p.color);
        row.entry.classList.toggle("out", p.out);
        row.entry.style.order = String(p.rank);
        setIfChanged(row.entry.dataset, "rank", String(p.rank));
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
        showRemove(row.remove, p.remove);
      }
      setIfChanged(addAI, "disabled", view.actions.addAIDisabled);
      if (startLabel !== view.actions.start.label)
        start.textContent = startLabel = view.actions.start.label;
      setIfChanged(start, "disabled", view.actions.start.disabled);
      const waitingRiders = state.players.filter(
        (p) => p.connected && !p.id.startsWith("bot:"),
      );
      const readyText = `${waitingRiders.filter((p) => readyPlayers.includes(p.id)).length}/${waitingRiders.length} ready`;
      const recapOpen = dialogs.current() === "recap";
      // The crown can move while the results are up: BACK TO LOBBY follows whoever holds it without reopening the
      // card. READY is not its to hold — every rider votes for itself.
      recapDialog.update({
        ready: { text: readyText, hidden: solo || !recapOpen || !recapIsReady },
        rematch: {
          label: solo ? "REMATCH" : view.actions.ready.label,
          pressed: view.actions.ready.pressed,
          hidden: !recapOpen || (solo ? !isHost : view.actions.ready.hidden),
        },
        lobbyHidden: !manages,
      });
      setIfChanged(controllerReadyCount, "textContent", readyText);
      setIfChanged(start, "hidden", !solo);
      setIfChanged(readyButton, "hidden", view.actions.ready.hidden);
      setIfChanged(readyButton, "textContent", view.actions.ready.label);
      setAttributeIfChanged(
        readyButton,
        "aria-pressed",
        String(view.actions.ready.pressed),
      );
      setIfChanged(settingsButton, "hidden", !manages);
      setIfChanged(addAI, "hidden", !manages);
      setIfChanged(hostControls, "hidden", view.actions.hidden);
      setIfChanged(reset, "disabled", view.actions.reset.disabled);
      setIfChanged(reset, "hidden", !manages || view.actions.reset.hidden);
      // The invite is the creator's: it carries the room code its device owns.
      setIfChanged(
        share,
        "hidden",
        !isHost || replacedHost || view.actions.shareHidden,
      );
      voice?.setRoster(id, state.players);
      for (const [playerId, row] of rosterEntries)
        if (voice)
          setIfChanged(row.entry.dataset, "voice", voice.indicator(playerId));
      for (const [playerId, entry] of lobbyRoster.entries())
        if (voice)
          setIfChanged(entry.dataset, "voice", voice.indicator(playerId));
      setIfChanged(roundChip, "textContent", view.roundClock);
      setIfChanged(roundChip, "hidden", view.roundChipHidden);
      showAnnouncement(state, view.announcerVisible && !screen.controllerOnly);
      if (!solo) {
        setIfChanged(
          announceAction,
          "hidden",
          view.actions.ready.hidden || state.phase !== "matchOver",
        );
        setIfChanged(announceAction, "textContent", view.actions.ready.label);
      }
      // Phone HUD: who you are, what the fire button would do, match points and the clock. The thirds themselves stay transparent.
      setIfChanged(hud, "hidden", view.hudHidden);
      if (player) setIfChanged(arcadeIdentity, "textContent", player.name);
      if (player && view.hud) {
        if (hudAvatar !== player.avatarId) {
          hudWho.replaceChildren(
            createAvatarPortrait(player.avatarId),
            node("b", "YOU"),
          );
          hudAvatar = player.avatarId;
        }
        setIfChanged(hudFire, "textContent", view.hud.fire);
        setIfChanged(hudWins, "textContent", view.hud.wins);
        setIfChanged(hudRound, "textContent", view.hud.clock);
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
  const menuDialog = createMenuDialog(dialogs, {
    solo,
    canEnd: () => isHost,
    playerId: () => id,
    standings: () => snapshot?.leaderboard ?? [],
    linkDiagnostics: () => app.dataset.linkDiagnostics,
    statsHidden: () => statsPanel.hidden,
    toggleStats: () => {
      statsPanel.hidden = !statsPanel.hidden;
    },
    leave: async (ending) => {
      runtime.stop();
      if (ending) {
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
    },
  });
  menu.onclick = menuDialog.open;
  const avatarDialog = createAvatarDialog(dialogs, {
    storage,
    picker: createAvatarPicker,
    // What this rider already wears is never "taken": an AI rider shares `robot` with a human that had it first, and
    // marking your own head as someone else's would disable the option you are standing on.
    wornBy: (avatarId) => {
      if (snapshot?.players.find((p) => p.id === id)?.avatarId === avatarId)
        return undefined;
      const owner = snapshot?.players.find(
        (p) => p.id !== id && p.avatarId === avatarId,
      );
      return owner && { name: owner.name, color: owner.color };
    },
    // Seated, the fold is what decides, and the frame loop syncs the form to its answer; syncing optimistically here
    // too would show the pick, then the old head for a frame, then the pick again. Unseated there is no fold to ask.
    chosen: (chosen) => {
      if (joined) runtime.command({ type: "avatar", avatarId: chosen });
      else joinForm.picker.sync(chosen);
    },
  });
  avatarButton.onclick = avatarDialog.open;
  const colorDialog = createColorDialog(dialogs, {
    storage,
    picker: createColorPicker as ColorDialogOptions["picker"],
    portrait: (avatarId) => createAvatarPortrait(avatarId as AvatarId),
    wornBy: (color) => {
      if (snapshot?.players.find((p) => p.id === id)?.color === color)
        return undefined;
      const owner = snapshot?.players.find(
        (p) => p.id !== id && p.color === color,
      );
      return owner && { name: owner.name, avatarId: owner.avatarId };
    },
    chosen: (chosen) => {
      if (joined)
        runtime.command({ type: "color", colorIndex: riderColorIndex(chosen) });
      else joinForm.colors.sync(chosen as RiderColorId);
    },
  });
  colorButton.onclick = colorDialog.open;
  const nameDialog = createNameDialog(dialogs, {
    current: () => snapshot?.players.find((p) => p.id === id)?.name ?? "",
    fixed: () => accountUsername() ?? undefined,
    // A rename is the ordinary join command sent again with a different name: the runtime turns it into a `JOIN` over
    // the seat this rider already holds, and says why when it will not (ready, or the round has started). What this
    // browser remembers is what the room accepted rather than what was asked for — the frame loop writes it once the
    // fold has answered, which is the bargain the colour already keeps.
    chosen: (chosen) => {
      runtime.command({ type: "join", name: chosen });
    },
    entry: ({ initial, onSubmit, document: doc }) =>
      createNameEntry({
        normalize: (raw) => seatRiderName(raw) ?? "",
        maxLength: MAX_LOGGED_NAME_UNITS,
        initial,
        buttonText: "SAVE",
        missingText: "Enter a name",
        onSubmit,
        document: doc,
        classes: { root: "fui-name-entry room-rename" },
      }),
  });
  nameButton.onclick = nameDialog.open;
  // The lobby card already carries the QR and the copyable link, so this opens the shared-screen display directly instead of a dialog that repeats them.
  share.title = "Open this room on a shared screen";
  share.onclick = () => {
    window.open(appUrl(displayQuery(code)), "_blank", "noopener");
  };
  const roomSettingsDialog = createRoomSettingsDialog(dialogs, {
    solo,
    labels: PICKUP_LABELS,
    settings: () => settings,
    save: (draft) => {
      if (!runtime.command({ type: "settings", settings: draft })) return false;
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
  });
  const openSettings = roomSettingsDialog.open;
  // Every dialog now exists: they take the place the one shared dialog had, right after the phone HUD.
  const dialogElements = [
    shortcutsDialog.element,
    settingsDialog.element,
    radioDialog.element,
    ...(voiceDialog ? [voiceDialog.element] : []),
    menuDialog.element,
    avatarDialog.element,
    colorDialog.element,
    nameDialog.element,
    roomSettingsDialog.element,
    recapDialog.element,
  ];
  hud.after(...dialogElements);
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
      dialogs.current() !== undefined ||
      roomAccount.dialog.open ||
      roomEnded ||
      !(manages || solo)
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
      dialogs.current() === undefined &&
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
  const mobileLayout = installMobilePlayLayout(
    app,
    clearControls,
    dialogElements,
  );
  showScreen(screen); // A phone booting a room is already on the lobby screen (#134): the header takes its lobby shape before the first snapshot.
  window.addEventListener("blur", clearControls);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clearControls();
  });
  for (const modal of [...dialogElements, roomAccount.dialog])
    modal.addEventListener("focusin", clearControls);
  document.addEventListener("focusin", () => {
    if (
      document.activeElement?.closest(
        'input,textarea,select,[contenteditable]:not([contenteditable="false"])',
      )
    )
      keyboard.clear();
  });
  // Opening any dialog lets go of held controls: ours say so through the registry, the account panel's through its `open`.
  dialogs.onChange((open) => {
    if (open !== undefined) clearControls();
  });
  new MutationObserver(() => {
    if (roomAccount.dialog.open) clearControls();
  }).observe(roomAccount.dialog, {
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
