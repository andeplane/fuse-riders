import { createTopBar } from "fuse-ui";
import { requestedRoomSlot } from "fuse-ui";
import { createGameSocial } from "fuse-ui/social";
import "fuse-ui/social.css";
import { startGameAnalytics, createPlayMetrics } from "fuse-ui/play-metrics";
import "@fontsource/press-start-2p/latin.css";
import "fuse-ui/tokens.css";
import "fuse-ui/components.css";
import "fuse-ui/portal.css";
import {
  bindAudioInput,
  browserAudioDependencies,
  createAudioControl,
  createGameAudio,
} from "fuse-ui/game-audio";
import "fuse-ui/game-audio.css";
import { safeStorage } from "fuse-ui/safe-storage";
import "./fuseball.css";
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
  createGameMenu,
  createInviteCard,
  createLandingCard,
  createRoomLayout,
  createNameEntry,
  createNotice,
  createRoster,
  createRoundControls,
  el,
} from "fuse-ui";
import {
  BTN,
  MAP_IDS,
  TEAM_MAP_IDS,
  isTeamMapId,
  RANDOM,
  mapOf,
  isCircle,
  isMapId,
  type MapDef,
  type MapId,
} from "../engine/index.js";
import { GAME_ID } from "../basics.js";
import {
  DEFAULT_SETTINGS,
  settingsFor,
  type Settings,
  type View,
} from "../online/game.js";
import { seatName } from "../online/names.js";
import { FuseballRuntime, type FuseballCallbacks } from "../online/runtime.js";
import { blend, fraction } from "../render/interpolate.js";
import {
  GADGET,
  PORTAL,
  TEAM,
  TEAM_LIGHT,
  teamColor,
} from "../render/palette.js";
import { createScene, guarded, solidCopies } from "../render/scene.js";
import { createSfx } from "./audio.js";
import {
  HeldControls,
  PadSet,
  autopilotBits,
  bindButton,
  bindStick,
  type PadSurface,
} from "./controls.js";
import {
  MAP_BLURBS,
  MODES,
  createGoalWatch,
  playRound,
  present,
  type Model,
  type Viewer,
} from "./presenter.js";
import { dueReports, sendReport } from "./reports.js";
import {
  NOT_OPEN,
  keys,
  roomFailure,
  safeStore,
  sessionFor,
  seedFromText,
} from "./session.js";

/**
 * The Fuseball page's glue: it reads the query, builds the screens from fuse-ui components, wires the runtime to
 * the transport, draws every animation frame from the runtime's frame timing and turns keys and touches into held
 * control bits. The decisions live in the presenter, the renderer and the engine; nothing here simulates.
 */
const GAME = GAME_ID;
const analytics = startGameAnalytics(GAME);
const reportPlay = createPlayMetrics(analytics.track, () => performance.now());
const endpoints = createEndpoints(
  {
    basePath: `${import.meta.env.BASE_URL}${GAME}/`,
    apiOrigin: import.meta.env.VITE_API_ORIGIN,
  },
  location.origin,
);
const social = createGameSocial({
  gameId: GAME,
  base: import.meta.env.BASE_URL,
  apiOrigin: import.meta.env.VITE_API_ORIGIN,
  document,
  window,
  fetch: (input, init) => fetch(input, init),
  track: analytics.track,
});
const store = safeStore(() => localStorage);
const names = keys(GAME);
const mapKey = `${GAME}-map`;
const seedKey = `${GAME}-seed`;
const sizeKey = `${GAME}-size`;
const query = new URLSearchParams(location.search);
const muted = query.has("mute");
/** One sound bus for the page: the mute and volumes are remembered across games, `?mute` keeps a preview silent. */
const audio = createGameAudio(
  browserAudioDependencies(safeStorage(() => localStorage)),
  { forceMute: muted },
);
// Music is supplied by the shared header; this bus owns the game effects.
bindAudioInput(audio, document, window);
const audioControl = createAudioControl(document, audio, { music: false });
const app = document.querySelector<HTMLElement>("#app")!;
const secret = () => uuid().replaceAll("-", "") + uuid().replaceAll("-", "");
/** For smokes and demos: `?autopilot` rides this device's rider with the bot's answers, through the same held controls. */
const autopilot = query.has("autopilot");
/** A link within the game that keeps this page's developer flags, `mute` and `autopilot`. */
const withFlags = (path: string) => {
  const kept = ["mute", "autopilot"].filter((flag) => query.has(flag));
  return kept.length
    ? `${path}${path.includes("?") ? "&" : "?"}${kept.join("&")}`
    : path;
};
const setText = (node: HTMLElement, value: string) => {
  if (node.textContent !== value) node.textContent = value;
};
const coarse = () => matchMedia("(pointer: coarse)").matches;
/** The arena this device last chose, for the room it creates or its solo match; `?map=` overrides it. */
const chosenMap = (): MapId => {
  const asked = query.get("map"),
    saved = store.getItem(mapKey);
  const map = isMapId(asked) ? asked : isMapId(saved) ? saved : MAP_IDS[0];
  // A link that asks for a team size and no team arena gets the first one.
  return /^[23]$/.test(query.get("size") ?? "") && !isTeamMapId(map)
    ? TEAM_MAP_IDS[0]
    : map;
};
/** Riders a side, as this device last chose: `?size=` overrides it, and the arena has the last word. */
const chosenSize = (): number => {
  const asked = Number(query.get("size") ?? store.getItem(sizeKey) ?? 0),
    size = asked === 2 || asked === 3 ? asked : 1;
  return isTeamMapId(chosenMap()) ? Math.max(2, size) : 1;
};
const chosenSeed = () =>
  seedFromText(query.get("seed")) ?? seedFromText(store.getItem(seedKey)) ?? 0;
const rollSeed = () => crypto.getRandomValues(new Uint32Array(1))[0]!;

const GUIDE = {
  controls: [
    { keys: "A D / ← →", action: "Run, and steer in the air" },
    {
      keys: "SPACE / J / K",
      action: "Jump. Next to the ball, the jump lifts it",
    },
    {
      keys: "SPACE in the air",
      action: "Air-jump, as often as you like: each leaves a bubble",
    },
    { keys: "Hold SPACE", action: "Harden your bubble: nothing pops it" },
    { keys: "S / ↓ + SPACE", action: "Slide on the ground, drop in the air" },
  ],
  touchControls: [
    { keys: "STICK", action: "Run, and steer in the air" },
    { keys: "JUMP", action: "Jump. Next to the ball, the jump lifts it" },
    {
      keys: "JUMP in the air",
      action: "Air-jump, as often as you like: each leaves a bubble",
    },
    { keys: "Hold JUMP", action: "Harden your bubble: nothing pops it" },
    {
      keys: "STICK down + JUMP",
      action: "Slide on the ground, drop in the air",
    },
  ],
  goal: "Knock the ball into the goal in YOUR colour to score and zap the other rider. First to 3 wins.",
} as const;

/** The same in three lines, for the reminder over a match's first countdown. */
const QUICK_GUIDE = {
  controls: [
    { keys: "A D / ← →", action: "Run and steer" },
    { keys: "SPACE / J / K", action: "Jump, lift the ball, air-jump" },
    { keys: "S / ↓ + SPACE", action: "Slide or drop" },
  ],
  touchControls: [
    { keys: "STICK", action: "Run and steer" },
    { keys: "JUMP", action: "Jump, lift the ball, air-jump" },
    { keys: "STICK down + JUMP", action: "Slide or drop" },
  ],
  goal: "Score in the goal in YOUR colour. First to 3.",
} as const;

function logo(): HTMLElement {
  const brand = el("a", "", "fb-brand");
  brand.href = withFlags(endpoints.appUrl());
  brand.append(
    el("b", "FUSE", "fb-brand-fuse"),
    el("b", "BALL", "fb-brand-ball"),
    el("small", "NEON BALL DUEL"),
  );
  return brand;
}
function header(
  extra: HTMLElement[] = [],
  onOpenChange?: (open: boolean) => void,
): HTMLElement {
  const bar = el("header", "", "fb-top");
  // Every game opens the app portal top left; it lists the games that have a portal.json.
  const portal = createAppPortal({
    document,
    current: GAME,
    base: import.meta.env.BASE_URL,
    search: location.search,
  });
  bar.append(
    portal.element,
    logo(),
    social.element(),
    audioControl.element,
    ...extra,
  );
  return createTopBar({
    element: bar,
    gameId: GAME,
    onOpenChange,
    sound: audioControl.sound,
  });
}

function keyHelp(): HTMLElement {
  const list = el("dl", "", "fb-keys");
  for (const hint of GUIDE.controls)
    list.append(el("dt", hint.keys), el("dd", hint.action));
  return list;
}

const SVG = "http://www.w3.org/2000/svg";
/** A small drawing of an arena from its map data: solids, both goals, the clouds and where the ball starts. */
function mapThumb(map: MapDef): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", `0 0 ${map.w} ${map.h}`);
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("fb-map-thumb");
  const add = (tag: string, attributes: Record<string, string | number>) => {
    const node = document.createElementNS(SVG, tag);
    for (const [name, value] of Object.entries(attributes))
      node.setAttribute(name, String(value));
    svg.append(node);
  };
  for (const cloud of map.clouds)
    add("circle", { cx: cloud.x, cy: cloud.y, r: cloud.r, class: "cloud" });
  for (const solid of map.solids)
    // A solid past the edge of a wrapping axis shows again at the start of it, as the scene draws it.
    for (const copy of solidCopies(map, solid))
      add("rect", {
        x: copy.x,
        y: copy.y,
        width: copy.w,
        height: copy.h,
        class: "solid",
      });
  for (const goal of map.goals)
    if (isCircle(goal))
      add("circle", {
        cx: goal.x,
        cy: goal.y,
        r: goal.r,
        fill: TEAM[goal.team],
      });
    else
      add("rect", {
        x: goal.x,
        y: goal.y,
        width: goal.w,
        height: goal.h,
        fill: TEAM[goal.team],
      });
  // The gadgets, as the scene colours them: a field in the colour of the goal it guards, a gate in amber, a bumper
  // as a ring, a portal pair in its own hue.
  for (const barrier of map.barriers)
    for (const copy of solidCopies(map, barrier)) {
      const team = barrier.kind === "field" ? guarded(map, barrier) : -1;
      add("rect", {
        x: copy.x - (copy.h >= copy.w ? 2 : 0),
        y: copy.y - (copy.h >= copy.w ? 0 : 2),
        width: copy.w + (copy.h >= copy.w ? 4 : 0),
        height: copy.h + (copy.h >= copy.w ? 0 : 4),
        fill: team === -1 ? GADGET : TEAM_LIGHT[team],
      });
    }
  // A ledge is a thin mint line; a mover is a block in the same mint with the line it rides along.
  for (const ledge of map.ledges)
    add("rect", {
      x: ledge.x,
      y: ledge.y,
      width: ledge.w,
      height: 6,
      class: "ledge",
    });
  for (const mover of map.movers) {
    add("line", {
      x1: mover.x + mover.w / 2,
      y1: mover.y + mover.h / 2,
      x2: mover.x + mover.w / 2 + mover.travel.x,
      y2: mover.y + mover.h / 2 + mover.travel.y,
      class: "rail",
    });
    add("rect", {
      x: mover.x,
      y: mover.y,
      width: mover.w,
      height: mover.h,
      class: "mover",
    });
  }
  for (const bumper of map.bumpers)
    add("circle", {
      cx: bumper.x,
      cy: bumper.y,
      r: bumper.r,
      class: "bumper",
    });
  for (const portal of map.portals)
    for (const end of [portal.a, portal.b])
      add("circle", {
        cx: end.x,
        cy: end.y,
        r: portal.r,
        fill: "none",
        stroke: PORTAL[portal.hue],
        "stroke-width": 6,
      });
  add("circle", {
    cx: map.ballAnchor.x,
    cy: map.ballAnchor.y,
    r: 9,
    class: "ball",
  });
  return svg;
}

/** The arenas as a grid of buttons; `onPick` hears a choice, `update` shows the room's. */
function createMapPicker(onPick: (id: MapId) => void) {
  const element = el("div", "", "fb-maps");
  element.setAttribute("role", "group");
  element.setAttribute("aria-label", "Arena");
  const buttons = new Map<MapId, HTMLButtonElement>();
  for (const id of [...MAP_IDS, RANDOM, ...TEAM_MAP_IDS] as const) {
    const map = mapOf(id);
    const choice = button("", "fb-map");
    choice.dataset.map = id;
    choice.append(
      mapThumb(map),
      el("strong", map.name.toUpperCase()),
      el("small", MAP_BLURBS[id]),
    );
    choice.onclick = () => onPick(id);
    buttons.set(id, choice);
    element.append(choice);
  }
  let previewSeed = 0;
  return {
    element,
    update(selected: MapId, editable: boolean, seed = 0) {
      if (selected === RANDOM && previewSeed !== seed) {
        buttons
          .get(RANDOM)!
          .querySelector("svg")!
          .replaceWith(mapThumb(mapOf(RANDOM, seed)));
        previewSeed = seed;
      }
      // Only the arenas of the mode being played are offered: team arenas for teams, the rest for a duel.
      const teams = isTeamMapId(selected);
      for (const [id, choice] of buttons) {
        choice.hidden = isTeamMapId(id) !== teams;
        choice.setAttribute("aria-pressed", String(id === selected));
        choice.disabled = !editable && id !== selected;
        choice.classList.toggle("fb-map-locked", !editable);
      }
    },
  };
}

/** Duel, 2 v 2 or 3 v 3 as a row of buttons; `onPick` hears a choice, `update` shows the room's. */
function createModePicker(onPick: (size: number) => void) {
  const element = el("div", "", "fb-modes");
  element.setAttribute("role", "group");
  element.setAttribute("aria-label", "Mode");
  const buttons = MODES.map((mode) => {
    const choice = button("", "fb-mode");
    choice.dataset.size = String(mode.size);
    choice.append(el("strong", mode.name), el("small", mode.blurb));
    choice.onclick = () => onPick(mode.size);
    element.append(choice);
    return { size: mode.size, choice };
  });
  return {
    element,
    update(size: number, editable: boolean) {
      for (const { size: each, choice } of buttons) {
        choice.setAttribute("aria-pressed", String(each === size));
        choice.disabled = !editable && each !== size;
      }
    },
  };
}

/** Commit on submit, so room updates cannot interrupt typing a seed. */
function createSeedPicker(onSeed: (seed: number) => void) {
  const element = el("form", "", "fb-seed"),
    label = el("label", "Seed"),
    input = el("input"),
    apply = button("APPLY"),
    reroll = button("RE-ROLL"),
    error = el("p", "", "fb-seed-error");
  input.type = "text";
  input.inputMode = "numeric";
  input.maxLength = 10;
  input.setAttribute("aria-label", "Level seed");
  input.setAttribute("aria-describedby", "fb-seed-error");
  error.id = "fb-seed-error";
  error.setAttribute("role", "status");
  error.hidden = true;
  label.append(input);
  apply.type = "submit";
  reroll.type = "button";
  element.append(label, apply, reroll, error);
  element.onsubmit = (event) => {
    event.preventDefault();
    const seed = seedFromText(input.value);
    error.hidden = seed !== undefined;
    input.setAttribute("aria-invalid", String(seed === undefined));
    if (seed === undefined) {
      setText(error, "Enter a whole number from 0 to 4294967295.");
      return;
    }
    onSeed(seed);
  };
  reroll.onclick = () => {
    const rolled = rollSeed(),
      seed = rolled === displayed ? (rolled + 1) >>> 0 : rolled;
    input.value = String(seed);
    error.hidden = true;
    input.setAttribute("aria-invalid", "false");
    onSeed(seed);
  };
  let displayed: number | undefined;
  return {
    element,
    update(map: MapId, seed: number, editable: boolean) {
      element.hidden = map !== RANDOM;
      if (displayed !== seed) {
        input.value = String(seed);
        displayed = seed;
        error.hidden = true;
        input.setAttribute("aria-invalid", "false");
      }
      input.disabled = apply.disabled = reroll.disabled = !editable;
      apply.hidden = reroll.hidden = !editable;
    },
  };
}

function landing(): void {
  const shared = el("label", "", "fb-shared"),
    toggle = el("input");
  toggle.type = "checkbox";
  toggle.checked = store.getItem(names.shared) === "1";
  toggle.onchange = () =>
    store.setItem(names.shared, toggle.checked ? "1" : "0");
  shared.append(toggle, el("span", "Shared TV: phones are the controllers"));
  let selectedMap = chosenMap(),
    selectedSeed = chosenSeed(),
    selectedSize = chosenSize();
  const solo = () =>
    withFlags(
      endpoints.appUrl(
        `?solo=1&map=${selectedMap}${selectedMap === RANDOM ? `&seed=${selectedSeed}` : ""}${selectedSize > 1 ? `&size=${selectedSize}` : ""}`,
      ),
    );
  const card = createLandingCard({
    background: async (host) =>
      (await import("./attract.js")).createAttract(host),
    title: "FUSEBALL",
    tagline:
      "A neon ball game for two to six: a duel, 2 v 2 or 3 v 3. Knock the ball into the goal in your own colour to score and zap the other side. Air-jump as often as you like: every one leaves a bubble that bumps the ball away. First to three wins.",
    soloText: "PLAY SOLO WITH BOTS",
    async onCreate() {
      const room = await createRoom(endpoints.apiUrl, fetch, GAME).catch(
        (error: unknown) => {
          throw new Error(
            roomFailure(error instanceof Error ? error.message : String(error)),
          );
        },
      );
      store.setItem(names.host(room.code), room.token);
      store.setItem(mapKey, selectedMap);
      store.setItem(seedKey, String(selectedSeed));
      store.setItem(sizeKey, String(selectedSize));
      location.href = withFlags(endpoints.appUrl(`?room=${room.code}`));
    },
    onSolo: () => {
      location.href = solo();
    },
    valid: validRoomCode,
    onJoin: (code) => {
      location.href = withFlags(endpoints.appUrl(`?room=${code}`));
    },
  });
  card.create.after(shared);
  const picker = createMapPicker((id) => {
    selectedMap = id;
    store.setItem(mapKey, id);
    picker.update(id, true, selectedSeed);
    seeds.update(id, selectedSeed, true);
  });
  const modes = createModePicker((size) => {
    const next = settingsFor(
      {
        display: false,
        mapId: selectedMap,
        seed: selectedMap === RANDOM ? selectedSeed : 0,
        size: selectedSize,
      },
      size,
    );
    selectedSize = next.size;
    selectedMap = next.mapId;
    store.setItem(sizeKey, String(next.size));
    store.setItem(mapKey, next.mapId);
    modes.update(next.size, true);
    picker.update(next.mapId, true, selectedSeed);
    seeds.update(next.mapId, selectedSeed, true);
  });
  modes.update(selectedSize, true);
  const seeds = createSeedPicker((seed) => {
    selectedSeed = seed;
    store.setItem(seedKey, String(seed));
    picker.update(selectedMap, true, seed);
    seeds.update(selectedMap, seed, true);
  });
  picker.update(selectedMap, true, selectedSeed);
  seeds.update(selectedMap, selectedSeed, true);
  const arena = el("section", "", "fb-landing-arena");
  arena.append(
    el("h2", "MODE", "fui-lobby-title"),
    modes.element,
    el("h2", "ARENA", "fui-lobby-title"),
    picker.element,
    seeds.element,
  );
  card.menu.addSettings(arena);
  card.menu.help.append(keyHelp());
  const back = el("a", "← ALL GAMES", "fb-back");
  back.href = import.meta.env.BASE_URL + (muted ? "?mute" : "");
  const menu = createGameMenu(GUIDE);
  menu.update({ canLobby: false, canLeave: false, touch: coarse() });
  app.replaceChildren(header([back, menu.element]), card.element);
}

/** A real element as a pad: `knob`, when given, follows the thumb. */
function surface(node: HTMLElement, knob?: HTMLElement): PadSurface {
  node.addEventListener("contextmenu", (event) => event.preventDefault());
  return {
    on(kind, listener) {
      const types =
        kind === "down"
          ? ["pointerdown"]
          : kind === "move"
            ? ["pointermove"]
            : ["pointerup", "pointercancel", "lostpointercapture"];
      for (const type of types)
        node.addEventListener(type, (event) => listener(event as PointerEvent));
    },
    capture: (pointerId) => node.setPointerCapture(pointerId),
    watch(ended) {
      const types = ["pointerup", "pointercancel"] as const,
        listener = (event: PointerEvent) => ended(event);
      for (const type of types) window.addEventListener(type, listener);
      return () => {
        for (const type of types) window.removeEventListener(type, listener);
      };
    },
    box: () => node.getBoundingClientRect(),
    show({ held, x, y }) {
      node.classList.toggle("held", held);
      if (knob)
        knob.style.transform = `translate(${(x * 70).toFixed(1)}%, ${(y * 70).toFixed(1)}%)`;
    },
  };
}

function room(solo: boolean): void {
  const session = solo
    ? ({ kind: "solo" } as const)
    : sessionFor(location.search, store, GAME, validRoomCode, secret);
  if (session.kind === "invalid" || session.kind === "landing") {
    const back = el("a", "← BACK", "fb-back");
    back.href = withFlags(endpoints.appUrl());
    app.replaceChildren(
      header([back]),
      el("p", "That is not a room code: check it and try again.", "fb-error"),
    );
    return;
  }
  const code = session.kind === "room" ? session.code : "SOLO",
    role = session.kind === "room" ? session.role : "host",
    display = role === "display";
  document.body.classList.toggle("fb-display", display);
  const viewer: Viewer = { me: "", host: solo, solo, display };
  const sfx = createSfx(audio);

  // ---- the page ----
  const status = createNotice({ className: "fb-status" });
  const controls = new HeldControls((bits) => runtime.input(bits));
  const menu = createGameMenu({
    ...GUIDE,
    onLobby: () => runtime.command({ type: "action", action: "lobby" }),
    onLeave: () => {
      runtime.stop();
      location.href = withFlags(endpoints.appUrl());
    },
    onOpenChange: (open) => {
      if (open) controls.clear();
    },
  });
  const roundControls = createRoundControls(QUICK_GUIDE);
  const top = header(
    [
      el("strong", solo ? "SOLO" : code, "fb-code"),
      status.element,
      menu.element,
    ],
    (open) => {
      if (open) {
        controls.clear();
        captured.clear();
      }
    },
  );
  const modalOpen = () => Boolean(document.querySelector("dialog[open]"));

  // Lobby: the invitation and the riders on one side, the arena and START on the other.
  let settings: Settings = { ...DEFAULT_SETTINGS };
  const lobby = el("section", "", "fb-lobby"),
    lobbyMain = el("div", "", "fb-panel"),
    lobbySide = el("aside", "", "fb-panel fb-lobby-side"),
    roster = createRoster({ emptyText: "No riders yet" }),
    addBot = button("+ ADD BOT", "fb-add-bot"),
    switchSide = button("SWITCH SIDE", "fb-switch-side"),
    start = button("START MATCH", "fui-button-primary fb-start"),
    lobbyNote = el("p", "", "fui-lobby-note"),
    tvLink = button("OPEN TV SCREEN", "fb-tv");
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
    initial: social.playerName(store.getItem(names.name)) ?? "",
    onInput: (value) => store.setItem(names.name, value),
    buttonText: "JOIN",
    onSubmit: (name) => {
      store.setItem(names.name, name);
      runtime.command({
        type: "join",
        name,
        slot: requestedRoomSlot(nameEntry.form),
      });
    },
  });
  lobbyMain.append(
    el("h2", "RIDERS", "fui-lobby-title"),
    roster.element,
    addBot,
    switchSide,
  );
  switchSide.onclick = () => runtime.switchSide();
  addBot.onclick = () =>
    runtime.command({
      type: "bot",
      action: "add",
      slot: requestedRoomSlot(addBot),
    });
  start.onclick = () => runtime.command({ type: "action", action: "start" });
  tvLink.onclick = () =>
    window.open(
      withFlags(endpoints.appUrl(`?room=${code}&display=1`)),
      "_blank",
    );
  const picker = createMapPicker((mapId) => {
    store.setItem(mapKey, mapId);
    runtime.command({
      type: "settings",
      settings: {
        ...settings,
        mapId,
        seed:
          mapId === RANDOM
            ? (seedFromText(store.getItem(seedKey)) ?? chosenSeed())
            : 0,
      },
    });
  });
  const seeds = createSeedPicker((seed) => {
    store.setItem(seedKey, String(seed));
    runtime.command({ type: "settings", settings: { ...settings, seed } });
  });
  const modes = createModePicker((size) => {
    const next = settingsFor(settings, size);
    store.setItem(sizeKey, String(next.size));
    store.setItem(mapKey, next.mapId);
    runtime.command({ type: "settings", settings: next });
  });
  const lobbyActions = el("div", "", "fb-actions");
  lobbyActions.append(tvLink, start);
  lobbySide.append(
    el("h2", "MODE", "fui-lobby-title"),
    modes.element,
    el("h2", "ARENA", "fui-lobby-title"),
    picker.element,
    seeds.element,
    lobbyNote,
    lobbyActions,
    keyHelp(),
  );
  lobby.append(lobbyMain, lobbySide);

  // The arena: who is playing, the canvas and the result card on one 16:9 screen.
  const stage = el("section", "", "fb-stage"),
    sidesRow = el("div", "", "fb-sides"),
    sideNodes = [0, 1].map((slot) => {
      const node = el("span", "", "fb-side");
      node.style.setProperty("--c", teamColor(slot));
      return node;
    }),
    arenaName = el("small", "", "fb-arena-name"),
    screen = el("div", "", "fb-screen"),
    canvas = el("canvas", "", "fb-canvas"),
    note = el("p", "", "fb-note");
  sidesRow.append(sideNodes[0]!, arenaName, sideNodes[1]!);
  const result = el("section", "", "fb-result"),
    resultTitle = el("h2"),
    resultLines = el("ol"),
    resultWaiting = el("p", "", "fui-lobby-note"),
    resultActions = el("div", "", "fb-actions"),
    rematch = button("REMATCH", "fui-button-primary fb-rematch"),
    toLobby = button("LOBBY", "fb-to-lobby");
  resultActions.append(toLobby, rematch);
  result.append(resultTitle, resultLines, resultWaiting, resultActions);
  result.hidden = true;
  rematch.onclick = () =>
    runtime.command({ type: "action", action: "rematch" });
  toLobby.onclick = () => runtime.command({ type: "action", action: "lobby" });
  screen.append(canvas, result, roundControls.element);

  // One stick and one button, twice: small over a phone's own arena, and filling the phone for a shared screen.
  const pads = (className: string) => {
    const row = el("div", "", className),
      stick = el("div", "", "fb-stick"),
      knob = el("i", "", "fb-stick-knob"),
      jump = el("div", "JUMP", "fb-jump");
    stick.setAttribute("role", "application");
    stick.setAttribute("aria-label", "Stick: run, steer, and down to slide");
    jump.setAttribute("role", "button");
    jump.setAttribute("aria-label", "Jump");
    stick.append(knob);
    row.append(stick, jump);
    const set = new PadSet(controls);
    set.add(
      bindStick(surface(stick, knob), (bits) =>
        controls.hold(`${className}:stick`, bits),
      ),
    );
    set.add(
      bindButton(surface(jump), BTN, (bits) =>
        controls.hold(`${className}:jump`, bits),
      ),
    );
    return { row, set };
  };
  const { row: touch, set: touchPads } = pads("fb-touch"),
    controllerPads = pads("fb-controller-pads");
  stage.append(sidesRow, screen, note, touch);

  const controller = el("section", "", "fb-controller"),
    controllerHead = el("header", "", "fb-controller-head"),
    controllerName = el("b"),
    controllerState = el("span");
  controllerHead.append(controllerName, controllerState);
  const controllerResult = el("div", "", "fb-actions fb-controller-result"),
    controllerRematch = button("REMATCH", "fui-button-primary"),
    controllerLobby = button("LOBBY");
  controllerRematch.onclick = rematch.onclick;
  controllerLobby.onclick = toLobby.onclick;
  controllerResult.append(controllerLobby, controllerRematch);
  // A rider who is not the host is told who starts the next match, as on the arena's result card.
  const controllerWaiting = el("p", "", "fb-controller-waiting");
  controller.append(
    controllerHead,
    controllerResult,
    controllerWaiting,
    controllerPads.row,
  );

  // Until the first frame nothing of the room shows, so a room that turns out not to exist never offers its controls.
  const connecting = el("p", "Connecting to the room…", "fb-connecting"),
    closed = el("section", "", "fb-panel fb-closed"),
    closedRetry = button("TRY AGAIN", "fb-retry"),
    closedBack = el(
      "a",
      "BACK TO FUSEBALL",
      "fui-button-primary fb-closed-back",
    );
  closedBack.href = withFlags(endpoints.appUrl());
  closedRetry.onclick = () => location.reload();
  const closedActions = el("div", "", "fb-actions");
  closedActions.append(closedRetry, closedBack);
  closed.append(
    el("h2", "ROOM CLOSED", "fui-lobby-title"),
    el(
      "p",
      "This room has ended, or it never existed. Try again, start a new one, or play solo.",
    ),
    closedActions,
  );
  closed.hidden = true;
  const main = el("main", "", "fb-room");
  main.append(connecting, closed, nameEntry.form, lobby, stage, controller);
  app.replaceChildren(top, main);
  const roomLayout = createRoomLayout({
    primaryAction: start,
    playerName: () => social.playerName(undefined) ?? undefined,
    slotColor: (slot) => (slot % 2 ? "#ff2e9d" : "#16e7ff"),
    slotLabel: (slot) => `${slot % 2 ? "Pink" : "Cyan"} · Slot ${slot + 1}`,
    background: async (host) =>
      (await import("./attract.js")).createAttract(host),
    element: lobby,
    roster,
    capacity: 2,
    join: nameEntry.form,
    addAI: addBot,
    modes: [modes.element],
    settings: [picker.element, seeds.element],
    actions: [lobbyNote, switchSide, tvLink, start],
  });
  lobby.hidden = true;
  stage.hidden = true;
  controller.hidden = true;
  nameEntry.form.hidden = true;
  let over = false;

  // ---- drawing: the runtime's two newest frames, blended, once per animation frame; no physics here ----
  const scene = createScene(canvas, {
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
  });
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
      for (const cue of scene.draw(
        world,
        now,
        model?.localSlot ?? -1,
        model?.names,
        model?.localIndex ?? -1,
      ))
        sfx.play(cue);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  const render = (next: Model, view: View) => {
    if (over) return;
    model = next;
    connecting.hidden = true;
    main.dataset.screen = next.screen;
    main.dataset.stage = view.stage;
    main.dataset.phase = view.world?.phase ?? "";
    main.dataset.score = view.world ? view.world.score.join("-") : "";
    main.dataset.riding = String(next.riding);
    lobby.hidden = next.screen !== "lobby";
    stage.hidden = next.screen !== "play";
    controller.hidden = next.screen !== "controller";
    nameEntry.form.hidden = !next.askName;
    // Lobby.
    roster.update(
      next.lobby.members.map((member) => ({
        id: member.id,
        slot: member.slot,
        name: member.you ? `${member.name} (you)` : member.name,
        color: teamColor(member.side),
        status: member.bot
          ? next.lobby.size > 1
            ? `BOT · ${member.side === 0 ? "CYAN" : "MAGENTA"}`
            : "BOT"
          : member.connected
            ? member.side === 0
              ? "CYAN"
              : "MAGENTA"
            : "OFFLINE",
      })),
    );
    roomLayout.update(next.lobby.members.length, 2 * view.settings.size);
    for (const [id, row] of roster.entries()) {
      let remove = row.querySelector<HTMLButtonElement>(".fb-remove");
      const removable = next.lobby.removable.includes(id);
      if (removable && !remove) {
        remove = button("×", "fb-remove");
        remove.setAttribute("aria-label", "Remove bot");
        remove.onclick = () =>
          runtime.command({ type: "bot", action: "remove", id });
        row.append(remove);
      }
      if (remove) remove.hidden = !removable;
    }
    addBot.hidden = !next.lobby.canAddBot;
    switchSide.hidden = !next.lobby.canSwitch;
    modes.update(next.lobby.size, next.lobby.editable);
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
    picker.update(view.settings.mapId, next.lobby.editable, view.settings.seed);
    seeds.update(view.settings.mapId, view.settings.seed, next.lobby.editable);
    lobbySide.hidden = display;
    const touchGuide = coarse() || next.screen === "controller";
    const watching = display || (view.stage !== "lobby" && !next.riding);
    menu.update({
      canLobby: viewer.host && view.stage !== "lobby" && !display,
      touch: touchGuide,
      spectator: watching && view.stage === "running",
      display,
    });
    roundControls.update({
      round: next.guideKey,
      visible: next.controlsVisible,
      touch: touchGuide,
      spectator: watching,
      display,
    });
    const guideParent = next.screen === "controller" ? controller : screen;
    if (roundControls.element.parentElement !== guideParent)
      guideParent.append(roundControls.element);
    // The arena.
    sideNodes.forEach((node, slot) => {
      const mates = next.sides.filter((side) => side.slot === slot);
      setText(
        node,
        mates
          .map(
            (side) =>
              `${side.name}${side.you ? " (you)" : ""}${side.away ? " · away" : ""}`,
          )
          .join(" · "),
      );
      node.classList.toggle(
        "you",
        mates.some((side) => side.you),
      );
    });
    setText(arenaName, next.mapName.toUpperCase());
    setText(note, next.note);
    note.hidden = !next.note;
    touch.hidden = !(coarse() && next.riding && !display);
    // Pads that leave the screen under a thumb let go of it.
    touchPads.show(!touch.hidden && !stage.hidden);
    controllerPads.set.show(!controller.hidden);
    // The phone controller.
    const mine = next.sides.find((side) => side.you);
    if (mine) {
      controller.style.setProperty("--c", teamColor(mine.slot));
      setText(
        controllerName,
        `${mine.slot === 0 ? "CYAN" : "MAGENTA"} · ${mine.name}`,
      );
    }
    setText(controllerState, next.status);
    controllerResult.hidden = !(next.result && next.result.host);
    setText(controllerWaiting, next.result?.waiting ?? "");
    controllerWaiting.hidden = !next.result?.waiting;
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

  // ---- the runtime ----
  const sent = new Set<string>();
  const goals = createGoalWatch();
  const remembered = seatName(
    social.playerName(store.getItem(names.name)) ?? "",
  );
  let joinSent = false;
  const callbacks: FuseballCallbacks = {
    state(frame, roomSettings) {
      const riders =
        frame.stage === "lobby"
          ? frame.seats.filter((seat) => !seat.watcher)
          : frame.roster;
      reportPlay({
        matchId: frame.matchId,
        active: frame.stage === "running",
        ended: frame.stage === "over",
        round: playRound(frame),
        playerCount: riders.length,
        botCount: riders.filter((rider) => rider.bot).length,
        seated: riders.some((rider) => rider.id === viewer.me),
        mode: solo ? "solo" : roomSettings.display ? "shared" : "online",
      });
      for (const goal of goals(frame, viewer.me))
        analytics.track("Goal Scored", { ...goal });
      settings = roomSettings;
      const next = present(frame, viewer);
      // A page that loads into a room with a name remembered from before joins under it once; a name typed on this
      // page joins only through JOIN.
      if (next.askName && remembered && !joinSent && !viewer.host) {
        joinSent = true;
        runtime.command({
          type: "join",
          slot: requestedRoomSlot(nameEntry.form),
          name: remembered,
        });
      }
      if (next.seated) joinSent = false;
      render(next, frame);
      const state = runtime.roomState();
      // The autopilot lets go when the match is not running, as a thumb would.
      if (autopilot)
        controls.hold("autopilot", autopilotBits(state, viewer.me));
      // Keys still down when a match starts or the log is reset are logged again.
      runtime.flush();
      if (session.kind === "room" && !display && state)
        for (const report of dueReports(
          state,
          runtime.self,
          runtime.confirmedTick(),
          sent,
        )) {
          sent.add(report.key);
          void sendReport(
            endpoints.apiUrl(`/api/games/${GAME}/rooms/${code}/${report.path}`),
            report,
            { fetch: social.reportFetch, roomToken: session.token },
          );
        }
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
      // A service that does not host this game closes the socket the same way: its game routes say which it was.
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
  const runtime = new FuseballRuntime(
    code,
    {
      display: shared,
      mapId: chosenMap(),
      seed: chosenMap() === RANDOM ? chosenSeed() : 0,
      size: chosenSize(),
    },
    callbacks,
    session.kind === "room"
      ? {
          transport: (events) =>
            social.transport(
              code,
              session.token,
              events,
              (events) =>
                new PeerTransport(code, session.token, events, {
                  apiUrl: endpoints.apiUrl,
                  gameId: GAME,
                  maxFastBytes: MAX_PACKET_BYTES,
                }),
            ),
          displayOnly: display,
        }
      : {
          humanName: social.playerName(store.getItem(names.name)) ?? undefined,
        },
  );
  installRoomLifecycle(window, {
    stop: () => runtime.stop(),
    destroy: () => {
      menu.dispose();
      scene.destroy();
    },
    reload: () => location.reload(),
  });

  // Keys: while this device rides, ours are swallowed so Space never scrolls or presses a focused button; otherwise
  // a focused button or field keeps its own keys (REMATCH, START MATCH and the name form work from the keyboard).
  const typing = (target: EventTarget | null) =>
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLButtonElement && !model?.riding);
  const captured = new Set<string>();
  document.addEventListener("keydown", (event) => {
    if (
      menu.isOpen() ||
      modalOpen() ||
      typing(event.target) ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey
    )
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
