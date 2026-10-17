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
import { STANCES, teamOf } from "../engine/index.js";
import { DEFAULT_SETTINGS, type View } from "../online/game.js";
import { FrontRuntime } from "../online/runtime.js";
import { CELL, drawBoard } from "./board.js";
import {
  SIZES,
  TEAMS,
  banner,
  cycleDifficulty,
  slotsOf,
  tileAt,
} from "./model.js";
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
      "Click the map to move your hero · 1 / 2 / 3: push, hold, follow",
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
  const ctx = canvas.getContext("2d")!;
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
      event: () => {},
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
    if (canvas.width !== world.width * CELL) {
      canvas.width = world.width * CELL;
      canvas.height = world.height * CELL;
    }
    drawBoard(ctx, world, runtime.slot());
    const mine = world.players.find((p) => p.seat === runtime.slot());
    const countdown = Math.max(
      0,
      Math.ceil((view.startAt - view.logTick) / 20),
    );
    hud.textContent = countdown
      ? `Starting in ${countdown}…`
      : mine
        ? `${TEAMS[teamOf(mine.seat)]} · stance ${mine.stance.toUpperCase()} · click the map to move · 1/2/3 stance`
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
  const order = (event: MouseEvent) => {
    event.preventDefault();
    const tile = tileAt(
      event.clientX,
      event.clientY,
      canvas.getBoundingClientRect(),
      canvas.width / CELL,
      canvas.height / CELL,
    );
    if (tile) runtime.move(tile.x, tile.y);
  };
  canvas.addEventListener("pointerdown", order);
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  const keys123 = (event: KeyboardEvent) => {
    const stance = STANCES[Number(event.key) - 1];
    if (stance && !event.repeat) runtime.stance(stance);
  };
  window.addEventListener("keydown", keys123);
  runtime.start();
  teardown = () => {
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
