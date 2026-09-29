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
  COMBAT_MODES,
  DEFAULT_SETTINGS,
  DOWN,
  FIRE,
  LEFT,
  LIFT_MODES,
  RIGHT,
  UP,
  WIN_TARGETS,
  botInput,
  type Settings,
} from "../engine/index.js";
import { chopperGame, type View } from "../online/game.js";
import { seatName } from "../online/names.js";
import { ChopperRuntime, type ChopperCallbacks } from "../online/runtime.js";
import { blend, fraction } from "../render/interpolate.js";
import { createScene, effectKey, VIEW_W } from "../render/scene.js";
import { PICKUP_COLORS, seatColor } from "../render/palette.js";
import { createSfx } from "./audio.js";
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
 * The page's glue: it reads the query, builds the screens from fuse-ui components and its own HUD, wires the
 * runtime to the transport, draws every animation frame from the runtime's frame timing and turns keys and touches
 * into held control bits. The decisions live in the presenter, the renderer and the engine.
 */
const GAME = chopperGame.id;
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
const muted = query.has("mute");
const autopilot = query.has("autopilot");
const app = document.querySelector<HTMLElement>("#app")!;
const secret = () => uuid().replaceAll("-", "") + uuid().replaceAll("-", "");
/** A link within the game that keeps this page's developer flags: `mute`, `autopilot`, `lift` and `combat`. */
const DEV_FLAGS = ["mute", "autopilot", "lift", "combat"] as const;
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

/**
 * Developer switches for the room a page creates (or plays solo): `?lift=thrust` starts on the W/S thrust trial,
 * `?combat=bump` (or `shoot`, `off`) on another nudge mode. The lobby's flight rules change them afterwards.
 */
function devSettings(): Settings {
  const lift = query.get("lift"),
    combat = query.get("combat");
  return {
    ...DEFAULT_SETTINGS,
    ...(LIFT_MODES.find((mode) => mode === lift)
      ? { lift: lift as Settings["lift"] }
      : {}),
    ...(COMBAT_MODES.find((mode) => mode === combat)
      ? { combat: combat as Settings["combat"] }
      : {}),
  };
}

function logo(): HTMLElement {
  const brand = el("a", "", "fc-brand");
  brand.href = withFlags(endpoints.appUrl());
  brand.append(
    el("b", "FUSE", "fc-brand-fuse"),
    el("b", "CHOPPERS", "fc-brand-choppers"),
    el("small", "MULTIPLAYER CAVE CHAOS"),
  );
  return brand;
}
function header(extra: HTMLElement[] = []): HTMLElement {
  const bar = el("header", "", "fc-top");
  bar.append(logo(), ...extra);
  return bar;
}

function keyHelp(): HTMLElement {
  const list = el("dl", "", "fc-keys");
  for (const [keysText, what] of [
    ["SPACE / W / ↑", "Hold to climb, let go to fall"],
    ["A D / ← →", "Fly back and forward"],
    ["F / J / K / ENTER / CLICK", "Fire: nudges rivals, downs drones"],
    ["S / ↓", "Dive (W/S thrust trial only)"],
  ])
    list.append(el("dt", keysText), el("dd", what));
  return list;
}

function landing(): void {
  const shared = el("label", "", "fc-shared"),
    toggle = el("input");
  toggle.type = "checkbox";
  toggle.checked = store.getItem(names.shared) === "1";
  toggle.onchange = () =>
    store.setItem(names.shared, toggle.checked ? "1" : "0");
  shared.append(toggle, el("span", "Shared TV: phones are the controllers"));
  const card = createLandingCard({
    title: "FUSE CHOPPERS",
    tagline:
      "Hold to climb, let go to fall. The cave scrolls, the crush zone closes in and your friends' shots knock you about. Be the last chopper flying, or first through the exit.",
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
  card.element.append(keyHelp());
  const back = el("a", "← FUSE RIDERS", "fc-back");
  back.href = import.meta.env.BASE_URL + (muted ? "?mute" : "");
  app.replaceChildren(header([back]), card.element);
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
    const back = el("a", "← BACK", "fc-back");
    back.href = withFlags(endpoints.appUrl());
    app.replaceChildren(
      header([back]),
      el("p", "That is not a room code: check it and try again.", "fc-error"),
    );
    return;
  }
  const code = session.kind === "room" ? session.code : "SOLO",
    role = session.kind === "room" ? session.role : "host",
    display = role === "display";
  document.body.classList.toggle("fc-display", display);
  const viewer: Viewer = { me: "", host: solo, solo, display };
  const sfx = createSfx(muted);

  // ---- the page ----
  const status = createNotice({ className: "fc-status" }),
    leave = button(solo ? "EXIT" : "LEAVE", "fc-leave");
  leave.onclick = () => {
    runtime.stop();
    location.href = withFlags(endpoints.appUrl());
  };
  // The host can go back to the lobby (and its flight rules) mid-match; in solo that is the only way to them.
  const backToLobby = button("LOBBY", "fc-to-lobby");
  backToLobby.onclick = () =>
    runtime.command({ type: "action", action: "lobby" });
  backToLobby.hidden = true;
  const top = header([
    el("strong", solo ? "SOLO" : code, "fc-code"),
    status.element,
    backToLobby,
    leave,
  ]);

  // Lobby.
  const lobby = el("section", "", "fc-lobby"),
    lobbyMain = el("div", "", "fc-lobby-main"),
    lobbySide = el("aside", "", "fc-lobby-side"),
    roster = createRoster({ emptyText: "No pilots yet" }),
    addBot = button("+ ADD BOT", "fc-add-bot"),
    start = button("TAKE OFF", "fui-button-primary fc-start"),
    lobbyNote = el("p", "", "fui-lobby-note"),
    tvLink = button("OPEN TV SCREEN", "fc-tv");
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
  lobbyMain.append(
    el("h2", "PILOTS", "fui-lobby-title"),
    roster.element,
    addBot,
  );
  addBot.onclick = () => runtime.command({ type: "bot", action: "add" });
  start.onclick = () => runtime.command({ type: "action", action: "start" });
  tvLink.onclick = () =>
    window.open(
      withFlags(endpoints.appUrl(`?room=${code}&display=1`)),
      "_blank",
    );

  // Flight rules: the host's to change.
  let settings: Settings = { ...DEFAULT_SETTINGS };
  const rules = el("div", "", "fc-rules");
  const choice = <K extends keyof Settings>(
    key: K,
    label: string,
    options: readonly [Settings[K], string][],
  ) => {
    const row = el("label", "", "fc-rule"),
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
      runtime.command({
        type: "settings",
        settings: { ...settings, [key]: picked[0] },
      });
    };
    row.append(el("span", label), select);
    rules.append(row);
    return (value: Settings[K], editable: boolean) => {
      if (select.value !== String(value)) select.value = String(value);
      select.disabled = !editable;
    };
  };
  const liftText = {
    classic: "Classic: hold to climb",
    thrust: "DEV trial: W/S thrust",
  };
  const combatText = {
    all: "Shots + bumps",
    shoot: "Shots only",
    bump: "Bumps only",
    off: "No combat",
  };
  const showLift = choice(
    "lift",
    "CONTROLS",
    LIFT_MODES.map((mode) => [mode, liftText[mode]] as const),
  );
  const showCombat = choice(
    "combat",
    "NUDGES",
    COMBAT_MODES.map((mode) => [mode, combatText[mode]] as const),
  );
  const showPowerUps = choice("powerUps", "POWER-UPS", [
    [true, "On"],
    [false, "Off"],
  ]);
  const showWins = choice(
    "wins",
    "CROWNS TO WIN",
    WIN_TARGETS.map((wins) => [wins, String(wins)] as const),
  );
  const lobbyActions = el("div", "", "fc-lobby-actions");
  lobbyActions.append(tvLink, start);
  lobbySide.append(
    el("h2", "FLIGHT RULES", "fui-lobby-title"),
    rules,
    el(
      "p",
      "The W/S trial is a developer experiment: W flies up, S flies down, and the chopper hovers when neither is held.",
      "fc-dev-note",
    ),
    lobbyNote,
    lobbyActions,
    keyHelp(),
  );
  lobby.append(lobbyMain, lobbySide);

  // The cave: canvas, HUD, banner and the result card on one 16:9 screen.
  const stage = el("section", "", "fc-stage"),
    screen = el("div", "", "fc-screen"),
    canvas = el("canvas", "", "fc-canvas") as HTMLCanvasElement,
    hud = el("div", "", "fc-hud"),
    cardsRow = el("div", "", "fc-cards"),
    time = el("div", "", "fc-time"),
    timeValue = el("b", "00:00.0"),
    progress = el("i"),
    roundLine = el("small", "", "fc-round"),
    legend = el("div", "", "fc-legend"),
    banner = el("div", "", "fc-banner"),
    bannerTitle = el("strong"),
    bannerDetail = el("span"),
    note = el("div", "", "fc-note");
  const bar = el("span", "", "fc-progress");
  bar.append(progress);
  time.append(el("small", "TIME"), timeValue, bar);
  legend.append(el("h3", "RACE TO SURVIVE!"));
  const legendList = el("ul");
  for (const [icon, text] of [
    ["scroll", "SCROLLS RIGHT"],
    ["crush", "AVOID THE CRUSH ZONE"],
    ["power", "PICK UP POWER-UPS"],
    ["hit", "HIT RIVALS"],
    ["exit", "REACH THE EXIT"],
  ]) {
    const item = el("li", "");
    item.append(el("i", "", `fc-icon fc-icon-${icon}`), el("span", text));
    legendList.append(item);
  }
  legend.append(legendList);
  banner.append(bannerTitle, bannerDetail);
  const hudLogo = logo();
  hudLogo.classList.add("fc-hud-logo");
  hud.append(hudLogo, cardsRow, time, roundLine, legend, banner, note);
  const result = el("section", "", "fc-result"),
    resultTitle = el("h2"),
    resultLines = el("ol"),
    resultWaiting = el("p", "", "fui-lobby-note"),
    resultActions = el("div", "", "fc-lobby-actions"),
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

  // Touch pads over the screen, and the phone controller for a shared screen.
  const controls = new HeldControls((bits) => runtime.input(bits));
  const touch = el("div", "", "fc-touch"),
    touchLeft = el("div", "", "fc-touch-side"),
    touchRight = el("div", "", "fc-touch-side fc-touch-right");
  const pads = (into: HTMLElement[], big: boolean) => {
    const [left, right] = into;
    const liftPad = holdButton(
        big ? "HOLD TO CLIMB" : "LIFT",
        "fc-pad fc-pad-lift",
        UP,
        controls,
      ),
      divePad = holdButton("DIVE", "fc-pad fc-pad-dive", DOWN, controls);
    left!.append(
      holdButton("◀", "fc-pad fc-pad-left", LEFT, controls),
      holdButton("▶", "fc-pad fc-pad-right", RIGHT, controls),
    );
    right!.append(
      holdButton("FIRE", "fc-pad fc-pad-fire", FIRE, controls),
      divePad,
      liftPad,
    );
    return { liftPad, divePad };
  };
  const touchPads = pads([touchLeft, touchRight], false);
  touch.append(touchLeft, touchRight);
  stage.append(screen, touch);

  const controller = el("section", "", "fc-controller"),
    controllerHead = el("header", "", "fc-controller-head"),
    controllerName = el("b"),
    controllerState = el("span"),
    controllerLeft = el("div", "", "fc-controller-side"),
    controllerRight = el("div", "", "fc-controller-side fc-controller-right");
  controllerHead.append(
    el("span", "", "fc-helmet"),
    controllerName,
    controllerState,
  );
  const controllerPads = pads([controllerLeft, controllerRight], true);
  const controllerBody = el("div", "", "fc-controller-body");
  controllerBody.append(controllerLeft, controllerRight);
  controller.append(controllerHead, controllerBody);

  // Until the first frame nothing of the room shows, so a room that turns out not to exist never offers its controls.
  const connecting = el("p", "Connecting to the room…", "fc-connecting"),
    closed = el("section", "", "fc-closed"),
    closedBack = el(
      "a",
      "BACK TO FUSE CHOPPERS",
      "fui-button-primary fc-closed-back",
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
  const main = el("main", "", "fc-room");
  // The name form stands above every screen: a newcomer mid-match picks a name and flies from the next round.
  main.append(connecting, closed, nameEntry.form, lobby, stage, controller);
  app.replaceChildren(top, main);
  lobby.hidden = true;
  stage.hidden = true;
  controller.hidden = true;
  nameEntry.form.hidden = true;
  let over = false;

  // ---- drawing ----
  const g = canvas.getContext("2d")!;
  const scene = createScene(g, (width, height) => {
    const surface = document.createElement("canvas");
    surface.width = width;
    surface.height = height;
    return surface;
  });
  let scale = 1;
  const fit = () => {
    const box = screen.getBoundingClientRect(),
      ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(box.width * ratio));
    canvas.height = Math.max(1, Math.round(box.height * ratio));
    scale = canvas.width / VIEW_W;
  };
  new ResizeObserver(fit).observe(screen);
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let model: Model | undefined;
  const frame = (now: number) => {
    const timing = runtime.frameTiming();
    if (timing?.newer.world && !stage.hidden) {
      const alpha = fraction(
        timing.older?.tick,
        timing.newer.tick,
        timing.tick,
      );
      const world = blend(timing.older?.world, timing.newer.world, alpha);
      g.setTransform(scale, 0, 0, scale, 0, 0);
      scene.draw({
        world,
        me: viewer.me,
        labels: model?.labels ?? new Map(),
        now,
        reducedMotion,
      });
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // ---- the HUD ----
  const cards = new Map<string, Record<string, HTMLElement>>();
  const renderCards = (list: Card[]) => {
    for (const [id, card] of cards)
      if (!list.some((c) => c.id === id)) {
        card.root!.remove();
        cards.delete(id);
      }
    list.forEach((c) => {
      let card = cards.get(c.id);
      if (!card) {
        const root = el("article", "", "fc-card");
        card = {
          root,
          tag: el("b", "", "fc-card-tag"),
          name: el("span", "", "fc-card-name"),
          crowns: el("span", "", "fc-card-crowns"),
          dots: el("span", "", "fc-card-dots"),
        };
        root.append(
          el("span", "", "fc-helmet"),
          card.tag!,
          card.name!,
          card.crowns!,
          card.dots!,
        );
        for (let i = 0; i < 3; i++) card.dots!.append(el("i"));
        cards.set(c.id, card);
        cardsRow.append(root);
      }
      const root = card.root!;
      root.style.setProperty("--c", seatColor(c.slot));
      root.style.order = String(c.slot);
      root.dataset.state = c.state;
      root.classList.toggle("you", c.you);
      root.classList.toggle("away", c.away);
      setText(card.tag!, c.tag);
      setText(card.name!, c.you ? `${c.name} (you)` : c.name);
      setText(card.crowns!, `♛ ${c.crowns}`);
      const lit = [
        ...c.effects
          .filter((e) => e !== "stun")
          .map((e) => PICKUP_COLORS[e as keyof typeof PICKUP_COLORS]),
      ];
      [...card.dots!.children].forEach((dot, i) =>
        (dot as HTMLElement).style.setProperty("--dot", lit[i] ?? ""),
      );
    });
  };

  const render = (next: Model, view: View) => {
    if (over) return;
    model = next;
    connecting.hidden = true;
    main.dataset.screen = next.screen;
    main.dataset.stage = view.stage;
    lobby.hidden = next.screen !== "lobby";
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
          ? "AI PILOT"
          : member.connected
            ? `P${member.slot + 1}`
            : "OFFLINE",
      })),
    );
    for (const [id, row] of roster.entries()) {
      let remove = row.querySelector<HTMLButtonElement>(".fc-remove");
      const removable = next.lobby.removable.includes(id);
      if (removable && !remove) {
        remove = button("×", "fc-remove");
        remove.setAttribute("aria-label", "Remove bot");
        remove.onclick = () =>
          runtime.command({ type: "bot", action: "remove", id });
        row.append(remove);
      }
      if (remove) remove.hidden = !removable;
    }
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
    showLift(view.settings.lift, next.lobby.editable);
    showCombat(view.settings.combat, next.lobby.editable);
    showPowerUps(view.settings.powerUps, next.lobby.editable);
    showWins(view.settings.wins, next.lobby.editable);
    lobbySide.hidden = display;
    backToLobby.hidden = !(viewer.host && view.stage !== "lobby" && !display);
    // HUD.
    renderCards(next.cards);
    setText(timeValue, next.time);
    progress.style.width = `${(next.progress * 100).toFixed(1)}%`;
    setText(roundLine, next.round);
    banner.hidden = !next.banner;
    if (next.banner) {
      setText(bannerTitle, next.banner.title);
      setText(bannerDetail, next.banner.detail);
      banner.dataset.tone = next.banner.tone;
    }
    setText(note, next.note);
    note.hidden = !next.note;
    legend.classList.toggle("fc-legend-quiet", (view.world?.played ?? 0) > 600);
    // Touch pads: on touch screens, while this device flies.
    const thrust = view.play.lift === "thrust";
    touch.hidden = !(coarse() && next.flying && !display);
    for (const set of [touchPads, controllerPads]) {
      set.divePad.hidden = !thrust;
      setText(
        set.liftPad,
        thrust ? "▲ UP" : set === controllerPads ? "HOLD TO CLIMB" : "LIFT",
      );
    }
    // The phone controller.
    const mine = next.cards.find((c) => c.you);
    if (mine) {
      controller.style.setProperty("--c", seatColor(mine.slot));
      setText(controllerName, `${mine.tag} · ${mine.name}`);
      setText(
        controllerState,
        next.banner?.title ??
          (mine.state === "crashed"
            ? "CRASHED"
            : mine.state === "escaped"
              ? "ESCAPED!"
              : mine.state === "out"
                ? "NEXT ROUND"
                : `♛ ${mine.crowns}`),
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
    lastSeed = -1;
  const listen = (view: View, next: Model) => {
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
        sfx.play(fx.kind);
      }
    const mySlot = world.choppers.find((c) => c.id === viewer.me)?.slot;
    for (const bullet of world.bullets)
      if (!heard.has(`shot:${bullet.id}`)) {
        heard.add(`shot:${bullet.id}`);
        if (bullet.slot === mySlot) sfx.play("shot");
      }
    if (heard.size > 2000) heard.clear();
    const title = next.banner?.title ?? "";
    if (title !== lastBanner) {
      if (["3", "2", "1"].includes(title)) sfx.play("count");
      else if (title === "GO!") sfx.play("go");
      else if (title.includes("WINS")) sfx.play("crown");
      lastBanner = title;
    }
  };

  // ---- the runtime ----
  const remembered = seatName(store.getItem(names.name) ?? "");
  let joinSent = false;
  const callbacks: ChopperCallbacks = {
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
      // For smokes and demos: `?autopilot` flies this device's chopper with the AI's answer, through the same
      // held-controls path a player's keys take.
      const room = autopilot ? runtime.roomState() : undefined,
        mine = room?.world?.choppers.find((c) => c.id === viewer.me);
      if (room?.world && mine && room.stage === "running")
        controls.hold("autopilot", botInput(room.world, mine));
      runtime.flush();
      main.dataset.flying = String(next.flying);
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
  const runtime = new ChopperRuntime(
    code,
    { ...devSettings(), display: shared },
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

  // Keys: while this device flies, ours are swallowed so Space never scrolls or presses a focused button; otherwise a
  // focused button, field or select keeps its own keys (REMATCH, TAKE OFF and the name form work from the keyboard).
  const typing = (target: EventTarget | null) =>
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLButtonElement && !model?.flying);
  const captured = new Set<string>();
  document.addEventListener("keydown", (event) => {
    sfx.resume();
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
  document.addEventListener("pointerdown", () => sfx.resume(), {
    passive: true,
  });
  canvas.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    canvas.setPointerCapture(event.pointerId);
    controls.hold("mouse", FIRE);
  });
  const mouseUp = () => controls.hold("mouse", 0);
  canvas.addEventListener("pointerup", mouseUp);
  canvas.addEventListener("lostpointercapture", mouseUp);
  runtime.start();
}

if (query.get("solo") === "1") room(true);
else if (query.has("room")) room(false);
else landing();
