import { createTopBar } from "../src/top-bar.js";
import {
  installBrowserPlaytest,
  type PlaytestAccount,
} from "../src/playtest.js";
import type { OutboxItem, PlaytestOutbox } from "../src/playtest-outbox.js";

const role = location.pathname === "/" ? "desktop" : "game";
const counts = { starts: 0, stops: 0, access: 0 };
const items = new Map<string, OutboxItem>();
const store: PlaytestOutbox = {
  async list() {
    return [...items.values()];
  },
  async put(item) {
    items.set(item.key, item);
  },
  async remove(key) {
    items.delete(key);
  },
  async updateRecording(key, change) {
    const value = items.get(key);
    if (value?.kind !== "recording") throw new Error("Missing recording");
    const next = change(value);
    items.set(key, next);
    return next;
  },
};
const identity: PlaytestAccount = {
  accountReady: async () => {},
  signedInToken: async () => "fake-verified-test-token",
  signIn: async () => {},
  signInFailure: () => "",
  watchAccount(listener) {
    if (role !== "desktop")
      throw new Error("A game must use its desktop's access state");
    listener({ name: "Test admin" });
    return () => {};
  },
};
const playtest = installBrowserPlaytest({
  document,
  window,
  gameId: role === "desktop" ? "fuseos" : "fuse-riders",
  recordingOnly: role === "desktop",
  account: identity,
  outbox: store,
  async fetch(input, init) {
    if (role !== "desktop")
      throw new Error("A game must never create its own recording");
    const path = new URL(String(input)).pathname;
    if (path === "/api/dev/me") {
      counts.access++;
      return Response.json({ uid: "admin", email: "admin@example.test" });
    }
    if (path.endsWith("/finish"))
      return Response.json({
        recording: { id: path.split("/").at(-2), status: "finished" },
      });
    const body = JSON.parse(String(init?.body)) as { id: string };
    return Response.json({ recording: { id: body.id } });
  },
  async startMicrophone() {
    if (role !== "desktop")
      throw new Error("A game must never open the microphone");
    counts.starts++;
    renderCounts();
    return {
      offsetMs: () => 0,
      setGame() {},
      async stop() {
        counts.stops++;
        renderCounts();
      },
    };
  },
});
const header = document.createElement("header");
document.body.append(header);
createTopBar({
  element: header,
  gameId: role === "desktop" ? "fuseos" : "fuse-riders",
  music: false,
});
function renderCounts() {
  document.body.dataset.starts = String(counts.starts);
  document.body.dataset.stops = String(counts.stops);
  document.body.dataset.access = String(counts.access);
}
playtest.watchRecording(renderCounts);
if (role === "desktop") {
  const game = document.createElement("iframe");
  game.id = "game";
  game.src = "/fuse-riders/?mute";
  document.body.append(game);
}
