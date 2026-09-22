import "@fontsource/press-start-2p/latin.css";
import "fuse-ui/tokens.css";
import "fuse-ui/components.css";
import "./birds.css";
import QRCode from "qrcode";
import {
  PeerTransport,
  createEndpoints,
  createRoom,
  installRoomLifecycle,
  validRoomCode,
} from "fuse-network-fe";
import { MAX_PACKET_BYTES, uuid, type Callbacks } from "fuse-netcode";
import { button, createInviteCard, createNameEntry, el } from "fuse-ui";
import {
  UNIT,
  type Fact,
  type Weapon,
  type WorldView,
  type Vector,
} from "../engine/view.js";
import { quantize } from "../engine/view-kit.js";
import {
  DEFAULT_SETTINGS,
  seatName,
  type BirdsSettings,
  type BirdsView,
} from "../online/game.js";
import { BirdsRuntime, type Play } from "../online/runtime.js";
import { createArena } from "../render/arena.js";
import { constrainCamera, followShot, zoomAt } from "../render/camera.js";
import {
  cancelGesture,
  resetGesture,
  createGestures,
  pointerDown,
  pointerMove,
  pointerUp,
} from "./gestures.js";
import { roomFailure, roomToken, safeStore, storageKeys } from "./session.js";
import { BirdsAudio } from "./audio.js";
import { PracticeRuntime } from "./practice.js";

const GAME = "fuse-birds",
  COLORS = ["#6df4ed", "#ff6ec7", "#bded76", "#ffb75e", "#b797ff"];
const endpoints = createEndpoints(
  {
    basePath: `${import.meta.env.BASE_URL}${GAME}/`,
    apiOrigin: import.meta.env.VITE_API_ORIGIN,
  },
  location.origin,
);
const app = document.querySelector<HTMLElement>("#app")!,
  store = safeStore(() => localStorage);
const secret = () => uuid().replaceAll("-", "") + uuid().replaceAll("-", "");
const muted = new URLSearchParams(location.search).has("mute");
function brand(): HTMLElement {
  const title = el("a", "", "birds-brand");
  title.href = endpoints.appUrl();
  title.append(el("span", "FUSE"), el("span", "BIRDS"));
  return title;
}
function notice(text: string): HTMLElement {
  const p = el("p", text, "birds-notice");
  p.setAttribute("role", "status");
  return p;
}
function landing(): void {
  const page = el("main", "", "birds-landing"),
    card = el("section", "", "birds-card");
  const title = el("h1", "SMALL BIRDS.\nBIG TROUBLE."),
    intro = el(
      "p",
      "Practice solo, or battle with 2–5 friends. Carve the cliffs, catch supply crates, and be the last bird standing.",
    );
  const create = button("CREATE ROOM", "fui-button-primary"),
    practice = button("1 PLAYER PRACTICE"),
    join = button("JOIN ROOM"),
    code = el("input");
  code.placeholder = "ROOM CODE";
  code.maxLength = 8;
  code.setAttribute("aria-label", "Room code");
  code.autocomplete = "off";
  const joinForm = el("form", "", "birds-join");
  join.type = "submit";
  joinForm.append(code, join);
  const shared = el("input");
  shared.type = "checkbox";
  shared.checked = store.get(storageKeys.shared) === "1";
  const label = el("label", "", "birds-shared");
  label.append(
    shared,
    document.createTextNode("Shared TV + phone controllers"),
  );
  shared.onchange = () =>
    store.set(storageKeys.shared, shared.checked ? "1" : "0");
  const message = notice(""),
    back = el("a", "← More Fuse games", "birds-back");
  back.href = import.meta.env.BASE_URL;
  create.onclick = async () => {
    if (create.disabled) return;
    create.disabled =
      practice.disabled =
      join.disabled =
      code.disabled =
      shared.disabled =
        true;
    message.textContent = "Creating your room…";
    try {
      const result = await createRoom(endpoints.apiUrl, fetch, GAME);
      store.set(storageKeys.host(result.code), result.token);
      history.pushState(
        null,
        "",
        endpoints.appUrl(`?room=${result.code}${muted ? "&mute" : ""}`),
      );
      room(result.code, false);
    } catch (error) {
      message.textContent = `${roomFailure(error)} Try again.`;
      create.disabled =
        practice.disabled =
        join.disabled =
        code.disabled =
        shared.disabled =
          false;
    }
  };
  practice.onclick = () => {
    if (practice.disabled) return;
    history.pushState(
      null,
      "",
      endpoints.appUrl(`?practice=1${muted ? "&mute" : ""}`),
    );
    room("SOLO PRACTICE", false, true);
  };
  joinForm.onsubmit = (e) => {
    e.preventDefault();
    if (create.disabled) return;
    const value = code.value.trim().toUpperCase();
    if (!validRoomCode(value)) {
      message.textContent = "Enter a valid room code.";
      return;
    }
    history.pushState(
      null,
      "",
      endpoints.appUrl(`?room=${value}${muted ? "&mute" : ""}`),
    );
    room(value, false);
  };
  card.append(
    el("small", "ARTILLERY · FRIENDS · MAYHEM", "birds-eyebrow"),
    title,
    intro,
    create,
    practice,
    label,
    joinForm,
    message,
    back,
  );
  page.append(brand(), card);
  app.replaceChildren(page);
}
function room(code: string, display: boolean, practice = false): void {
  const page = el("main", "", "birds-room"),
    header = el("header", "", "birds-top"),
    message = notice("Connecting…");
  const audio = new BirdsAudio(!muted),
    sound = button(muted ? "SOUND OFF" : "SOUND ON");
  sound.setAttribute("aria-pressed", String(audio.enabled));
  sound.onclick = () => {
    audio.enabled = !audio.enabled;
    sound.textContent = audio.enabled ? "SOUND ON" : "SOUND OFF";
    sound.setAttribute("aria-pressed", String(audio.enabled));
    audio.unlock();
  };
  const retry = button("RETRY"),
    leave = button("LEAVE"),
    codeLabel = el("strong", code, "birds-code");
  retry.onclick = () => location.reload();
  const menu = el("details", "", "birds-menu"),
    menuTitle = el("summary", "MENU"),
    menuItems = el("div", "", "birds-menu-items");
  menuItems.append(sound, retry, leave);
  menu.append(menuTitle, menuItems);
  menu.addEventListener("toggle", () => {
    if (menu.open) cancel();
  });
  page.addEventListener("pointerdown", () => audio.unlock());
  header.append(brand(), codeLabel, message, menu);
  const lobby = el("section", "", "birds-lobby birds-card"),
    members = el("ul", "", "birds-roster"),
    start = button("START BATTLE", "fui-button-primary");
  const lobbyNote = notice("Invite at least one friend to start."),
    tv = el("a", "OPEN TV SCREEN", "fui-button");
  tv.href = endpoints.appUrl(`?room=${code}&display=1${muted ? "&mute" : ""}`);
  tv.target = "_blank";
  tv.rel = "noopener";
  const invite = createInviteCard({
    code,
    link: endpoints.appUrl(`?room=${code}`),
    qr: (text) => QRCode.toDataURL(text, { margin: 1, width: 300 }),
  });
  const nameEntry = createNameEntry({
    initial: store.get(storageKeys.name) ?? "",
    normalize: (raw) => seatName(raw) ?? "",
    buttonText: "JOIN BATTLE",
    onSubmit(name) {
      store.set(storageKeys.name, name);
      runtime.command({ type: "join", name, avatarId: "owl" });
    },
  });
  nameEntry.form.hidden = true;
  lobby.append(
    el("h1", "ASSEMBLE YOUR FLOCK"),
    invite.element,
    nameEntry.form,
    members,
    lobbyNote,
    start,
    tv,
  );
  const board = el("section", "", "birds-board"),
    canvas = el("canvas"),
    scorebar = el("div", "", "birds-scorebar"),
    turn = el("div", "", "birds-turn");
  canvas.setAttribute(
    "aria-label",
    "Battlefield. Drag your bird backwards to aim, then release to fire. Drag elsewhere to pan. Pinch or scroll to zoom.",
  );
  canvas.tabIndex = 0;
  canvas.setAttribute(
    "aria-description",
    "Keyboard: I/K aim up/down, J/L aim left/right, Shift adjusts faster, Enter fires, Escape cancels. Plus/minus zoom.",
  );
  canvas.title = canvas.getAttribute("aria-description")!;
  const sky = el("div", "", "birds-canvas");
  sky.append(canvas);
  const overlay = el("section", "", "birds-overlay"),
    overlayTitle = el("h2"),
    overlayText = el("p"),
    rematch = button("PLAY AGAIN", "fui-button-primary"),
    toLobby = button("LOBBY");
  overlay.append(overlayTitle, overlayText, rematch, toLobby);
  const cameraBar = el("div", "", "birds-camera"),
    zoomIn = button("+"),
    zoomOut = button("−"),
    recenter = button("MY BIRD"),
    full = button("FULL MAP"),
    zoomLabel = el("output", "100%", "birds-zoom");
  zoomLabel.setAttribute("aria-label", "Map zoom");
  zoomIn.setAttribute("aria-label", "Zoom in");
  zoomOut.setAttribute("aria-label", "Zoom out");
  cameraBar.append(recenter, zoomOut, zoomLabel, zoomIn, full);
  const footer = el("footer", "", "birds-controls"),
    weapons = el("div", "", "birds-weapons"),
    pebble = button("", "birds-weapon"),
    scatter = button("", "birds-weapon");
  const pebbleCount = el("b", "∞"),
    scatterCount = el("b", "×3");
  pebble.append(
    el("span", "●", "birds-pebble-icon"),
    el("span", "PEBBLE"),
    pebbleCount,
  );
  scatter.append(
    el("span", "✹", "birds-scatter-icon"),
    el("span", "SCATTER BOMB"),
    scatterCount,
  );
  weapons.append(pebble, scatter);
  const turnActions = el("div", "", "birds-turn-actions"),
    pass = button("PASS");
  turnActions.append(pass);
  const hint = el(
    "p",
    "Pull your bird backwards. Release to fire. Pinch to zoom.",
    "birds-hint",
  );
  footer.append(weapons, turnActions, hint);
  board.append(scorebar, turn, sky, overlay, cameraBar, footer);
  board.hidden = true;
  page.append(header, lobby, board);
  app.replaceChildren(page);
  page.classList.toggle("birds-tv", display);
  const gestures = createGestures({ x: 768, y: 384, zoom: 1 });
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let following = true,
    previousPaint = 0;
  let me = "",
    host = false,
    view: WorldView | null = null,
    weapon: Weapon = "pebble",
    turnKey = "",
    ready = false,
    battlefieldReady = false,
    stopped = false,
    frameId = 0;
  let keyboardAim: Vector | undefined;
  const arena = createArena(
    canvas,
    `${import.meta.env.BASE_URL}games/fuse-birds/art/v1`,
    reducedMotion,
  );
  arena.ready
    .then(() => {
      ready = true;
    })
    .catch((error) => {
      message.textContent = roomFailure(error);
    });
  const viewport = () => ({
    width: Math.max(1, canvas.clientWidth),
    height: Math.max(1, canvas.clientHeight),
  });
  const cancel = () => {
    keyboardAim = undefined;
    cancelGesture(gestures);
  };
  const canPlay = () =>
    battlefieldReady &&
    !display &&
    view?.phase === "aiming" &&
    view.players[view.active]?.id === me;
  const abandonInput = () => {
    cancel();
    resetGesture(gestures);
  };
  const canAim = canPlay;
  const play = (action: Play) => {
    if (!runtime.play(action))
      message.textContent = "Wait for your turn before playing.";
  };
  const select = (next: Weapon) => {
    cancel();
    weapon = next;
    pebble.setAttribute("aria-pressed", String(next === "pebble"));
    scatter.setAttribute("aria-pressed", String(next === "scatter"));
  };
  pebble.onclick = () => select("pebble");
  scatter.onclick = () => select("scatter");
  select("pebble");
  const centerBird = () => {
    if (!view || display) return;
    const bird =
      view.players.find((p) => p.id === me && p.hp > 0) ??
      view.players[view.active]!;
    gestures.camera = constrainCamera(
      { x: bird.x / UNIT, y: bird.y / UNIT, zoom: 2.5 },
      view,
      viewport(),
    );
    cancel();
  };
  const zoom = (factor: number) => {
    if (!view || display) return;
    following = false;
    cancel();
    const vp = viewport();
    gestures.camera = zoomAt(
      gestures.camera,
      gestures.camera.zoom * factor,
      { x: vp.width / 2, y: vp.height / 2 },
      view,
      vp,
    );
  };
  zoomIn.onclick = () => zoom(1.4);
  zoomOut.onclick = () => zoom(1 / 1.4);
  recenter.onclick = () => {
    following = true;
    centerBird();
  };
  full.onclick = () => {
    following = false;
    cancel();
    gestures.camera = { x: 768, y: 384, zoom: 1 };
  };
  const point = (e: PointerEvent) => {
    const box = canvas.getBoundingClientRect();
    return { id: e.pointerId, x: e.clientX - box.left, y: e.clientY - box.top };
  };
  canvas.onpointerdown = (e) => {
    if (!view || display) return;
    if (keyboardAim) cancel();
    audio.unlock();
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const bird = view.players[view.active]!;
    pointerDown(gestures, point(e), canAim(), view, viewport(), {
      x: bird.x / UNIT,
      y: bird.y / UNIT,
    });
    if (gestures.mode !== "aim") following = false;
  };
  canvas.onpointermove = (e) => {
    if (view && !display) pointerMove(gestures, point(e), view, viewport());
  };
  canvas.onpointerup = (e) => {
    const shot = pointerUp(gestures, e.pointerId);
    if (shot && canPlay()) {
      following = true;
      play({ type: "launch", weapon, ...shot });
    }
  };
  canvas.onpointercancel = (e) => {
    cancel();
    pointerUp(gestures, e.pointerId);
  };
  canvas.onlostpointercapture = (e) => {
    if (gestures.pointers.has(e.pointerId)) {
      cancel();
      pointerUp(gestures, e.pointerId);
    }
  };
  canvas.addEventListener(
    "wheel",
    (e) => {
      if (display || !view) return;
      following = false;
      e.preventDefault();
      cancel();
      const box = canvas.getBoundingClientRect();
      gestures.camera = zoomAt(
        gestures.camera,
        gestures.camera.zoom * Math.exp(-e.deltaY * 0.002),
        { x: e.clientX - box.left, y: e.clientY - box.top },
        view,
        viewport(),
      );
    },
    { passive: false },
  );
  if (practice) {
    pass.hidden = true;
    const newMap = button("NEW MAP");
    newMap.onclick = () => {
      cancel();
      runtime.command({ type: "action", action: "rematch" });
    };
    turnActions.append(newMap);
    retry.hidden = true;
  }
  pass.onclick = () => {
    cancel();
    play({ type: "pass" });
  };
  start.onclick = () => runtime.command({ type: "action", action: "start" });
  rematch.onclick = () =>
    runtime.command({ type: "action", action: "rematch" });
  toLobby.onclick = () => runtime.command({ type: "action", action: "lobby" });
  const cards = new Map<string, HTMLElement>();
  const callbacks: Callbacks<BirdsView, Fact, BirdsSettings> = {
    ready(id, isHost) {
      me = id;
      host = isHost;
    },
    status(text) {
      message.textContent = roomFailure(text);
    },
    kicked() {
      message.textContent =
        "You were removed from this room. Leave to create or join another.";
      cancel();
    },
    ended() {
      message.textContent =
        "Room connection ended. Retry to reconnect, or leave to start another room.";
      cancel();
    },
    event(fact, matchId, round) {
      arena.emit(fact, `${matchId}:${round}`, performance.now());
      audio.play(fact, performance.now());
      if (fact.type === "rejected" && fact.actor === me)
        message.textContent = fact.reason ?? "That action was not accepted.";
      if (fact.type === "pickup")
        message.textContent = fact.amount
          ? "Supply collected: +1 Scatter Bomb."
          : "Supply collected. Scatter ammunition is already full.";
    },
    state(frame, settings) {
      host = frame.managerId === me;
      view = frame.world;
      page.dataset.phase = view?.phase ?? frame.stage;
      page.dataset.turn = String(view?.turn ?? 0);
      const seated = frame.seats.some((s) => s.id === me && !s.watcher),
        inLobby = frame.stage === "lobby";
      lobby.hidden = !inLobby;
      board.hidden = inLobby;
      nameEntry.form.hidden = display || seated || !inLobby;
      members.replaceChildren(
        ...frame.seats
          .filter((s) => !s.watcher)
          .map((s) => {
            const li = el(
              "li",
              `${s.name}${s.id === me ? " · YOU" : ""}${s.connected ? "" : " · away"}`,
            );
            li.style.color = COLORS[s.slot]!;
            return li;
          }),
      );
      const present = frame.seats.filter(
        (s) => !s.watcher && s.connected,
      ).length;
      start.hidden = !host;
      start.disabled = present < 2;
      tv.hidden = !host || display || !settings.display;
      lobbyNote.textContent = host
        ? `${present}/5 birds ready. ${present < 2 ? "Invite a friend to start." : "Start when your flock is ready."}`
        : "Waiting for the host to start.";
      if (!view) {
        cancel();
        return;
      }
      const player = view.players[view.active]!,
        key = `${view.id}:${view.round}:${view.turn}`;
      if (turnKey !== key) {
        cancel();
        if (player.ammo === 0) select("pebble");
        if (
          !display &&
          viewport().width < 800 &&
          (!turnKey || player.id === me)
        ) {
          centerBird();
          following = true;
        }
        turnKey = key;
      }
      if (!canPlay() || (weapon === "scatter" && player.ammo === 0)) cancel();
      scorebar.replaceChildren(
        ...view.players.map((p) => {
          let card = cards.get(p.id);
          if (!card) {
            card = el("article", "", "birds-player");
            cards.set(p.id, card);
          }
          card.style.setProperty("--bird", COLORS[p.slot]!);
          card.classList.toggle("current", p.id === player.id);
          card.classList.toggle("eliminated", p.hp === 0);
          card.replaceChildren(
            el("span", `${p.name}${p.id === me && !practice ? " · YOU" : ""}`),
            el("b", p.hp > 0 ? String(p.hp) : "OUT"),
          );
          return card;
        }),
      );
      turn.textContent = practice
        ? `SOLO PRACTICE · WIND ${view.wind}`
        : `${player.id === me ? "YOUR TURN" : `${player.name}'S TURN`}  ·  ${view.phase === "aiming" ? `${Math.ceil(view.timeLeft)}s` : view.phase.toUpperCase()}  ·  WIND ${view.wind < 0 ? "←" : view.wind > 0 ? "→" : "—"} ${Math.abs(view.wind)}`;
      pebbleCount.textContent = "∞";
      scatterCount.textContent = `×${player.ammo}`;
      pebble.setAttribute("aria-label", "Pebble, unlimited ammunition");
      scatter.setAttribute(
        "aria-label",
        `Scatter Bomb, ${player.ammo} shots remaining`,
      );
      pebble.disabled = !canPlay();
      scatter.disabled = !canPlay() || player.ammo === 0;
      pass.disabled = !canPlay();
      turnActions.hidden = display;
      cameraBar.hidden = display;
      hint.textContent = display
        ? "Scan the room QR on your phone to play."
        : !battlefieldReady
          ? "Preparing the battlefield…"
          : canPlay()
            ? "Pull your bird backwards to aim. Release to fire. Drag elsewhere to pan."
            : `Watch ${player.name}. You can still explore the map.`;
      overlay.hidden = !["preparing", "over", "fault"].includes(view.phase);
      overlayTitle.textContent =
        view.phase === "preparing"
          ? "SHAPING THE ISLANDS"
          : view.phase === "fault"
            ? "ROUND INTERRUPTED"
            : view.winner
              ? `${view.players.find((p) => p.id === view!.winner)?.name ?? "Bird"} WINS!`
              : "DRAW!";
      overlayText.textContent =
        view.phase === "preparing"
          ? practice
            ? "Preparing your practice map…"
            : "Checking that every bird has an opening shot…"
          : (view.fault ?? "New terrain. Fresh ammunition. Another round?");
      rematch.hidden = toLobby.hidden = !host || view.phase === "preparing";
    },
  };
  const runtime = practice
    ? new PracticeRuntime(callbacks, {
        name: seatName(store.get(storageKeys.name) ?? "") ?? "YOU",
        seed: crypto.getRandomValues(new Uint32Array(1))[0]!,
        active: () => !document.hidden,
      })
    : new BirdsRuntime(
        code,
        {
          ...DEFAULT_SETTINGS,
          display:
            !!store.get(storageKeys.host(code)) &&
            store.get(storageKeys.shared) === "1",
        },
        callbacks,
        {
          displayOnly: display,
          transport: (events) =>
            new PeerTransport(
              code,
              roomToken(store, code, display, secret),
              events,
              {
                apiUrl: endpoints.apiUrl,
                gameId: GAME,
                maxFastBytes: MAX_PACKET_BYTES,
              },
            ),
        },
      );
  const stop = () => {
    stopped = true;
    cancel();
    cancelAnimationFrame(frameId);
    runtime.stop();
    arena.destroy();
    audio.destroy();
  };
  leave.onclick = () => {
    stop();
    location.href = endpoints.appUrl();
  };
  installRoomLifecycle(window, {
    stop: () => runtime.stop(),
    destroy: stop,
    reload: () => location.reload(),
  });
  window.addEventListener("blur", abandonInput);
  window.addEventListener("resize", cancel);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) abandonInput();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      cancel();
      return;
    }
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLButtonElement
    )
      return;
    const key = e.key.toLowerCase();
    if (!display && (key === "+" || key === "=" || key === "-")) {
      e.preventDefault();
      zoom(key === "-" ? 1 / 1.4 : 1.4);
    } else if (canAim() && ["i", "j", "k", "l"].includes(key)) {
      e.preventDefault();
      audio.unlock();
      const bird = view!.players[view!.active]!;
      const current = keyboardAim ?? {
        vx: bird.x / UNIT < view!.width / 2 ? 1536 : -1536,
        vy: -1600,
      };
      const step = e.shiftKey ? 128 : 16;
      const next = quantize(
        current.vx + (key === "l" ? step : key === "j" ? -step : 0),
        current.vy + (key === "k" ? step : key === "i" ? -step : 0),
      );
      cancelGesture(gestures);
      if (Math.abs(next.vx) + Math.abs(next.vy) >= 128) keyboardAim = next;
    } else if (canAim() && key === "enter" && keyboardAim && !e.repeat) {
      e.preventDefault();
      const vector = keyboardAim;
      cancel();
      following = true;
      play({ type: "launch", weapon, ...vector });
    }
  });
  function paint(now: number): void {
    if (stopped) return;
    if (
      view &&
      following &&
      !display &&
      !reducedMotion &&
      !keyboardAim &&
      gestures.mode === "idle"
    )
      gestures.camera = followShot(
        gestures.camera,
        view.projectiles.map((p) => ({ x: p.x / UNIT, y: p.y / UNIT })),
        view,
        viewport(),
        now - previousPaint,
      );
    previousPaint = now;
    if (ready && view && !board.hidden && view.phase !== "preparing")
      battlefieldReady = arena.paint(
        {
          world: view,
          camera: gestures.camera,
          shared: display,
          aim: keyboardAim ?? gestures.aim,
        },
        now,
      );
    else battlefieldReady = false;
    canvas.dataset.ready = String(battlefieldReady);
    canvas.dataset.gesture = keyboardAim ? "keyboard-aim" : gestures.mode;
    const zoomText = `${Math.round(gestures.camera.zoom * 100)}%`;
    if (zoomLabel.textContent !== zoomText) zoomLabel.textContent = zoomText;
    frameId = requestAnimationFrame(paint);
  }
  frameId = requestAnimationFrame(paint);
  runtime.start();
}
const query = new URLSearchParams(location.search),
  code = query.get("room")?.trim().toUpperCase();
window.addEventListener("popstate", () => location.reload());
if (query.get("practice") === "1") room("SOLO PRACTICE", false, true);
else if (code && validRoomCode(code)) room(code, query.get("display") === "1");
else landing();
