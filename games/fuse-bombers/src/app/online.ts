import "fuse-ui/components.css";
import "./online.css";
import QRCode from "qrcode";
import * as net from "fuse-network-fe";
import { MAX_PACKET_BYTES } from "fuse-netcode";
import * as ui from "fuse-ui";
import type Phaser from "phaser";
import { BOT_DIFFICULTIES as LEVELS } from "../engine/index.js";
import { DEFAULT_SETTINGS, MAX_WINS, bombersGame } from "../online/game.js";
import { seatName } from "../online/names.js";
import { BombersRuntime, type BombersCallbacks } from "../online/runtime.js";
import { css } from "../render/palette.js";
import { RoundScene, type PlayerLook } from "../render/round-scene.js";
import type { GameAudio } from "./audio/index.js";
import { createBrowserInput, type DeviceId } from "./input/index.js";
import { controllerPadLayout } from "./input/touch.js";
import { OnlineSource } from "./online-source.js";
import {
  buzz,
  present,
  trouble,
  type Model,
  type Viewer,
} from "./presenter.js";
import { keys, type Session, type Store } from "./session.js";

/**
 * The online pages' glue: the landing card, and a room (created, joined by code, or solo against bots) built from
 * fuse-ui, with `BombersRuntime` wired to the transport, the local input layer and the round scene. What shows is the
 * presenter's decision.
 */
const { el, button } = ui;
const GAME = bombersGame.id;
const endpoints = net.createEndpoints(
  {
    basePath: `${import.meta.env.BASE_URL}${GAME}/`,
    apiOrigin: import.meta.env.VITE_API_ORIGIN,
  },
  location.origin,
);
const names = keys(GAME);
const flags = new URLSearchParams(location.search),
  muted = flags.has("mute");
/** A page of this game, keeping `?mute`. */
const link = (query = "") =>
  endpoints.appUrl(
    muted ? `?${query}${query && "&"}mute` : query && `?${query}`,
  );
const go = (query = "") => location.assign(link(query));
const after = <T>(list: readonly T[], item: T) =>
  list[(list.indexOf(item) + 1) % list.length]!;
/** What CREATE ROOM says while the room service does not host this game yet (production, before launch). */
const CLOSED = "Online rooms are not open yet: play solo or at this screen";

/** The page under a bar with the app portal and the brand; returns the bar. */
function page(...parts: HTMLElement[]): HTMLElement {
  const root = el("div", "", "fui-app fb-online"),
    bar = el("header", "", "fb-bar"),
    brand = el("a", "FUSE BOMBERS");
  brand.href = link();
  const portal = ui.createAppPortal({
    document,
    current: GAME,
    base: import.meta.env.BASE_URL,
    search: location.search,
  });
  bar.append(portal.element, brand);
  root.append(bar, ...parts);
  document.body.append(root);
  return bar;
}

/** The first screen: create or join a room, play against bots, or everyone at this screen (the local lobby). */
export function showLanding(store: Store, error = ""): void {
  const card = ui.createLandingCard({
    title: "FUSE BOMBERS",
    tagline:
      "Fly a gunship round a floating temple and fire as the launcher turns: online, against bots, or everyone at one screen.",
    soloText: "SOLO VS BOTS",
    async onCreate() {
      const room = await net
        .createRoom(endpoints.apiUrl, fetch, GAME)
        .catch((failure: Error) => {
          throw /unknown game/i.test(failure.message)
            ? new Error(CLOSED)
            : failure;
        });
      store.setItem(names.host(room.code), room.token);
      go(`room=${room.code}`);
    },
    onSolo: () => go("solo=1"),
    valid: net.validRoomCode,
    onJoin: (code) => go(`room=${code}`),
  });
  const local = button("EVERYONE AT THIS SCREEN");
  local.onclick = () => go("local");
  card.solo?.after(local);
  // A room made with this ticked shows the arena on a TV (OPEN TV SCREEN) and every seated phone is a controller.
  const shared = el("label", "", "fb-shared"),
    toggle = el("input");
  toggle.type = "checkbox";
  toggle.checked = store.getItem(names.shared) === "1";
  toggle.onchange = () =>
    store.setItem(names.shared, toggle.checked ? "1" : "0");
  shared.append(toggle, el("span", "Shared TV: phones are the controllers"));
  card.create.after(shared);
  card.error.textContent = error;
  page(card.element);
}

/** A room, as its creator, a joiner or the shared TV, or a match against bots (`solo`), drawn by `game`'s round scene;
 * on a shared TV a seated device is a controller instead. */
export function showRoom(
  session: Extract<Session, { kind: "room" | "solo" }>,
  { store, audio, game }: { store: Store; audio: GameAudio; game: Phaser.Game },
): void {
  const solo = session.kind === "solo",
    code = solo ? "SOLO" : session.code;
  const input = createBrowserInput(window, { forceTouch: flags.has("touch") });
  const touch = input.touchEnabled,
    display = !solo && session.role === "display";
  document.body.classList.toggle("fb-display", display);
  const viewer: Viewer = {
    me: "",
    host: solo,
    hostPresent: true,
    touch,
    display,
  };
  let settings = DEFAULT_SETTINGS,
    dead = false;

  const status = ui.createNotice({ className: "fui-notice fb-status" }),
    leave = button(solo ? "EXIT" : "LEAVE"),
    card = el("section", "", "fb-card"),
    cardTitle = el("h2", "CONNECTING", "fui-lobby-title"),
    cardText = el("p", "Connecting to the room…"),
    back = button("BACK", "fui-button-primary");
  leave.onclick = back.onclick = () => {
    runtime.stop();
    go();
  };
  card.append(cardTitle, cardText, back);
  const nameEntry = ui.createNameEntry({
    normalize: (raw) => seatName(raw) ?? "",
    initial: store.getItem(names.name) ?? "",
    onInput: (value) => store.setItem(names.name, value),
    buttonText: "JOIN",
    onSubmit: (name) => runtime.command({ type: "join", name }),
  });
  // The host cycles the settings as in the local lobby: rounds to win 1–9; bots easy, normal, hard.
  const lobby = el("section", "", "fb-lobby"),
    pilots = el("div"),
    match = el("div"),
    roster = ui.createRoster({ emptyText: "No pilots yet" }),
    addBot = button("+ ADD BOT"),
    start = button("START", "fui-button-primary"),
    note = el("p", "", "fui-lobby-note"),
    wins = button(""),
    level = button(""),
    set = (change: Partial<typeof settings>) =>
      runtime.command({
        type: "settings",
        settings: { ...settings, ...change },
      });
  addBot.onclick = () => runtime.command({ type: "bot", action: "add" });
  start.onclick = () => runtime.command({ type: "action", action: "start" });
  wins.onclick = () => set({ wins: (settings.wins % MAX_WINS) + 1 });
  level.onclick = () => set({ difficulty: after(LEVELS, settings.difficulty) });
  match.append(el("h2", "MATCH", "fui-lobby-title"), wins, level, start);
  match.hidden = display;
  const tv = button("OPEN TV SCREEN", "fui-button-primary");
  tv.onclick = () => window.open(link(`room=${code}&display=1`), "_blank");
  if (!solo)
    pilots.append(
      ui.createInviteCard({
        code,
        link: endpoints.appUrl(`?room=${code}`),
        qr: (text) => QRCode.toDataURL(text, { margin: 1, width: 360 }),
      }).element,
      tv,
    );
  pilots.append(el("h2", "PILOTS", "fui-lobby-title"), roster.element, addBot);
  lobby.append(pilots, match);
  // A phone's controller for the shared TV: who it flies, hull and launcher, the round's word; the pads are the input
  // layer's, laid out big (`controllerPadLayout`).
  const pad = el("section", "", "fb-pad"),
    padName = el("b"),
    padTag = el("small"),
    padWins = el("span"),
    padHull = el("i"),
    padReload = el("i"),
    padState = el("p", "", "fb-pad-state"),
    padLine = el("p", "", "fb-pad-line"),
    padActions = el("div", "", "fb-pad-actions"),
    rematch = button("REMATCH", "fui-button-primary"),
    toLobby = button("BACK TO LOBBY"),
    head = el("header"),
    meters = el("div", "", "fb-pad-meters");
  rematch.onclick = () =>
    runtime.command({ type: "action", action: "rematch" });
  toLobby.onclick = () => runtime.command({ type: "action", action: "lobby" });
  head.append(padName, padTag, padWins);
  meters.append(el("span", "HULL"), padHull, el("span", "LAUNCHER"), padReload);
  padActions.append(rematch, toLobby);
  pad.append(head, meters, padState, padLine, padActions);
  if (!touch) pad.append(el("p", "WASD TO FLY · SPACE TO FIRE"));
  pad.hidden = true;
  const bar = page(card, nameEntry.form, note, lobby, pad);
  bar.append(el("strong", code), status.element, leave);
  const root = bar.parentElement!;
  root.dataset.screen = "card";
  // The round's overlay (badges, countdown, results) over the canvas, laid out by screens.css as the local game's.
  const overlay = el("div");
  overlay.id = "screen";
  if (touch) overlay.dataset.touch = ""; // screens.css moves the HUD clear of the pads
  if (display) overlay.dataset.display = ""; // and makes it big enough to read across the room
  document.body.append(overlay);
  audio.mountToggle(); // After `#screen`, so screens.css hides it mid-round.
  overlay.addEventListener("click", (event) => {
    const action = (event.target as Element)
      .closest("[data-action]")
      ?.getAttribute("data-action");
    if (action === "rematch" || action === "lobby")
      runtime.command({ type: "action", action });
  });
  nameEntry.form.hidden = lobby.hidden = true;

  /** A dead end: the card says why, with BACK to the landing. The first one stands. */
  const deadEnd = (title: string, text: string) => {
    if (dead) return;
    dead = true;
    runtime.stop();
    input.setTouchPads([]);
    nameEntry.form.hidden = lobby.hidden = overlay.hidden = pad.hidden = true;
    root.dataset.screen = "card";
    root.classList.remove("fb-match");
    cardTitle.textContent = title;
    cardText.textContent = text;
    card.hidden = false;
  };

  // `looks` is the round scene's, kept up to date in place: it reads them when a round starts.
  const looks: PlayerLook[] = [];
  let source: OnlineSource | undefined,
    model: Model | undefined,
    shown = "";
  const render = (next: Model) => {
    model = next;
    const controller = next.controller;
    card.hidden = true;
    root.dataset.screen = overlay.dataset.screen = next.screen;
    root.classList.toggle("fb-match", next.screen !== "lobby" && !controller);
    nameEntry.form.hidden = !next.askName;
    lobby.hidden = next.screen !== "lobby";
    overlay.hidden = next.screen === "lobby" || !!controller;
    pad.hidden = !controller;
    document.body.classList.toggle("fb-controller", !!controller);
    if (controller) {
      const { state, loaded } = controller;
      pad.style.setProperty("--c", controller.color);
      pad.dataset.state = state;
      padName.textContent = controller.name;
      padTag.textContent = controller.tag;
      padWins.textContent = `WINS ${controller.wins}`;
      padHull.style.setProperty("--v", `${controller.hp * 100}%`);
      padReload.style.setProperty("--v", `${controller.reload * 100}%`);
      padState.textContent =
        state === "out"
          ? ""
          : `${state === "ghost" ? "GHOST · BOMB" : "LAUNCHER"} ${loaded ? "LOADED" : "RELOADING"}`;
      padLine.textContent = controller.line;
      padActions.hidden = !controller.actions;
    }
    // The arena sleeps on a controller: the TV shows it, and plays its sounds.
    const scene = game.scene.getScene(RoundScene.KEY);
    if (controller && scene?.sys.isActive()) game.scene.sleep(RoundScene.KEY);
    else if (!controller && scene?.sys.isSleeping())
      game.scene.wake(RoundScene.KEY);
    tv.hidden = !next.openTv;
    if (overlay.dataset.html !== next.overlay)
      overlay.innerHTML = overlay.dataset.html = next.overlay;
    roster.update(next.members);
    for (const [id, row] of roster.entries()) {
      const removable = next.members.some((m) => m.id === id && m.removable);
      let remove = row.querySelector("button");
      if (removable && !remove) {
        remove = button("×");
        remove.setAttribute("aria-label", "Remove bot");
        remove.onclick = () =>
          runtime.command({ type: "bot", action: "remove", id });
        row.append(remove);
      }
      if (remove) remove.hidden = !removable;
    }
    addBot.hidden = !next.canAddBot;
    start.hidden = !next.host;
    start.disabled = !next.canStart;
    note.textContent = next.note;
    note.hidden = !next.note;
    wins.textContent = `ROUNDS TO WIN: ${settings.wins}`;
    level.textContent = `BOTS: ${settings.difficulty.toUpperCase()}`;
    wins.disabled = level.disabled = !next.host;
    looks.splice(0, looks.length, ...next.looks);
    const color = next.looks[next.follow ?? -1]?.color;
    const label = controller?.state === "ghost" ? "BOMB" : "FIRE";
    input.setTouchPads(
      next.flying ? [{ label, color: css(color ?? 0) }] : [],
      controller ? controllerPadLayout : undefined,
    );
    if (next.screen !== root.dataset.music) {
      root.dataset.music = next.screen;
      if (next.screen === "lobby") audio.music("lobby");
    }
  };

  const callbacks: BombersCallbacks = {
    state(frame, roomSettings) {
      if (dead) return;
      settings = roomSettings;
      shown = `${frame.matchId}:${frame.round}`;
      viewer.host = solo || frame.managerId === viewer.me;
      viewer.hostPresent = solo || runtime.hostPresent;
      render(present(frame, viewer));
      // A controller never needs the arena; a page that drew it and then took a seat puts it to sleep (`render`).
      if (!frame.world || source || model?.controller) return;
      source = new OnlineSource(
        () => runtime.frameTiming(),
        () => viewer.me,
        frame.world,
      );
      game.scene.start(RoundScene.KEY, { source, players: looks });
      const attach = () =>
        audio.attachRound(game.scene.getScene(RoundScene.KEY)!);
      if (game.isRunning) attach();
      else game.events.once("ready", attach);
    },
    event(event, matchId, round) {
      source?.push(event, matchId, round);
      // A controller buzzes when its gunship is hit, where the phone can (Android; iOS has no vibration).
      const ms = model?.controller ? buzz(event, model.follow) : 0;
      if (ms && shown === `${matchId}:${round}` && "vibrate" in navigator)
        navigator.vibrate(ms);
    },
    status(text) {
      const kind = trouble(text);
      if (kind === "full")
        deadEnd("ROOM FULL", "Every seat is taken: start a room of your own.");
      else if (kind === "desync")
        deadEnd("OUT OF SYNC", "This page lost step with the room: rejoin.");
      else if (kind === "fatal") deadEnd("CANNOT PLAY HERE", text);
      else {
        // Retrying, or a shared room whose TV is not open: pink, and shown mid-match too.
        status.show(
          text,
          kind === "retry" || kind === "display" ? "error" : "info",
        );
      }
    },
    ready(id) {
      viewer.me = id;
    },
    kicked: () => deadEnd("REMOVED", "The host removed you from the room."),
    ended: () =>
      deadEnd("ROOM CLOSED", "This room has ended, or it never existed."),
  };
  // The creator's choice on the landing page; a joiner's settings are the room's anyway.
  const shared =
    !solo && session.role === "host" && store.getItem(names.shared) === "1";
  const runtime = new BombersRuntime(
    code,
    { ...DEFAULT_SETTINGS, display: shared },
    callbacks,
    session.kind === "solo"
      ? { humanName: store.getItem(names.name) ?? undefined }
      : {
          transport: (events) =>
            new net.PeerTransport(code, session.token, events, {
              apiUrl: endpoints.apiUrl,
              gameId: GAME,
              maxFastBytes: MAX_PACKET_BYTES,
            }),
          displayOnly: display,
        },
  );
  if (flags.has("debug")) Object.assign(window, { fuseBombers: { runtime } }); // preview/smoke.mjs reads the room
  // WASD and Space, the touch pad and gamepads fly this device's gunship: presses fire at once, holds steer each frame.
  const flies = (device: DeviceId) =>
    device === "key:WASD" || !device.startsWith("key:");
  const pads = [0, 1, 2, 3].map((i): DeviceId => `pad:${i}`);
  const steering: DeviceId[] = ["key:WASD", "touch:0", ...pads];
  input.hub.onPress((device) => !dead && flies(device) && runtime.fire());
  const poll = () => {
    if (dead) return;
    input.hub.poll();
    runtime.input(steering.reduce((bits, d) => bits | input.hub.heldBy(d), 0));
    requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);
  // A hidden page draws no frames to poll from: let go of everything at once (the sources forget their holds too).
  const release = () => runtime.input(0);
  window.addEventListener("blur", release);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) release();
  });
  net.installRoomLifecycle(window, {
    stop: () => runtime.stop(),
    destroy: () => input.hub.dispose(),
    reload: () => location.reload(),
  });
  runtime.start();
}
