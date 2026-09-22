/**
 * The landing page: what an online page shows before any room exists (#255 P1). CREATE ROOM, JOIN ROOM, REJOIN,
 * PLAY SOLO, SETTINGS, MORE GAMES and the account panel all live here. The room itself is `ui.ts`'s: the landing
 * page talks to it through `LandingHost`, and leaving for a room keeps the document (and so the music) alive.
 */
import {
  button,
  createDialog,
  createJoinByCode,
  createRadioGroup,
} from "fuse-ui";
import { createRoom, validRoomCode } from "fuse-network-fe";
import type { GameAudio } from "../client/game-audio.js";
import { POWERUP_GUIDE } from "../client/powerup-guide.js";
import { createPowerupGuide } from "../client/powerup-guide-view.js";
import type { SafeStorage } from "../client/safe-storage.js";
import { selectedTheme } from "../client/theme-choice.js";
import {
  loadRoomSettings,
  parseRoomSettings,
  SETTINGS_KEY,
} from "../engine/room-settings.js";
import { GAME_ID } from "../shared/game-id.js";
import { createAnalyticsSetting } from "./analytics-setting.js";
import { startAnalytics, track } from "./analytics.js";
import { startAttract } from "./attract.js";
import { FUSE_DIALOG_CLASSES } from "./dialogs/shell.js";
import { node } from "./dom.js";
import { apiUrl, appUrl } from "./endpoints.js";
import {
  hostTokenKey,
  LAST_ROOM_KEY,
  plainClick,
  rejoinCode,
  roomQuery,
  SOLO_QUERY,
} from "./landing-route.js";
import { PICKUP_LABELS } from "./pickup-labels.js";
import { showRoomSettings } from "./room-settings-menu.js";

/** What the landing page needs from the page around it. */
export interface LandingHost {
  app: HTMLElement;
  storage: SafeStorage;
  /** The document's one radio: the landing page's music is background music its toggles own outright. */
  audio: GameAudio;
  /** Where Ctrl+A goes while the landing page is up. */
  setRadioToggle: (toggle: () => void) => void;
  /** Sign-in, match history and the leaderboard (`createAccountPanel` with the page's endpoints). */
  accountPanel: (friendButton: (publicId: string) => HTMLElement) => {
    button: HTMLElement;
    matchesButton: HTMLElement;
    leaderboardButton: HTMLElement;
    dialog: HTMLDialogElement;
    dispose: () => void;
  };
  /** Friends, presence and invites (`createFriendsPanel`); `join` opens an invited room in this document. */
  friendsPanel: (join: (code: string) => void) => {
    button: HTMLElement;
    dialog: HTMLDialogElement;
    banner: HTMLElement;
    friendButton: (publicId: string) => HTMLElement;
    dispose: () => void;
  };
  /** Starts the room the URL now names, in this document. */
  startRoom: () => void;
}

export function showLanding(host: LandingHost): void {
  const { app, storage } = host;
  const save = (key: string, value: string) => storage.setItem(key, value);
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
  headline.append("LEAVE A TRAIL.", node("br"), "MAKE A ", node("em", "MESS."));
  const intro = node("p", "", "landing-intro");
  intro.append(
    "Outrun your friends. Blow up their plans.",
    node("br"),
    "One arena. Five riders. Absolutely no brakes.",
  );
  const soloLink = link(
    appUrl(SOLO_QUERY),
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
      save(hostTokenKey(body.code), body.token);
      const settings = loadRoomSettings(storage);
      settings.mode = chosenMode();
      save(SETTINGS_KEY, JSON.stringify(settings));
      track("Room Created", { mode: settings.mode });
      enter(roomQuery(body.code));
    } catch (e) {
      error.textContent = String(e);
      create.disabled = false;
    }
  };
  error.setAttribute("role", "alert");
  const createRow = node("div", "", "landing-create");
  createRow.append(mode, create);
  // The last room this browser was in is one tap away; a closed room still lands on its ROOM CLOSED card, which forgets it.
  const lastRoom = rejoinCode(storage.getItem(LAST_ROOM_KEY));
  const { row: joinRow } = createJoinByCode({
    valid: validRoomCode,
    onJoin: (value) => enter(roomQuery(value)),
    onInvalid: (message) => {
      error.textContent = message;
    },
    ...(lastRoom
      ? {
          rejoin: {
            code: lastRoom,
            title: "Return to the room you were in last",
            onRejoin: (room: string) => {
              location.href = appUrl(roomQuery(room));
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
    friendsPanel.dispose();
    window.addEventListener("popstate", () => location.reload(), {
      once: true,
    });
    history.pushState(null, "", appUrl(query));
    host.startRoom();
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
  const landingAudio = host.audio;
  landingAudio.bindMusicToggle(musicButton);
  landingAudio.bindMuteToggle(muteButton);
  musicButton.before(landingAudio.controls);
  host.setRadioToggle(() => landingAudio.controls.toggleAttribute("open"));
  // PLAY SOLO is a real link for a new tab or a bookmark; a plain click takes the in-place route with the music.
  soloLink.addEventListener("click", (event) => {
    if (!plainClick(event)) return;
    event.preventDefault();
    enter(SOLO_QUERY);
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
      PICKUP_LABELS,
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
    );
    landingDialog.showModal();
  };
  topEnd.append(landingSettings);
  card.append(landingDialog);
  // Optional sign-in and match history. A guest who never opens it never downloads the sign-in SDK.
  const friendsPanel = host.friendsPanel((code) => enter(roomQuery(code)));
  const accountPanel = host.accountPanel(friendsPanel.friendButton);
  topEnd.append(
    accountPanel.matchesButton,
    accountPanel.leaderboardButton,
    friendsPanel.button,
    accountPanel.button,
  );
  friendsPanel.banner.classList.add("friends-invite-banner");
  card.append(accountPanel.dialog, friendsPanel.dialog);
  app.append(friendsPanel.banner);
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
}
