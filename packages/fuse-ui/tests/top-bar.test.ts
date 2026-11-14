import assert from "node:assert/strict";
import { test } from "node:test";
import { createTopBar } from "fuse-ui";
import { page } from "./dom-fixture.js";
import { ALL_SONGS } from "fuse-music";
import type { MusicPlayer } from "../src/radio.js";

test("the default radio survives header replacement without constructing a second player", () => {
  const { document } = page();
  let creates = 0,
    plays = 0,
    paused = true;
  const media: MusicPlayer = {
    src: "",
    volume: 0,
    onended: null,
    onerror: null,
    get paused() {
      return paused;
    },
    play: async () => {
      plays++;
      paused = false;
    },
    pause() {
      paused = true;
    },
    load() {},
  };
  const first = document.createElement("header");
  document.body.append(first);
  const createMusicMedia = () => {
    creates++;
    return media;
  };
  createTopBar({ element: first, gameId: "test-game", createMusicMedia });
  assert.equal(creates, 0, "opening a game does not download music");
  assert.equal(
    first.querySelectorAll(".fui-radio option").length,
    ALL_SONGS.length,
  );
  first.querySelector<HTMLButtonElement>(".fui-radio button")!.click();
  assert.equal(creates, 1);
  assert.equal(plays, 1);
  const second = document.createElement("header");
  first.replaceWith(second);
  createTopBar({ element: second, gameId: "test-game", createMusicMedia });
  assert.equal(creates, 1);
  assert.equal(document.querySelectorAll(".fui-radio").length, 1);
  assert.equal(
    second.querySelector(".fui-radio button")?.textContent,
    "Pause radio",
  );
});

test("games can choose a smaller catalogue or retain their own radio controls", () => {
  const { document } = page();
  const root = document.createElement("header");
  const media: MusicPlayer = {
    src: "",
    volume: 0,
    onended: null,
    onerror: null,
    play: async () => {},
    pause() {},
    load() {},
  };
  createTopBar({
    element: root,
    gameId: "test-game",
    music: [ALL_SONGS[17]],
    createMusicMedia: () => media,
  });
  assert.equal(root.querySelectorAll(".fui-radio option").length, 1);
  const custom = document.createElement("header");
  createTopBar({
    element: custom,
    gameId: "custom-game",
    music: false,
    createMusicMedia: () => media,
  });
  assert.equal(custom.querySelector(".fui-radio"), null);
});

test("one master sound button controls both channels and survives header refreshes", () => {
  const { document } = page();
  const root = document.createElement("header");
  const state = { music: true, effects: true };
  createTopBar({
    element: root,
    sound: {
      enabled: () => state.music || state.effects,
      setEnabled(on) {
        state.music = state.effects = on;
      },
    },
  });
  const sound = root.querySelector<HTMLButtonElement>(".fui-top-bar-sound")!;
  sound.click();
  assert.deepEqual(state, { music: false, effects: false });
  assert.equal(sound.getAttribute("aria-label"), "Sound off");
  createTopBar({ element: root });
  sound.click();
  assert.deepEqual(state, { music: true, effects: true });
  assert.equal(root.querySelectorAll(".fui-top-bar-sound").length, 1);
});

test("preview mute disables the master switch and games without audio hide it", () => {
  const { document } = page();
  const root = document.createElement("header");
  createTopBar({ element: root });
  const sound = root.querySelector<HTMLButtonElement>(".fui-top-bar-sound")!;
  assert.equal(sound.hidden, true);
  let writes = 0;
  createTopBar({
    element: root,
    sound: {
      enabled: () => true,
      forcedMute: true,
      setEnabled() {
        writes++;
      },
    },
  });
  sound.click();
  assert.equal(sound.disabled, true);
  assert.equal(sound.hidden, false);
  assert.equal(sound.getAttribute("aria-label"), "Sound off");
  assert.equal(writes, 0);
});

test("initially empty room notices remain connected and visible outside the menu", () => {
  const { document } = page();
  const root = document.createElement("header");
  const notice = document.createElement("div");
  root.append(notice);
  document.body.append(root);
  createTopBar({ element: root });
  notice.textContent = "Connection lost. Retry.";
  assert.equal(notice.isConnected, true);
  assert.equal(notice.closest("dialog"), null);
  assert.equal(notice.parentElement?.className, "fui-top-bar-context");
  createTopBar({ element: root });
  assert.equal(
    root.querySelector(".fui-top-bar-context")?.textContent,
    "Connection lost. Retry.",
  );
});

test("the shared header retains account/menu handlers and reflects later per-game Elo updates", async () => {
  const { document } = page(),
    root = document.createElement("header"),
    brand = document.createElement("a"),
    nav = document.createElement("nav");
  nav.className = "fui-social";
  brand.textContent = "FUSE VOLLEY";
  const profile = document.createElement("button"),
    friends = document.createElement("button");
  profile.textContent = "Sign in";
  friends.textContent = "Friends";
  let opened = 0;
  profile.onclick = () => {
    opened++;
  };
  nav.append(profile, friends);
  root.append(brand, nav);
  document.body.append(root);
  createTopBar({ element: root, brand, gameId: "fuse-volley" });
  const account = root.querySelector<HTMLButtonElement>(
    ".fui-top-bar-account",
  )!;
  account.click();
  assert.equal(opened, 1);
  profile.textContent = "Andeplane\n1,000 ELO";
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(account.textContent, "Andeplane\n1,000 ELO");
  assert.equal(root.dataset.gameId, "fuse-volley");
  assert.ok(root.querySelector(".fui-top-bar-actions")!.contains(friends));
  const toggle = root.querySelector(".fui-top-bar-toggle");
  createTopBar({ element: root, gameId: "fuse-volley" });
  assert.equal(root.querySelectorAll(".fui-top-bar-toggle").length, 1);
  assert.equal(root.querySelector(".fui-top-bar-toggle"), toggle);
});

test("a reconciled header can be rebuilt without appending its old brand container to itself", () => {
  const { document } = page(),
    root = document.createElement("header");
  root.innerHTML = '<div class="brand">FUSE CRAFT</div>';
  document.body.append(root);
  createTopBar({ element: root, gameId: "fuse-craft" });
  const oldLeft = root.querySelector<HTMLElement>(".fui-top-bar-left")!;
  root.className = "nd-header";
  oldLeft.className = "brand";
  oldLeft.textContent = "FUSE CRAFT";
  createTopBar({ element: root, gameId: "fuse-craft" });
  assert.equal(root.querySelectorAll(".fui-top-bar-left").length, 1);
  assert.match(
    root.querySelector(".fui-top-bar-brand")!.textContent!,
    /FUSE CRAFT/,
  );
});

test("a key pressed in the bar's own controls stays there; one in the game's lent context reaches the game", () => {
  const { document, window } = page();
  const root = document.createElement("header");
  document.body.append(root);
  createTopBar({ element: root, music: false, gameId: "test-game" });
  const lent = document.createElement("button");
  root.querySelector(".fui-top-bar-context")!.append(lent);
  const heard: (EventTarget | null)[] = [];
  document.addEventListener("keydown", (event) => heard.push(event.target));
  const press = (target: Element) =>
    target.dispatchEvent(new window.Event("keydown", { bubbles: true }));
  press(root.querySelector(".fui-top-bar-toggle")!);
  assert.deepEqual(heard, [], "Space on ☰ opens the menu, not the bomb");
  press(lent);
  assert.deepEqual(
    heard,
    [lent],
    "focus left on the game's own button must not swallow its keys",
  );
});
