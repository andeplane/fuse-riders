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
  createLandingCard,
  createInviteCard,
  createNameEntry,
  createNotice,
  createRoster,
  el,
} from "fuse-ui";
import {
  UP,
  DOWN,
  LEFT,
  RIGHT,
  VACUUM,
  PULSE,
  DURATION,
  carried,
  createWorld,
  botInput,
  stepWorld,
  type World,
} from "../engine/world.js";
import { GraveyardRuntime } from "../online/runtime.js";
import type { View } from "../online/game.js";
import { seatName } from "../online/names.js";
import { draw, COLORS } from "../render/scene.js";
import { toView } from "../engine/view.js";
import { keys, safeStore, sessionFor, roomFailure } from "./session.js";
import { NightAudio } from "./audio.js";
const GAME = "graveyard-shift",
  app = document.querySelector<HTMLElement>("#app")!,
  store = safeStore(() => localStorage),
  names = keys(GAME),
  query = new URLSearchParams(location.search);
const endpoints = createEndpoints(
  {
    basePath: `${import.meta.env.BASE_URL}${GAME}/`,
    apiOrigin: import.meta.env.VITE_API_ORIGIN,
  },
  location.origin,
);
const audio = new NightAudio(store, location.search);
let runtime: GraveyardRuntime | undefined;
let latest: View | undefined;
let self = "";
let alive = true;
const url = (search = "") =>
  endpoints.appUrl(
    search + (query.has("mute") ? (search ? "&" : "?") + "mute" : ""),
  );
function navigate(search = "") {
  runtime?.stop();
  audio.stop();
  location.href = url(search);
}
function header() {
  const h = el("header", "", "top"),
    portal = createAppPortal({
      document,
      current: GAME,
      base: import.meta.env.BASE_URL,
      search: location.search,
    }),
    brand = el("a", "GRAVEYARD SHIFT", "brand");
  brand.href = url();
  const sound = button(audio.silent ? "SOUND OFF" : "SOUND", "sound");
  sound.disabled = audio.silent;
  sound.onclick = () => {
    audio.toggle();
    sound.textContent = audio.prefs.muted.music ? "SOUND OFF" : "SOUND ON";
  };
  h.append(portal.element, brand, el("span", "A FUSE GAME", "eyebrow"), sound);
  return h;
}
function handbook() {
  const d = el("dialog", "", "handbook");
  d.append(
    el("p", "FIELD GUIDE / 01", "eyebrow"),
    el("h2", "Your first night"),
    el("p", "90 seconds. Two shrines. Only banked energy counts."),
  );
  const steps = [
    [
      "01 / VACUUM",
      "Face a ghost and hold J or left mouse. Stay in range while its resistance ring drains. Contests reward sustained suction.",
    ],
    [
      "02 / CARRY",
      "Your backpack holds five ghosts. Wisps are worth 1; wraiths are worth 4 and tug you toward them.",
    ],
    [
      "03 / CONTAIN",
      "Stand still at either gold shrine for 1.25 seconds to bank your whole tank. Moving interrupts delivery.",
    ],
    [
      "04 / DISRUPT",
      "Space or K sends an air pulse. It interrupts nearby rivals and releases one of their ghosts. Recharge: 3.5 seconds.",
    ],
  ];
  for (const [a, b] of steps) {
    d.append(el("h3", a), el("p", b));
  }
  d.append(
    el(
      "p",
      "WASD / ARROWS to move • J / MOUSE to vacuum • SPACE / K to pulse. On phones, hold the direction pad and action buttons. Equal banked scores share placement.",
    ),
  );
  const close = button("READY FOR THE NIGHT", "primary");
  close.onclick = () => d.close();
  d.append(close);
  app.append(d);
  d.showModal();
}
function canvas() {
  const c = el("canvas", "", "arena");
  c.width = 1000;
  c.height = 620;
  c.setAttribute(
    "aria-label",
    "Moonlit cemetery arena with hunters, ghosts and two containment shrines",
  );
  return c;
}
const top = header();
app.append(top);
document.addEventListener("pointerdown", () => audio.resume());
document.addEventListener("keydown", () => audio.resume());
if (!query.has("room") && query.get("solo") !== "1") landing();
else room();
function landing() {
  const hero = el("main", "", "landing"),
    art = el("section", "", "hero"),
    c = canvas();
  const title = el("div", "", "hero-title");
  title.append(
    el("p", "ST. HOLLOW CEMETERY • MIDNIGHT", "eyebrow"),
    el("h1", "GRAVEYARD\nSHIFT"),
    el(
      "p",
      "The dead are restless.\nYour night just got interesting.",
      "tagline",
    ),
  );
  art.append(c, title);
  const shared = el("label", "", "shared"),
    toggle = el("input");
  toggle.type = "checkbox";
  toggle.checked = store.getItem(names.shared) === "1";
  toggle.onchange = () =>
    store.setItem(names.shared, toggle.checked ? "1" : "0");
  shared.append(toggle, el("span", "Shared TV + phone controllers"));
  const card = createLandingCard({
    title: "CLOCK IN",
    tagline:
      "Catch ghosts. Fill your tank. Reach a shrine before a rival blows your haul loose.",
    soloText: "START SOLO SHIFT",
    async onCreate() {
      const r = await createRoom(endpoints.apiUrl, fetch, GAME);
      store.setItem(names.host(r.code), r.token);
      navigate(`?room=${r.code}`);
    },
    onSolo: () => navigate("?solo=1"),
    valid: validRoomCode,
    onJoin: (code) => navigate(`?room=${code}`),
  });
  card.create.after(shared);
  const guide = button("HOW TO PLAY", "guide");
  guide.onclick = handbook;
  card.element.append(
    guide,
    el("p", "2–5 HUNTERS • SOLO + BOTS • 90 SECONDS", "meta"),
  );
  hero.append(art, card.element);
  app.append(hero);
  const demo = createWorld(47, [
    { id: "a", slot: 0 },
    { id: "b", slot: 1 },
    { id: "c", slot: 2 },
  ]);
  let last = 0;
  const animate = (now: number) => {
    if (!alive) return;
    if (now - last > 50) {
      stepWorld(
        demo,
        new Map(demo.hunters.map((h) => [h.id, botInput(demo, h)])),
      );
      last = now;
      if (demo.tick >= DURATION) demo.tick = 0;
    }
    draw(c.getContext("2d")!, toView(demo), "");
    audio.frame();
    requestAnimationFrame(animate);
  };
  requestAnimationFrame(animate);
}
function room() {
  const session = sessionFor(
    location.search,
    store,
    GAME,
    validRoomCode,
    () => uuid().replaceAll("-", "") + uuid().replaceAll("-", ""),
  );
  if (session.kind === "invalid" || session.kind === "landing") {
    app.append(el("p", "Invalid room code. Return to the menu."));
    return;
  }
  const solo = session.kind === "solo",
    code = session.kind === "room" ? session.code : "SOLO",
    display = session.kind === "room" && session.role === "display";
  let host = solo,
    shared = false;
  const status = createNotice({ className: "status" }),
    exit = button("LEAVE");
  exit.onclick = () => navigate();
  top.append(el("b", code, "room-code"), status.element, exit);
  const main = el("main", "", "room"),
    lobby = el("section", "", "lobby"),
    roster = createRoster({ emptyText: "Waiting for the night crew" }),
    add = button("+ ADD BOT"),
    ready = button("READY", "primary"),
    tv = button("OPEN TV"),
    help = button("HOW TO PLAY");
  help.onclick = handbook;
  add.onclick = () => runtime?.command({ type: "bot", action: "add" });
  ready.onclick = () => runtime?.readyUp();
  tv.onclick = () => window.open(url(`?room=${code}&display=1`), "_blank");
  if (!solo) {
    const invite = createInviteCard({
      code,
      link: url(`?room=${code}`),
      qr: (text) => QRCode.toDataURL(text, { margin: 1, width: 240 }),
    });
    lobby.append(invite.element);
  }
  const name = createNameEntry({
    initial: store.getItem(names.name) ?? "",
    normalize: (v) => seatName(v) ?? "",
    onInput: (v) => store.setItem(names.name, v),
    buttonText: "JOIN CREW",
    onSubmit: (v) => {
      store.setItem(names.name, v);
      runtime?.command({ type: "join", name: v });
    },
  });
  const actions = el("div", "", "actions");
  actions.append(add, ready, tv, help);
  lobby.append(
    el("p", "NIGHT CREW", "eyebrow"),
    el("h1", "The gates are open."),
    roster.element,
    el("p", "Every human hunter presses READY. Bots are always ready."),
    actions,
  );
  const play = el("section", "", "play"),
    hud = el("div", "", "hud"),
    timer = el("strong", "01:30", "clock"),
    scores = el("div", "", "scores"),
    c = canvas(),
    hint = el("p", "Move · Vacuum · Carry · Contain", "hint"),
    pad = el("section", "", "pad"),
    personal = el("p", "", "personal");
  hud.append(scores, timer);
  play.append(hud, c, hint, personal, pad);
  const dirs = el("div", "", "directions"),
    abilities = el("div", "", "abilities");
  pad.append(dirs, abilities);
  const sources = new Map<string, number>();
  let bits = 0;
  const update = () => {
    bits = [...sources.values()].reduce((a, b) => a | b, 0);
    runtime?.input(bits);
  };
  const clear = () => {
    sources.clear();
    bits = 0;
    runtime?.cancel();
  };
  const hold = (
    label: string,
    bit: number,
    parent: HTMLElement,
    cls: string,
  ) => {
    const b = button(label, cls);
    b.setAttribute("aria-label", label);
    b.onpointerdown = (e) => {
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      sources.set(`p${e.pointerId}`, bit);
      update();
    };
    const release = (e: PointerEvent) => {
      sources.delete(`p${e.pointerId}`);
      update();
    };
    b.onpointerup = release;
    b.onpointercancel = clear;
    b.onlostpointercapture = (e) => {
      if (sources.has(`p${e.pointerId}`)) clear();
    };
    parent.append(b);
    return b;
  };
  hold("↑", UP, dirs, "up");
  hold("←", LEFT, dirs, "left");
  hold("↓", DOWN, dirs, "down");
  hold("→", RIGHT, dirs, "right");
  hold("VACUUM", VACUUM, abilities, "vacuum");
  const pulse = hold("AIR PULSE", PULSE, abilities, "pulse");
  const keysMap: Record<string, number> = {
    w: UP,
    arrowup: UP,
    s: DOWN,
    arrowdown: DOWN,
    a: LEFT,
    arrowleft: LEFT,
    d: RIGHT,
    arrowright: RIGHT,
    j: VACUUM,
    k: PULSE,
    " ": PULSE,
  };
  document.addEventListener("keydown", (e) => {
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement ||
      e.target instanceof HTMLButtonElement
    )
      return;
    const b = keysMap[e.key.toLowerCase()];
    if (b) {
      e.preventDefault();
      sources.set(e.key.toLowerCase(), b);
      update();
    }
  });
  document.addEventListener("keyup", (e) => {
    sources.delete(e.key.toLowerCase());
    update();
  });
  window.addEventListener("blur", clear);
  document.addEventListener("visibilitychange", () => {
    clear();
    audio.visibility(document.hidden);
  });
  c.onpointerdown = (e) => {
    if (e.button !== 0) return;
    c.setPointerCapture(e.pointerId);
    sources.set(`p${e.pointerId}`, VACUUM);
    update();
  };
  c.onpointerup =
    c.onpointercancel =
    c.onlostpointercapture =
      (e) => {
        sources.delete(`p${e.pointerId}`);
        update();
      };
  const result = el("section", "", "result"),
    resultTitle = el("h1", "SHIFT COMPLETE"),
    ranks = el("div", "", "ranks"),
    again = button("READY FOR ANOTHER SHIFT", "primary"),
    back = button("BACK TO LOBBY");
  again.onclick = () => runtime?.readyUp();
  back.onclick = () => runtime?.command({ type: "action", action: "lobby" });
  result.append(resultTitle, ranks, again, back);
  main.append(name.form, lobby, play, result);
  ready.hidden = true;
  add.hidden = true;
  tv.hidden = true;
  play.hidden = true;
  result.hidden = true;
  name.form.hidden = true;
  app.append(main);
  let previous: World | undefined;
  let joined = false;
  runtime = new GraveyardRuntime(
    code,
    {
      display:
        !solo &&
        session.kind === "room" &&
        session.role === "host" &&
        store.getItem(names.shared) === "1",
    },
    {
      state(frame, settings) {
        latest = frame;
        shared = settings.display;
        runtime?.flush();
        const mine = frame.seats.find((s) => s.id === self && !s.watcher);
        main.dataset.phase = frame.stage;
        main.dataset.tick = String(frame.tick);
        main.dataset.layout =
          shared && !display && !!mine ? "controller" : "arena";
        name.form.hidden = solo || display || !!mine;
        lobby.hidden = frame.stage !== "lobby";
        play.hidden = frame.stage === "lobby";
        result.hidden = frame.stage !== "over";
        pad.hidden = display || !mine || frame.stage !== "running";
        c.hidden = shared && !display && !!mine;
        personal.hidden = display;
        add.hidden = !host || frame.seats.filter((s) => !s.watcher).length >= 5;
        tv.hidden = !host || !shared;
        ready.hidden = display || !mine;
        ready.textContent = frame.ready[self] ? "WAITING FOR CREW…" : "READY";
        again.hidden = display || !mine;
        again.textContent = frame.ready[self]
          ? "WAITING FOR CREW…"
          : "READY FOR ANOTHER SHIFT";
        back.hidden = !host;
        if (!mine && !display && !joined && store.getItem(names.name)) {
          joined = true;
          runtime?.command({ type: "join", name: store.getItem(names.name)! });
        }
        roster.update(
          frame.seats
            .filter((s) => !s.watcher)
            .map((s) => ({
              id: s.id,
              name:
                s.name +
                (s.bot ? " / BOT" : frame.ready[s.id] ? " / READY" : ""),
              color: COLORS[s.slot]!,
              connected: s.connected,
            })),
        );
        for (const [id, row] of roster.entries()) {
          const s = frame.seats.find((s) => s.id === id);
          let b = row.querySelector<HTMLButtonElement>(".remove");
          if (host && s?.bot && !b) {
            b = button("×", "remove");
            b.onclick = () =>
              runtime?.command({ type: "bot", action: "remove", id });
            row.append(b);
          }
        }
        const w = frame.world;
        if (!w) return;
        const seconds = Math.ceil((DURATION - w.tick) / 20);
        timer.textContent = `${Math.floor(seconds / 60)
          .toString()
          .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
        scores.replaceChildren(
          ...w.hunters.map((h) => {
            const card = el("div", "", "score");
            card.style.setProperty("--hunter", COLORS[h.slot]!);
            card.append(
              el(
                "span",
                frame.seats.find((s) => s.id === h.id)?.name ?? "Hunter",
              ),
              el("strong", String(h.score).padStart(3, "0")),
              el("small", `${h.tank.length}/5 · +${carried(w, h)} carried`),
            );
            return card;
          }),
        );
        const me = w.hunters.find((h) => h.id === self);
        personal.textContent = me
          ? `${mine?.name ?? "Hunter"} · BANKED ${me.score} · TANK ${me.tank.length}/5 · CARRYING ${carried(w, me)}`
          : "Watching the night crew";
        pulse.textContent = me?.cooldown
          ? `PULSE ${(me.cooldown / 20).toFixed(1)}s`
          : "AIR PULSE";
        hint.textContent = me?.deposit
          ? "CONTAINING… Hold still."
          : me?.tank.length === 5
            ? "TANK FULL — reach either shrine and hold still."
            : "WASD / ARROWS move   ·   J / MOUSE vacuum   ·   SPACE pulse";
        if (frame.stage === "over") {
          const sorted = [...w.hunters].sort(
            (a, b) => b.score - a.score || a.slot - b.slot,
          );
          ranks.replaceChildren(
            ...sorted.map((h) =>
              el(
                "p",
                `${1 + w.hunters.filter((p) => p.score > h.score).length}. ${frame.seats.find((s) => s.id === h.id)?.name ?? "Hunter"} — ${h.score} energy`,
              ),
            ),
          );
        }
        if (previous && me) {
          const old = previous.hunters.find((h) => h.id === self);
          if (old) {
            if (me.score > old.score) audio.cue("deposit");
            else if (me.tank.length > old.tank.length) audio.cue("capture");
            if (me.pulse > old.pulse) audio.cue("pulse");
            if (me.stun > old.stun) audio.cue("hit");
          }
        }
        previous = w;
      },
      event() {},
      status: (s) => {
        status.show(roomFailure(s), "info");
      },
      ready(id, isHost) {
        self = id;
        host = isHost;
      },
      ended() {
        status.show(
          "Room ended. Return to the menu to create a new shift.",
          "error",
        );
      },
    },
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
      : { humanName: store.getItem(names.name) ?? "Hunter" },
  );
  const retry = button("RECONNECT", "retry");
  retry.onclick = () => location.reload();
  top.append(retry);
  installRoomLifecycle(window, {
    stop: () => {
      clear();
      runtime?.stop();
    },
    destroy: () => {
      alive = false;
      audio.stop();
    },
    reload: () => location.reload(),
  });
  runtime.start();
  const render = () => {
    if (!alive) return;
    if (latest?.world && !c.hidden)
      draw(c.getContext("2d")!, latest.world, self);
    audio.frame();
    requestAnimationFrame(render);
  };
  requestAnimationFrame(render);
}
