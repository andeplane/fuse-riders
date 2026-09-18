import "@fontsource/press-start-2p/latin.css";
import "fuse-ui/tokens.css";
import "fuse-ui/components.css";
import "./dice.css";
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
import { DEFAULT_SETTINGS, diceGame, seatName } from "../game/index.js";
import { presentTable, type TableModel, type Viewer } from "./presenter.js";
import { dueReports, sendReport } from "./reports.js";
import { DiceRuntime, type DiceCallbacks } from "./runtime.js";
import { keys, roomFailure, safeStore, sessionFor } from "./session.js";

/**
 * The dice page's glue: it reads the query, builds the screens from fuse-ui components, wires the runtime to the
 * transport the way Fuse Riders does, and hands every frame to `presentTable`. The decisions live in the presenter,
 * the reports and the session modules, which are unit-tested; this file only puts their answers on the page.
 */
const GAME = diceGame.id;
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
const COLORS = ["#16e7ff", "#ff2e9d", "#b6ff4d", "#ffe46b", "#a78bfa"];
const app = document.querySelector<HTMLElement>("#app")!;

function header(extra: HTMLElement[] = []): HTMLElement {
  const bar = el("header", "", "dice-top"),
    brand = el("a", "", "dice-brand");
  brand.href = endpoints.appUrl();
  brand.append(el("span", "PIG"), el("small", "A FUSE GAME"));
  bar.append(brand, ...extra);
  return bar;
}

function landing(): void {
  const shared = el("label", "", "dice-shared"),
    toggle = el("input");
  toggle.type = "checkbox";
  toggle.checked = store.getItem(names.shared) === "1";
  toggle.onchange = () =>
    store.setItem(names.shared, toggle.checked ? "1" : "0");
  shared.append(toggle, el("span", "Shared TV: phones are the controllers"));
  const card = createLandingCard({
    title: "ROLL OR HOLD",
    tagline:
      "Roll as often as you dare: every roll adds up, but a 1 loses the lot. Hold to bank it. First to 50 wins the round, two rounds win the match.",
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
  card.create.after(shared);
  const back = el("a", "← FUSE RIDERS", "dice-back");
  back.href = import.meta.env.BASE_URL;
  app.replaceChildren(header([back]), card.element);
}

/** A die face: nine cells, lit per the presenter's pips. */
function createDie() {
  const element = el("div", "", "dice-die");
  const cells = Array.from({ length: 9 }, () => el("span", "", "dice-pip"));
  element.append(...cells);
  element.setAttribute("role", "img");
  let key = "";
  return {
    element,
    render(model: TableModel["die"]) {
      element.classList.toggle("blank", !model);
      element.classList.toggle("bust", model?.bust === true);
      element.setAttribute(
        "aria-label",
        model ? `${model.by} rolled ${model.value}` : "No roll yet",
      );
      cells.forEach((cell, index) =>
        cell.classList.toggle("on", model?.pips[index] ?? false),
      );
      if (model && model.key !== key) {
        element.classList.remove("rolled");
        void element.offsetWidth; // restart the roll animation
        element.classList.add("rolled");
      }
      key = model?.key ?? "";
    },
  };
}

function room(solo: boolean): void {
  const session = solo
    ? ({ kind: "solo" } as const)
    : sessionFor(location.search, store, GAME, validRoomCode, secret);
  if (session.kind === "invalid" || session.kind === "landing") {
    app.replaceChildren(header(), el("p", "Invalid room code", "dice-error"));
    return;
  }
  const code = session.kind === "room" ? session.code : "SOLO",
    role = session.kind === "room" ? session.role : "host",
    display = role === "display";
  document.body.classList.toggle("dice-display", display);
  const viewer: Viewer = {
    me: "",
    host: solo,
    solo,
    display,
    shared: false,
  };

  // ---- the page ----
  const status = createNotice({ className: "dice-status" }),
    toast = createNotice({ holdMs: 2200, className: "dice-toast" }),
    leave = button(solo ? "EXIT" : "LEAVE", "dice-leave");
  leave.onclick = () => {
    runtime.stop();
    location.href = endpoints.appUrl();
  };
  const codeChip = el("strong", solo ? "SOLO" : code, "dice-code");
  const top = header([codeChip, status.element, leave]);

  // Lobby: invitation, roster with bot controls, name entry, start.
  const lobby = el("section", "", "dice-lobby"),
    roster = createRoster({ emptyText: "Nobody has joined yet" }),
    addBot = button("+ ADD BOT", "dice-add-bot"),
    start = button("START MATCH", "fui-button-primary dice-start"),
    lobbyNote = el("p", "", "fui-lobby-note"),
    tvLink = button("OPEN TV SCREEN", "dice-tv");
  const link = endpoints.appUrl(`?room=${code}`);
  if (!solo) {
    const invite = createInviteCard({
      code,
      link,
      qr: (text) => QRCode.toDataURL(text, { margin: 1, width: 360 }),
    });
    lobby.append(invite.element);
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
  const lobbyActions = el("div", "", "dice-lobby-actions");
  lobbyActions.append(addBot, start);
  lobby.append(
    el("h2", "PLAYERS", "fui-lobby-title"),
    roster.element,
    lobbyNote,
    lobbyActions,
  );
  addBot.onclick = () => runtime.command({ type: "bot", action: "add" });
  start.onclick = () => runtime.command({ type: "action", action: "start" });
  tvLink.onclick = () =>
    window.open(endpoints.appUrl(`?room=${code}&display=1`), "_blank");

  // Table: scores, the die, the turn total, the timer and the buttons.
  const table = el("section", "", "dice-table"),
    roundLine = el("p", "", "dice-round"),
    headline = el("h1", "", "dice-headline"),
    detail = el("p", "", "dice-detail"),
    board = el("div", "", "dice-board"),
    die = createDie(),
    total = el("div", "", "dice-total"),
    totalValue = el("strong", "0"),
    timer = el("div", "", "dice-timer"),
    timerFill = el("span"),
    timerText = el("small", "", "dice-timer-text");
  total.append(el("small", "TURN TOTAL"), totalValue);
  timer.append(timerFill);
  timer.setAttribute("aria-hidden", "true");
  const centre = el("div", "", "dice-centre");
  centre.append(die.element, total, toast.element);
  const pad = createControllerRow({
    buttons: [
      {
        label: "ROLL",
        keys: "Space R",
        title: "Roll the die (Space)",
        onPress: () => runtime.play("roll"),
      },
      {
        label: "HOLD",
        keys: "H Enter",
        title: "Bank the turn total (H)",
        onPress: () => runtime.play("hold"),
      },
    ] as const,
    className: "fui-controller dice-pad",
  });
  const [rollButton, holdButton] = pad.buttons;
  rollButton.classList.add("dice-roll");
  holdButton.classList.add("dice-hold");
  table.append(
    roundLine,
    headline,
    detail,
    board,
    centre,
    timer,
    timerText,
    pad.element,
  );
  const cards = new Map<string, Record<string, HTMLElement>>();

  // The result of a match.
  const result = el("section", "", "dice-result"),
    resultTitle = el("h2", "", "dice-result-title"),
    resultLines = el("ol", "", "dice-result-lines"),
    rematch = button("REMATCH", "fui-button-primary"),
    toLobby = button("LOBBY"),
    resultWaiting = el("p", "", "fui-lobby-note"),
    resultActions = el("div", "", "dice-lobby-actions");
  resultActions.append(toLobby, rematch);
  result.append(resultTitle, resultLines, resultWaiting, resultActions);
  result.hidden = true;
  rematch.onclick = () =>
    runtime.command({ type: "action", action: "rematch" });
  toLobby.onclick = () => runtime.command({ type: "action", action: "lobby" });

  const main = el("main", "", "dice-room");
  main.append(nameEntry.form, lobby, table, result);
  app.replaceChildren(top, main);
  table.hidden = true;
  nameEntry.form.hidden = true;

  const render = (model: TableModel) => {
    main.dataset.layout = model.layout;
    lobby.hidden = model.screen !== "lobby";
    table.hidden = model.screen !== "table";
    nameEntry.form.hidden = !model.askName;
    // Lobby.
    roster.update(
      model.lobby.members.map((member, index) => ({
        ...member,
        color: COLORS[index % COLORS.length]!,
      })),
    );
    for (const [id, row] of roster.entries()) {
      let remove = row.querySelector<HTMLButtonElement>(".dice-remove");
      const removable = model.lobby.removable.includes(id);
      if (removable && !remove) {
        remove = button("×", "dice-remove");
        remove.setAttribute("aria-label", "Remove bot");
        remove.onclick = () =>
          runtime.command({ type: "bot", action: "remove", id });
        row.append(remove);
      }
      if (remove) remove.hidden = !removable;
    }
    addBot.hidden = !model.lobby.canAddBot;
    start.hidden = !model.lobby.showStart;
    start.disabled = !model.lobby.canStart;
    lobbyNote.textContent = model.lobby.note;
    lobbyNote.hidden = !model.lobby.note;
    const offerTv = viewer.shared && viewer.host && !display && !solo;
    if (offerTv && !tvLink.isConnected) lobbyActions.prepend(tvLink);
    tvLink.hidden = !offerTv;
    // Table.
    roundLine.textContent = model.round;
    headline.textContent = model.headline;
    detail.textContent = model.detail;
    for (const [id, card] of cards)
      if (!model.players.some((player) => player.id === id)) {
        card.root!.remove();
        cards.delete(id);
      }
    model.players.forEach((player, index) => {
      let card = cards.get(player.id);
      if (!card) {
        const root = el("article", "", "dice-player");
        card = {
          root,
          name: el("strong", "", "dice-player-name"),
          score: el("b", "", "dice-player-score"),
          wins: el("span", "", "dice-player-wins"),
          bar: el("i", "", "dice-player-bar"),
        };
        const meter = el("span", "", "dice-player-meter");
        meter.append(card.bar!);
        root.append(card.name!, card.wins!, card.score!, meter);
        cards.set(player.id, card);
        board.append(root);
      }
      const root = card.root!;
      root.style.setProperty("--rider-color", COLORS[index % COLORS.length]!);
      root.style.order = String(index);
      root.classList.toggle("current", player.current);
      root.classList.toggle("you", player.you);
      root.classList.toggle("away", player.away);
      root.classList.toggle("winner", player.winner);
      card.name!.textContent = player.you
        ? `${player.name} (you)`
        : player.name;
      card.score!.textContent = String(player.score);
      card.wins!.textContent = player.wins;
      card.wins!.setAttribute("aria-label", `${player.roundWins} round wins`);
      card.bar!.style.width = `${Math.round(player.progress * 100)}%`;
    });
    die.render(model.die);
    totalValue.textContent = String(model.turnTotal);
    timerFill.style.width = `${(model.timer * 100).toFixed(1)}%`;
    timer.classList.toggle("low", model.timer > 0 && model.timer < 0.3);
    timerText.textContent = model.seconds ? `${model.seconds}s` : "";
    pad.element.hidden = !model.controls.visible;
    rollButton.disabled = !model.controls.roll;
    holdButton.disabled = !model.controls.hold;
    // Result.
    result.hidden = !model.result;
    if (model.result) {
      resultTitle.textContent = model.result.title;
      const lines = model.result.lines.join("\n");
      if (resultLines.dataset.lines !== lines) {
        resultLines.dataset.lines = lines;
        resultLines.replaceChildren(
          ...model.result.lines.map((line) => el("li", line)),
        );
      }
      resultActions.hidden = !model.result.host;
      resultWaiting.textContent = model.result.waiting;
      resultWaiting.hidden = !model.result.waiting;
    }
  };

  // ---- the runtime ----
  const sent = new Set<string>();
  const remembered = seatName(store.getItem(names.name) ?? "");
  let lastDie = "",
    joinSent = false;
  const callbacks: DiceCallbacks = {
    state(frame, settings) {
      viewer.shared = settings.display;
      const model = presentTable(frame, viewer);
      // For the browser smoke (scripts/dice-smoke.ts) and the stylesheet.
      main.dataset.phase = frame.phase;
      main.dataset.round = String(frame.round);
      if (model.die && model.die.key !== lastDie && model.die.bust)
        toast.flash(`${model.die.by} rolled a 1: BUST!`, "warn");
      lastDie = model.die?.key ?? "";
      // A page that loads into a room with a name remembered from before (a reload frees a lobby seat) joins under it
      // once; a name typed on this page joins only through JOIN.
      if (model.askName && remembered && !joinSent) {
        joinSent = true;
        runtime.command({ type: "join", name: remembered });
      }
      if (model.seated) joinSent = false;
      render(model);
      const state = runtime.roomState();
      if (session.kind === "room" && role !== "display" && state)
        for (const report of dueReports(
          state,
          viewer.me,
          runtime.confirmedTick(),
          sent,
        )) {
          sent.add(report.key);
          void sendReport(
            endpoints.apiUrl(`/api/games/${GAME}/rooms/${code}/${report.path}`),
            report,
            {
              fetch: (input, init) => fetch(input, init),
              roomToken: session.token,
            },
          );
        }
    },
    event() {
      // Everything shown comes from the view: a rollback can change a roll after its event was emitted.
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
  const runtime = new DiceRuntime(
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
  document.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLInputElement || event.repeat) return;
    const key = event.key.toLowerCase();
    if (key === " " || key === "r") {
      event.preventDefault();
      runtime.play("roll");
    } else if (key === "h" || key === "enter") runtime.play("hold");
  });
  runtime.start();
}

const query = new URLSearchParams(location.search);
if (query.get("solo") === "1") room(true);
else if (query.has("room")) room(false);
else landing();
