/**
 * The landing page: what an online page shows before any room exists (#255 P1). CREATE ROOM, JOIN ROOM, REJOIN,
 * PLAY SOLO, SETTINGS and the account panel all live here. The room itself is `ui.ts`'s: the landing page talks to
 * it through `LandingHost`, and leaving for a room keeps the document (and so the music) alive.
 */
import { createRoom } from "fuse-network-fe";
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
import { createAnalyticsSetting } from "./analytics-setting.js";
import { startAnalytics, track } from "./analytics.js";
import { startAttract } from "./attract.js";
import { createDialogShell } from "./dialogs/shell.js";
import { node } from "./dom.js";
import { apiUrl, appUrl } from "./endpoints.js";
import {
  hostTokenKey,
  joinQuery,
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
  accountPanel: () => {
    button: HTMLElement;
    leaderboardButton: HTMLElement;
    dialog: HTMLDialogElement;
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
  card.innerHTML = `<canvas class="landing-arena" aria-hidden="true"></canvas><div class="landing-shade"></div>
      <header class="landing-top"><a class="landing-brand" href="${appUrl()}">FUSE<span>RIDERS</span></a><div class="landing-top-end game-top-menu"><span class="landing-tag">TINY RIDERS. BIG TROUBLE.</span><button class="landing-audio" type="button">♫ MUSIC ON</button><button class="landing-mute" type="button">🔊 SOUND ON</button></div></header>
      <section class="landing-content"><p class="landing-eyebrow"><span></span> A NEON ARENA PARTY GAME</p>
      <h1>LEAVE A TRAIL.<br>MAKE A <em>MESS.</em></h1>
      <p class="landing-intro">Outrun your friends. Blow up their plans.<br>One arena. Five riders. Absolutely no brakes.</p>
      <a class="solo-cta" href="${appUrl(SOLO_QUERY)}"><span>▶ &nbsp; PLAY SOLO</span><small>YOU VS. FOUR AI RIVALS</small></a>
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
  let selectedMode = loadRoomSettings(storage).mode;
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
      save(hostTokenKey(body.code), body.token);
      const settings = loadRoomSettings(storage);
      settings.mode = selectedMode;
      save(SETTINGS_KEY, JSON.stringify(settings));
      track("Room Created", { mode: selectedMode });
      enter(roomQuery(body.code));
    } catch (e) {
      error.textContent = String(e);
      create.disabled = false;
    }
  };
  join.onclick = () => {
    const target = joinQuery(input.value);
    if ("query" in target) enter(target.query);
    else error.textContent = target.error;
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
  const lastRoom = rejoinCode(storage.getItem(LAST_ROOM_KEY));
  if (lastRoom) {
    const rejoin = node("button", `REJOIN ${lastRoom}`, "landing-rejoin");
    rejoin.title = "Return to the room you were in last";
    rejoin.onclick = () => {
      location.href = appUrl(roomQuery(lastRoom));
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
  landingAudio.bindMusicToggle(
    card.querySelector<HTMLButtonElement>(".landing-audio")!,
  );
  landingAudio.bindMuteToggle(
    card.querySelector<HTMLButtonElement>(".landing-mute")!,
  );
  card.querySelector(".landing-audio")!.before(landingAudio.controls);
  host.setRadioToggle(() => landingAudio.controls.toggleAttribute("open"));
  // PLAY SOLO is a real link for a new tab or a bookmark; a plain click takes the in-place route with the music.
  card
    .querySelector<HTMLAnchorElement>(".solo-cta")!
    .addEventListener("click", (event) => {
      if (!plainClick(event)) return;
      event.preventDefault();
      enter(SOLO_QUERY);
    });
  // Settings before a game exists (#168): the same room settings CREATE ROOM and PLAY SOLO read from storage. The screen layout
  // stays disabled here because the radio buttons below choose it for the room being created.
  const landingSettings = node("button", "SETTINGS", "landing-settings");
  landingSettings.type = "button";
  const { dialog: landingDialog, body: landingBody } = createDialogShell({
    title: "SETTINGS",
    label: "Settings",
    closeClass: "",
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
      () => landingDialog.close(),
    );
    landingDialog.showModal();
  };
  card.querySelector(".landing-top-end")!.append(landingSettings);
  card.append(landingDialog);
  // Optional sign-in and match history. A guest who never opens it never downloads the sign-in SDK.
  const accountPanel = host.accountPanel();
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
}
