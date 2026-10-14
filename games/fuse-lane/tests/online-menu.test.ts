import test from "node:test";
import assert from "node:assert/strict";
import { validRoomCode } from "fuse-network-fe";
import { createArt } from "../src/app/art.js";
import { createMenu, type MenuMode } from "../src/app/menu.js";
import {
  createOnlineSheet,
  lastRoom,
  nextFace,
  storedFace,
  type OnlineMode,
} from "../src/app/online-menu.js";
import { createRoomLobby, presetOf } from "../src/app/room-lobby.js";
import { colorOf, type LobbyModel } from "../src/app/presenter.js";
import { keys, type Store } from "../src/app/session.js";
import { FakeImages, installDom } from "./fixtures/dom.js";

const dom = installDom();
const art = createArt("/", new FakeImages().make);
const names = keys("fuse-lane");

function memory(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  const store: Store = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
  return { store, map };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

function sheet(
  store: Store,
  create: (mode: OnlineMode) => Promise<void> = async () => {},
) {
  const created: OnlineMode[] = [],
    joined: string[] = [];
  const root = createOnlineSheet({
    art,
    store,
    keys: names,
    valid: validRoomCode,
    onCreate: (mode) => {
      created.push(mode);
      return create(mode);
    },
    onJoin: (code) => joined.push(code),
  });
  dom.document.body.replaceChildren(root);
  const byText = (text: string) =>
    dom
      .$$<HTMLButtonElement>("button", root)
      .find((button) => button.textContent === text)!;
  return { root, created, joined, byText };
}

test("PLAY ONLINE: a face and name for the room, each device or a shared TV, remembered on the device", async () => {
  const { store, map } = memory({ [names.name]: "Ada" });
  const s = sheet(store);
  const name = dom.$<HTMLInputElement>(".fl-person-name", s.root);
  assert.equal(name.value, "Ada", "the name the room seats you with");
  const face = dom.$<HTMLButtonElement>(".fl-person-face", s.root);
  face.click();
  assert.equal(map.get(names.avatar), nextFace("fox"));
  assert.equal(storedFace(store, names.avatar), nextFace("fox"));
  const devices = s.byText("EACH ON THEIR OWN DEVICE"),
    shared = s.byText("SHARED TV");
  assert.equal(devices.getAttribute("aria-pressed"), "true");
  shared.click();
  assert.equal(shared.getAttribute("aria-pressed"), "true");
  assert.equal(map.get(names.shared), "1");
  assert.match(
    dom.$(".fl-mode-hint", s.root).textContent ?? "",
    /each player plays from their own phone/,
  );
  name.value = "  Ada Lovelace ";
  s.byText("CREATE ROOM").click();
  await settle();
  assert.deepEqual(s.created, ["shared"]);
  assert.equal(map.get(names.name), "Ada Lovelace");
});

test("CREATE ROOM says what went wrong and comes back; JOIN takes a code in any case, or says what a code looks like", async () => {
  const { store } = memory();
  const s = sheet(store, () =>
    Promise.reject(new Error("Online rooms are not open yet for this game.")),
  );
  const create = s.byText("CREATE ROOM");
  create.click();
  assert.equal(create.disabled, true, "one room per tap");
  await settle();
  const error = dom.$(".fl-online-error", s.root);
  assert.equal(error.hidden, false);
  assert.equal(
    error.textContent,
    "Online rooms are not open yet for this game.",
  );
  assert.equal(s.byText("CREATE ROOM").disabled, false);

  const code = dom.$<HTMLInputElement>(".fl-join input", s.root);
  code.value = "??";
  s.byText("JOIN").click();
  assert.equal(error.textContent, "Type the room's code, for example AB42");
  code.value = " ab42 ";
  s.byText("JOIN").click();
  assert.deepEqual(s.joined, ["AB42"]);
});

test("REJOIN goes back to the last room this device was in", () => {
  const { store } = memory({ [names.last]: "qx74" });
  assert.equal(lastRoom(store, names.last, validRoomCode), "QX74");
  const s = sheet(store);
  s.byText("REJOIN QX74").click();
  assert.deepEqual(s.joined, ["QX74"]);
  assert.equal(lastRoom(memory().store, names.last, validRoomCode), undefined);
  assert.equal(
    lastRoom(memory({ [names.last]: "!!" }).store, names.last, validRoomCode),
    undefined,
  );
});

test("the menu's two tabs: this device or online, opening on the one the device used last", () => {
  const modes: MenuMode[] = [];
  const online = dom.document.createElement("section");
  const root = createMenu({
    art,
    store: memory().store,
    onStart: () => {},
    onResume: () => {},
    onDiscard: () => {},
    online: { sheet: online, mode: "online", onMode: (m) => modes.push(m) },
  });
  dom.document.body.replaceChildren(root);
  const tab = (text: string) =>
    dom
      .$$<HTMLButtonElement>('[role="tab"]', root)
      .find((button) => button.textContent === text)!;
  const setup = dom.$(".fl-setup", root);
  assert.equal(setup.hidden, true);
  assert.equal(online.hidden, false);
  assert.equal(tab("PLAY ONLINE").getAttribute("aria-selected"), "true");
  tab("ON THIS DEVICE").click();
  assert.deepEqual(modes, ["local"]);
  assert.equal(setup.hidden, false);
  assert.equal(online.hidden, true);
});

const LOBBY: LobbyModel = {
  members: [
    {
      id: "a",
      name: "Ada (you)",
      status: "READY",
      avatar: "fox",
      color: colorOf(0),
    },
    { id: "b", name: "Bo", status: "AWAY", avatar: "cat", color: colorOf(1) },
    {
      id: "bot:1",
      name: "Riley",
      status: "BOT",
      avatar: "robot",
      color: colorOf(2),
    },
  ],
  canStart: true,
  showStart: true,
  note: "",
  canAddBot: true,
  removable: ["bot:1"],
  goals: [30, 30, 30, 30],
  canPickGoals: true,
  weekSeconds: 60,
  canSetWeek: true,
  level: 1,
  canSetLevel: true,
};

test("the room's lobby: faces and names, the AI's level, goal presets and every host choice back as an action", () => {
  const calls: unknown[][] = [];
  const lobby = createRoomLobby({
    art,
    code: "AB42",
    link: "https://example.test/fuse-lane/?room=AB42",
    qr: async () => "data:image/png;base64,",
    tv: false,
    actions: {
      addBot: () => calls.push(["addBot"]),
      removeBot: (id) => calls.push(["removeBot", id]),
      start: () => calls.push(["start"]),
      goal: (goal) => calls.push(["goal", goal]),
      level: (level) => calls.push(["level", level]),
      weekSeconds: (seconds) => calls.push(["week", seconds]),
    },
  });
  dom.document.body.replaceChildren(lobby.element);
  lobby.render(LOBBY, false);
  const rows = dom.$$(".fl-roster-row", lobby.element);
  assert.deepEqual(
    rows.map((row) => row.textContent?.replace("×", "")),
    ["Ada (you)Ready", "BoAway", "RileyAI · Normal"],
  );
  assert.ok(rows[1]!.classList.contains("away"));
  const removes = dom.$$<HTMLButtonElement>(".fl-remove", lobby.element);
  assert.deepEqual(
    removes.map((remove) => remove.hidden),
    [true, true, false],
    "only an AI can be removed",
  );
  removes[2]!.click();
  const press = (text: string) =>
    dom
      .$$<HTMLButtonElement>("button", lobby.element)
      .find((button) => button.textContent === text)!
      .click();
  press("Long · 80");
  press("Hard");
  press("90s");
  press("+ ADD AI");
  press("START MATCH");
  assert.deepEqual(calls, [
    ["removeBot", "bot:1"],
    ["goal", 80],
    ["level", 2],
    ["week", 90],
    ["addBot"],
    ["start"],
  ]);
  // A guest: no START, no bots, a note; and nobody's level to set without an AI.
  lobby.render(
    {
      ...LOBBY,
      members: LOBBY.members.slice(0, 2),
      canStart: false,
      showStart: false,
      canAddBot: false,
      removable: [],
      canSetWeek: false,
      canSetLevel: false,
      note: "Waiting for the host to start",
    },
    false,
  );
  assert.equal(dom.$$(".fl-roster-row", lobby.element).length, 2);
  assert.equal(dom.$(".fl-lobby-note", lobby.element).hidden, false);
  assert.equal(
    dom.$<HTMLButtonElement>(".fl-start", lobby.element).hidden,
    true,
  );
});

test("a goal preset is read back only when all four goals match one", () => {
  assert.equal(presetOf([50, 50, 50, 50]), 50);
  assert.equal(presetOf([30, 40, 50, 60]), 0);
  assert.equal(presetOf([70, 70, 70, 70]), 0);
});
