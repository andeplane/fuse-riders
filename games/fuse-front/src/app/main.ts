import "fuse-ui/tokens.css";
import "fuse-ui/components.css";
import "fuse-ui/portal.css";
import "@fontsource/oxanium/latin-700.css";
import "@fontsource/oxanium/latin-800.css";
import "@fontsource/barlow/latin-400.css";
import "@fontsource/barlow/latin-600.css";
import "./style.css";
import {
  createInviteCard,
  createLandingCard,
  createLobbyShell,
  el,
} from "fuse-ui";
import { createAppPortal } from "fuse-ui/portal";
import { safeStorage } from "fuse-ui/safe-storage";
import {
  createEndpoints,
  createRoom,
  memberToken,
  PeerTransport,
  validRoomCode,
} from "fuse-network-fe";
import { MAX_PACKET_BYTES } from "fuse-netcode";
import { DRAW, teamOf, type WorldView } from "../engine/index.js";
import { DEFAULT_SETTINGS, type View } from "../online/game.js";
import { mapsFor } from "../online/maps.js";
import { FrontRuntime } from "../online/runtime.js";
import { Battlefield } from "../render/battlefield.js";
import type { Renderer } from "../render/renderer.js";
import { Field3D } from "../render3d/field.js";
import { qualityParam } from "../render3d/fx.js";
import { edgePan, PAN_SPEED } from "../render/camera.js";
import { Hud } from "./hud.js";
import { HERO_ROLES, heroPortrait, loadPortraits } from "./look.js";
import { keyAction } from "./hud-state.js";
import {
  IDLE,
  bodyAt,
  clickIntent,
  modeAfter,
  type Intent,
  isEnemy,
  modeFor,
  overlayOf,
  pinchZoom,
  pressItem,
  pressSpell,
  type Mode,
  zoomAnchor,
} from "./targeting.js";
import {
  SIZES,
  TEAMS,
  banner,
  cycleDifficulty,
  heroCards,
  mapOptions,
  pickHero,
  slotsOf,
  type SlotView,
} from "./model.js";
import { GAME_ID, keys, roomFailure, sessionFor } from "./session.js";
import { Radar, homeOf, minimapTile } from "./radar.js";
import { createAudio } from "./audio/index.js";

const app = document.querySelector<HTMLElement>("#app")!;
const base = import.meta.env.BASE_URL;
const endpoints = createEndpoints(
  {
    basePath: `${base}${GAME_ID}/`,
    apiOrigin: import.meta.env.VITE_API_ORIGIN,
  },
  location.origin,
);
const store = safeStorage(() => localStorage);
// `?mute` and `?2d` (the pixel battlefield) stay on every link the page makes; `?quality=low|high`, read once here, fixes
// the 3D look.
const params = new URLSearchParams(location.search);
const sticky = ["mute", "2d"].filter((flag) => params.has(flag));
const link = (query = "") =>
  endpoints.appUrl(
    sticky.reduce((url, flag) => `${url}${url ? "&" : "?"}${flag}`, query),
  );
let teardown = () => {};
// Sound: this browser's MUSIC and SFX choices, kept; `?mute` silences the page and leaves them alone.
const sound = createAudio(store, keys.audio, params.has("mute"), app);
const { audio } = sound;

function navigate(query = ""): void {
  history.pushState(null, "", link(query));
  render();
}

/** The three.js battlefield when the device gives WebGL2 (and `?2d` does not ask for pixels), else the pixel one. */
function battlefield(): { field: Renderer; canvas: HTMLCanvasElement } {
  if (!sticky.includes("2d"))
    try {
      const canvas = el("canvas", "", "ff-board ff-board-3d");
      return {
        field: new Field3D(canvas, qualityParam(params.toString())),
        canvas,
      };
    } catch (failure) {
      console.warn(
        "Fuse Front: WebGL2 unavailable, using the pixel battlefield",
        failure,
      );
    }
  const canvas = el("canvas", "", "ff-board");
  const field = new Battlefield(canvas, (w, h) =>
    Object.assign(document.createElement("canvas"), { width: w, height: h }),
  );
  return { field, canvas };
}

function header(): HTMLElement {
  const top = el("header", "", "ff-top");
  const brand = el("a", "FUSE FRONT", "ff-brand");
  brand.href = link();
  top.append(
    createAppPortal({
      document,
      current: GAME_ID,
      base,
      search: location.search,
    }).element,
    brand,
    el("span", "", "ff-top-gap"),
    ...sound.toggles(),
  );
  return top;
}

function landing(error = ""): void {
  audio.scene({ kind: "menu" });
  const name = el("input", "", "ff-name");
  name.placeholder = "Your name";
  name.maxLength = 18;
  name.value = store.getItem(keys.name) ?? "";
  name.oninput = () => store.setItem(keys.name, name.value.trim());
  const card = createLandingCard({
    title: "FUSE FRONT",
    tagline: "Push the lanes. Hold the jungle. Raze the fort.",
    soloText: "SOLO VS BOTS",
    valid: validRoomCode,
    async onCreate() {
      try {
        const room = await createRoom(endpoints.apiUrl, fetch, GAME_ID);
        store.setItem(keys.host(room.code), room.token);
        navigate(`?room=${room.code}`);
      } catch (failure) {
        throw new Error(
          roomFailure(
            failure instanceof Error ? failure.message : String(failure),
          ),
        );
      }
    },
    onSolo: () => navigate("?solo=1"),
    onJoin: (code) => navigate(`?room=${code}`),
  });
  card.error.textContent = error;
  card.create.before(name);
  app.replaceChildren(
    header(),
    card.element,
    el(
      "p",
      "Right-click to move or attack · A + click: attack-move · Shift queues orders · Q W E R: cast or aim · 1–6: items · B: shop · hold `: scoreboard · Z / X: zoom · Tab: the fight · Home: your fort",
      "ff-help",
    ),
  );
}

function room(code: string, token: string | undefined, display: boolean): void {
  const status = el("p", "Connecting…", "ff-status");
  status.setAttribute("role", "status");
  const lobby = el("section", "", "ff-lobby");
  const play = el("section", "", "ff-play");
  const hint = el("p", "", "ff-hud");
  const end = el("div", "", "ff-end ff-frame");
  const endText = el("strong", "");
  const endNote = el("p", "");
  const back = el("button", "BACK TO LOBBY", "fui-button fui-button-primary");
  end.append(endText, endNote, back);
  const stage = el("div", "", "ff-stage");
  const { field, canvas } = battlefield();
  // Hero portraits come from the 3D models where the 3D battlefield runs; the pixel ones otherwise.
  if (field instanceof Field3D) loadPortraits();
  let shown: WorldView | undefined;
  // What the next map click means, and the tile under the mouse, for the aiming overlay.
  let mode: Mode = IDLE;
  let cursor: { x: number; y: number } | undefined;
  // The overlay is rebuilt only when the view, the mode or the tile under the cursor changed.
  let drawn = "";
  let drawnFor: WorldView | undefined;
  const refresh = () => {
    const key = `${mode.kind}:${mode.kind === "aim" || mode.kind === "item" ? mode.slot : ""}:${cursor?.x},${cursor?.y}`;
    if (!shown || (shown === drawnFor && key === drawn)) return;
    [drawn, drawnFor] = [key, shown];
    field.overlay = overlayOf(shown, runtime.slot(), mode, cursor);
  };
  const arm = (next: Mode) => {
    mode = next;
    hud.armed(next.kind === "aim" ? next.slot : -1, next.kind === "attackMove");
    hud.aimingItem(next.kind === "item" ? next.slot : -1);
    canvas.classList.toggle("ff-aiming", next.kind !== "idle");
    refresh();
  };
  const hud = new Hud({
    cast(slot, shift = false) {
      if (!shown) return;
      const ready = !!hud.state.spells[slot]?.ready;
      const queued = shift || hud.queueing;
      const seat = runtime.slot();
      const press = pressSpell(shown, seat, mode, slot, ready, queued);
      if (press.cast)
        runtime.cast(slot, press.cast.x, press.cast.y, undefined, queued);
      // A spell that cannot go now buzzes (a passive, a locked or a cooling one).
      else if (press.mode === mode && seat >= 0) audio.ui("invalid");
      arm(press.mode);
    },
    attackMove: () =>
      arm(mode.kind === "attackMove" ? IDLE : { kind: "attackMove" }),
    look: (fx, fy) => shown && field.lookAt(fx, fy, shown),
    useItem(slot) {
      if (!shown) return;
      const press = pressItem(shown, runtime.slot(), mode, slot);
      if (press.use) runtime.useItem(slot, press.use.x, press.use.y);
      arm(press.mode);
    },
    // A refused order (a watcher, or one the runtime turns down) buzzes.
    buy: (id) => audio.ui(runtime.buy(id) ? "buy" : "invalid"),
    sell: (slot) => audio.ui(runtime.sell(slot) ? "sell" : "invalid"),
    move(fx, fy, queued = false) {
      if (!shown || runtime.slot() < 0) return;
      const tile = minimapTile(fx, fy, shown.width, shown.height);
      runtime.move(tile.x, tile.y, queued);
      // As on the board, a queued order leaves an armed attack-move armed.
      arm(queued ? mode : IDLE);
    },
  });
  const radar = new Radar();
  /** Centres the camera on a point in tiles, if there is one. */
  const jump = (at: { x: number; y: number } | undefined) =>
    at && shown && field.lookAt(at.x / shown.width, at.y / shown.height, shown);
  stage.append(canvas, hud.overlay, hud.shop.element, end);
  play.append(hud.top, stage, hud.bottom, hint);
  play.hidden = true;
  app.replaceChildren(header(), status, lobby, play);
  const name = () => store.getItem(keys.name) || "Commander";
  const online = token !== undefined;
  const runtime = new FrontRuntime(
    code,
    DEFAULT_SETTINGS,
    {
      ready: () => {
        if (online && !display) runtime.command({ type: "join", name: name() });
      },
      state: (frame) => show(frame),
      event: (event, matchId) => {
        field.event(matchId, event, performance.now());
        audio.event(matchId, event, shown, runtime.slot());
        const ping = radar.event(matchId, event, shown, runtime.slot());
        if (ping && shown)
          hud.ping(ping.x / shown.width, ping.y / shown.height, ping.kind);
        // This seat's last hits pop their gold where the body fell; its kills, assists and deaths post a notice.
        const fed = hud.feed.event(matchId, event, shown, runtime.slot());
        const at = fed.float && shown && field.screenOf(fed.float, shown);
        // `screenOf` is from the canvas's content box; the overlay covers the stage, where the canvas may sit centred.
        const [ox, oy] = [
          canvas.offsetLeft + canvas.clientLeft,
          canvas.offsetTop + canvas.clientTop,
        ];
        if (fed.float && at) hud.popup(fed.float.text, at.x + ox, at.y + oy);
        if (fed.float) audio.gold(event.step);
        if (fed.notice) hud.notice(fed.notice.text, fed.notice.good);
      },
      status: (text) => (status.textContent = roomFailure(text)),
      ended: () =>
        (status.textContent = "Room ended. Go back to create another room."),
      kicked: () => (status.textContent = "You were removed from the room."),
    },
    online
      ? {
          displayOnly: display,
          transport: (events) =>
            new PeerTransport(code, token, events, {
              apiUrl: endpoints.apiUrl,
              gameId: GAME_ID,
              maxFastBytes: MAX_PACKET_BYTES,
            }),
        }
      : { humanName: name() },
  );
  let lobbyKey = "";
  // The seat whose hero the lobby's cards show: this device's, or one the host chose from the team chips.
  let picking = -1;
  let wasLobby = true;
  function show(view: View): void {
    const inLobby = view.stage === "lobby";
    lobby.hidden = !inLobby;
    play.hidden = inLobby;
    // A phone drops the page header in a match, so the board gets the height (`style.css`).
    app.classList.toggle("ff-in-match", !inLobby);
    if (!inLobby && wasLobby) hud.unfold(false);
    wasLobby = inLobby;
    // The music: the lobby's theme, the match's moods, then its outro (a watcher hears the winner's, a draw a defeat).
    const seat = runtime.slot();
    const won =
      view.winner !== DRAW && (seat < 0 || teamOf(seat) === view.winner);
    audio.scene(
      inLobby
        ? { kind: "menu" }
        : view.stage === "over"
          ? { kind: "over", won }
          : { kind: "match", step: view.world?.step ?? 0 },
    );
    if (inLobby) {
      const slots = slotsOf(view, runtime.self);
      if (!slots.some((s) => s.slot === picking))
        picking = slots.find((s) => s.self)?.slot ?? 0;
      const key = JSON.stringify([
        slots,
        picking,
        view.settings.size,
        view.settings.map,
        runtime.creator,
      ]);
      if (key !== lobbyKey) {
        lobbyKey = key;
        renderLobby(view);
      }
      return;
    }
    const world = view.world!;
    const slot = runtime.slot();
    hud.update(world, slot, slotsOf(view, runtime.self));
    // Where this device's hero stands, for browser smokes to read that an order moved it.
    const mine = world.heroes.find((h) => h.seat === slot);
    canvas.dataset.hero = mine ? `${mine.x},${mine.y}` : "";
    // Aiming ends with the hero (dead, watching, or between matches).
    if (modeFor(world, slot, mode) !== mode) arm(IDLE);
    if (mode.kind !== "idle" || cursor) refresh();
    const countdown = Math.max(
      0,
      Math.ceil((view.startAt - view.logTick) / 20),
    );
    const text = countdown
      ? `Starting in ${countdown}…`
      : slot >= 0
        ? `${TEAMS[slot % 2]} · right-click: move, or attack an enemy · A then click: attack-move · Shift + click queues · Q W E R: cast or aim, then click · 1–6 items · B shop · hold \` score · Esc cancels · Space or F follows · Z/X zoom · Home fort · Tab fight · right-click the minimap to move`
        : "Watching";
    if (hint.textContent !== text) hint.textContent = text;
    const over = view.stage === "over";
    end.hidden = !over;
    if (!over) return;
    const result = banner(view.winner, slot);
    endText.textContent = result;
    const { red, neutral, blue } = hud.state;
    endNote.textContent = `${hud.state.time} · sectors ${red} red · ${neutral} neutral · ${blue} blue`;
    back.hidden = !runtime.creator && !runtime.solo;
  }
  function renderLobby(view: View): void {
    const host = runtime.creator || runtime.solo;
    const sizes = el("div", "", "ff-sizes");
    for (const size of SIZES) {
      const choice = el("button", `${size}V${size}`, "fui-button");
      choice.classList.toggle("ff-on", view.settings.size === size);
      choice.disabled = !host;
      choice.onclick = () =>
        runtime.command({
          type: "settings",
          // A picked map too small for the new size goes back to the size's default.
          settings: {
            ...view.settings,
            size,
            map: mapsFor(size).some((m) => m.id === view.settings.map)
              ? view.settings.map
              : null,
          },
        });
      sizes.append(choice);
    }
    // The maps that hold the size; the host's pick, or the size's default, is lit.
    const maps = el("div", "", "ff-sizes ff-maps");
    for (const option of mapOptions(view.settings)) {
      const choice = el("button", option.label, "fui-button");
      choice.classList.toggle("ff-on", option.on);
      choice.disabled = !host;
      choice.onclick = () =>
        runtime.command({
          type: "settings",
          settings: { ...view.settings, map: option.id },
        });
      maps.append(choice);
    }
    // Team panels of seat chips; the host clicks a chip to pick that seat's hero on the cards above.
    const teams = el("div", "", "ff-teams");
    const slots = slotsOf(view, runtime.self);
    for (const team of [0, 1]) {
      const column = el("div", "", `ff-team ff-t${team}`);
      const seats = el("div", "", "ff-seats");
      column.append(el("h3", `${TEAMS[team]} ARMY`, "ff-team-name"), seats);
      for (const slot of slots.filter((s) => s.team === team)) {
        const chip = el("span", "", "ff-seat");
        const who = slot.self ? "You" : slot.name;
        const name = el("button", `${who} · ${slot.hero}`, "ff-seat-pick");
        name.disabled = !host;
        name.setAttribute("aria-pressed", String(slot.slot === picking));
        name.onclick = () => ((picking = slot.slot), renderLobby(view));
        chip.classList.toggle("ff-own", slot.self);
        chip.classList.toggle("ff-on", slot.slot === picking);
        chip.append(name);
        if (slot.bot && host) {
          const cycle = el("button", "⟳", "ff-cycle");
          cycle.title = "Change difficulty";
          cycle.onclick = () =>
            runtime.command({
              type: "settings",
              settings: cycleDifficulty(view.settings, slot.slot),
            });
          chip.append(cycle);
        }
        seats.append(chip);
      }
      teams.append(column);
    }
    const roster = el("div", "", "ff-roster");
    roster.append(el("h2", "HEROES"), heroPicker(view, slots, host), teams);
    const start = el("button", "START", "fui-button ff-start");
    start.onclick = () => runtime.command({ type: "action", action: "start" });
    const shell = createLobbyShell({
      label: `Room ${code}`,
      intro: [
        el("h2", "BATTLE SIZE", "fui-lobby-title"),
        sizes,
        el("h2", "MAP", "fui-lobby-title"),
        maps,
      ],
      ...(online
        ? {
            invite: createInviteCard({ code, link: link(`?room=${code}`) })
              .element,
          }
        : {}),
      roster,
      footer: [host ? start : el("p", "Waiting for the host to start…")],
    });
    lobby.replaceChildren(shell.element);
  }
  /** The picking seat's hero cards, its hero lit; the host picks by clicking one (each hero once a team). */
  function heroPicker(
    view: View,
    slots: readonly SlotView[],
    host: boolean,
  ): HTMLElement {
    const seat = slots.find((s) => s.slot === picking);
    const row = el("div", "", "ff-heroes");
    for (const card of heroCards(slots, picking)) {
      const choice = el("button", "", `ff-hero ff-${card.state}`);
      const words = el("span", "", "ff-hero-words");
      const status = {
        mine: seat?.self ? "Your pick" : `${seat?.name ?? ""}'s pick`,
        taken: `Taken by ${card.by}`,
        free: "Available",
      }[card.state];
      words.append(
        el("b", card.kind.toUpperCase()),
        el("span", HERO_ROLES[card.kind], "ff-role"),
        el("small", status),
      );
      choice.append(heroPortrait(card.kind, seat?.team ?? 0), words);
      choice.setAttribute("aria-pressed", String(card.state === "mine"));
      choice.disabled = !host || card.state === "taken";
      choice.onclick = () =>
        runtime.command({
          type: "settings",
          settings: pickHero(view.settings, picking, card.kind),
        });
      row.append(choice);
    }
    return row;
  }
  back.onclick = () => runtime.command({ type: "action", action: "lobby" });
  // The battlefield draws every animation frame from the runtime's newest frames; `show` only runs the DOM around it.
  let hover: { x: number; y: number } | undefined;
  let drag: { id: number; x: number; y: number; moved: boolean } | undefined;
  let last = performance.now();
  let raf = 0;
  const fit = (world: WorldView) => {
    const width = play.getBoundingClientRect().width - 6;
    const top = canvas.getBoundingClientRect().top + scrollY;
    // A phone lays the panel over the board (`style.css`), so the board takes the screen below the top bar.
    const overlaid = getComputedStyle(hud.bottom).position === "absolute";
    const below = overlaid
      ? 0
      : hud.bottom.getBoundingClientRect().height +
        hint.getBoundingClientRect().height;
    const height = Math.max(
      160,
      innerHeight - top - below - (overlaid ? 16 : 30),
    );
    field.resize(width, height, devicePixelRatio || 1, world);
  };
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const timing = runtime.frameTiming();
    const newer = timing?.newer;
    if (!timing || !newer?.world || newer.stage === "lobby") {
      shown = undefined;
      return;
    }
    const world = newer.world;
    if (!shown) fit(world);
    if (world !== shown) radar.watch(world);
    shown = world;
    const older =
      timing.older?.world && timing.older.matchId === newer.matchId
        ? timing.older
        : undefined;
    const span = older ? newer.tick - older.tick : 0;
    const t =
      older && span > 0
        ? Math.min(1, Math.max(0, (timing.tick - older.tick) / span))
        : 1;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (hover && !drag) {
      const box = canvas.getBoundingClientRect();
      const dir = edgePan(hover.x, hover.y, box.width, box.height);
      if (dir.x || dir.y)
        field.pan(dir.x * PAN_SPEED * dt, dir.y * PAN_SPEED * dt, world);
      // While aiming, the area follows the ground under a still mouse as the camera moves.
      if (mode.kind === "aim") {
        cursor = field.tileAt(hover.x, hover.y, world);
        refresh();
      }
    }
    const before = older?.world ?? undefined;
    field.draw(newer.matchId, world, before, t, runtime.slot(), now);
    const box = field.box(world);
    hud.cameraBox(box);
    audio.camera = box;
    audio.frame(newer.matchId, world);
  };
  raf = requestAnimationFrame(frame);
  const resized = () => shown && fit(shown);
  window.addEventListener("resize", resized);
  // Two fingers pinch the zoom; the wheel zooms too (the pixel battlefield keeps its scale).
  const touches = new Map<number, { x: number; y: number }>();
  // The wheel and a pinch zoom toward the pointer (`zoomAnchor`); the keys zoom about the centre.
  const zoomAt = (factor: number, x: number, y: number) => {
    if (!shown) return field.zoom(factor);
    const tile = field.tileAt(x, y, shown);
    field.zoom(
      factor,
      zoomAnchor(shown, runtime.slot(), field.follow, tile, x, y),
    );
  };
  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      // Lines (Firefox) and pages count as many pixels.
      const pixels = event.deltaY * [1, 16, 400][event.deltaMode]!;
      zoomAt(Math.exp(-pixels * 0.0015), event.offsetX, event.offsetY);
    },
    { passive: false },
  );
  // A press that stays put is a MOVE order on release; one that travels drags the camera instead.
  canvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    canvas.setPointerCapture?.(event.pointerId);
    if (event.pointerType === "touch")
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touches.size > 1) {
      drag = undefined;
      return;
    }
    drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
    };
  });
  canvas.addEventListener("pointermove", (event) => {
    hover =
      event.pointerType === "mouse"
        ? { x: event.offsetX, y: event.offsetY }
        : undefined;
    if (hover && shown) {
      // The cursor marks an enemy it would attack, and the overlay follows it while aiming.
      cursor = field.tileAt(hover.x, hover.y, shown);
      const enemy = cursor && bodyAt(shown, cursor, isEnemy(runtime.slot()));
      canvas.classList.toggle("ff-hostile", !!enemy);
      // The tile under the mouse, for browser smokes to read.
      canvas.dataset.tile = cursor ? `${cursor.x},${cursor.y}` : "";
      refresh();
    }
    if (touches.has(event.pointerId)) {
      const [a0, b0] = [...touches.values()];
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const [a1, b1] = [...touches.values()];
      const pinch = a0 && b0 && a1 && b1 && pinchZoom(a0, b0, a1, b1);
      if (touches.size > 1) {
        const box = canvas.getBoundingClientRect();
        // A third finger moving changes nothing between the first two.
        if (pinch && pinch.factor !== 1)
          zoomAt(pinch.factor, pinch.x - box.left, pinch.y - box.top);
        return;
      }
    }
    if (!drag || drag.id !== event.pointerId || !shown) return;
    const dx = event.clientX - drag.x,
      dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 6) return;
    drag = { ...drag, x: event.clientX, y: event.clientY, moved: true };
    field.pan(-dx, -dy, shown);
  });
  canvas.addEventListener("pointerup", (event) => {
    touches.delete(event.pointerId);
    const was = drag;
    drag = undefined;
    if (!was || was.moved || !shown) return;
    const tile = field.tileAt(event.offsetX, event.offsetY, shown);
    if (!tile) return;
    // A click on an enemy attacks it and on the ground moves; armed, a left click attack-moves or casts the aimed
    // spell and a right click cancels (`targeting.ts`). Shift, or the HUD's QUEUE, queues the order behind the route.
    const intent = clickIntent(
      shown,
      runtime.slot(),
      mode,
      tile,
      event.button,
      event.shiftKey || hud.queueing,
    );
    if (intent.kind === "none") return;
    send(intent);
    arm(modeAfter(mode, intent));
  });
  /** Asks the runtime for what a click meant. */
  const send = (intent: Intent) => {
    if (intent.kind === "move" || intent.kind === "attackMove")
      runtime[intent.kind](intent.x, intent.y, !!intent.queued);
    else if (intent.kind === "attack") {
      if (runtime.attack(intent.of, intent.id, !!intent.queued))
        audio.ui("confirm");
    } else if (intent.kind === "cast")
      runtime.cast(
        intent.slot,
        intent.x,
        intent.y,
        intent.target,
        !!intent.queued,
      );
    else if (intent.kind === "useItem")
      runtime.useItem(intent.slot, intent.x, intent.y);
  };
  canvas.addEventListener("pointercancel", (event) => {
    touches.delete(event.pointerId);
    drag = undefined;
  });
  canvas.addEventListener("pointerleave", () => {
    hover = cursor = undefined;
    canvas.classList.remove("ff-hostile");
    refresh();
  });
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  const keys123 = (event: KeyboardEvent) => {
    const action = keyAction(event.key);
    const held = event.ctrlKey || event.metaKey || event.altKey;
    if (!action || !shown || event.repeat || held) return;
    const typing =
      event.target instanceof Element &&
      event.target.closest("input, textarea, select, [contenteditable]");
    if (typing) return;
    // Tab jumps to the fight only from the board: on a focused control, or with Shift, it moves focus as usual.
    const control =
      event.target instanceof Element && event.target.closest("button, a");
    if (action.kind === "fight" && (event.shiftKey || control)) return;
    // Also keeps Space from re-pressing a focused HUD button.
    event.preventDefault();
    if (action.kind === "recentre") field.follow = true;
    else if (action.kind === "zoom") field.zoom(action.factor);
    else if (action.kind === "home") jump(homeOf(shown, runtime.slot()));
    else if (action.kind === "fight") jump(radar.fight(shown, runtime.slot()));
    else if (action.kind === "close")
      (hud.shop.close(), hud.showScore(false), arm(IDLE));
    else if (action.kind === "score") hud.showScore(true);
    else if (action.kind === "attackMove") hud.actions.attackMove();
    else if (action.kind === "shop") hud.toggleShop();
    else if (action.kind === "item") hud.actions.useItem(action.slot);
    else hud.actions.cast(action.slot, event.shiftKey);
  };
  // The scoreboard shows only while ` is held.
  const keyUp = (event: KeyboardEvent) =>
    keyAction(event.key)?.kind === "score" && hud.showScore(false);
  window.addEventListener("keydown", keys123);
  window.addEventListener("keyup", keyUp);
  // A window left with ` still held never sees its keyup.
  const blurred = () => hud.showScore(false);
  window.addEventListener("blur", blurred);
  runtime.start();
  teardown = () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resized);
    window.removeEventListener("keydown", keys123);
    window.removeEventListener("keyup", keyUp);
    window.removeEventListener("blur", blurred);
    runtime.stop();
    field.dispose();
  };
}

function render(): void {
  teardown();
  teardown = () => {};
  const session = sessionFor(
    location.search,
    store,
    validRoomCode,
    memberToken,
  );
  if (session.kind === "landing") landing();
  else if (session.kind === "invalid")
    landing("Invalid room code. Check your invite or create a new room.");
  else if (session.kind === "solo") room("SOLO", undefined, false);
  else room(session.code, session.token, session.role === "display");
}

window.addEventListener("popstate", render);
render();
