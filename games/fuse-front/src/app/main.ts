import "fuse-ui/tokens.css";
import "fuse-ui/components.css";
import "fuse-ui/portal.css";
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
import { STANCES, teamOf, type WorldView } from "../engine/index.js";
import { DEFAULT_SETTINGS, type View } from "../online/game.js";
import { FrontRuntime } from "../online/runtime.js";
import { Battlefield } from "../render/battlefield.js";
import { edgePan, PAN_SPEED } from "../render/camera.js";
import { SIZES, TEAMS, banner, cycleDifficulty, slotsOf } from "./model.js";
import { GAME_ID, keys, roomFailure, sessionFor } from "./session.js";

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
const muted = new URLSearchParams(location.search).has("mute");
const link = (query = "") =>
  endpoints.appUrl(`${query}${muted ? (query ? "&mute" : "?mute") : ""}`);
let teardown = () => {};

function navigate(query = ""): void {
  history.pushState(null, "", link(query));
  render();
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
  );
  return top;
}

function landing(error = ""): void {
  const name = el("input", "", "ff-name");
  name.placeholder = "Your name";
  name.maxLength = 18;
  name.value = store.getItem(keys.name) ?? "";
  name.oninput = () => store.setItem(keys.name, name.value.trim());
  const card = createLandingCard({
    title: "FUSE FRONT",
    tagline: "Take the flag. The factory does the rest.",
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
      "Click the map to move your hero · drag or edge to pan, Space to recentre · 1 / 2 / 3: push, hold, follow",
      "ff-help",
    ),
  );
}

function room(code: string, token: string | undefined, display: boolean): void {
  const status = el("p", "Connecting…", "ff-status");
  status.setAttribute("role", "status");
  const lobby = el("section", "", "ff-lobby");
  const play = el("section", "", "ff-play");
  const hud = el("p", "", "ff-hud");
  const canvas = el("canvas", "", "ff-board");
  const end = el("div", "", "ff-banner");
  const endText = el("strong", "");
  const back = el("button", "BACK TO LOBBY", "fui-button fui-button-primary");
  end.append(endText, back);
  play.append(hud, canvas, end);
  play.hidden = true;
  app.replaceChildren(header(), status, lobby, play);
  const field = new Battlefield(canvas, (w, h) =>
    Object.assign(document.createElement("canvas"), { width: w, height: h }),
  );
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
      event: (event, matchId) => field.event(matchId, event, performance.now()),
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
  function show(view: View): void {
    const inLobby = view.stage === "lobby";
    lobby.hidden = !inLobby;
    play.hidden = inLobby;
    if (inLobby) {
      const slots = slotsOf(view, runtime.self);
      const key = JSON.stringify([slots, view.settings.size, runtime.creator]);
      if (key !== lobbyKey) {
        lobbyKey = key;
        renderLobby(view);
      }
      return;
    }
    const world = view.world!;
    const mine = world.players.find((p) => p.seat === runtime.slot());
    const countdown = Math.max(
      0,
      Math.ceil((view.startAt - view.logTick) / 20),
    );
    hud.textContent = countdown
      ? `Starting in ${countdown}…`
      : mine
        ? `${TEAMS[teamOf(mine.seat)]} · stance ${mine.stance.toUpperCase()} · click to move · drag or edge to pan · Space recentres · 1/2/3 stance`
        : "Watching";
    end.hidden = view.stage !== "over";
    endText.textContent = banner(view.winner, runtime.slot());
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
          settings: { ...view.settings, size },
        });
      sizes.append(choice);
    }
    const teams = el("div", "", "ff-teams");
    const slots = slotsOf(view, runtime.self);
    for (const team of [0, 1]) {
      const column = el("ul", "", `ff-team ff-team-${team}`);
      column.append(el("li", TEAMS[team]!, "ff-team-name"));
      for (const slot of slots.filter((s) => s.team === team)) {
        const row = el(
          "li",
          slot.name + (slot.self ? " (you)" : ""),
          "ff-seat",
        );
        if (slot.bot && host) {
          const cycle = el("button", "⟳", "ff-cycle");
          cycle.title = "Change difficulty";
          cycle.onclick = () =>
            runtime.command({
              type: "settings",
              settings: cycleDifficulty(view.settings, slot.slot),
            });
          row.append(cycle);
        }
        column.append(row);
      }
      teams.append(column);
    }
    const start = el("button", "START", "fui-button fui-button-primary");
    start.onclick = () => runtime.command({ type: "action", action: "start" });
    const shell = createLobbyShell({
      label: `Room ${code}`,
      intro: [el("h2", "BATTLE SIZE", "fui-lobby-title"), sizes],
      ...(online
        ? {
            invite: createInviteCard({ code, link: link(`?room=${code}`) })
              .element,
          }
        : {}),
      roster: teams,
      footer: [host ? start : el("p", "Waiting for the host to start…")],
    });
    lobby.replaceChildren(shell.element);
  }
  back.onclick = () => runtime.command({ type: "action", action: "lobby" });
  // The battlefield draws every animation frame from the runtime's newest frames; `show` only runs the DOM around it.
  let shown: WorldView | undefined;
  let hover: { x: number; y: number } | undefined;
  let drag: { id: number; x: number; y: number; moved: boolean } | undefined;
  let last = performance.now();
  let raf = 0;
  const fit = (world: WorldView) => {
    const width = play.getBoundingClientRect().width - 6;
    const top = canvas.getBoundingClientRect().top;
    field.resize(width, innerHeight - top - 18, devicePixelRatio || 1, world);
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
    }
    const before = older?.world ?? undefined;
    field.draw(newer.matchId, world, before, t, runtime.slot(), now);
  };
  raf = requestAnimationFrame(frame);
  const resized = () => shown && fit(shown);
  window.addEventListener("resize", resized);
  // A press that stays put is a MOVE order on release; one that travels drags the camera instead.
  canvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    canvas.setPointerCapture?.(event.pointerId);
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
    if (!drag || drag.id !== event.pointerId || !shown) return;
    const dx = event.clientX - drag.x,
      dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 6) return;
    drag = { ...drag, x: event.clientX, y: event.clientY, moved: true };
    field.pan(-dx, -dy, shown);
  });
  canvas.addEventListener("pointerup", (event) => {
    const was = drag;
    drag = undefined;
    if (!was || was.moved || !shown) return;
    const tile = field.tileAt(event.offsetX, event.offsetY, shown);
    if (tile) runtime.move(tile.x, tile.y);
  });
  canvas.addEventListener("pointercancel", () => (drag = undefined));
  canvas.addEventListener("pointerleave", () => (hover = undefined));
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  const keys123 = (event: KeyboardEvent) => {
    if (event.key === " " && shown) {
      event.preventDefault();
      field.follow = true;
      return;
    }
    const stance = STANCES[Number(event.key) - 1];
    if (stance && !event.repeat) runtime.stance(stance);
  };
  window.addEventListener("keydown", keys123);
  runtime.start();
  teardown = () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resized);
    window.removeEventListener("keydown", keys123);
    runtime.stop();
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
