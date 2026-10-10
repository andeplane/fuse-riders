import "@fontsource/press-start-2p/latin.css";
import "fuse-ui/tokens.css";
import "fuse-ui/components.css";
import "fuse-ui/portal.css";
import "./style.css";
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
  createInviteCard,
  createKeyList,
  createLandingCard,
  createNameEntry,
  createNotice,
  createPicker,
  createRoster,
  el,
} from "fuse-ui";
import { HERO_KINDS, type HeroKind } from "../engine/index.js";
import { VIEW_H, VIEW_W } from "../engine/view-kit.js";
import { axeGame, type View } from "../online/game.js";
import { DEFAULT_HERO, isHero, seatName } from "../online/names.js";
import { AxeRuntime, type AxeCallbacks } from "../online/runtime.js";
import { createScene } from "../render/scene.js";
import type { MakeSurface } from "../render/surface.js";
import { HeldControls, KEY_HELP } from "./controls.js";
import { PendingPick, SoloOpening } from "./flow.js";
import { drawn } from "./interpolate.js";
import {
  HEROES,
  TEXT,
  partyLabel,
  pixelScale,
  present,
  type Card,
  type Model,
  type Viewer,
} from "./presenter.js";
import {
  NOT_OPEN,
  keys,
  roomFailure,
  safeStore,
  sessionFor,
} from "./session.js";

/**
 * The page's glue: it reads the query, builds the screens from fuse-ui components, wires the runtime to the
 * transport, draws every animation frame into the native 320 × 180 canvas and scales it up by whole numbers, and turns
 * keys into held control bits. The decisions live in the presenter, the scene and the engine.
 */
const GAME = axeGame.id;
/** The renderer's surfaces in the browser: a canvas and its 2D context, smoothing off, `putImageData` the fast path. */
const canvasSurface: MakeSurface<HTMLCanvasElement> = (width, height) => {
  const image = el("canvas");
  [image.width, image.height] = [width, height];
  const paint = image.getContext("2d")!;
  paint.imageSmoothingEnabled = false;
  const putPixels = (rgba: Uint8ClampedArray<ArrayBuffer>) =>
    paint.putImageData(new ImageData(rgba, width, height), 0, 0);
  return { image, paint, putPixels };
};
const endpoints = createEndpoints(
  {
    basePath: `${import.meta.env.BASE_URL}${GAME}/`,
    apiOrigin: import.meta.env.VITE_API_ORIGIN,
  },
  location.origin,
);
const store = safeStore(() => localStorage);
const names = keys(GAME);
const query = new URLSearchParams(location.search);
const app = document.querySelector<HTMLElement>("#app")!;
const secret = () => uuid().replaceAll("-", "") + uuid().replaceAll("-", "");
/** A link within the game that keeps this page's `mute` flag. */
const withFlags = (path: string) =>
  query.has("mute") ? `${path}${path.includes("?") ? "&" : "?"}mute` : path;
const setText = (node: HTMLElement, value: string) => {
  if (node.textContent !== value) node.textContent = value;
};
/** The hero this browser picked last: what it joins with, never what the screen says a seat plays. */
const storedHero = (): HeroKind => {
  const hero = store.getItem(names.hero);
  return isHero(hero) ? hero : DEFAULT_HERO;
};

function header(extra: HTMLElement[] = []): HTMLElement {
  const bar = el("header", "", "fa-top"),
    brand = el("a", "", "fa-brand");
  brand.href = withFlags(endpoints.appUrl());
  brand.append(el("b", "FUSE"), el("b", "AXE"));
  const portal = createAppPortal({
    document,
    current: GAME,
    base: import.meta.env.BASE_URL,
    search: location.search,
  });
  bar.append(portal.element, brand, ...extra);
  return bar;
}
function keyHelp(): HTMLElement {
  const box = el("div", "", "fa-keys");
  box.append(...createKeyList([{ title: "KEYS", entries: KEY_HELP }]));
  return box;
}
/** A hero's badge: its initial on its colour, until the sprites arrive. */
function badge(hero: string): HTMLElement {
  const info = isHero(hero) ? HEROES[hero] : undefined,
    mark = el("span", info?.name[0] ?? "?", "fa-badge");
  if (info) mark.style.setProperty("--hero", info.color);
  return mark;
}

function landing(): void {
  const card = createLandingCard({
    title: "FUSE AXE",
    tagline:
      "Three heroes take the road east to the Dark Keep. Cleave through Vorhal's raiders alone or with up to four friends.",
    soloText: "PLAY SOLO",
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
      location.href = withFlags(endpoints.appUrl("?solo=1"));
    },
    valid: validRoomCode,
    onJoin: (code) => {
      location.href = withFlags(endpoints.appUrl(`?room=${code}`));
    },
  });
  card.element.append(keyHelp());
  const back = el("a", "← FUSE RIDERS", "fa-back");
  back.href = import.meta.env.BASE_URL + (query.has("mute") ? "?mute" : "");
  app.replaceChildren(header([back]), card.element);
}

function room(solo: boolean): void {
  const session = solo
    ? ({ kind: "solo" } as const)
    : sessionFor(location.search, store, GAME, validRoomCode, secret);
  if (session.kind === "invalid" || session.kind === "landing") {
    const back = el("a", "← BACK", "fa-back");
    back.href = withFlags(endpoints.appUrl());
    app.replaceChildren(
      header([back]),
      el("p", "That is not a room code: check it and try again.", "fa-error"),
    );
    return;
  }
  const code = session.kind === "room" ? session.code : "SOLO",
    display = session.kind === "room" && session.role === "display";
  const viewer: Viewer = { me: "", host: solo, solo, display };

  // ---- the page ----
  const status = createNotice({ className: "fa-status" }),
    toLobby = button("LOBBY", "fa-to-lobby"),
    leave = button(solo ? "EXIT" : "LEAVE", "fa-leave");
  // The host can take the room back to the lobby, and its hero picker, from a run.
  toLobby.onclick = () => runtime.command({ type: "action", action: "lobby" });
  leave.onclick = () => {
    runtime.stop();
    location.href = withFlags(endpoints.appUrl());
  };
  const top = header([
    el("strong", code, "fa-code"),
    status.element,
    toLobby,
    leave,
  ]);

  // The lobby: who is here and which hero each plays; this device's pick, and the host's START.
  const lobby = el("section", "", "fa-lobby"),
    lobbyMain = el("div", "", "fa-panel"),
    lobbySide = el("aside", "", "fa-panel fa-side"),
    roster = createRoster({ emptyText: "No heroes yet", avatar: badge }),
    blurb = el("p", "", "fa-blurb"),
    lobbyNote = el("p", "", "fui-lobby-note"),
    start = button("START", "fui-button-primary fa-start");
  const picker = createPicker<HeroKind>({
    legend: "CHOOSE YOUR HERO",
    choices: HERO_KINDS.map((id) => ({ id, label: HEROES[id].name })),
    selected: storedHero(),
    dataKey: "hero",
    art: badge,
    onPick(hero) {
      store.setItem(names.hero, hero);
      // Seated, the room decides: the pick shows until the seat's hero answers, then the seat's hero shows, whether
      // or not this pick landed.
      if (model?.seated && runtime.pick(hero)) pending.pick(hero, tick);
    },
  });
  if (!solo)
    lobbyMain.append(
      createInviteCard({
        code,
        link: endpoints.appUrl(`?room=${code}`),
        qr: (text) => QRCode.toDataURL(text, { margin: 1, width: 360 }),
      }).element,
    );
  lobbyMain.append(el("h2", "HEROES", "fui-lobby-title"), roster.element);
  lobbySide.append(picker.element, blurb, lobbyNote, start, keyHelp());
  lobby.append(lobbyMain, lobbySide);
  start.onclick = () => runtime.command({ type: "action", action: "start" });

  // The game: the native frame, scaled by whole numbers and letterboxed; its HUD names the party.
  const stage = el("section", "", "fa-stage"),
    screen = el("div", "", "fa-screen"),
    canvas = el("canvas", "", "fa-canvas"),
    note = el("p", "", "fa-note");
  // The stage flow's card over the game: a cleared stage's tally, the continue countdown, the run's end.
  const card = el("div", "", "fa-card"),
    cardTitle = el("h2", "", "fa-card-title"),
    cardLine = el("p", "", "fa-card-line"),
    cardClock = el("strong", "", "fa-card-clock"),
    cardHint = el("p", "", "fa-card-hint"),
    tally = el("table", "", "fa-tally"),
    actions = el("div", "", "fa-card-actions"),
    continueButton = button(
      TEXT.continueButton,
      "fui-button-primary fa-continue",
    ),
    rematch = button(TEXT.rematchButton, "fui-button-primary fa-rematch"),
    backToLobby = button(TEXT.lobbyButton, "fa-card-lobby");
  actions.append(continueButton, rematch, backToLobby);
  card.append(cardTitle, cardLine, cardHint, cardClock, tally, actions);
  card.hidden = true;
  continueButton.onclick = () => runtime.continueRun();
  rematch.onclick = () =>
    runtime.command({ type: "action", action: "rematch" });
  backToLobby.onclick = () =>
    runtime.command({ type: "action", action: "lobby" });
  // The HUD draws the party in pixels; the canvas says it in words.
  canvas.setAttribute("role", "img");
  screen.append(canvas, card);
  stage.append(screen, note);

  // Until the first frame nothing of the room shows, so a room that turns out not to exist never offers its controls.
  const connecting = el("p", "Connecting to the room…", "fa-connecting"),
    closed = el("section", "", "fa-panel fa-closed"),
    closedBack = el("a", "BACK TO FUSE AXE", "fui-button-primary");
  closedBack.href = withFlags(endpoints.appUrl());
  closed.append(
    el("h2", "ROOM CLOSED", "fui-lobby-title"),
    el(
      "p",
      "This room has ended, or it never existed. Start a new one, or play solo.",
    ),
    closedBack,
  );
  // The name form stands above every screen: a newcomer mid-run picks a name and plays from the next run.
  const nameEntry = createNameEntry({
    normalize: (raw) => seatName(raw) ?? "",
    initial: store.getItem(names.name) ?? "",
    onInput: (value) => store.setItem(names.name, value),
    buttonText: "JOIN",
    onSubmit: (name) => {
      store.setItem(names.name, name);
      runtime.command({ type: "join", name, avatarId: storedHero() });
    },
  });
  const main = el("main", "", "fa-room");
  main.append(connecting, closed, nameEntry.form, lobby, stage);
  app.replaceChildren(top, main);
  for (const part of [closed, nameEntry.form, lobby, stage, toLobby])
    part.hidden = true;
  let over = false;
  let model: Model | undefined;
  // The log tick of the newest frame, and the hero this device has picked that the seat has not yet answered.
  let tick = 0;
  const pending = new PendingPick();

  // ---- drawing ----
  const pixels = el("canvas");
  pixels.width = VIEW_W;
  pixels.height = VIEW_H;
  const native = pixels.getContext("2d")!,
    g = canvas.getContext("2d")!,
    scene = createScene(canvasSurface);
  const fit = () => {
    // The screen's own area (a border is not drawable), in device pixels.
    const ratio = window.devicePixelRatio || 1,
      scale = pixelScale(
        screen.clientWidth * ratio,
        screen.clientHeight * ratio,
      );
    canvas.width = VIEW_W * scale;
    canvas.height = VIEW_H * scale;
    canvas.style.width = `${canvas.width / ratio}px`;
    canvas.style.height = `${canvas.height / ratio}px`;
  };
  new ResizeObserver(fit).observe(screen);
  const paint = (now: number) => {
    // A room that has ended draws nothing more, so its loop ends with it.
    if (over) return;
    const world = stage.hidden ? null : drawn(runtime.frameTiming());
    if (world) {
      scene.draw(native, world, Math.floor((now * 60) / 1000), model?.hud);
      // Resizing the canvas resets its context, smoothing included.
      g.imageSmoothingEnabled = false;
      g.drawImage(pixels, 0, 0, canvas.width, canvas.height);
    }
    requestAnimationFrame(paint);
  };
  requestAnimationFrame(paint);

  const showCard = (shown: Card | null) => {
    main.dataset.card = shown?.kind ?? "";
    card.hidden = !shown;
    if (!shown) return;
    card.dataset.kind = shown.kind;
    setText(cardTitle, shown.title);
    setText(cardLine, shown.line);
    setText(cardHint, shown.hint);
    setText(cardClock, shown.seconds === null ? "" : String(shown.seconds));
    cardClock.hidden = shown.seconds === null;
    continueButton.hidden = !shown.canContinue;
    rematch.hidden = backToLobby.hidden = !shown.canRematch;
    actions.hidden = !shown.canContinue && !shown.canRematch;
    tally.hidden = !shown.rows.length;
    const rows = JSON.stringify(shown.rows);
    if (tally.dataset.rows === rows) return;
    tally.dataset.rows = rows;
    const head = el("tr");
    for (const label of TEXT.tallyHead) head.append(el("th", label));
    tally.replaceChildren(
      head,
      ...shown.rows.map((row) => {
        const line = el("tr"),
          who = el("td");
        line.style.setProperty("--c", row.color);
        who.append(el("b", row.tag), el("span", row.name));
        line.append(
          who,
          el("td", HEROES[row.hero].name),
          el("td", String(row.damage)),
          el("td", String(row.knockdowns)),
        );
        return line;
      }),
    );
  };

  const render = (next: Model, view: View) => {
    if (over) return;
    model = next;
    tick = view.logTick;
    connecting.hidden = true;
    main.dataset.screen = next.screen;
    main.dataset.stage = view.stage;
    main.dataset.hero = next.hero ?? "";
    main.dataset.playing = String(next.playing);
    const party = partyLabel(next.members);
    if (canvas.getAttribute("aria-label") !== party)
      canvas.setAttribute("aria-label", party);
    lobby.hidden = next.screen !== "lobby";
    stage.hidden = next.screen !== "play";
    nameEntry.form.hidden = !next.askName;
    toLobby.hidden = !next.canReturn;
    roster.update(
      next.members.map((member) => ({
        id: member.id,
        name: member.name,
        color: member.color,
        status: member.status,
        avatar: member.hero ?? undefined,
      })),
    );
    // A seat shows the hero the room gave it (this device's own pick until the room answers); before a seat, the one
    // this browser will join with.
    const hero =
      pending.shown(next.hero, next.canPick, view.logTick) ?? storedHero();
    picker.sync(hero);
    picker.element.disabled = next.seated && !next.canPick;
    picker.element.hidden = blurb.hidden = display;
    setText(blurb, `${HEROES[hero].name}: ${HEROES[hero].blurb}`);
    start.hidden = !next.showStart;
    start.disabled = !next.canStart;
    for (const line of [lobbyNote, note]) {
      setText(line, next.note);
      line.hidden = !next.note;
    }
    showCard(next.card);
  };

  // ---- the runtime ----
  const remembered = seatName(store.getItem(names.name) ?? "");
  let joinSent = false,
    adopted = false;
  // Solo sets out at once; this page opens on the hero picker, so its first frames never show (see `SoloOpening`).
  const opening = solo ? new SoloOpening() : undefined;
  const callbacks: AxeCallbacks = {
    state(frame) {
      if (
        opening?.holds(frame, () =>
          runtime.command({ type: "action", action: "lobby" }),
        )
      )
        return;
      const next = present(frame, viewer);
      if (next.askName && remembered && !joinSent) {
        joinSent = true;
        runtime.command({
          type: "join",
          name: remembered,
          avatarId: storedHero(),
        });
      }
      if (next.seated) joinSent = false;
      // Solo seats its player as the default hero: the one this browser picked last is picked for it, once.
      if (solo && !adopted && next.canPick) {
        adopted = true;
        if (next.hero !== storedHero() && runtime.pick(storedHero()))
          pending.pick(storedHero(), frame.logTick);
      }
      render(next, frame);
      runtime.flush();
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
      controls.close();
      for (const part of [connecting, nameEntry.form, lobby, stage, toLobby])
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
  const runtime = new AxeRuntime(
    code,
    { display: false },
    callbacks,
    session.kind === "room"
      ? {
          transport: (events) =>
            new PeerTransport(code, session.token, events, {
              apiUrl: endpoints.apiUrl,
              gameId: GAME,
              maxFastBytes: MAX_PACKET_BYTES,
            }),
          displayOnly: display,
        }
      : { humanName: store.getItem(names.name) ?? undefined },
  );
  installRoomLifecycle(window, {
    stop: () => runtime.stop(),
    destroy: () => {},
    reload: () => location.reload(),
  });

  // Keys: while this device plays a hero, a focused button does not take ours (they steer the hero, and arrows never
  // scroll); otherwise a focused button or field keeps its own keys (START and the name form work from the keyboard).
  // What counts as ours, and what lets go of them, is `HeldControls`'s.
  const controls = new HeldControls((bits) => runtime.input(bits));
  const typing = (target: EventTarget | null) =>
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLButtonElement && !model?.playing);
  document.addEventListener("keydown", (event) => {
    if (controls.down(event, typing(event.target))) event.preventDefault();
  });
  document.addEventListener("keyup", (event) => {
    if (controls.up(event.code)) event.preventDefault();
  });
  window.addEventListener("blur", () => controls.clear());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) controls.clear();
  });
  runtime.start();
}

if (query.get("solo") === "1") room(true);
else if (query.has("room")) room(false);
else landing();
