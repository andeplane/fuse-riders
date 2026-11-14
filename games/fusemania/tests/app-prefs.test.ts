import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTIONS,
  COLUMN_ACTIONS,
  DEFAULT_PREFS,
  MAX_KEYS,
  MAX_OFFSET_MS,
  MAX_SPEED,
  MAX_VISUAL_MS,
  MIN_SPEED,
  PREFS_KEY,
  RESERVED_CODES,
  actionOf,
  bindKey,
  defaultPrefs,
  keyLabel,
  loadPrefs,
  parsePrefs,
  savePrefs,
  unbindKey,
  type Prefs,
  type PrefsStore,
} from "../src/app/prefs.js";

/** A store that keeps what it is given and counts the calls. */
function fakeStore(initial?: string) {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(PREFS_KEY, initial);
  const log = { reads: 0, writes: 0 };
  const store: PrefsStore = {
    getItem(key) {
      log.reads++;
      return data.get(key) ?? null;
    },
    setItem(key, value) {
      log.writes++;
      data.set(key, value);
    },
  };
  return { store, data, log };
}
/** Every bound key, to check none is on two actions. */
const allKeys = (prefs: Prefs) =>
  ACTIONS.flatMap((action) => prefs.keys[action]);
const custom = (): Prefs => ({
  keys: {
    left: ["KeyQ", "Numpad4"],
    down: ["KeyW"],
    up: ["KeyE"],
    right: ["KeyR", "Semicolon"],
    item: [],
  },
  speed: 2.25,
  down: true,
  offsetMs: -35,
  visualMs: 20,
});

// ---- the defaults ----

test("the defaults are WASD, IJKL and the arrow keys, with Space for the power-up", () => {
  const prefs = defaultPrefs();
  assert.deepEqual(prefs.keys, {
    left: ["KeyA", "KeyJ", "ArrowLeft"],
    down: ["KeyS", "KeyK", "ArrowDown"],
    up: ["KeyW", "KeyI", "ArrowUp"],
    right: ["KeyD", "KeyL", "ArrowRight"],
    item: ["Space"],
  });
  assert.deepEqual(
    [prefs.speed, prefs.down, prefs.offsetMs, prefs.visualMs],
    [1.5, false, 0, 0],
  );
  assert.equal(new Set(allKeys(prefs)).size, allKeys(prefs).length);
  assert.deepEqual(COLUMN_ACTIONS, ["left", "down", "up", "right"]);
  assert.ok(ACTIONS.every((action) => prefs.keys[action].length <= MAX_KEYS));
});

test("every call for the defaults gets a copy of its own", () => {
  const first = defaultPrefs();
  first.keys.left.push("KeyZ");
  first.keys.item.length = 0;
  first.speed = 4;
  assert.deepEqual(defaultPrefs().keys.left, ["KeyA", "KeyJ", "ArrowLeft"]);
  assert.deepEqual(defaultPrefs().keys.item, ["Space"]);
  assert.equal(defaultPrefs().speed, 1.5);
  assert.deepEqual(DEFAULT_PREFS.keys.left, ["KeyA", "KeyJ", "ArrowLeft"]);
  assert.notEqual(defaultPrefs().keys, defaultPrefs().keys);
});

// ---- parsing ----

test("anything that is not preferences parses as the defaults", () => {
  for (const garbage of [
    undefined,
    null,
    0,
    7,
    "",
    "prefs",
    true,
    [],
    [1, 2, 3],
    {},
    () => 1,
    { keys: null },
    { keys: "KeyA" },
    { keys: [] },
    { keys: { left: "KeyA" } },
    { speed: "fast", down: "yes", offsetMs: null, visualMs: {} },
  ])
    assert.deepEqual(parsePrefs(garbage), defaultPrefs(), String(garbage));
});

test("a stored layout that is valid is kept as it is", () => {
  const stored = custom();
  const parsed = parsePrefs(JSON.parse(JSON.stringify(stored)));
  assert.deepEqual(parsed, stored);
  // And what it returns shares nothing with what it was given.
  const again = parsePrefs(stored);
  assert.deepEqual(again, stored);
  assert.notEqual(again, stored);
  assert.notEqual(again.keys.left, stored.keys.left);
});

test("each field is kept when valid and defaulted when not", () => {
  assert.deepEqual(
    parsePrefs({ speed: 3, down: true, offsetMs: "12", visualMs: [] }),
    { ...defaultPrefs(), speed: 3, down: true },
  );
  assert.deepEqual(parsePrefs({ keys: custom().keys, speed: null, down: 1 }), {
    ...defaultPrefs(),
    keys: custom().keys,
  });
  // Unknown fields are not carried along.
  assert.deepEqual(
    Object.keys(parsePrefs({ speed: 2, extra: 1, __proto__: { x: 1 } })).sort(),
    ["down", "keys", "offsetMs", "speed", "visualMs"],
  );
});

test("numbers are clamped to their limits, and offsets are whole milliseconds", () => {
  assert.equal(parsePrefs({ speed: 99 }).speed, MAX_SPEED);
  assert.equal(parsePrefs({ speed: 0 }).speed, MIN_SPEED);
  assert.equal(parsePrefs({ speed: -3 }).speed, MIN_SPEED);
  assert.equal(parsePrefs({ speed: 2.75 }).speed, 2.75);
  assert.equal(parsePrefs({ offsetMs: 9999 }).offsetMs, MAX_OFFSET_MS);
  assert.equal(parsePrefs({ offsetMs: -9999 }).offsetMs, -MAX_OFFSET_MS);
  assert.equal(parsePrefs({ offsetMs: 37.6 }).offsetMs, 38);
  assert.equal(parsePrefs({ offsetMs: -12.4 }).offsetMs, -12);
  assert.equal(parsePrefs({ visualMs: 9999 }).visualMs, MAX_VISUAL_MS);
  assert.equal(parsePrefs({ visualMs: -9999 }).visualMs, -MAX_VISUAL_MS);
  assert.equal(parsePrefs({ visualMs: 14.5 }).visualMs, 15);
  // Not numbers at all: the defaults, not a limit.
  for (const bad of [Number.NaN, Infinity, -Infinity, "2", null]) {
    assert.equal(parsePrefs({ speed: bad }).speed, 1.5, String(bad));
    assert.equal(parsePrefs({ offsetMs: bad }).offsetMs, 0, String(bad));
    assert.equal(parsePrefs({ visualMs: bad }).visualMs, 0, String(bad));
  }
});

test("stored keys are filtered: reserved, malformed and repeated codes are dropped", () => {
  const parsed = parsePrefs({
    keys: {
      left: ["KeyQ", "Escape", 7, "Key Q"],
      down: ["KeyW", "KeyQ"],
      up: ["KeyE", "KeyE", "Tab", ""],
      right: ["KeyR", "x".repeat(25), "<b>", null],
      item: ["F5", "MetaLeft"],
    },
  });
  assert.deepEqual(parsed.keys, {
    left: ["KeyQ"],
    // KeyQ was already Left's: a key belongs to one action.
    down: ["KeyW"],
    up: ["KeyE"],
    right: ["KeyR"],
    item: [],
  });
  assert.equal(new Set(allKeys(parsed)).size, allKeys(parsed).length);
});

test("a stored layout that leaves an arrow without a key, or is malformed, is not used", () => {
  const good = custom().keys;
  for (const keys of [
    { ...good, up: [] },
    { ...good, up: ["Escape"] },
    // Up's only key is already Left's.
    { ...good, up: ["KeyQ"] },
    { ...good, right: undefined },
    { ...good, item: "Space" },
    { left: good.left, down: good.down, up: good.up, right: good.right },
    { ...good, left: ["KeyA", "KeyB", "KeyC", "KeyD", "KeyF"] },
  ]) {
    const parsed = parsePrefs({ keys, speed: 3 });
    assert.deepEqual(parsed.keys, defaultPrefs().keys, JSON.stringify(keys));
    assert.equal(parsed.speed, 3, "the other fields still count");
  }
  // The power-up alone may be without a key.
  assert.deepEqual(parsePrefs({ keys: { ...good, item: [] } }).keys.item, []);
});

// ---- binding ----

test("binding a key adds it to the action and leaves the original alone", () => {
  const prefs = defaultPrefs(),
    before = structuredClone(prefs);
  const next = bindKey(prefs, "left", "KeyF");
  assert.deepEqual(next.keys.left, ["KeyA", "KeyJ", "ArrowLeft", "KeyF"]);
  assert.deepEqual(prefs, before);
  assert.notEqual(next, prefs);
  assert.notEqual(next.keys.down, prefs.keys.down, "nothing is shared");
  assert.deepEqual(
    { ...next, keys: { ...next.keys, left: before.keys.left } },
    before,
    "only that action changed",
  );
  assert.equal(actionOf(next, "KeyF"), "left");
  assert.equal(actionOf(prefs, "KeyF"), undefined);
});

test("a key belongs to one action: binding it elsewhere moves it", () => {
  const prefs = defaultPrefs();
  const next = bindKey(prefs, "item", "KeyS");
  assert.deepEqual(next.keys.item, ["Space", "KeyS"]);
  assert.deepEqual(next.keys.down, ["KeyK", "ArrowDown"]);
  assert.equal(actionOf(next, "KeyS"), "item");
  assert.equal(new Set(allKeys(next)).size, allKeys(next).length);
  // Every binding, in any order, keeps that true.
  let state = defaultPrefs();
  const presses: [number, string][] = [
    [0, "KeyS"],
    [1, "KeyA"],
    [2, "Space"],
    [4, "KeyW"],
    [3, "KeyS"],
    [0, "ArrowRight"],
    [4, "KeyA"],
    [2, "KeyD"],
  ];
  for (const [index, key] of presses) {
    state = bindKey(state, ACTIONS[index]!, key);
    assert.equal(new Set(allKeys(state)).size, allKeys(state).length);
    assert.ok(COLUMN_ACTIONS.every((action) => state.keys[action].length > 0));
    assert.ok(ACTIONS.every((action) => state.keys[action].length <= MAX_KEYS));
  }
});

test("an action holds MAX_KEYS keys: the oldest drops for a new one", () => {
  let prefs = bindKey(defaultPrefs(), "left", "KeyF");
  assert.equal(prefs.keys.left.length, MAX_KEYS);
  prefs = bindKey(prefs, "left", "KeyG");
  assert.deepEqual(prefs.keys.left, ["KeyJ", "ArrowLeft", "KeyF", "KeyG"]);
  assert.equal(actionOf(prefs, "KeyA"), undefined, "the dropped key is free");
  // Binding a key the action already has makes it the newest, and drops nothing.
  prefs = bindKey(prefs, "left", "KeyJ");
  assert.deepEqual(prefs.keys.left, ["ArrowLeft", "KeyF", "KeyG", "KeyJ"]);
});

test("an arrow never loses its last key", () => {
  const prefs = defaultPrefs();
  prefs.keys.down = ["KeyS"];
  // Taking Down's only key for another action is refused outright.
  assert.equal(bindKey(prefs, "left", "KeyS"), prefs);
  assert.equal(bindKey(prefs, "item", "KeyS"), prefs);
  // Removing it is refused too.
  assert.equal(unbindKey(prefs, "down", "KeyS"), prefs);
  assert.deepEqual(prefs.keys.down, ["KeyS"]);
  // With a second key the first is free to go either way.
  const two = bindKey(prefs, "down", "KeyX");
  assert.deepEqual(bindKey(two, "left", "KeyS").keys.down, ["KeyX"]);
  assert.deepEqual(unbindKey(two, "down", "KeyS").keys.down, ["KeyX"]);
  assert.equal(
    unbindKey(unbindKey(two, "down", "KeyS"), "down", "KeyX").keys.down.length,
    1,
  );
});

test("removing a key leaves the rest, and the power-up may end with none", () => {
  const prefs = defaultPrefs(),
    before = structuredClone(prefs);
  const next = unbindKey(prefs, "up", "KeyI");
  assert.deepEqual(next.keys.up, ["KeyW", "ArrowUp"]);
  assert.deepEqual(prefs, before, "the original is untouched");
  assert.notEqual(next.keys.left, prefs.keys.left);
  const none = unbindKey(prefs, "item", "Space");
  assert.deepEqual(none.keys.item, []);
  assert.equal(actionOf(none, "Space"), undefined);
  // A key the action does not have changes nothing that matters.
  assert.deepEqual(unbindKey(prefs, "up", "KeyZ"), before);
  assert.deepEqual(unbindKey(prefs, "up", "KeyA"), before, "Left keeps its A");
});

test("reserved and malformed keys are never bound", () => {
  const prefs = defaultPrefs();
  assert.deepEqual(RESERVED_CODES, [
    "Escape",
    "Tab",
    "MetaLeft",
    "MetaRight",
    "F5",
    "F11",
    "F12",
  ]);
  for (const key of [
    ...RESERVED_CODES,
    "",
    "Key A",
    "Key-A",
    "<script>",
    "x".repeat(25),
  ]) {
    for (const action of ACTIONS)
      assert.equal(bindKey(prefs, action, key), prefs, `${action} ${key}`);
    assert.equal(actionOf(prefs, key), undefined);
  }
  // Their neighbours are ordinary keys.
  for (const key of [
    "F1",
    "F10",
    "ShiftLeft",
    "Enter",
    "Numpad0",
    "IntlBackslash",
  ])
    assert.equal(actionOf(bindKey(prefs, "item", key), key), "item", key);
});

test("actionOf finds the action a key is on", () => {
  const prefs = defaultPrefs();
  assert.equal(actionOf(prefs, "KeyA"), "left");
  assert.equal(actionOf(prefs, "ArrowDown"), "down");
  assert.equal(actionOf(prefs, "KeyI"), "up");
  assert.equal(actionOf(prefs, "KeyL"), "right");
  assert.equal(actionOf(prefs, "Space"), "item");
  assert.equal(actionOf(prefs, "KeyZ"), undefined);
});

// ---- labels ----

test("a key is labelled as the player reads it", () => {
  const labels: [string, string][] = [
    ["KeyA", "A"],
    ["KeyZ", "Z"],
    ["Digit7", "7"],
    ["ArrowLeft", "←"],
    ["ArrowDown", "↓"],
    ["ArrowUp", "↑"],
    ["ArrowRight", "→"],
    ["Space", "SPACE"],
    ["Enter", "ENTER"],
    ["ShiftLeft", "L SHIFT"],
    ["ShiftRight", "R SHIFT"],
    ["ControlLeft", "L CTRL"],
    ["ControlRight", "R CTRL"],
    ["AltLeft", "L ALT"],
    ["AltRight", "R ALT"],
    ["Backspace", "BKSP"],
    ["Numpad4", "NUM 4"],
    ["NumpadEnter", "NUM ENTER"],
    ["Semicolon", "SEMICOLON"],
    ["F1", "F1"],
  ];
  for (const [key, label] of labels) assert.equal(keyLabel(key), label, key);
  // Every default key has a short label, and no two keys of the defaults read alike.
  const shown = allKeys(defaultPrefs()).map(keyLabel);
  assert.ok(shown.every((label) => label.length > 0 && label.length <= 5));
  assert.equal(new Set(shown).size, shown.length);
});

// ---- storage ----

test("preferences survive a save and a load", () => {
  const { store, data, log } = fakeStore();
  assert.deepEqual(loadPrefs(store), defaultPrefs(), "nothing stored yet");
  const prefs = custom();
  savePrefs(store, prefs);
  assert.equal(log.writes, 1);
  assert.deepEqual([...data.keys()], [PREFS_KEY]);
  assert.deepEqual(loadPrefs(store), prefs);
  assert.deepEqual(prefs, custom(), "saving does not change what was saved");
});

test("what is saved is always valid, whatever it was given", () => {
  const { store, data } = fakeStore();
  const wild: Prefs = {
    keys: {
      left: ["KeyQ", "Escape"],
      down: ["KeyW"],
      up: ["KeyE"],
      right: ["KeyR"],
      item: ["KeyQ"],
    },
    speed: 40,
    down: true,
    offsetMs: 1e6,
    visualMs: -12.7,
  };
  savePrefs(store, wild);
  assert.deepEqual(JSON.parse(data.get(PREFS_KEY)!), {
    keys: {
      left: ["KeyQ"],
      down: ["KeyW"],
      up: ["KeyE"],
      right: ["KeyR"],
      item: [],
    },
    speed: MAX_SPEED,
    down: true,
    offsetMs: MAX_OFFSET_MS,
    visualMs: -13,
  });
});

test("a stored value that is not preferences loads as the defaults", () => {
  for (const stored of [
    "",
    "{",
    "not json",
    "null",
    "42",
    '"prefs"',
    "[]",
    "{}",
    '{"keys":{"left":[]}}',
  ])
    assert.deepEqual(
      loadPrefs(fakeStore(stored).store),
      defaultPrefs(),
      stored,
    );
  // What is valid in a partly broken value still counts.
  assert.deepEqual(
    loadPrefs(fakeStore('{"speed":3,"down":true,"keys":7}').store),
    { ...defaultPrefs(), speed: 3, down: true },
  );
});

test("a store that throws costs only the remembered choice", () => {
  const refusing: PrefsStore = {
    getItem() {
      throw new Error("storage is blocked");
    },
    setItem() {
      throw new Error("quota exceeded");
    },
  };
  assert.deepEqual(loadPrefs(refusing), defaultPrefs());
  assert.doesNotThrow(() => savePrefs(refusing, custom()));
  // A store that reads but cannot write still gives what it has.
  const { store } = fakeStore(JSON.stringify(custom()));
  const readOnly: PrefsStore = {
    getItem: (key) => store.getItem(key),
    setItem() {
      throw new Error("read only");
    },
  };
  savePrefs(readOnly, defaultPrefs());
  assert.deepEqual(loadPrefs(readOnly), custom());
});
