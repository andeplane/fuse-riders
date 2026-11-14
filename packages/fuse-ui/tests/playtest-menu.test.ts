import assert from "node:assert/strict";
import { test } from "node:test";
import { Window as BrowserWindow } from "happy-dom";
import { createTopBar } from "../src/top-bar.js";
import {
  installBrowserPlaytest,
  type PlaytestAccount,
} from "../src/playtest.js";
import type { OutboxItem, PlaytestOutbox } from "../src/playtest-outbox.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((ready) => {
    resolve = ready;
  });
  return { promise, resolve };
}

function fixture() {
  const browser = new BrowserWindow({
    url: "https://games.example/fuse-riders/?mute",
  });
  const win = browser as unknown as Window;
  const doc = win.document;
  const listeners = new Set<Parameters<PlaytestAccount["watchAccount"]>[0]>();
  const requests: string[] = [];
  let approval: Promise<Response> | undefined;
  let allowed = true;
  let starts = 0,
    stops = 0;
  let nextStart: Promise<void> | undefined;
  const items = new Map<string, OutboxItem>();
  const outbox: PlaytestOutbox = {
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
      const item = items.get(key);
      if (item?.kind !== "recording") throw new Error("Missing recording");
      const updated = change(item);
      items.set(key, updated);
      return updated;
    },
  };
  const identity: PlaytestAccount = {
    signedInToken: async () => "test-token",
    accountReady: async () => {},
    signIn: async () => {},
    signInFailure: () => "",
    watchAccount(listener) {
      listeners.add(listener);
      listener(undefined);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  const playtest = installBrowserPlaytest({
    document: doc,
    window: win,
    gameId: "fuse-riders",
    account: identity,
    outbox,
    fetch: async (input, init) => {
      const path = new URL(String(input)).pathname;
      requests.push(path);
      if (path === "/api/dev/me")
        return (
          approval ??
          Response.json(
            allowed ? { uid: "admin", email: "admin@example.test" } : {},
            { status: allowed ? 200 : 403 },
          )
        );
      if (path.endsWith("/finish"))
        return Response.json({
          recording: { id: path.split("/").at(-2), status: "finished" },
        });
      const body = JSON.parse(String(init?.body)) as { id: string };
      return Response.json({ recording: { id: body.id } });
    },
    startMicrophone: async () => {
      starts++;
      await nextStart;
      return {
        offsetMs: () => 0,
        setGame() {},
        async stop() {
          stops++;
        },
      };
    },
  });
  const root = doc.createElement("header");
  doc.body.append(root);
  createTopBar({ element: root, gameId: "fuse-riders", music: false });
  const toggle = root.querySelector<HTMLButtonElement>(
    ".fui-playtest-recording-toggle",
  )!;
  return {
    browser,
    win,
    doc,
    playtest,
    root,
    toggle,
    requests,
    starts: () => starts,
    stops: () => stops,
    allow(value: boolean) {
      allowed = value;
    },
    deferApproval(value: Promise<Response> | undefined) {
      approval = value;
    },
    deferStart(value: Promise<void>) {
      nextStart = value;
    },
    user(signedIn: boolean) {
      for (const listener of listeners)
        listener(signedIn ? { name: "Player" } : undefined);
    },
    async flush() {
      await new Promise<void>((resolve) => setImmediate(resolve));
    },
    async close() {
      browser.dispatchEvent(new browser.Event("pagehide"));
      await browser.happyDOM.close();
    },
  };
}

test("the game menu offers recording only after server-approved sign-in, without a query flag", async () => {
  const f = fixture();
  try {
    assert.equal(f.toggle.hidden, true);
    assert.equal(
      f.root.querySelector(".fui-playtest-trigger")?.textContent,
      "Report · Ctrl+X",
    );
    assert.equal(
      f.requests.length,
      0,
      "anonymous play makes no access request",
    );
    f.allow(false);
    f.user(true);
    await f.flush();
    assert.equal(f.toggle.hidden, true);
    assert.equal(f.starts(), 0);
    f.user(false);
    f.allow(true);
    f.user(true);
    await f.flush();
    assert.equal(f.toggle.hidden, false);
    assert.equal(f.toggle.textContent, "Start recording");
    assert.equal(f.starts(), 0, "sign-in alone never requests the microphone");
    f.toggle.click();
    await f.flush();
    assert.equal(f.starts(), 1);
    assert.equal(f.toggle.textContent, "Stop recording");
    assert.equal(f.toggle.getAttribute("aria-pressed"), "true");
    f.toggle.click();
    await f.flush();
    assert.equal(f.stops(), 1);
    assert.equal(f.toggle.textContent, "Start recording");
    f.toggle.click();
    await f.flush();
    f.user(false);
    await f.flush();
    assert.equal(f.toggle.hidden, true);
    assert.equal(f.stops(), 2, "sign-out stops active audio capture");
    assert.equal(f.requests.filter((path) => path === "/api/dev/me").length, 2);
  } finally {
    await f.close();
  }
});

test("sign-out invalidates both in-flight authorization and a pending microphone start", async () => {
  const f = fixture();
  try {
    const approval = deferred<Response>();
    f.deferApproval(approval.promise);
    f.user(true);
    await f.flush();
    f.user(false);
    approval.resolve(
      Response.json({ uid: "old-admin", email: "admin@example.test" }),
    );
    await f.flush();
    assert.equal(f.toggle.hidden, true);
    f.deferApproval(undefined);
    f.user(true);
    await f.flush();
    const capture = deferred<void>();
    f.deferStart(capture.promise);
    f.toggle.click();
    await f.flush();
    assert.equal(f.toggle.disabled, true);
    f.user(false);
    capture.resolve();
    await f.flush();
    assert.equal(f.starts(), 1);
    assert.equal(f.stops(), 1);
    assert.equal(f.toggle.hidden, true);
    assert.equal(f.toggle.getAttribute("aria-pressed"), "false");
  } finally {
    await f.close();
  }
});

test("a stale denial cannot revoke a later account; a current denial stops its capture", async () => {
  const f = fixture();
  try {
    const oldApproval = deferred<Response>();
    f.deferApproval(oldApproval.promise);
    f.user(true);
    await f.flush();
    f.user(false);
    f.deferApproval(undefined);
    f.user(true);
    await f.flush();
    assert.equal(f.toggle.hidden, false);
    oldApproval.resolve(Response.json({}, { status: 403 }));
    await f.flush();
    assert.equal(f.toggle.hidden, false);
    f.toggle.click();
    await f.flush();
    assert.equal(f.starts(), 1);
    f.allow(false);
    f.user(true);
    await f.flush();
    assert.equal(f.toggle.hidden, true);
    assert.equal(f.stops(), 1);
    assert.equal(f.toggle.getAttribute("aria-pressed"), "false");
    // An untrusted same-origin window is not a current embedded game.
    f.browser.dispatchEvent(
      new f.browser.MessageEvent("message", {
        origin: f.win.location.origin,
        source: f.browser,
        data: { type: "fuse-playtest-recording-toggle" },
      }),
    );
    await f.flush();
    assert.equal(f.starts(), 1);
  } finally {
    await f.close();
  }
});
