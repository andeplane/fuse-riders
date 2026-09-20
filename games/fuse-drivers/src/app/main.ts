import "@fontsource/press-start-2p/latin.css";
import "fuse-ui/tokens.css";
import "fuse-ui/components.css";
import "./fuseDrivers.css";
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
  createControllerRow,
  createInviteCard,
  createLandingCard,
  createNameEntry,
  createNotice,
  createRoster,
  el,
} from "fuse-ui";
import { DEFAULT_SETTINGS, fuseDriversGame, seatName } from "../game/index.js";
import { NEUTRAL_INPUT, type TruckInput } from "../game/sim/input.js";
import { mountArena, type MountedArena } from "./arena/index.js";
import { presentTable, type TableModel, type Viewer } from "./presenter.js";
import { dueReports, sendReport } from "./reports.js";
import { FuseDriversRuntime, type FuseDriversCallbacks } from "./runtime.js";
import { keys, roomFailure, safeStore, sessionFor } from "./session.js";

/**
 * The page's glue: it reads the query, builds the screens from fuse-ui, wires the runtime to the transport,
 * and hands every animation frame to the arena. The decisions live in the presenter, the reports and the
 * session modules, which are unit-tested; this file only puts their answers on the page.
 */
const GAME = fuseDriversGame.id;
const endpoints = createEndpoints(
  {
    basePath: `${import.meta.env.BASE_URL}${GAME}/`,
    apiOrigin: import.meta.env.VITE_API_ORIGIN,
  },
  location.origin,
);
const store = safeStore(() => localStorage);
const names = keys(GAME);
const secret = () => uuid().replaceAll("-", "") + uuid().replaceAll("-", "");
const app = document.querySelector<HTMLElement>("#app")!;

function header(): HTMLElement {
  const bar = el("header", "", "fd-top");
  const brand = el("a", "FUSE DRIVERS", "fd-brand");
  (brand as HTMLAnchorElement).href = import.meta.env.BASE_URL;
  bar.append(brand);
  return bar;
}

function landing(): void {
  const card = createLandingCard({
    title: "FUSE DRIVERS",
    tagline: "Offroad racing with weapons. Two to five drivers, one screen.",
    soloText: "RACE THE CPU",
    async onCreate() {
      const room = await createRoom(endpoints.apiUrl, fetch, GAME).catch(
        (error: unknown) => {
          throw new Error(
            roomFailure(error instanceof Error ? error.message : String(error)),
          );
        },
      );
      store.setItem(names.host(room.code), room.token);
      location.href = endpoints.appUrl(`?room=${room.code}`);
    },
    onSolo: () => {
      location.href = endpoints.appUrl("?solo=1");
    },
    valid: validRoomCode,
    onJoin: (code) => {
      location.href = endpoints.appUrl(`?room=${code}`);
    },
  });
  app.replaceChildren(header(), card.element);
}

/** The keys a driver holds, read every frame rather than on each event, so a held turn keeps turning. */
function keyboardControls(): { read: () => TruckInput; stop: () => void } {
  const down = new Set<string>();
  const key = (event: KeyboardEvent) => event.key.toLowerCase();
  const onDown = (event: KeyboardEvent) => {
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLButtonElement
    )
      return;
    down.add(key(event));
    if ([" ", "arrowleft", "arrowright", "arrowdown"].includes(key(event)))
      event.preventDefault();
  };
  const onUp = (event: KeyboardEvent) => down.delete(key(event));
  const clear = () => down.clear();
  addEventListener("keydown", onDown);
  addEventListener("keyup", onUp);
  addEventListener("blur", clear);
  return {
    read: () => ({
      left: down.has("arrowleft") || down.has("a"),
      right: down.has("arrowright") || down.has("d"),
      brake: down.has("arrowdown") || down.has("s"),
      nitro: down.has("shift"),
      item: down.has(" "),
      itemAlt: down.has("arrowdown") && down.has(" "),
    }),
    stop: () => {
      removeEventListener("keydown", onDown);
      removeEventListener("keyup", onUp);
      removeEventListener("blur", clear);
    },
  };
}

function room(solo: boolean): void {
  const session = solo
    ? ({ kind: "solo" } as const)
    : sessionFor(location.search, store, GAME, validRoomCode, secret);
  if (session.kind === "invalid" || session.kind === "landing") {
    app.replaceChildren(header(), el("p", "Invalid room code", "fd-error"));
    return;
  }
  const code = session.kind === "room" ? session.code : "SOLO";
  const role = session.kind === "room" ? session.role : "host";
  const display = role === "display";
  const viewer: Viewer = {
    me: "",
    host: solo || role === "host",
    solo,
    display,
    shared: false,
  };

  const status = createNotice({ className: "fd-status" });
  const roster = createRoster({ emptyText: "Nobody has joined yet" });
  const start = button("START RACE", "fui-button-primary");
  const lobby = el("section", "", "fd-lobby");
  if (!solo)
    lobby.append(
      createInviteCard({
        code,
        link: endpoints.appUrl(`?room=${code}`),
        qr: (text) => QRCode.toDataURL(text, { margin: 1, width: 360 }),
      }).element,
    );
  lobby.append(roster.element, start);

  const nameEntry = createNameEntry({
    normalize: (raw) => seatName(raw) ?? "",
    initial: store.getItem(names.name) ?? "",
    onInput: (value) => store.setItem(names.name, value),
    buttonText: "JOIN THE GRID",
    onSubmit: (name) => {
      store.setItem(names.name, name);
      runtime.command({ type: "join", name });
    },
  });

  const canvas = document.createElement("canvas");
  canvas.className = "fd-arena";
  const hud = el("p", "", "fd-hud");
  const results = el("section", "", "fd-results");
  const race = el("section", "", "fd-race");
  race.append(canvas, hud);

  // Touch drivers steer with the same controls the keyboard writes, held while a finger is down.
  const touch = { ...NEUTRAL_INPUT };
  const pad = createControllerRow({
    className: "fui-controller fd-pad",
    buttons: [
      {
        label: "◀",
        onPress: () => (touch.left = true),
        onRelease: () => (touch.left = false),
      },
      {
        label: "ITEM",
        onPress: () => (touch.item = true),
        onRelease: () => (touch.item = false),
      },
      {
        label: "NITRO",
        onPress: () => (touch.nitro = true),
        onRelease: () => (touch.nitro = false),
      },
      {
        label: "▶",
        onPress: () => (touch.right = true),
        onRelease: () => (touch.right = false),
      },
    ] as const,
  });
  race.append(pad.element);

  const main = el("main", "", "fd-room");
  main.append(nameEntry.form, lobby, race, results);
  app.replaceChildren(header(), status.element, main);

  const render = (model: TableModel) => {
    lobby.hidden = model.screen !== "lobby";
    race.hidden = model.screen === "lobby";
    results.hidden = model.screen !== "results";
    nameEntry.form.hidden = !model.askName;
    roster.update(model.lobby.members);
    start.hidden = !model.lobby.showStart;
    start.disabled = !model.lobby.canStart;
    if (model.lobby.note) status.show(model.lobby.note, "info");
    if (model.race)
      hud.textContent = `LAP ${String(model.race.lap)}/${String(model.race.laps)}   POS ${String(model.race.place)}/${String(model.race.drivers.length)}`;
    if (model.results)
      results.replaceChildren(
        el("h2", model.results.title, "fd-results-title"),
        ...model.results.rows.map((row) => el("p", row, "fd-results-row")),
        ...(model.results.host ? [rematch] : []),
      );
    // A phone that is only a controller has no room for the arena.
    pad.element.hidden = model.screen !== "race";
  };

  const rematch = button("RACE AGAIN", "fui-button-primary");
  rematch.onclick = () =>
    runtime.command({ type: "action", action: "rematch" });
  start.onclick = () => runtime.command({ type: "action", action: "start" });

  let latest: Parameters<FuseDriversCallbacks["state"]>[0] | undefined;
  const callbacks: FuseDriversCallbacks = {
    state(frame, settings) {
      viewer.shared = settings.display;
      latest = frame;
      render(presentTable(frame, viewer));
    },
    event() {
      /* Never render from events: a rollback rewrites outcomes without emitting them again. */
    },
    status(text) {
      const shown = roomFailure(text);
      status.show(shown, shown === text ? "info" : "error");
    },
    ready(id, host) {
      viewer.me = id;
      viewer.host = host;
    },
    ended() {
      status.show("Room ended", "error");
    },
  };

  const shared =
    !solo && role === "host" && store.getItem(names.shared) === "1";
  const runtime = new FuseDriversRuntime(
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

  const board = keyboardControls();
  let arena: MountedArena | undefined;
  let stopped = false;
  const sent = new Set<string>();

  const frame = () => {
    if (stopped) return;
    requestAnimationFrame(frame);
    if (!latest) return;
    if (!arena)
      arena = mountArena(canvas, {
        assetBase: `${import.meta.env.BASE_URL}${GAME}/assets/`,
      });
    arena.render(latest, performance.now(), runtime.self);
    if (!display)
      runtime.drive({
        left: board.read().left || touch.left,
        right: board.read().right || touch.right,
        brake: board.read().brake || touch.brake,
        nitro: board.read().nitro || touch.nitro,
        item: board.read().item || touch.item,
        itemAlt: board.read().itemAlt || touch.itemAlt,
      });
    const room = runtime.roomState();
    if (room && session.kind === "room")
      for (const report of dueReports(
        room,
        runtime.self,
        runtime.confirmedTick(),
        sent,
      )) {
        sent.add(report.key);
        void sendReport(
          endpoints.apiUrl(`/api/games/${GAME}/rooms/${code}/${report.path}`),
          report,
          { fetch, roomToken: session.token },
        );
      }
  };
  requestAnimationFrame(frame);

  installRoomLifecycle(window, {
    stop: () => {
      stopped = true;
      board.stop();
      runtime.stop();
    },
    destroy: () => arena?.destroy(),
    reload: () => location.reload(),
  });
  runtime.start();
}

const query = new URLSearchParams(location.search);
if (query.get("solo") === "1") room(true);
else if (query.has("room")) room(false);
else landing();
