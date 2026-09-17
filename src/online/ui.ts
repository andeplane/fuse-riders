import { VoiceChat } from "./voice-chat.js";
import { powerLabel } from "../client/power-indicator.js";
import { uuid } from "../shared/uuid.js";
import { showRoomSettings } from "./room-settings-menu.js";
import { keyboardShortcuts } from "./keyboard-shortcuts.js";
import { startAttract } from "./attract.js";
import { BOT_ID_PREFIX } from "../shared/bot-controller.js";
import { mountArenaPresentation } from "../client/phaser/presentation.js";
import { apiUrl, appUrl } from "./endpoints.js";
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
import { ControllerPointerBindings } from "../client/controller-pointers.js";
import {
  createAvatarPicker,
  createAvatarPortrait,
} from "../client/avatar-heads.js";
import {
  applyThemeProperties,
  selectedTheme,
  storeTheme,
  themes,
  type ThemeDefinition,
  type ThemeId,
} from "../client/themes.js";
import { createGameAudio, type GameAudio } from "../client/game-audio.js";
import {
  defaultRoomSettings,
  loadRoomSettings,
  parseRoomSettings,
  SETTINGS_KEY,
  type RoomSettings,
} from "../shared/room-settings.js";
import type { PickupType } from "../shared/game.js";
import type { ViewSnapshot } from "../client/snapshot-stream.js";
import type { MatchPlayerStats } from "../shared/match-stats.js";
import type { Moment } from "../shared/moments.js";
import {
  COMPARISON_COLUMNS,
  COMPARISON_KEY,
  HIGHLIGHTS_TITLE,
  RECAP_EMPTY_MESSAGE,
  RECAP_KICKER,
  RECAP_TITLE,
  buildMatchRecap,
} from "../shared/match-recap.js";
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
import { MAX_PACKET_BYTES } from "./packet.js";
import { NetStats } from "./net-stats.js";
import { Telemetry, telemetryEndpoint } from "./telemetry.js";
import type { AvatarId } from "../shared/avatars.js";
import QRCode from "qrcode";
import "./online.css";
import "./top-menu.css";
import { formatNetStats } from "./net-stats.js";
import { installMobilePlayLayout } from "./mobile-play-layout.js";
import { connectHint } from "./connect-hint.js";
import { createJoinCard, createJoinForm } from "./join-form.js";
import { safeStorage } from "../client/safe-storage.js";
import {
  decidedRoundReport,
  matchEndedProps,
  matchStartKey,
  startAnalytics,
  track,
} from "./analytics.js";
import { POWERUP_GUIDE } from "../client/powerup-guide.js";
import { createPowerupGuide } from "../client/powerup-guide-view.js";
import {
  announcementFor,
  eliminationLine,
  roundClock,
} from "../client/arena-announcer.js";
import { plainStatus } from "./status-copy.js";
const LAST_ROOM_KEY = "fuse-last-room";
/** The last decided round (and rider) whose Kill and Miss events this browser sent, so a reload or a reopened tab does not send them twice. */
const SHOTS_REPORTED_KEY = "fuse-shots-reported";
const reducedMotion = () =>
  matchMedia("(prefers-reduced-motion: reduce)").matches;
const storage = safeStorage(() => localStorage);
const node = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = "",
  className = "",
) => {
  const e = document.createElement(tag);
  e.textContent = text;
  e.className = className;
  return e;
};
/** Clipboard write with an execCommand fallback. `navigator.clipboard` is secure-context only, so on an
 *  insecure origin it is undefined rather than throwing: only a write that actually ran reports success. */
const copyText = async (text: string) => {
  const clipboard = navigator.clipboard;
  if (typeof clipboard?.writeText === "function") {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      /* Fall through to the legacy path below. */
    }
  }
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.cssText = "position:fixed;top:-1000px;opacity:0";
  document.body.append(field);
  field.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    field.remove();
  }
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
  nitro: "Nitro",
  snail: "Snail",
  gravity: "Gravity",
};
const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const save = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {}
};
/** The transport's player-facing wording, in the game's voice. */
const TRANSPORT_COPY = {
  linking: "Connected · linking riders",
  protocolChanged: "Game protocol changed — reload this page",
  roomEnded: "Room ended — return to menu to start again",
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
    card.innerHTML = `<canvas class="landing-arena" aria-hidden="true"></canvas><div class="landing-shade"></div>
      <header class="landing-top"><a class="landing-brand" href="${appUrl()}">FUSE<span>RIDERS</span></a><div class="landing-top-end game-top-menu"><span class="landing-tag">TINY RIDERS. BIG TROUBLE.</span><button class="landing-audio" type="button">♫ MUSIC ON</button><button class="landing-mute" type="button">🔊 SOUND ON</button></div></header>
      <section class="landing-content"><p class="landing-eyebrow"><span></span> A NEON ARENA PARTY GAME</p>
      <h1>LEAVE A TRAIL.<br>MAKE A <em>MESS.</em></h1>
      <p class="landing-intro">Outrun your friends. Blow up their plans.<br>One arena. Five riders. Absolutely no brakes.</p>
      <a class="solo-cta" href="${appUrl("?solo=1")}"><span>▶ &nbsp; PLAY SOLO</span><small>YOU VS. FOUR AI RIVALS</small></a>
      <div class="landing-multiplayer"><p class="landing-section-label">OR BRING YOUR FRIENDS</p></div>
      <p class="landing-hint">Phones are your controllers. A TV can be your arena.<br>On the same Wi-Fi? Even better.</p></section>
      <aside class="landing-live"><span class="live-dot"></span> LIVE AI FREE-FOR-ALL <small>Real riders. Real explosions.</small></aside>
      <footer class="landing-footer"><span>STEER. CHARGE. RELEASE. SURVIVE.</span><button class="attract-toggle" type="button">Ⅱ PAUSE BACKGROUND</button></footer>`;
    const form = card.querySelector<HTMLElement>(".landing-multiplayer")!;
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
    card.querySelector(".landing-content")!.append(guide);
    const mode = node("fieldset", "", "landing-mode");
    mode.setAttribute("aria-label", "Where will you play?");
    mode.append(node("legend", "Where will you play?"));
    let selectedMode = loadRoomSettings(localStorage).mode;
    for (const [value, label] of [
      ["devices", "Each device"],
      ["shared", "Shared TV"],
    ] as const) {
      const option = node("label"),
        radio = node("input");
      radio.type = "radio";
      radio.name = "landing-mode";
      radio.value = value;
      radio.checked = selectedMode === value;
      radio.onchange = () => {
        selectedMode = value;
      };
      option.append(radio, node("span", label));
      mode.append(option);
    }
    const create = node("button", "CREATE ROOM"),
      join = node("button", "JOIN ROOM"),
      input = node("input");
    input.placeholder = "Room code";
    input.maxLength = 10;
    input.autocapitalize = "characters";
    const error = node("p");
    // `enter` keeps the document, so Room Created no longer needs a send-before-unload flush: nothing unloads out from
    // under the request, and the room stops waiting up to 700ms for Mixpanel before it appears.
    create.onclick = async () => {
      create.disabled = true;
      try {
        const body = await createRoom(apiUrl);
        save(`fuse-room-${body.code}`, body.token);
        const settings = loadRoomSettings(localStorage);
        settings.mode = selectedMode;
        save(SETTINGS_KEY, JSON.stringify(settings));
        track("Room Created", { mode: selectedMode });
        enter(`?room=${body.code}`);
      } catch (e) {
        error.textContent = String(e);
        create.disabled = false;
      }
    };
    join.onclick = () => {
      const value = input.value.trim().toUpperCase();
      if (validRoomCode(value)) enter(`?room=${value}`);
      else error.textContent = "Enter a room code, for example AB42";
    };
    mode.setAttribute("aria-label", "Where will you play?");
    input.setAttribute("aria-label", "Room code");
    error.setAttribute("role", "alert");
    const createRow = node("div", "", "landing-create");
    createRow.append(mode, create);
    const joinRow = node("div", "", "landing-join");
    joinRow.append(input, join);
    input.onkeydown = (event) => {
      if (event.key === "Enter") join.click();
    };
    // The last room this browser was in is one tap away; a closed room still lands on its ROOM CLOSED card, which forgets it.
    const lastRoom = read(LAST_ROOM_KEY);
    if (lastRoom && validRoomCode(lastRoom)) {
      const rejoin = node("button", `REJOIN ${lastRoom}`, "landing-rejoin");
      rejoin.title = "Return to the room you were in last";
      rejoin.onclick = () => {
        location.href = appUrl(`?room=${lastRoom}`);
      };
      joinRow.append(rejoin);
    }
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
    landingAudio.bindMusicToggle(
      card.querySelector<HTMLButtonElement>(".landing-audio")!,
    );
    landingAudio.bindMuteToggle(
      card.querySelector<HTMLButtonElement>(".landing-mute")!,
    );
    card.querySelector(".landing-audio")!.before(landingAudio.controls);
    radioToggle = () => landingAudio.controls.toggleAttribute("open");
    // PLAY SOLO is a real link for a new tab or a bookmark; a plain click takes the in-place route with the music.
    card
      .querySelector<HTMLAnchorElement>(".solo-cta")!
      .addEventListener("click", (event) => {
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
    const landingDialog = node("dialog", "", "game-dialog");
    landingDialog.setAttribute("aria-label", "Settings");
    const landingBar = node("header", "", "dialog-bar"),
      landingClose = node("button", "✕  CLOSE");
    landingClose.type = "button";
    landingClose.setAttribute("aria-label", "CLOSE");
    landingClose.onclick = () => landingDialog.close();
    const landingActions = node("span", "", "dialog-actions");
    landingActions.append(landingClose);
    landingBar.append(node("strong", "SETTINGS"), landingActions);
    const landingBody = node("div", "", "dialog-body");
    landingDialog.append(landingBar, landingBody);
    landingDialog.addEventListener("click", (event) => {
      if (event.target === landingDialog) {
        const r = landingDialog.getBoundingClientRect();
        if (
          event.clientX < r.left ||
          event.clientX > r.right ||
          event.clientY < r.top ||
          event.clientY > r.bottom
        )
          landingDialog.close();
      }
    });
    // `solo:true` disables the screen-layout fieldset, which is what keeps CREATE ROOM's own `settings.mode=selectedMode` from fighting
    // this dialog over the same stored key: the page's radios remain the only writer of `mode`.
    landingSettings.onclick = () => {
      showRoomSettings(
        landingBody,
        loadRoomSettings(localStorage),
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
    card.querySelector(".landing-top-end")!.append(landingSettings);
    card.append(landingDialog);
    // Optional sign-in and match history. A guest who never opens it never downloads the sign-in SDK.
    const accountPanel = createPlayerAccountPanel();
    card
      .querySelector(".landing-top-end")!
      .append(accountPanel.leaderboardButton, accountPanel.button);
    card.append(accountPanel.dialog);
    window.addEventListener("pagehide", accountPanel.dispose, { once: true });
    void startAttract(
      card.querySelector("canvas")!,
      card.querySelector(".attract-toggle")!,
    )
      .then((stop) => {
        if (ended) stop();
        else cleanup = stop;
      })
      .catch(() => {
        card.querySelector(".landing-live")?.remove();
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
    settings = loadRoomSettings(localStorage),
    snapshot: ViewSnapshot | undefined;
  startAnalytics({ role, mode: settings.mode, solo });
  track("App Opened");
  // Funnel bookkeeping, per page load: a seat is reported once, and a match only where this device saw it begin.
  // The in-memory copy is the real guard: storage can refuse, and a round-over snapshot arrives twenty times a second.
  let seatTracked = false,
    matchStartedAt = 0,
    matchNumber = 0,
    startedMatch = "",
    reportedShots = read(SHOTS_REPORTED_KEY) ?? "";
  const frameTimes: number[] = [];
  const inputTimes: number[] = [];
  let previousFrame = performance.now(),
    inputAt = 0;
  let lastRatedRound = "";
  let lastRecap = "",
    rejoinPending = false;
  const benchmark = url.searchParams.get("benchmark") === "1";
  let benchmarkInput: { seq: number; at: number } | undefined,
    lastBenchmarkRender = 0,
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
  let connectFailed = false;
  // 20s is where connectHint gives up on progress and says "different network": the one drop-off the funnel cannot otherwise see.
  const bootTick = () => {
    const waited = performance.now() - bootAt;
    bootNote.textContent = connectHint(rawStatus, waited);
    if (waited >= 20000 && !connectFailed) {
      connectFailed = true;
      track("Connect Failed", {
        status: rawStatus || null,
        secondsWaiting: Math.round(waited / 1000),
      });
    }
  };
  const bootPoll = setInterval(bootTick, 1000);
  const bootDone = () => {
    if (!bootNote.isConnected) return;
    clearInterval(bootPoll);
    booting.remove();
    bootNote.remove();
    app.classList.remove("booting");
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
  app.classList.toggle("booting", role !== "joiner");
  app.classList.toggle("joining", role === "joiner");
  app.replaceChildren(header, role === "joiner" ? joinPanel : booting);
  let canvas = node("canvas", "", "online-arena");
  let renderScope = code;
  const presentation = mountArenaPresentation(canvas, (replacement) => {
    canvas = replacement;
  });
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
  const showAnnouncement = (state: ViewSnapshot, visible: boolean) => {
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
      announceSmall.textContent = `ROUND ${announcement.round}`;
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
    if (canvas.hidden || reducedMotion()) return;
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
  const sharedLobby = node("section", "", "shared-lobby room-lobby");
  sharedLobby.hidden = true;
  const lobbyCopy = node("div", "", "room-lobby-copy");
  const lobbyHeading = node("h1");
  lobbyHeading.innerHTML = "SCAN.<br>STEER.<br>SURVIVE.";
  lobbyCopy.append(
    node("p", "PHONE PARTY // 2–5 RIDERS", "room-eyebrow"),
    lobbyHeading,
    node(
      "p",
      "Pick your avatar. Grab your phone. Carve neon trails and blow up your friends’ plans.",
      "room-intro",
    ),
    node("p", "STEER  ◀ ▶     HOLD · AIM · RELEASE", "room-howto"),
  );
  const joinLink = new URL(appUrl(`?room=${code}`), location.origin).href;
  const qrCard = node("div", "", "room-qr-card"),
    lobbyQr = node("img");
  lobbyQr.alt = "Scan to join this room";
  // The link lives next to the QR so a rider who cannot scan can still be handed the room: one tap copies it, and the label reports back.
  const linkRow = node("div", "", "room-qr-link"),
    linkText = node("span", joinLink, "room-qr-url"),
    copyLink = node("button", "COPY LINK", "room-qr-copy");
  copyLink.type = "button";
  copyLink.title = "Copy the join link";
  linkRow.append(linkText, copyLink);
  let copyReset = 0;
  copyLink.onclick = async () => {
    const copied = await copyText(joinLink);
    copyLink.textContent = copied ? "COPIED" : "COPY FAILED";
    copyLink.classList.toggle("copied", copied);
    clearTimeout(copyReset);
    copyReset = window.setTimeout(() => {
      copyLink.textContent = "COPY LINK";
      copyLink.classList.remove("copied");
    }, 1600);
  };
  qrCard.append(
    lobbyQr,
    node("p", "SCAN TO JOIN"),
    node("strong", code, "shared-room-code"),
    ...(solo ? [] : [linkRow]),
  );
  qrCard.hidden = solo;
  const lobbyRiders = node("div", "", "room-riders");
  const lobbyEmpty = node(
    "p",
    "Your crew belongs here. Share the code to get started.",
    "room-empty",
  );
  lobbyRiders.append(lobbyEmpty);
  const lobbyFooter = node("footer", "", "room-lobby-footer"),
    lobbyCount = node("span", "Waiting for riders");
  lobbyFooter.append(lobbyCount);
  sharedLobby.append(lobbyCopy, qrCard, lobbyRiders, lobbyFooter);
  const lobbyEntries = new Map<
    string,
    {
      entry: HTMLElement;
      head: HTMLElement;
      name: HTMLElement;
      status: HTMLElement;
      avatar: AvatarId;
    }
  >();
  if (!solo)
    void QRCode.toDataURL(joinLink)
      .then((data) => {
        lobbyQr.src = data;
      })
      .catch(() => {
        lobbyQr.hidden = true;
      });
  const controls = node("div", "", "online-controls");
  const leftButton = node("button", "◀"),
    fireButton = node("button", "HOLD TO FIRE"),
    rightButton = node("button", "▶");
  controls.append(leftButton, fireButton, rightButton);
  controls.addEventListener("selectstart", (event) => event.preventDefault());
  controls.addEventListener("contextmenu", (event) => event.preventDefault());
  for (const [button, key, label] of [
    [leftButton, "ArrowLeft A", "Steer left"],
    [fireButton, "Space", "Hold to charge, release to fire"],
    [rightButton, "ArrowRight D", "Steer right"],
  ] as const) {
    button.setAttribute("aria-keyshortcuts", key);
    button.title = `${label} (${key})`;
  }
  const roster = node("div", "", "online-roster");
  const hostControls = node("div", "", "online-host");
  const start = node("button", "START RACE"),
    reset = node("button", "BACK TO LOBBY"),
    settingsButton = node("button", "ROOM SETTINGS"),
    share = node("button", "TV VIEW"),
    addAI = node("button", "ADD AI");
  hostControls.append(start, reset, settingsButton, share, addAI);
  const rosterEntries = new Map<
    string,
    {
      entry: HTMLElement;
      label: HTMLElement;
      head: HTMLElement;
      avatar: AvatarId;
      remove: HTMLButtonElement;
    }
  >();
  const help = node("button", "?", "desktop-help");
  help.setAttribute("aria-label", "Keyboard controls");
  help.title = "Keyboard controls";
  const avatarButton = node("button", "AVATAR");
  avatarButton.hidden = true;
  header.append(avatarButton, prefsButton, menu, help);
  const dialog = node("dialog", "", "game-dialog");
  dialog.setAttribute("aria-label", "Game menu");
  const close = node("button", "✕  CLOSE");
  close.type = "button";
  close.setAttribute("aria-label", "CLOSE");
  close.onclick = () => dialog.close();
  const rematch = node("button", "REMATCH");
  rematch.type = "button";
  rematch.hidden = true;
  rematch.title = "Play the same match again";
  const dialogActions = node("span", "", "dialog-actions");
  dialogActions.append(rematch, close);
  const dialogBar = node("header", "", "dialog-bar"),
    dialogTitle = node("strong", "GAME MENU");
  dialogBar.append(dialogTitle, dialogActions);
  const dialogBody = node("div", "", "dialog-body");
  dialog.append(dialogBar, dialogBody);
  dialog.addEventListener("close", () => {
    rematch.hidden = true;
    close.textContent = "✕  CLOSE";
    close.setAttribute("aria-label", "CLOSE");
    dialog.classList.remove("recap-dialog");
    dialogTitle.textContent = "GAME MENU";
    dialog.setAttribute("aria-label", "Game menu");
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (
        event.clientX < r.left ||
        event.clientX > r.right ||
        event.clientY < r.top ||
        event.clientY > r.bottom
      )
        dialog.close();
    }
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
  help.onclick = () => {
    dialogTitle.textContent = "SHORTCUTS";
    dialog.setAttribute("aria-label", "Keyboard shortcuts"); // the close handler resets both
    dialogBody.replaceChildren(node("h2", "Keyboard shortcuts"));
    for (const group of keyboardShortcuts({
      mac,
      canConfigure: isHost || solo,
      solo,
    })) {
      const list = node("dl", "", "shortcut-list");
      for (const [keys, action] of group.entries) {
        list.append(node("dt", keys), node("dd", action));
      }
      dialogBody.append(node("h3", group.title, "shortcut-group"), list);
    }
    dialog.showModal();
  };
  // Move the existing actions, keeping their handlers and mobile/lobby destinations intact.
  const desktopQuery = matchMedia(
    "(min-width: 1000px) and (hover: hover) and (pointer: fine)",
  );
  const updateDesktopLayout = () => {
    // Keep the creator's seat invitation beside the riders while the lobby is
    // visible. Outside the lobby it must remain reachable for mid-game joins.
    if (role !== "joiner") {
      const joinParent = sharedLobby.hidden ? app : lobbyRiders;
      if (joinPanel.parentElement !== joinParent) {
        if (joinParent === app) {
          joinForm.element.querySelector("input")!.after(joinForm.submitButton);
          scoreboard.after(joinPanel);
        } else {
          joinForm.element.append(joinForm.submitButton);
          lobbyRiders.prepend(joinPanel);
        }
      }
    }
    const desktop =
      desktopQuery.matches &&
      !app.classList.contains("mobile-play") &&
      !app.classList.contains("controller-only") &&
      !app.classList.contains("joining") &&
      sharedLobby.hidden;
    app.classList.toggle("desktop-game", desktop);
    // Keep the same account control visible beside MENU during full-screen phone play.
    const accountParent = app.classList.contains("mobile-play") ? app : topMenu;
    if (roomAccount.button.parentElement !== accountParent)
      accountParent.append(roomAccount.button);
    // Desktop play keeps the standings in a fixed column right of the arena (its width lives in online.css), so the game bar holds actions only.
    const side =
      desktop &&
      !canvas.hidden &&
      !app.classList.contains("booting") &&
      !app.classList.contains("room-over");
    app.classList.toggle("side-standings", side);
    const rosterParent = side ? app : desktop ? header : scoreboard;
    if (roster.parentElement !== rosterParent) {
      if (side) app.append(roster);
      else if (desktop) header.insertBefore(roster, topMenu);
      else scoreboard.append(roster);
    }
    const actionsParent = !sharedLobby.hidden
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
  window.addEventListener("resize", updateDesktopLayout);
  desktopQuery.addEventListener("change", updateDesktopLayout);

  const openRadio = () => {
    audio.unlock();
    audio.controls.setAttribute("open", "");
    dialogTitle.textContent = "RADIO";
    dialog.setAttribute("aria-label", "Radio");
    dialogBody.replaceChildren(node("h2", "Fuse Riders Radio"), audio.controls);
    if (!dialog.open) dialog.showModal();
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
  prefs.append(
    musicButton,
    effectsButton,
    muteButton,
    radioButton,
    styleHeading,
    styleRow,
    fullscreen,
  );
  const voice = solo ? undefined : new VoiceChat();
  if (voice) {
    prefs.prepend(node("h3", "GAME AUDIO", "settings-group"));
    muteButton.title =
      "Music and effects only; use DEAFEN in voice chat to silence voice.";
    prefs.append(voice.controls);
    topMenu.insertBefore(voice.button, prefsButton);
    voice.button.onclick = () => {
      dialogTitle.textContent = "VOICE CHAT";
      dialog.setAttribute("aria-label", "Voice chat");
      dialogBody.replaceChildren(voice.controls);
      if (!dialog.open) dialog.showModal();
    };
    voice.setChanged(() => {
      for (const [playerId, row] of rosterEntries)
        row.entry.dataset.voice = voice.indicator(playerId);
      for (const [playerId, row] of lobbyEntries)
        row.entry.dataset.voice = voice.indicator(playerId);
    });
  }
  prefsButton.onclick = () => {
    if (voice) prefs.append(voice.controls);
    dialogTitle.textContent = "SETTINGS";
    dialog.setAttribute("aria-label", "Settings");
    dialogBody.replaceChildren(prefs);
    dialog.showModal();
  };
  /** Podium, totals, highlight reel, awards and rider comparison built from the authoritative match statistics and moments. */
  const renderRecap = (
    stats: ReadonlyArray<MatchPlayerStats>,
    moments: ReadonlyArray<Moment>,
  ) => {
    const recap = buildMatchRecap(stats, moments);
    const root = node("section", "", "match-recap-report");
    const heading = node("header", "", "recap-heading"),
      copy = node("div");
    copy.append(node("p", RECAP_KICKER, "kicker"), node("h2", RECAP_TITLE));
    heading.append(copy);
    root.append(heading);
    if (!recap.comparison.length) {
      root.append(node("p", RECAP_EMPTY_MESSAGE, "recap-empty"));
      return root;
    }
    const podium = node("div", "", "recap-podium");
    for (const entry of recap.podium) {
      const card = node(
        "article",
        "",
        `podium-card podium-place-${entry.placement}${entry.playerId === id ? " is-you" : ""}`,
      );
      card.style.setProperty("--player-color", entry.color);
      card.append(
        node("span", entry.placeLabel, "podium-place"),
        node("strong", entry.name),
        node("small", entry.winsLabel),
      );
      podium.append(card);
    }
    const totals = node("div", "", "recap-totals");
    for (const total of recap.totals) {
      const cell = node("div", "", "recap-total");
      cell.append(node("strong", total.value), node("small", total.label));
      totals.append(cell);
    }
    const reel = node("div", "", "recap-highlights");
    reel.append(node("p", HIGHLIGHTS_TITLE, "reel-title"));
    for (const entry of recap.highlights) {
      const card = node("article", "", "award-card highlight-card");
      card.style.setProperty("--player-color", entry.color);
      card.append(
        node("span", entry.icon, "award-icon"),
        node("small", entry.when),
        node("strong", entry.title),
        node("em", entry.copy),
      );
      const clip = replay.recorder.clip(entry.key);
      if (clip && !canvas.hidden) {
        const watch = node("button", "▶ WATCH", "watch-again");
        watch.type = "button";
        watch.title = "Replay this moment";
        watch.onclick = () => {
          audio.unlock();
          reopenRecap = true;
          dialog.close();
          replay.play(clip, performance.now());
        };
        card.append(watch);
      }
      reel.append(card);
    }
    const awards = node("div", "", "recap-awards");
    for (const award of recap.awards) {
      const card = node("article", "", "award-card");
      card.append(
        node("span", award.icon, "award-icon"),
        node("small", award.title),
        node("strong", award.winnerText),
        node("em", award.detail),
      );
      awards.append(card);
    }
    const comparison = node("div", "", "recap-comparison");
    comparison.append(node("p", COMPARISON_KEY, "comparison-key"));
    const columns = node("div", "", "comparison-row comparison-header");
    for (const label of [
      "RIDER",
      ...COMPARISON_COLUMNS.map((column) => column.label),
    ])
      columns.append(node("span", label));
    comparison.append(columns);
    for (const entry of recap.comparison) {
      const row = node(
        "div",
        "",
        `comparison-row${entry.playerId === id ? " is-you" : ""}`,
      );
      row.style.setProperty("--player-color", entry.color);
      const rider = node("span", "", "comparison-rider"),
        riderCopy = node("span");
      riderCopy.append(
        node("b", entry.riderLabel),
        node("small", entry.riderNote),
      );
      rider.append(node("i"), riderCopy);
      row.append(rider);
      for (const column of COMPARISON_COLUMNS)
        row.append(
          node(
            column.key === "wins" ? "strong" : "span",
            entry[column.key],
            column.key === "pickups"
              ? "pickup-counts"
              : column.key === "deaths"
                ? "death-counts"
                : "",
          ),
        );
      comparison.append(row);
    }
    root.append(podium, totals);
    if (recap.highlights.length) root.append(reel);
    if (recap.awards.length) root.append(awards);
    root.append(comparison);
    return root;
  };
  const openRecap = () => {
    if (!snapshot) return;
    dialogBody.replaceChildren(
      renderRecap(snapshot.matchStats, snapshot.moments),
    );
    dialogTitle.textContent = "MATCH RESULTS";
    dialog.setAttribute("aria-label", "Match results");
    dialog.classList.add("recap-dialog");
    rematch.hidden = !isHost;
    dialog.showModal();
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
      const plain = plainStatus(text);
      status.textContent = plain.text;
      status.title = text;
      status.dataset.raw = text;
      status.dataset.tone = plain.tone;
      // A replaced host tab cannot act on the room any more: its actions go away and one button reclaims hosting (a reload re-authenticates with the stored token).
      const replaced = /replaced/i.test(text);
      statusAction.hidden = !(plain.retry || replaced);
      statusAction.textContent = replaced ? "TAKE OVER HOSTING" : "RETRY";
      if (replaced) {
        replacedHost = true;
        hostControls.hidden = true;
        announceAction.hidden = true;
      }
      if (bootNote.isConnected) bootTick();
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
      app.classList.add("room-over");
      app.classList.remove("controller-only");
      if (canvas.isConnected) canvas.after(overCard);
      else app.append(overCard);
      mobileLayout.update({
        joined,
        phase: snapshot?.phase ?? "lobby",
        displayOnly,
        host: isHost,
        ended: true,
      });
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
      const startKey = matchStartKey(state.matchId, state.phase, state.round);
      if (startKey && startedMatch !== startKey) {
        startedMatch = startKey;
        matchStartedAt = Date.now();
        matchNumber += 1;
        track("Match Started", {
          matchNumber,
          playerCount: state.players.length,
          botCount: state.players.filter((p) => p.id.startsWith(BOT_ID_PREFIX))
            .length,
          mode: rules.mode,
          match: rules.match,
          matchLength: rules.length,
          powerupTypes: Object.values(rules.weights ?? {}).filter(
            (weight) => weight > 0,
          ).length,
          host: isHost,
        });
      }
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
      const shotReport = decidedRoundReport(
        state.decidedRound,
        id,
        runtime.confirmedTick(),
        reportedShots,
        {
          riders: state.players.length,
          bots: state.players.filter((p) => p.id.startsWith(BOT_ID_PREFIX))
            .length,
        },
      );
      if (shotReport) {
        reportedShots = shotReport.key;
        save(SHOTS_REPORTED_KEY, shotReport.key);
        for (const shot of shotReport.events)
          track(shot.event, shot.properties);
      }
      const matchId = state.matchId;
      snapshot = state;
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
      const recapReady =
        state.phase === "matchOver" &&
        state.tick >= (state.phaseEndsAtTick ?? 0);
      results.hidden = !recapReady;
      if (state.phase === "lobby") lastRecap = "";
      joined = Boolean(player);
      if (player && !seatTracked) {
        seatTracked = true;
        track("Seat Taken", {
          avatarId: player.avatarId,
          playerCount: state.players.length,
        });
      }
      const joining = role === "joiner" && !joined;
      app.classList.toggle("joining", joining);
      mobileLayout.update({
        joined,
        phase: state.phase,
        displayOnly,
        host: isHost,
        recapReady,
      });
      joinPanel.hidden = joined || displayOnly;
      /* Avatars are a lobby choice: before a seat the join form carries it, the button leaves with the lobby, and a picker left open closes when the round starts. */ avatarButton.hidden =
        !joined || state.phase !== "lobby";
      if (
        avatarButton.hidden &&
        dialog.open &&
        dialogBody.querySelector(".avatar-option")
      )
        dialog.close();
      controls.hidden = !joined || displayOnly;
      // A rider the room still lists as offline (page reload mid-round) reconnects by itself; anyone absent goes through the join card.
      if (player && !player.connected && !displayOnly) {
        if (!rejoinPending) {
          rejoinPending = true;
          runtime.command({
            type: "join",
            name: player.name,
            avatarId: player.avatarId,
          });
        }
      } else rejoinPending = false;
      // A phone in the lobby always gets the lobby card (#134); elsewhere solo and a joined shared-TV phone have none.
      // Once the recap is ready the room is back in the same lobby it started from: closing the results lands on QR, riders and REMATCH / BACK TO LOBBY.
      // Solo and a joined shared-screen rider have no lobby card (their pre-start screen is the arena or the controller), so their button stays CLOSE.
      const phoneLobby = mobileLayout.lobby();
      sharedLobby.hidden =
        !(state.phase === "lobby" || recapReady) ||
        joining ||
        (!phoneLobby &&
          (solo ||
            (settings.mode === "shared" && joined && !displayOnly) ||
            mobileLayout.active()));
      app.classList.toggle("room-waiting", !sharedLobby.hidden);
      const readyCount = state.players.filter((p) => p.connected).length;
      lobbyCount.textContent =
        readyCount < 2
          ? `${readyCount === 1 ? "1 rider ready · " : ""}Waiting for at least 2 riders`
          : `${readyCount} riders ready`;
      lobbyEmpty.hidden = state.players.length > 0;
      for (const [playerId, row] of lobbyEntries)
        if (!state.players.some((p) => p.id === playerId)) {
          row.entry.remove();
          lobbyEntries.delete(playerId);
        }
      for (const p of state.players) {
        let row = lobbyEntries.get(p.id);
        if (!row) {
          const entry = node("div", "", "room-rider"),
            head = createAvatarPortrait(p.avatarId),
            name = node("strong"),
            status = node("small"),
            info = node("div");
          info.append(name, status);
          entry.append(head, info);
          row = { entry, head, name, status, avatar: p.avatarId };
          lobbyEntries.set(p.id, row);
          lobbyRiders.append(entry);
        }
        if (row.avatar !== p.avatarId) {
          const head = createAvatarPortrait(p.avatarId);
          row.head.replaceWith(head);
          row.head = head;
          row.avatar = p.avatarId;
        }
        row.entry.style.setProperty("--rider-color", p.color);
        if (row.name.textContent !== p.name) row.name.textContent = p.name;
        row.status.textContent = p.connected ? "READY" : "OFFLINE";
      }
      roster.hidden = !sharedLobby.hidden;
      const controllerOnly =
        settings.mode === "shared" && !displayOnly && joined && !phoneLobby;
      app.classList.toggle("controller-only", controllerOnly);
      canvas.hidden = !sharedLobby.hidden || controllerOnly || joining;
      if (!canvas.hidden)
        replay.observe(state, state.matchId, performance.now());
      styleHeading.hidden = styleRow.hidden = controllerOnly;
      /* A shared-TV rider's phone never draws an arena. */ updateDesktopLayout();
      if (
        state.phase === "countdown" &&
        joined &&
        !keyHintShown &&
        app.classList.contains("desktop-game")
      ) {
        keyHintShown = true;
        keyHint.hidden = false;
      }
      // Opened after the layout above so the close button can say where it lands.
      if (recapReady && lastRecap !== String(state.phaseEndsAtTick)) {
        lastRecap = String(state.phaseEndsAtTick);
        openRecap();
        // Only this match's own start time is a duration: a device that saw match 1 begin and missed match 2's
        // start would otherwise report match 1's clock as match 2's length, which is worse than reporting none.
        const sawStart =
          startedMatch === matchStartKey(matchId, "countdown", 1);
        track("Match Ended", {
          ...matchEndedProps(state.matchStats, id),
          ...(sawStart && matchStartedAt
            ? {
                durationSeconds: Math.round(
                  (Date.now() - matchStartedAt) / 1000,
                ),
              }
            : {}),
        });
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
      powerStatus.hidden =
        !player ||
        displayOnly ||
        !["playing", "countdown"].includes(state.phase);
      powerStatus.textContent = player
        ? powerLabel(player.powerPickups, player.extraBombs, player.grip)
        : "";
      if (player) {
        app.style.setProperty("--player-color", player.color);
        const remaining = Math.max(0, player.bombReadyAtTick - state.tick);
        fireButton.textContent = remaining
          ? `${Math.ceil(remaining / 20)}s RECHARGE`
          : player.gunArmed
            ? "TAP TO FIRE GUN"
            : player.shellArmed
              ? "FIRE SHELL"
              : inputState.isHeld("bomb")
                ? "RELEASE!"
                : "HOLD TO FIRE";
      }
      notice.textContent =
        state.phase === "lobby"
          ? joined && !isHost
            ? "Waiting for the host to start"
            : "Join your friends, then start the race"
          : state.phase === "countdown"
            ? `READY · ${Math.max(0, Math.ceil(((state.phaseEndsAtTick ?? state.tick) - state.tick) / 20))}`
            : state.phase === "roundOver"
              ? state.roundWinnerId === id
                ? "You win this round"
                : `${state.players.find((p) => p.id === state.roundWinnerId)?.name ?? "Nobody"} wins this round`
              : state.phase === "matchOver"
                ? `${state.matchStats.find((p) => p.playerId === state.matchWinnerId)?.name ?? "Shared victory"} · MATCH COMPLETE`
                : player?.waitingForNextRound
                  ? "You’re in — joining next round"
                  : !player?.alive && joined
                    ? "Eliminated — next round soon"
                    : "";
      for (const [playerId, row] of rosterEntries)
        if (!state.players.some((p) => p.id === playerId)) {
          row.entry.remove();
          rosterEntries.delete(playerId);
        }
      // Standings: cards are ordered by match score (this round's points break ties) with CSS `order`, so the DOM and its handlers stay put. The leader is marked once somebody has scored.
      const ranked = [...state.players].sort(
          (a, b) =>
            b.matchScoreUnits - a.matchScoreUnits ||
            b.roundScoreUnits - a.roundScoreUnits,
        ),
        topScore = ranked[0]?.matchScoreUnits ?? 0;
      for (const p of state.players) {
        let row = rosterEntries.get(p.id);
        if (!row) {
          const entry = node("span", "", "online-score-card"),
            label = node("span"),
            head = createAvatarPortrait(p.avatarId),
            remove = node("button", "×");
          entry.append(head, label, remove);
          remove.onclick = () =>
            runtime.command({ type: "bot", action: "remove", id: p.id });
          row = { entry, label, head, avatar: p.avatarId, remove };
          rosterEntries.set(p.id, row);
          roster.append(entry);
        }
        const name = `${p.name}${p.waitingForNextRound ? " · next round" : p.connected ? "" : " · offline"}`,
          points = `${p.matchScoreUnits / 60} PTS · +${p.roundScoreUnits / 60}`;
        if (row.label.textContent !== `${name}${points}`) {
          row.label.className = "online-score-label";
          row.label.replaceChildren(
            node("span", name, "online-score-name"),
            node("span", points, "online-score-points"),
          );
        }
        row.label.title = `${p.name} · ${p.matchScoreUnits / 60} PTS · +${p.roundScoreUnits / 60} this round`;
        row.label.setAttribute("aria-label", row.label.title);
        row.entry.style.color = p.color;
        row.entry.style.setProperty("--rider-color", p.color);
        row.entry.classList.toggle(
          "out",
          !p.alive && !["lobby", "countdown"].includes(state.phase),
        );
        const rank = ranked.indexOf(p) + 1;
        row.entry.style.order = String(rank);
        row.entry.dataset.rank = String(rank);
        row.entry.classList.toggle(
          "leader",
          topScore > 0 && p.matchScoreUnits === topScore,
        );
        row.entry.style.setProperty(
          "--lead",
          topScore > 0 ? String(p.matchScoreUnits / topScore) : "0",
        );
        if (row.avatar !== p.avatarId) {
          const head = createAvatarPortrait(p.avatarId);
          row.head.replaceWith(head);
          row.head = head;
          row.avatar = p.avatarId;
        }
        const removeParent = sharedLobby.hidden
          ? row.entry
          : lobbyEntries.get(p.id)!.entry;
        if (row.remove.parentElement !== removeParent)
          removeParent.append(row.remove);
        row.remove.hidden = !isHost || !p.id.startsWith(BOT_ID_PREFIX);
        row.remove.disabled = !["lobby", "roundOver", "matchOver"].includes(
          state.phase,
        );
        row.remove.setAttribute("aria-label", `Remove ${p.name}`);
        row.remove.title = row.remove.disabled
          ? "Remove AI between rounds or return to menu"
          : "Remove AI rider";
      }
      addAI.disabled = state.players.length >= 5;
      const startLabel = state.phase === "matchOver" ? "REMATCH" : "START RACE";
      if (start.textContent !== startLabel) start.textContent = startLabel;
      start.disabled =
        state.players.filter((p) => p.connected).length < 2 ||
        !["lobby", "matchOver"].includes(state.phase);
      hostControls.hidden = !isHost || replacedHost;
      reset.disabled = state.phase === "lobby";
      reset.hidden = phoneLobby;
      share.hidden = solo || phoneLobby; // BACK TO LOBBY means nothing in the lobby and a phone is never the TV; the phone screen has no room for dead buttons. Solo has no room to show either.
      voice?.setRoster(id, state.players);
      for (const [playerId, row] of rosterEntries)
        if (voice) row.entry.dataset.voice = voice.indicator(playerId);
      for (const [playerId, row] of lobbyEntries)
        if (voice) row.entry.dataset.voice = voice.indicator(playerId);
      const clock = roundClock(state);
      roundChip.textContent = clock;
      roundChip.hidden = !clock || !sharedLobby.hidden;
      showAnnouncement(state, sharedLobby.hidden && !joining);
      // Phone HUD: who you are, what the fire button would do, match points and the clock. The thirds themselves stay transparent.
      hud.hidden = !player || !mobileLayout.active();
      if (player) {
        if (hudAvatar !== player.avatarId) {
          hudWho.replaceChildren(
            createAvatarPortrait(player.avatarId),
            node("b", "YOU"),
          );
          hudAvatar = player.avatarId;
        }
        hudFire.textContent =
          state.phase === "playing" && player.alive
            ? (fireButton.textContent ?? "")
            : player.alive || state.phase !== "playing"
              ? ""
              : "WIPED OUT";
        hudWins.textContent = `${player.matchScoreUnits / 60} PTS · +${player.roundScoreUnits / 60}`;
        hudRound.textContent = clock;
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
              maxFastBytes: MAX_PACKET_BYTES,
              copy: TRANSPORT_COPY,
            }),
          displayOnly,
        },
  );
  start.onclick = () => {
    void audio.unlock();
    runtime.command({
      type: "action",
      action: snapshot?.phase === "matchOver" ? "rematch" : "start",
    });
  };
  announceAction.onclick = () => start.click();
  addAI.onclick = () => runtime.command({ type: "bot", action: "add" });
  // Link quality for the player: hidden unless asked for (?stats=1 or the menu), so a bad Wi-Fi is a fact, not a guess.
  const statsPanel = node("pre", "", "net-stats");
  statsPanel.hidden = solo || !url.searchParams.has("stats");
  app.append(statsPanel);
  reset.onclick = () => runtime.command({ type: "action", action: "lobby" });
  rematch.onclick = () => {
    dialog.close();
    start.click();
  };
  menu.onclick = () => {
    dialogTitle.textContent = solo ? "EXIT" : "ROOM";
    dialog.setAttribute("aria-label", solo ? "Exit" : "Room");
    dialogBody.replaceChildren(
      node(
        "p",
        solo
          ? "End this solo run and go back to the menu?"
          : isHost
            ? "End this room for everyone?"
            : "Leave this room?",
      ),
    );
    const leave = node(
        "button",
        solo ? "END RUN" : isHost ? "END ROOM" : "LEAVE ROOM",
        "exit-confirm",
      ),
      stay = node("button", solo ? "KEEP PLAYING" : "STAY"),
      choices = node("div", "", "exit-choices");
    stay.onclick = () => dialog.close();
    choices.append(stay, leave);
    leave.onclick = async () => {
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
    dialogBody.append(choices);
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
      dialogBody.append(list);
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
      dialogBody.append(
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
    dialog.showModal();
  };
  avatarButton.onclick = () => {
    dialogTitle.textContent = "AVATAR";
    dialog.setAttribute("aria-label", "Avatar");
    dialogBody.replaceChildren(node("h2", "Your avatar"));
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
    dialogBody.append(picker.element);
    dialog.showModal();
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
  const mobileLayout = installMobilePlayLayout(app, clearControls);
  mobileLayout.update({ joined: false, phase: "lobby", displayOnly }); // A phone booting a room is already on the lobby screen (#134): the header takes its lobby shape before the first snapshot.
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
      } catch {}
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
  function replayFrame(
    now: number,
    predicted: ViewSnapshot | undefined,
  ): boolean {
    const update = replay.frame(now);
    if (!update) return false;
    // The arena left the screen under a replay (MAIN MENU, a controller-only seat): take the dressing down and forget the clip.
    if (canvas.hidden) {
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
    const predicted = runtime.view();
    if (replayFrame(now, predicted)) {
      requestAnimationFrame(frame);
      return;
    }
    if (
      predicted &&
      (!canvas.hidden || (!sharedLobby.hidden && !canvas.dataset.renderer))
    ) {
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
