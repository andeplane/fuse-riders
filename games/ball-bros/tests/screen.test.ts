import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import type { Callbacks, Frame, RoomCommand } from "fuse-netcode";
import {
  mountGame,
  type Client,
  type ScreenOptions,
} from "../src/app/game-screen.js";
import { landing } from "../src/app/landing.js";
import {
  NAME_KEY,
  rememberRoom,
  roomFailure,
  safeStore,
  session,
} from "../src/app/session.js";
import { roomModel } from "../src/app/room-model.js";
import { installLifecycle } from "../src/app/lifecycle.js";
import {
  ballGame,
  createRoom,
  type RoomView,
  type Settings,
} from "../src/online/game.js";
import {
  createArena,
  type Impact,
  type Steering,
} from "../src/engine/state.js";

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

test("every BFCache restoration rebuilds the stopped runtime", () => {
  const listeners = new Map<string, (event: { persisted: boolean }) => void>();
  let stops = 0,
    restores = 0;
  installLifecycle(
    {
      addEventListener(type, listener) {
        listeners.set(type, listener);
      },
    },
    {
      dispose() {
        stops++;
      },
      restore() {
        restores++;
      },
    },
  );
  listeners.get("pageshow")!({ persisted: false });
  assert.equal(restores, 0);
  for (let i = 0; i < 3; i++) {
    listeners.get("pagehide")!({ persisted: true });
    listeners.get("pageshow")!({ persisted: true });
  }
  assert.equal(stops, 3);
  assert.equal(restores, 3);
});

test("returning to the lobby clears the previous round's power timers", async () => {
  const s = screen();
  await flush();
  const f = frame("running");
  f.arena!.bases.find((b) => b.id === s.client.self)!.stickyUntil = 160;
  s.update(f);
  const powers = s.root.querySelector<HTMLElement>(".power-status")!;
  assert.match(powers.textContent!, /STICKY/);
  assert.equal(powers.hidden, false);
  s.update(frame());
  assert.equal(powers.textContent, "");
  assert.equal(powers.hidden, true);
  s.destroy();
});

test("a delayed room creation cannot navigate away from a newer screen", async () => {
  const { root } = dom();
  let complete!: (value: { code: string; token: string }) => void;
  let active = true,
    destination = "";
  const store = safeStore(() => {
    throw new Error();
  });
  const card = landing(root, {
    store,
    create: () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
    active: () => active,
    navigate: (query) => {
      destination = query;
      active = false;
    },
  });
  card.create.click();
  card.solo!.click();
  complete({ code: "AB42", token: "stale" });
  await flush();
  assert.equal(destination, "?solo=1");
  assert.equal(store.getItem("ball-bros-host-AB42"), null);
});
function frame(
  stage: "lobby" | "running" | "over" = "lobby",
  matchId = "match",
): Frame<RoomView> {
  const r = createRoom(matchId, { display: false });
  for (const [slot, id] of ["a", "b"].entries())
    r.seats.set(id, {
      id,
      name: id === "a" ? "Alice" : "Bob",
      slot,
      bot: false,
      connected: true,
      generation: 1,
      avatarId: "robot",
    });
  r.stage = stage;
  if (stage !== "lobby") r.arena = createArena([...r.seats.values()]);
  if (stage === "over") {
    r.arena!.phase = "over";
    r.arena!.winner = "b";
  }
  return { ...ballGame.view(r), logTick: r.tick, managerId: "a" };
}
const dom = () => {
  const { document, window } = parseHTML(
    "<html><body><div id='app'></div></body></html>",
  );
  return {
    root: document.querySelector<HTMLElement>("#app")!,
    document,
    window,
  };
};
const button = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll("button")].find((b) => b.textContent === text)!;

test("room identities are game-scoped, reloadable and never included in invites", async () => {
  const memory = safeStore(() => {
    throw new Error("blocked");
  });
  assert.equal(session("", memory, () => "guest").kind, "landing");
  assert.equal(session("?solo=1", memory, () => "guest").kind, "solo");
  assert.equal(
    session("?room=<script>", memory, () => "guest").kind,
    "invalid",
  );
  rememberRoom(memory, "AB42", "host-secret", true);
  assert.deepEqual(
    session("?room=ab42", memory, () => "unused"),
    {
      kind: "room",
      code: "AB42",
      token: "host-secret",
      display: false,
      shared: true,
    },
  );
  assert.equal(
    (
      session("?room=AB42&display=1", memory, () => "display-secret") as {
        token: string;
      }
    ).token,
    "display-secret",
  );
  const guest = session("?room=CD42", memory, () => "guest-secret");
  assert.deepEqual(
    session("?room=CD42", memory, () => "replacement"),
    guest,
  );
  const flaky = safeStore(() => ({
    getItem() {
      throw new Error();
    },
    setItem() {
      throw new Error();
    },
  }));
  flaky.setItem("x", "saved");
  assert.equal(flaky.getItem("x"), "saved");
  const readOnly = safeStore(() => ({
    getItem: () => "old-token",
    setItem() {
      throw new Error("quota");
    },
  }));
  readOnly.setItem("credential", "new-token");
  assert.equal(readOnly.getItem("credential"), "new-token");
  const backing = new Map<string, string>();
  const normal = safeStore(() => ({
    getItem: (k) => backing.get(k) ?? null,
    setItem: (k, v) => {
      backing.set(k, v);
    },
  }));
  normal.setItem("x", "ok");
  assert.equal(normal.getItem("x"), "ok");
  assert.match(roomFailure("unknown game"), /solo/);
  assert.match(roomFailure("another game"), /another game/);
  assert.equal(roomFailure("Link failed"), "Link failed");

  const { root, window } = dom();
  let navigated = "",
    refuse = true;
  const card = landing(root, {
    store: memory,
    navigate: (q) => {
      navigated = q;
    },
    create: async () => {
      if (refuse) throw new Error("unknown game");
      return { code: "EF42", token: "new-secret" };
    },
  });
  card.create.click();
  await flush();
  assert.match(card.error.textContent!, /solo/);
  assert.equal(card.create.disabled, false);
  refuse = false;
  root.querySelector<HTMLInputElement>("input[type=checkbox]")!.checked = true;
  card.create.click();
  await flush();
  assert.equal(navigated, "?room=EF42");
  assert.ok(!root.textContent!.includes("new-secret"));
  card.solo!.click();
  assert.equal(navigated, "?solo=1");
  card.join.input.value = " ab42 ";
  card.join.button.click();
  assert.equal(navigated, "?room=AB42");
  card.join.input.value = "?";
  card.join.input.dispatchEvent(
    Object.assign(new window.Event("keydown"), { key: "Enter" }),
  );
  assert.match(card.error.textContent!, /room code/);
});

function screen(online = true, display = false, shared = false, fail = "") {
  const { root, document, window } = dom();
  const inputs: [Steering, Steering, boolean][] = [],
    commands: RoomCommand<Settings>[] = [];
  let callbacks!: Callbacks<RoomView, Impact, Settings>,
    paint!: (now: number) => void;
  let current = frame(),
    paints = 0,
    disposed = 0,
    stopped = 0,
    retries = 0,
    homes = 0,
    starts = 0,
    impacts = 0;
  let renderFails = fail === "paint",
    readyFails = fail === "ready";
  const events = new EventTarget(),
    store = safeStore(() => {
      throw new Error();
    });
  const client: Client = {
    self: display ? "tv" : "b",
    canManage: true,
    start() {
      starts++;
      callbacks.ready(client.self, true);
      callbacks.state(current, { display: shared });
    },
    stop() {
      stopped++;
    },
    cancel() {
      inputs.push([0, 0, false]);
    },
    input(s, r = 0, l = false) {
      inputs.push([s, r, l]);
      return true;
    },
    command(c) {
      commands.push(c);
      return true;
    },
    frameTiming: () => ({ newer: current, tick: current.tick, lead: 0 }),
  };
  const options: ScreenOptions = {
    online: online
      ? {
          code: "AB42",
          display,
          shared,
          link: "http://game/ball-bros/?room=AB42",
          displayLink: "http://game/ball-bros/?room=AB42&display=1",
        }
      : undefined,
    store,
    qr: async () => "data:image/png;base64,test",
    events,
    audio: {
      muted: true,
      unlock() {},
      play() {},
      destroy() {
        disposed++;
      },
    },
    renderer: () => ({
      ready: readyFails
        ? Promise.reject(new Error("load failed"))
        : Promise.resolve(),
      paint() {
        if (renderFails) throw new Error();
        paints++;
      },
      impact() {
        impacts++;
      },
      destroy() {
        disposed++;
      },
    }),
    runtime(c) {
      callbacks = c;
      return client;
    },
    now: () => 10,
    frame(cb) {
      paint = cb;
      return 1;
    },
    cancelFrame() {},
    home() {
      homes++;
    },
    retry() {
      retries++;
    },
  };
  const destroy = mountGame(root, options);
  return {
    root,
    document,
    window,
    client,
    inputs,
    commands,
    events,
    store,
    destroy,
    update(v: Frame<RoomView>) {
      current = v;
      callbacks.state(v, { display: shared });
    },
    key(
      code: string,
      type = "keydown",
      target: HTMLElement | Document = document,
    ) {
      target.dispatchEvent(
        Object.assign(
          new window.Event(type, { bubbles: true, cancelable: true }),
          { code, repeat: false },
        ),
      );
    },
    draw() {
      paint(10);
    },
    status(text: string) {
      callbacks.status(text);
    },
    event() {
      callbacks.event({ kind: "block", x: 1, y: 1, slot: 1 }, "match", 1, 1);
    },
    ended() {
      callbacks.ended?.();
    },
    kicked() {
      callbacks.kicked?.();
    },
    repair() {
      renderFails = false;
      readyFails = false;
    },
    counters: () => ({
      paints,
      disposed,
      stopped,
      retries,
      homes,
      starts,
      impacts,
    }),
  };
}

test("room screen follows lobby, own identity, controls, corrected results, rematch and leaving", async () => {
  const s = screen();
  await flush();
  assert.equal(s.root.querySelector<HTMLElement>(".room-panel")!.hidden, false);
  s.status("Direct link failed. Reconnect to retry.");
  assert.equal(
    s.root.querySelector(".status")!.parentElement,
    s.root,
    "connection failures stay visible outside the hidden arena",
  );
  assert.match(s.root.querySelector(".status")!.textContent!, /Reconnect/);
  button(s.root, "+ ADD BOT").click();
  button(s.root, "START MATCH").click();
  assert.deepEqual(s.commands.slice(-2), [
    { type: "bot", action: "add" },
    { type: "action", action: "start" },
  ]);
  const lobby = frame();
  lobby.players.push({
    id: "bot-1",
    name: "Orbit",
    avatarId: "robot",
    slot: 2,
    connected: true,
    bot: true,
  });
  s.update(lobby);
  button(s.root, "REMOVE").click();
  // Only the bot's remove control is visible.
  const remove = [
    ...s.root.querySelectorAll<HTMLButtonElement>(".remove-bot"),
  ].find((b) => !b.hidden)!;
  remove.click();
  assert.deepEqual(s.commands.at(-1), {
    type: "bot",
    action: "remove",
    id: "bot-1",
  });
  const running = frame("running");
  running.arena!.bases[0]!.saves = 99;
  running.arena!.bases[1]!.saves = 3;
  s.update(running);
  s.update(running);
  s.draw();
  s.event();
  assert.equal(
    s.root.querySelector(".controller-identity")!.textContent,
    "P2 BOB",
  );
  s.key("KeyD");
  s.key("KeyW");
  assert.deepEqual(s.inputs.at(-1), [1, 1, false]);
  s.key("KeyD", "keyup");
  assert.deepEqual(s.inputs.at(-1), [0, 1, false]);
  s.events.dispatchEvent(new Event("blur"));
  assert.deepEqual(s.inputs.at(-1), [0, 0, false]);
  s.key("Space", "keydown", button(s.root, "SOUND OFF"));
  assert.deepEqual(s.inputs.at(-1), [0, 0, false]);
  button(s.root, "SOUND OFF").click();
  assert.ok(button(s.root, "SOUND ON"));
  s.key("Space");
  assert.deepEqual(s.inputs.at(-1), [0, 0, true]);
  s.key("Space", "keyup");
  const result = frame("over");
  result.arena!.bases[1]!.saves = 3;
  s.update(result);
  assert.match(
    s.root.querySelector(".overlay p")!.textContent!,
    /Your saves: 3/,
  );
  button(s.root, "PLAY AGAIN").click();
  await flush();
  assert.deepEqual(s.commands.at(-1), { type: "action", action: "rematch" });
  button(s.root, "BACK TO LOBBY").click();
  assert.deepEqual(s.commands.at(-1), { type: "action", action: "lobby" });
  s.update(frame("running", "rematch"));
  assert.equal(s.root.querySelector<HTMLElement>(".overlay")!.hidden, true);
  s.status("Link failed: retry");
  assert.match(s.root.querySelector(".status")!.textContent!, /Link failed/);
  button(s.root, "RECONNECT").click();
  button(s.root, "LEAVE").click();
  assert.equal(s.counters().retries, 1);
  assert.equal(s.counters().homes, 1);
  s.ended();
  assert.match(s.root.querySelector(".status")!.textContent!, /Room ended/);
  s.kicked();
  assert.match(s.root.querySelector(".status")!.textContent!, /removed/);
  s.destroy();
  assert.equal(s.counters().disposed, 2);
  assert.equal(s.counters().impacts, 1);
});

test("shared phones show a controller, displays never play, and eliminated players stop sending", async () => {
  const phone = screen(true, false, true);
  await flush();
  phone.update(frame("running"));
  assert.ok(phone.root.classList.contains("controller-mode"));
  phone.draw();
  assert.equal(phone.counters().paints, 0);
  const dead = frame("running");
  dead.arena!.bases[1]!.alive = false;
  phone.update(dead);
  assert.equal(
    phone.root.querySelector<HTMLElement>(".touch-controls")!.hidden,
    true,
  );
  phone.destroy();
  const tv = screen(true, true, true);
  await flush();
  tv.update(frame("running"));
  tv.key("KeyA");
  assert.equal(
    tv.root.querySelector<HTMLElement>(".touch-controls")!.hidden,
    true,
  );
  assert.equal(
    tv.root.querySelector<HTMLElement>(".controller-identity")!.hidden,
    true,
  );
  assert.ok(tv.inputs.every((i) => i[0] === 0 && i[1] === 0));
  tv.update(frame("over"));
  assert.equal(button(tv.root, "PLAY AGAIN").hidden, true);
  tv.destroy();
});

test("name entry, remembered lobby rejoin, renderer failures and solo restart remain usable", async () => {
  const s = screen();
  await flush();
  const empty = frame();
  empty.players = [];
  s.update(empty);
  const name = s.root.querySelector<HTMLInputElement>(".fui-name-input")!;
  name.value = "Bob";
  s.root
    .querySelector(".fui-name-entry")!
    .dispatchEvent(new s.window.Event("submit", { cancelable: true }));
  assert.deepEqual(s.commands.at(-1), {
    type: "join",
    name: "Bob",
    avatarId: "fox",
  });
  assert.equal(s.store.getItem(NAME_KEY), "Bob");
  s.update(empty);
  assert.deepEqual(s.commands.at(-1), {
    type: "join",
    name: "Bob",
    avatarId: "fox",
  });
  s.destroy();
  for (const fault of ["ready", "paint"]) {
    const bad = screen(false, false, false, fault);
    await flush();
    if (fault === "paint") bad.draw();
    assert.equal(button(bad.root, "RETRY ARENA").hidden, false);
    bad.repair();
    button(bad.root, "RETRY ARENA").click();
    await flush();
    assert.ok(bad.counters().starts >= 1);
    bad.update(frame("running"));
    button(bad.root, "RESTART ROUND").click();
    await flush();
    assert.ok(bad.counters().starts >= 2);
    bad.update(frame("over"));
    button(bad.root, "PLAY AGAIN").click();
    await flush();
    assert.deepEqual(bad.commands.at(-1), {
      type: "action",
      action: "rematch",
    });
    bad.destroy();
  }
  const model = roomModel(frame("running"), "late", false, false, false);
  assert.equal(model.controls, false);
  assert.match(model.note, /lobby/);
  assert.equal(roomModel(frame(), "late", false, false, false).askName, true);
});
