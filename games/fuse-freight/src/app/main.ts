import "@fontsource/press-start-2p/latin.css";
import "fuse-ui/tokens.css";
import "fuse-ui/components.css";
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
  createInviteCard,
  createLandingCard,
  createNameEntry,
  createNotice,
  createRoster,
  el,
} from "fuse-ui";
import {
  DEFAULT_SETTINGS,
  LEFT,
  RIGHT,
  ROUND_SECONDS,
  WIN_TARGETS,
  botInput,
  createWorld,
  roundDone,
  stepWorld,
  toView,
  type Settings,
  type World,
} from "../engine/index.js";
import { freightGame, type View } from "../online/game.js";
import { seatName } from "../online/names.js";
import { FreightRuntime, type FreightCallbacks } from "../online/runtime.js";
import { blend, fraction } from "../render/interpolate.js";
import { createScene, effectKey, VIEW_H, VIEW_W } from "../render/scene.js";
import { seatColor } from "../render/palette.js";
import {
  RULES,
  createBays,
  createRulePanel,
  trainIcon,
  type Rule,
} from "../render/illustrations.js";
import type { MakeSurface } from "../render/sprites.js";
import {
  createAudio,
  loadPrefs,
  mutedByQuery,
  savePrefs,
  type Cue,
  type GameAudio,
  type Mood,
} from "./audio.js";
import { HeldControls } from "./controls.js";
import { present, type Card, type Model, type Viewer } from "./presenter.js";
import {
  NOT_OPEN,
  keys,
  roomFailure,
  safeStore,
  sessionFor,
} from "./session.js";

/**
 * The page's glue: it reads the query, builds the screens from fuse-ui components and its own HUD, wires the runtime
 * to the transport, draws every animation frame from the runtime's frame timing and turns keys and touches into held
 * steering bits. The decisions live in the presenter, the renderer and the engine.
 */
const GAME = freightGame.id;
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
const muted = mutedByQuery(location.search);
const autopilot = query.has("autopilot");
const app = document.querySelector<HTMLElement>("#app")!;
const secret = () => uuid().replaceAll("-", "") + uuid().replaceAll("-", "");
/** A link within the game that keeps this page's developer flags: `mute` and `autopilot`. */
const DEV_FLAGS = ["mute", "autopilot"] as const;
const withFlags = (path: string) => {
  const kept = DEV_FLAGS.filter((flag) => query.has(flag)).map((flag) =>
    query.get(flag) ? `${flag}=${encodeURIComponent(query.get(flag)!)}` : flag,
  );
  return kept.length
    ? `${path}${path.includes("?") ? "&" : "?"}${kept.join("&")}`
    : path;
};
const setText = (node: HTMLElement, value: string) => {
  if (node.textContent !== value) node.textContent = value;
};
const coarse = () => matchMedia("(pointer: coarse)").matches;
const touchFirst = () =>
  matchMedia("(hover: none) and (pointer: coarse)").matches;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const make: MakeSurface = (width, height) => {
  const surface = document.createElement("canvas");
  surface.width = width;
  surface.height = height;
  return surface;
};

// ---- sound ----
const audio: GameAudio = createAudio(muted, loadPrefs(store, touchFirst()));
for (const type of ["pointerdown", "keydown"] as const)
  document.addEventListener(type, () => audio.resume(), { passive: true });

function soundToggles(): HTMLElement {
  const box = el("div", "", "ff-sound");
  if (audio.silenced) {
    const chip = el("span", "🔇 MUTED", "ff-sound-chip");
    chip.title = "This page was opened with ?mute";
    box.append(chip);
    return box;
  }
  const music = button("", "ff-sound-button"),
    effects = button("", "ff-sound-button");
  const show = () => {
    setText(music, audio.prefs.muted.music ? "♫ MUSIC OFF" : "♫ MUSIC ON");
    setText(effects, audio.prefs.muted.effects ? "FX OFF" : "FX ON");
    music.setAttribute("aria-pressed", String(!audio.prefs.muted.music));
    effects.setAttribute("aria-pressed", String(!audio.prefs.muted.effects));
  };
  music.onclick = () => {
    audio.setMuted("music", !audio.prefs.muted.music);
    savePrefs(store, audio.prefs);
    audio.resume();
    show();
  };
  effects.onclick = () => {
    audio.setMuted("effects", !audio.prefs.muted.effects);
    savePrefs(store, audio.prefs);
    show();
  };
  show();
  box.append(music, effects);
  return box;
}

// ---- shared pieces ----
function logo(): HTMLElement {
  const brand = el("a", "", "ff-brand");
  brand.href = withFlags(endpoints.appUrl());
  brand.append(
    el("b", "FUSE", "ff-brand-fuse"),
    el("b", "FREIGHT", "ff-brand-freight"),
  );
  return brand;
}
function header(extra: HTMLElement[] = []): HTMLElement {
  const bar = el("header", "", "ff-top");
  bar.append(logo(), ...extra);
  return bar;
}

/** Canvases that animate while shown: the splash's depot, the rules panels and the lobby's bays. */
const animations = new Set<(now: number) => void>();
const animate = (now: number) => {
  for (const run of animations) run(now);
  requestAnimationFrame(animate);
};
requestAnimationFrame(animate);

function pictureCanvas(width: number, height: number, className: string) {
  const canvas = el("canvas", "", className) as HTMLCanvasElement;
  const ratio = Math.min(2, window.devicePixelRatio || 1) * 1.5;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const g = canvas.getContext("2d")!;
  return { canvas, g, ratio };
}

const RULE_TEXT: Record<Rule, [string, string]> = {
  steer: ["STEER", "The train drives itself. Steer left or right."],
  collect: ["COLLECT", "Drive over loose carts. They couple on at the back."],
  steal: [
    "STEAL",
    "Cross a rival's tail: every wagon behind the hit breaks loose.",
  ],
  deliver: [
    "DELIVER",
    "Drive into a dock. Every wagon you pull scores a point.",
  ],
};

/** The illustrated rules: four animated panels and the one line that decides the round. */
function howToPlay(): HTMLElement {
  const section = el("section", "", "ff-howto");
  section.append(el("h2", "HOW TO PLAY", "ff-howto-title"));
  const grid = el("div", "", "ff-howto-grid");
  RULES.forEach((rule, index) => {
    const card = el("article", "", "ff-rule");
    const { canvas, g, ratio } = pictureCanvas(240, 120, "ff-rule-canvas");
    const panel = createRulePanel(g, make, rule);
    const [title, body] = RULE_TEXT[rule];
    const head = el("header", "", "ff-rule-head");
    head.append(el("b", String(index + 1), "ff-rule-number"), el("h3", title));
    card.append(head, el("p", body), canvas);
    grid.append(card);
    animations.add((now) => {
      if (!canvas.isConnected || canvas.offsetParent === null) return;
      g.setTransform(ratio, 0, 0, ratio, 0, 0);
      panel.draw(now);
    });
  });
  section.append(
    grid,
    el(
      "p",
      "🏆 MOST DELIVERED WAGONS WINS · 1–5 DRIVERS · BOTS FILL THE DEPOT",
      "ff-howto-foot",
    ),
  );
  return section;
}

function keyHelp(): HTMLElement {
  const list = el("dl", "", "ff-keys");
  for (const [keysText, what] of [
    ["A / ←", "Steer left"],
    ["D / →", "Steer right"],
    ["TOUCH", "Hold the big ◀ ▶ buttons"],
  ])
    list.append(el("dt", keysText), el("dd", what));
  return list;
}

// ---- the splash ----
function landing(): void {
  document.body.classList.add("ff-landing-page");
  audio.mood("menu");
  const splash = el("section", "", "ff-splash");
  const { canvas, g } = (() => {
    const canvas = el("canvas", "", "ff-attract") as HTMLCanvasElement;
    return { canvas, g: canvas.getContext("2d")! };
  })();
  const scene = createScene(g, make);
  // A live round of five AI trains behind the menu, on the real rules.
  let world: World = attractWorld(),
    carry = 0,
    lastNow = 0,
    inputs = new Map<string, number>();
  const labels = new Map(
    [0, 1, 2, 3, 4].map((slot) => [`bot:${slot + 1}`, `P${slot + 1}`]),
  );
  const fit = () => {
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    canvas.height = Math.max(1, Math.round(canvas.clientHeight * ratio));
  };
  new ResizeObserver(fit).observe(canvas);
  animations.add((now) => {
    if (!canvas.isConnected) return;
    carry += Math.min(100, lastNow ? now - lastNow : 0);
    lastNow = now;
    while (carry >= 1000 / 60) {
      carry -= 1000 / 60;
      if (world.step % 3 === 0)
        inputs = new Map(world.trains.map((t) => [t.id, botInput(world, t)]));
      stepWorld(world, inputs);
      if (roundDone(world)) world = attractWorld();
    }
    // Cover the canvas with the 16:9 depot, cropped at the edges on other shapes.
    const scale = Math.max(canvas.width / VIEW_W, canvas.height / VIEW_H);
    g.setTransform(
      scale,
      0,
      0,
      scale,
      (canvas.width - VIEW_W * scale) / 2,
      (canvas.height - VIEW_H * scale) / 2,
    );
    scene.draw({ world: toView(world), me: "", labels, now, reducedMotion });
  });

  const shared = el("label", "", "ff-shared"),
    toggle = el("input");
  toggle.type = "checkbox";
  toggle.checked = store.getItem(names.shared) === "1";
  toggle.onchange = () =>
    store.setItem(names.shared, toggle.checked ? "1" : "0");
  shared.append(toggle, el("span", "Shared TV: phones are the controllers"));
  const card = createLandingCard({
    title: "FUSE FREIGHT",
    tagline:
      "Little trains, big plans. Collect loose carts, cut your rivals' tails and deliver before the whistle.",
    soloText: "PLAY SOLO VS BOTS",
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
  card.create.after(shared);
  card.element.classList.add("ff-landing-card");
  card.element.append(keyHelp());
  const title = el("div", "", "ff-title");
  title.append(
    el("b", "FUSE", "ff-title-fuse"),
    el("b", "FREIGHT", "ff-title-freight"),
    el("span", "COLLECT • STEAL • DELIVER", "ff-title-tagline"),
  );
  const back = el("a", "← FUSE RIDERS", "ff-back");
  back.href = import.meta.env.BASE_URL + (muted ? "?mute" : "");
  const front = el("div", "", "ff-splash-front");
  front.append(title, card.element);
  splash.append(canvas, front);
  app.replaceChildren(header([soundToggles(), back]), splash, howToPlay());
}

function attractWorld(): World {
  return createWorld(
    (Math.random() * 0xffff_ffff) >>> 0,
    [0, 1, 2, 3, 4].map((slot) => ({ id: `bot:${slot + 1}`, slot })),
    { seconds: 60 },
  );
}

/** A button that holds `bits` while a pointer is down on it. */
function holdButton(
  label: string,
  className: string,
  bits: number,
  controls: HeldControls,
): HTMLButtonElement {
  const pad = button(label, className);
  const source = `pad:${className}:${label}`;
  const down = (event: PointerEvent) => {
    event.preventDefault();
    try {
      // Keeps the press while the thumb slides off the pad; a pointer the browser no longer tracks cannot be captured.
      pad.setPointerCapture(event.pointerId);
    } catch {
      /* the press still holds until pointerup */
    }
    pad.classList.add("held");
    controls.hold(source, bits);
  };
  const up = () => {
    pad.classList.remove("held");
    controls.hold(source, 0);
  };
  pad.addEventListener("pointerdown", down);
  pad.addEventListener("pointerup", up);
  pad.addEventListener("pointercancel", up);
  pad.addEventListener("lostpointercapture", up);
  pad.addEventListener("contextmenu", (event) => event.preventDefault());
  return pad;
}

function room(solo: boolean): void {
  const session = solo
    ? ({ kind: "solo" } as const)
    : sessionFor(location.search, store, GAME, validRoomCode, secret);
  if (session.kind === "invalid" || session.kind === "landing") {
    const back = el("a", "← BACK", "ff-back");
    back.href = withFlags(endpoints.appUrl());
    app.replaceChildren(
      header([back]),
      el("p", "That is not a room code: check it and try again.", "ff-error"),
    );
    return;
  }
  const code = session.kind === "room" ? session.code : "SOLO",
    role = session.kind === "room" ? session.role : "host",
    display = role === "display";
  document.body.classList.toggle("ff-display", display);
  const viewer: Viewer = { me: "", host: solo, solo, display };
  const icons = [0, 1, 2, 3, 4].map((slot) =>
    (trainIcon(make, slot) as HTMLCanvasElement).toDataURL(),
  );
  const icon = (slot: number) => {
    const image = el("img", "", "ff-icon") as HTMLImageElement;
    image.src = icons[slot] ?? icons[0]!;
    image.alt = "";
    return image;
  };

  // ---- the page ----
  const status = createNotice({ className: "ff-status" }),
    leave = button(solo ? "EXIT" : "LEAVE", "ff-leave");
  leave.onclick = () => {
    runtime.stop();
    location.href = withFlags(endpoints.appUrl());
  };
  // The host can go back to the lobby (and the depot rules) mid-match; in solo that is the only way to them.
  const backToLobby = button("LOBBY", "ff-to-lobby");
  backToLobby.onclick = () =>
    runtime.command({ type: "action", action: "lobby" });
  backToLobby.hidden = true;
  const top = header([
    el("strong", solo ? "SOLO" : code, "ff-code"),
    status.element,
    soundToggles(),
    backToLobby,
    leave,
  ]);

  // Lobby.
  const lobby = el("section", "", "ff-lobby"),
    lobbyMain = el("div", "", "ff-lobby-main"),
    lobbySide = el("aside", "", "ff-lobby-side"),
    roster = createRoster({ emptyText: "No drivers yet" }),
    addBot = button("+ ADD BOT", "ff-add-bot"),
    start = button("START THE TRAINS ▶", "fui-button-primary ff-start"),
    lobbyNote = el("p", "", "fui-lobby-note"),
    tvLink = button("OPEN TV SCREEN", "ff-tv");
  const bays = pictureCanvas(480, 190, "ff-bays");
  const bayPainter = createBays(bays.g, make);
  let bayState: { slot: number; taken: boolean; you: boolean }[] = [
    0, 1, 2, 3, 4,
  ].map((slot) => ({ slot, taken: false, you: false }));
  animations.add((now) => {
    if (lobby.hidden || !bays.canvas.isConnected) return;
    bays.g.setTransform(bays.ratio, 0, 0, bays.ratio, 0, 0);
    bayPainter.draw(bayState, now);
  });
  lobbyMain.append(bays.canvas);
  if (!solo) {
    const invite = createInviteCard({
      code,
      link: endpoints.appUrl(`?room=${code}`),
      qr: (text) => QRCode.toDataURL(text, { margin: 1, width: 360 }),
    });
    lobbyMain.append(invite.element);
  }
  const nameEntry = createNameEntry({
    normalize: (raw) => seatName(raw) ?? "",
    initial: store.getItem(names.name) ?? "",
    onInput: (value) => store.setItem(names.name, value),
    buttonText: "JOIN",
    onSubmit: (name) => {
      store.setItem(names.name, name);
      runtime.command({ type: "join", name });
    },
  });
  const rosterBox = el("div", "", "ff-roster");
  rosterBox.append(
    el("h2", "DRIVERS", "fui-lobby-title"),
    roster.element,
    addBot,
  );
  lobbySide.append(rosterBox);
  addBot.onclick = () => runtime.command({ type: "bot", action: "add" });
  start.onclick = () => runtime.command({ type: "action", action: "start" });
  tvLink.onclick = () =>
    window.open(
      withFlags(endpoints.appUrl(`?room=${code}&display=1`)),
      "_blank",
    );

  // Depot rules: the host's to change.
  let settings: Settings = { ...DEFAULT_SETTINGS };
  const rules = el("div", "", "ff-rules");
  const choice = <K extends keyof Settings>(
    key: K,
    label: string,
    options: readonly [Settings[K], string][],
  ) => {
    const row = el("label", "", "ff-rule-setting"),
      select = el("select");
    select.name = key;
    for (const [value, text] of options) {
      const option = el("option", text);
      option.value = String(value);
      select.append(option);
    }
    select.onchange = () => {
      const picked = options.find(([value]) => String(value) === select.value);
      if (!picked) return;
      // Kept at once, so a second change before the next frame builds on this one rather than undoing it.
      settings = { ...settings, [key]: picked[0] };
      runtime.command({ type: "settings", settings });
    };
    row.append(el("span", label), select);
    rules.append(row);
    return (value: Settings[K], editable: boolean) => {
      if (select.value !== String(value)) select.value = String(value);
      select.disabled = !editable;
    };
  };
  const showWins = choice(
    "wins",
    "ROUND WINS TO WIN",
    WIN_TARGETS.map((wins) => [wins, String(wins)] as const),
  );
  const showSeconds = choice(
    "seconds",
    "ROUND LENGTH",
    ROUND_SECONDS.map((seconds) => [seconds, `${seconds} seconds`] as const),
  );
  const lobbyActions = el("div", "", "ff-lobby-actions");
  lobbyActions.append(tvLink, start);
  const depotRules = el("div", "", "ff-depot-rules");
  depotRules.append(
    el("h2", "DEPOT RULES", "fui-lobby-title"),
    rules,
    lobbyNote,
    lobbyActions,
    keyHelp(),
  );
  depotRules.hidden = display;
  lobbySide.append(depotRules);
  lobby.append(lobbyMain, lobbySide);
  const lobbyRules = howToPlay();
  lobbyRules.classList.add("ff-howto-lobby");

  // The depot: canvas, HUD, banner, scoreboard and the result card on one 16:9 screen.
  const stage = el("section", "", "ff-stage"),
    screen = el("div", "", "ff-screen"),
    canvas = el("canvas", "", "ff-canvas") as HTMLCanvasElement,
    hud = el("div", "", "ff-hud"),
    cardsLeft = el("div", "", "ff-cards"),
    cardsRight = el("div", "", "ff-cards ff-cards-right"),
    clock = el("div", "", "ff-clock"),
    clockValue = el("b", "01:15"),
    callout = el("span", "", "ff-callout"),
    roundLine = el("small", "", "ff-round"),
    banner = el("div", "", "ff-banner"),
    bannerTitle = el("strong"),
    bannerDetail = el("span"),
    board = el("section", "", "ff-board"),
    boardTitle = el("h2"),
    boardRows = el("ol"),
    boardNext = el("p", "", "ff-board-next"),
    note = el("div", "", "ff-note"),
    hint = el("div", "", "ff-hint");
  clock.append(clockValue, callout);
  banner.append(bannerTitle, bannerDetail);
  board.append(el("small", "ROUND OVER"), boardTitle, boardRows, boardNext);
  hint.append(
    el("span", "◀ LEFT", "ff-hint-key"),
    el("span", "The train drives itself", "ff-hint-text"),
    el("span", "RIGHT ▶", "ff-hint-key"),
  );
  hud.append(
    cardsLeft,
    clock,
    cardsRight,
    roundLine,
    banner,
    board,
    note,
    hint,
  );
  const result = el("section", "", "ff-result"),
    resultTitle = el("h2"),
    resultLines = el("ol"),
    resultWaiting = el("p", "", "fui-lobby-note"),
    resultActions = el("div", "", "ff-lobby-actions"),
    rematch = button("REMATCH", "fui-button-primary"),
    toLobby = button("LOBBY");
  resultActions.append(toLobby, rematch);
  result.append(
    el("small", "MATCH OVER"),
    resultTitle,
    resultLines,
    resultWaiting,
    resultActions,
  );
  result.hidden = true;
  rematch.onclick = () =>
    runtime.command({ type: "action", action: "rematch" });
  toLobby.onclick = () => runtime.command({ type: "action", action: "lobby" });
  screen.append(canvas, hud, result);

  // Touch buttons under or over the depot, and the phone controller for a shared screen.
  const controls = new HeldControls((bits) => runtime.input(bits));
  const touch = el("div", "", "ff-touch");
  touch.append(
    holdButton("◀", "ff-pad ff-pad-left", LEFT, controls),
    holdButton("▶", "ff-pad ff-pad-right", RIGHT, controls),
  );
  stage.append(screen, touch);

  const controller = el("section", "", "ff-controller"),
    controllerHead = el("header", "", "ff-controller-head"),
    controllerName = el("b"),
    controllerState = el("span"),
    controllerBody = el("div", "", "ff-controller-body");
  const controllerIcon = el("span", "", "ff-controller-icon");
  controllerHead.append(controllerIcon, controllerName, controllerState);
  controllerBody.append(
    holdButton("◀ LEFT", "ff-pad ff-pad-left ff-pad-big", LEFT, controls),
    holdButton("RIGHT ▶", "ff-pad ff-pad-right ff-pad-big", RIGHT, controls),
  );
  controller.append(controllerHead, controllerBody);

  // Until the first frame nothing of the room shows, so a room that turns out not to exist never offers its controls.
  const connecting = el("p", "Connecting to the depot…", "ff-connecting"),
    closed = el("section", "", "ff-closed"),
    closedBack = el(
      "a",
      "BACK TO FUSE FREIGHT",
      "fui-button-primary ff-closed-back",
    );
  closedBack.href = withFlags(endpoints.appUrl());
  closed.append(
    el("h2", "ROOM CLOSED", "fui-lobby-title"),
    el(
      "p",
      "This room has ended, or it never existed. Start a new one, or play solo.",
    ),
    closedBack,
  );
  closed.hidden = true;
  const main = el("main", "", "ff-room");
  // The name form stands above every screen: a newcomer mid-match picks a name and drives from the next round.
  main.append(
    connecting,
    closed,
    nameEntry.form,
    lobby,
    lobbyRules,
    stage,
    controller,
  );
  app.replaceChildren(top, main);
  lobby.hidden = true;
  lobbyRules.hidden = true;
  stage.hidden = true;
  controller.hidden = true;
  nameEntry.form.hidden = true;
  let over = false;

  // ---- drawing ----
  const g = canvas.getContext("2d")!;
  const scene = createScene(g, make);
  let scale = 1;
  const fit = () => {
    const box = screen.getBoundingClientRect(),
      ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(box.width * ratio));
    canvas.height = Math.max(1, Math.round(box.height * ratio));
    scale = canvas.width / VIEW_W;
  };
  new ResizeObserver(fit).observe(screen);
  let model: Model | undefined;
  animations.add((now) => {
    const timing = runtime.frameTiming();
    if (!timing?.newer.world || stage.hidden) return;
    const alpha = fraction(timing.older?.tick, timing.newer.tick, timing.tick);
    const world = blend(timing.older?.world, timing.newer.world, alpha);
    g.setTransform(scale, 0, 0, scale, 0, 0);
    scene.draw({
      world,
      me: viewer.me,
      labels: model?.labels ?? new Map(),
      now,
      reducedMotion,
    });
  });

  // ---- the HUD ----
  const cards = new Map<string, Record<string, HTMLElement>>();
  const renderCards = (list: Card[]) => {
    for (const [id, card] of cards)
      if (!list.some((c) => c.id === id)) {
        card.root!.remove();
        cards.delete(id);
      }
    list.forEach((c, index) => {
      let card = cards.get(c.id);
      if (!card) {
        const root = el("article", "", "ff-card");
        card = {
          root,
          icon: icon(c.slot),
          tag: el("b", "", "ff-card-tag"),
          name: el("span", "", "ff-card-name"),
          score: el("b", "", "ff-card-score"),
          carry: el("span", "", "ff-card-carry"),
          wins: el("span", "", "ff-card-wins"),
        };
        const label = el("span", "", "ff-card-label");
        label.append(card.tag!, card.name!);
        const numbers = el("span", "", "ff-card-numbers");
        numbers.append(card.score!, card.carry!);
        root.append(card.icon!, label, numbers, card.wins!);
        cards.set(c.id, card);
      }
      const root = card.root!;
      // Up to three cards on each side of the clock, in seat order.
      const side = index < Math.ceil(list.length / 2) ? cardsLeft : cardsRight;
      if (root.parentElement !== side) side.append(root);
      root.style.setProperty("--c", seatColor(c.slot));
      root.style.order = String(c.slot);
      root.dataset.state = c.state;
      root.classList.toggle("you", c.you);
      root.classList.toggle("away", c.away);
      root.classList.toggle("full", c.full);
      root.classList.toggle("lead", c.place === 1 && c.score > 0);
      setText(card.tag!, c.you ? "YOU" : c.tag);
      setText(card.name!, c.name);
      setText(card.score!, String(c.score).padStart(2, "0"));
      setText(
        card.carry!,
        c.full ? "FULL" : c.carrying ? `+${c.carrying}` : "",
      );
      setText(card.wins!, c.wins ? "♛".repeat(Math.min(3, c.wins)) : "");
    });
  };

  const render = (next: Model, view: View) => {
    if (over) return;
    model = next;
    connecting.hidden = true;
    main.dataset.screen = next.screen;
    main.dataset.stage = view.stage;
    lobby.hidden = next.screen !== "lobby";
    lobbyRules.hidden = next.screen !== "lobby" || display;
    stage.hidden = next.screen !== "play";
    controller.hidden = next.screen !== "controller";
    nameEntry.form.hidden = !next.askName;
    // Lobby.
    roster.update(
      next.lobby.members.map((member) => ({
        id: member.id,
        name: member.you ? `${member.name} (you)` : member.name,
        color: seatColor(member.slot),
        status: member.bot
          ? "AI DRIVER"
          : member.connected
            ? `P${member.slot + 1} ✓`
            : "OFFLINE",
      })),
    );
    for (const [id, row] of roster.entries()) {
      let remove = row.querySelector<HTMLButtonElement>(".ff-remove");
      const removable = next.lobby.removable.includes(id);
      if (removable && !remove) {
        remove = button("×", "ff-remove");
        remove.setAttribute("aria-label", "Remove bot");
        remove.onclick = () =>
          runtime.command({ type: "bot", action: "remove", id });
        row.append(remove);
      }
      if (remove) remove.hidden = !removable;
    }
    bayState = [0, 1, 2, 3, 4].map((slot) => {
      const member = next.lobby.members.find((m) => m.slot === slot);
      return { slot, taken: !!member, you: member?.you ?? false };
    });
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
    showWins(view.settings.wins, next.lobby.editable);
    showSeconds(view.settings.seconds, next.lobby.editable);
    backToLobby.hidden = !(viewer.host && view.stage !== "lobby" && !display);
    // HUD.
    renderCards(next.cards);
    setText(clockValue, next.time);
    clock.classList.toggle("urgent", next.urgent);
    setText(callout, next.callout);
    callout.hidden = !next.callout;
    setText(roundLine, next.round);
    banner.hidden = !next.banner;
    if (next.banner) {
      setText(bannerTitle, next.banner.title);
      setText(bannerDetail, next.banner.detail);
      bannerDetail.hidden = !next.banner.detail;
      banner.dataset.tone = next.banner.tone;
    }
    board.hidden = !next.board;
    if (next.board) {
      setText(boardTitle, next.board.title);
      setText(boardNext, next.board.next);
      const key = JSON.stringify(next.board.rows);
      if (boardRows.dataset.rows !== key) {
        boardRows.dataset.rows = key;
        boardRows.replaceChildren(
          ...next.board.rows.map((row) => {
            const item = el("li", "");
            item.style.setProperty("--c", seatColor(row.slot));
            item.append(
              el("b", String(row.place), "ff-board-place"),
              icon(row.slot),
              el("span", row.name, "ff-board-name"),
              el("b", String(row.score), "ff-board-score"),
              el("small", row.detail),
            );
            return item;
          }),
        );
      }
    }
    setText(note, next.note);
    note.hidden = !next.note;
    hint.hidden =
      !(next.driving || view.world?.phase === "countdown") || display;
    // Touch buttons: on touch screens, while this device drives.
    touch.hidden = !(coarse() && next.driving && !display);
    // The phone controller.
    const mine = next.cards.find((c) => c.you);
    if (mine) {
      controller.style.setProperty("--c", seatColor(mine.slot));
      if (controllerIcon.dataset.slot !== String(mine.slot)) {
        controllerIcon.dataset.slot = String(mine.slot);
        controllerIcon.replaceChildren(icon(mine.slot));
      }
      setText(controllerName, `${mine.tag} · ${mine.name}`);
      setText(
        controllerState,
        next.banner?.title ??
          (next.board
            ? next.board.next
            : mine.state === "out"
              ? "NEXT ROUND"
              : `${mine.score} DELIVERED${mine.carrying ? ` · +${mine.carrying}` : ""}${mine.full ? " · FULL" : ""}`),
      );
    }
    // Result.
    result.hidden = !next.result || next.screen === "controller";
    if (next.result) {
      setText(resultTitle, next.result.title);
      const lines = next.result.lines.join("\n");
      if (resultLines.dataset.lines !== lines) {
        resultLines.dataset.lines = lines;
        resultLines.replaceChildren(
          ...next.result.lines.map((line) => el("li", line)),
        );
      }
      resultActions.hidden = !next.result.host;
      setText(resultWaiting, next.result.waiting);
      resultWaiting.hidden = !next.result.waiting;
    }
  };

  // ---- sounds ----
  const heard = new Set<string>();
  let lastBanner = "",
    lastSeed = -1,
    lastFull = false,
    lastPhase = "";
  const listen = (view: View, next: Model) => {
    const mood: Mood =
      view.stage === "running" && view.world?.phase === "play"
        ? next.urgent
          ? "final"
          : "round"
        : "menu";
    audio.mood(mood);
    const world = view.world;
    if (!world) return;
    if (world.seed !== lastSeed) {
      lastSeed = world.seed;
      heard.clear();
      for (const fx of world.fx) heard.add(effectKey(fx));
    }
    // Keyed by what happened, not by id: a rollback that renumbers effects does not replay their sounds.
    for (const fx of world.fx)
      if (!heard.has(effectKey(fx))) {
        heard.add(effectKey(fx));
        // On a crowded floor only this device's own cargo pings; cuts and deliveries always sound.
        const own = world.trains.find((t) => t.id === viewer.me)?.slot;
        if (fx.kind === "collect" && own !== undefined && fx.slot !== own)
          continue;
        if (fx.kind === "spawn" || fx.kind === "wall") {
          if (fx.slot !== own) continue;
        }
        audio.play(fx.kind as Cue);
      }
    if (heard.size > 2000) heard.clear();
    const full = next.cards.find((c) => c.you)?.full ?? false;
    if (full && !lastFull) audio.play("full");
    lastFull = full;
    const phase = `${view.round}:${world.phase}`;
    if (phase !== lastPhase) {
      if (world.phase === "outro") audio.play("whistle");
      lastPhase = phase;
    }
    const title = next.banner?.title ?? "";
    if (title !== lastBanner) {
      if (["3", "2", "1"].includes(title)) audio.play("count");
      else if (title === "GO!") audio.play("go");
      else if (title.includes("SECONDS LEFT")) audio.play("final");
      else if (title.includes("WINS") || title.startsWith("SHARED"))
        audio.play("win");
      lastBanner = title;
    }
  };

  // ---- the runtime ----
  const remembered = seatName(store.getItem(names.name) ?? "");
  let joinSent = false;
  const callbacks: FreightCallbacks = {
    state(frame, roomSettings) {
      settings = roomSettings;
      const next = present(frame, viewer);
      main.dataset.round = String(frame.round);
      if (next.askName && remembered && !joinSent) {
        joinSent = true;
        runtime.command({ type: "join", name: remembered });
      }
      if (next.seated) joinSent = false;
      render(next, frame);
      listen(frame, next);
      // For smokes and demos: `?autopilot` drives this device's train with the AI's answer, through the same
      // held-controls path a player's keys take.
      const room = autopilot ? runtime.roomState() : undefined,
        mine = room?.world?.trains.find((t) => t.id === viewer.me);
      if (room?.world && mine && room.stage === "running")
        controls.hold("autopilot", botInput(room.world, mine));
      runtime.flush();
      main.dataset.driving = String(next.driving);
      main.dataset.phase = frame.world?.phase ?? "";
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
      controls.clear();
      for (const part of [
        connecting,
        nameEntry.form,
        lobby,
        lobbyRules,
        stage,
        controller,
      ])
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
  const runtime = new FreightRuntime(
    code,
    { ...DEFAULT_SETTINGS, display: shared },
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

  // Keys: while this device drives, ours are swallowed so arrows never scroll or move a focused control; otherwise a
  // focused button, field or select keeps its own keys (REMATCH, START and the name form work from the keyboard).
  const typing = (target: EventTarget | null) =>
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLButtonElement && !model?.driving);
  const captured = new Set<string>();
  document.addEventListener("keydown", (event) => {
    if (typing(event.target) || event.metaKey || event.ctrlKey || event.altKey)
      return;
    if (controls.press(event.code)) {
      captured.add(event.code);
      event.preventDefault();
    }
  });
  document.addEventListener("keyup", (event) => {
    controls.release(event.code);
    if (captured.delete(event.code)) event.preventDefault();
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
