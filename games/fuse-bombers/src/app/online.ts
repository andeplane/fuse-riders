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
import { OnlineSource } from "./online-source.js";
import { present, trouble, type Model, type Viewer } from "./presenter.js";
import { carry, keys, type Session, type Store } from "./session.js";

/**
 * The online pages' glue: the landing card, and a room (created, joined by code, or solo against bots) built from
 * fuse-ui, with `BombersRuntime` wired to the transport, the local input layer and the round scene. What shows is the
 * presenter's decision.
 */
const { el, button } = ui;
export const GAME = bombersGame.id;
const endpoints = net.createEndpoints(
  {
    basePath: `${import.meta.env.BASE_URL}${GAME}/`,
    apiOrigin: import.meta.env.VITE_API_ORIGIN,
  },
  location.origin,
);
const names = keys(GAME);
const flags = new URLSearchParams(location.search);
/** A page of this game, keeping `?mute` and `?calm`. */
const link = (query = "") => {
  const search = carry(location.search, query);
  return endpoints.appUrl(search && `?${search}`);
};
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
  card.error.textContent = error;
  page(card.element);
}

/** A room, as its creator or a joiner, or a match against bots (`solo`), drawn by `game`'s round scene. */
export function showRoom(
  session: Extract<Session, { kind: "room" | "solo" }>,
  { store, audio, game }: { store: Store; audio: GameAudio; game: Phaser.Game },
): void {
  const solo = session.kind === "solo",
    code = solo ? "SOLO" : session.code;
  const input = createBrowserInput(window, { forceTouch: flags.has("touch") });
  const touch = input.touchEnabled;
  const viewer: Viewer = { me: "", host: solo, hostPresent: true, touch };
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
  if (!solo)
    pilots.append(
      ui.createInviteCard({
        code,
        link: endpoints.appUrl(`?room=${code}`),
        qr: (text) => QRCode.toDataURL(text, { margin: 1, width: 360 }),
      }).element,
    );
  pilots.append(el("h2", "PILOTS", "fui-lobby-title"), roster.element, addBot);
  lobby.append(pilots, match);
  const bar = page(card, nameEntry.form, note, lobby);
  bar.append(el("strong", code), status.element, leave);
  const root = bar.parentElement!;
  root.dataset.screen = "card";
  // The round's overlay (badges, countdown, results) over the canvas, laid out by screens.css as the local game's.
  const overlay = el("div");
  overlay.id = "screen";
  if (touch) overlay.dataset.touch = ""; // screens.css moves the HUD clear of the pads
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
    audio.music(null);
    game.destroy(true); // Nothing of the round shows again: stop its loop, scene and sound hooks, drop the canvas.
    nameEntry.form.hidden = lobby.hidden = overlay.hidden = true;
    root.dataset.screen = "card";
    root.classList.remove("fb-match");
    cardTitle.textContent = title;
    cardText.textContent = text;
    card.hidden = false;
  };

  // `looks` is the round scene's, kept up to date in place: it reads them when a round starts.
  const looks: PlayerLook[] = [];
  let source: OnlineSource | undefined;
  const render = (next: Model) => {
    card.hidden = true;
    root.dataset.screen = overlay.dataset.screen = next.screen;
    root.classList.toggle("fb-match", next.screen !== "lobby");
    nameEntry.form.hidden = !next.askName;
    lobby.hidden = next.screen !== "lobby";
    overlay.hidden = next.screen === "lobby";
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
    const pad = { label: "FIRE", color: css(color ?? 0) };
    input.setTouchPads(next.flying ? [pad] : []);
    if (next.screen !== root.dataset.music) {
      root.dataset.music = next.screen;
      if (next.screen === "lobby") audio.music("lobby");
    }
  };

  const callbacks: BombersCallbacks = {
    state(frame, roomSettings) {
      if (dead) return;
      settings = roomSettings;
      viewer.host = solo || frame.managerId === viewer.me;
      viewer.hostPresent = solo || runtime.hostPresent;
      render(present(frame, viewer));
      if (!frame.world || source) return;
      source = new OnlineSource(
        () => runtime.frameTiming(),
        () => viewer.me,
        frame.world,
      );
      game.scene.start(RoundScene.KEY, { source, players: looks });
      const attach = () => {
        if (!dead) audio.attachRound(game.scene.getScene(RoundScene.KEY)!);
      };
      if (game.isRunning) attach();
      else game.events.once("ready", attach);
    },
    // A hidden tab draws nothing: its effects would only pile up and all play at once when it returns.
    event(event, matchId, round) {
      if (!document.hidden) source?.push(event, matchId, round);
    },
    status(text) {
      const kind = trouble(text);
      if (kind === "full")
        deadEnd("ROOM FULL", "Every seat is taken: start a room of your own.");
      else if (kind === "desync")
        deadEnd("OUT OF SYNC", "This page lost step with the room: rejoin.");
      else if (kind === "fatal") deadEnd("CANNOT PLAY HERE", text);
      else {
        status.show(text, kind === "retry" ? "error" : "info"); // retrying: pink
      }
    },
    ready(id) {
      viewer.me = id;
    },
    kicked: () => deadEnd("REMOVED", "The host removed you from the room."),
    ended: () =>
      deadEnd("ROOM CLOSED", "This room has ended, or it never existed."),
  };
  const runtime = new BombersRuntime(
    code,
    DEFAULT_SETTINGS,
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
        },
  );
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
  net.installRoomLifecycle(window, {
    stop: () => runtime.stop(),
    destroy: () => input.hub.dispose(),
    reload: () => location.reload(),
  });
  runtime.start();
}
