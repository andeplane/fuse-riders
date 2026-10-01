import test from "node:test";
import assert from "node:assert/strict";
import {
  createFullscreenControl,
  createPointerSurface,
  type FullscreenDocument,
  type FullscreenTarget,
  type PointerLike,
} from "../src/app/screen.ts";
import type { Point } from "../src/render/camera.ts";

class FakeEvents<E> {
  readonly listeners = new Map<string, Set<(event: E) => void>>();
  addEventListener(type: string, listener: (event: E) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: (event: E) => void) {
    this.listeners.get(type)?.delete(listener);
  }
  fire(type: string, event: E) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
  count() {
    return [...this.listeners.values()].reduce((n, set) => n + set.size, 0);
  }
}

class FakeDocument extends FakeEvents<unknown> implements FullscreenDocument {
  fullscreenEnabled?: boolean;
  webkitFullscreenEnabled?: boolean;
  fullscreenElement?: unknown = null;
  webkitFullscreenElement?: unknown;
  exits = 0;
  exitFullscreen?: () => Promise<void> = async () => {
    this.exits++;
  };
  webkitExitFullscreen?: () => void | Promise<void>;
}

test("full screen goes to the game container and follows the document's state", async () => {
  const doc = new FakeDocument();
  doc.fullscreenEnabled = true;
  const requests: unknown[] = [];
  const container: FullscreenTarget = {
    async requestFullscreen(options) {
      requests.push(options);
    },
  };
  const control = createFullscreenControl(doc, container)!;
  assert.ok(control);
  let changes = 0;
  const stop = control.onChange(() => changes++);
  assert.equal(control.active(), false);
  control.toggle();
  assert.deepEqual(requests, [{ navigationUI: "hide" }]);
  doc.fullscreenElement = container;
  doc.fire("fullscreenchange", {});
  assert.equal(control.active(), true);
  assert.equal(changes, 1);
  control.toggle();
  assert.equal(doc.exits, 1, "the button leaves full screen");
  // Esc is handled by the browser: the document changes and tells us.
  doc.fullscreenElement = null;
  doc.fire("fullscreenchange", {});
  assert.equal(control.active(), false);
  assert.equal(changes, 2);
  stop();
  assert.equal(doc.count(), 0, "unsubscribing removes every listener");
});

test("full screen falls back to Safari's prefixed API and is absent when unavailable", () => {
  const doc = new FakeDocument();
  doc.exitFullscreen = undefined;
  doc.fullscreenElement = undefined;
  doc.webkitFullscreenEnabled = true;
  doc.webkitFullscreenElement = null;
  let exits = 0;
  doc.webkitExitFullscreen = () => {
    exits++;
  };
  let requests = 0;
  const container: FullscreenTarget = {
    webkitRequestFullscreen: () => {
      requests++;
    },
  };
  const control = createFullscreenControl(doc, container)!;
  let changes = 0;
  control.onChange(() => changes++);
  control.toggle();
  assert.equal(requests, 1);
  doc.webkitFullscreenElement = container;
  doc.fire("webkitfullscreenchange", {});
  assert.equal(control.active(), true);
  assert.equal(changes, 1);
  control.toggle();
  assert.equal(exits, 1);

  const blocked = new FakeDocument();
  blocked.fullscreenEnabled = false;
  assert.equal(
    createFullscreenControl(blocked, { requestFullscreen: async () => {} }),
    undefined,
    "an iframe without permission offers no button",
  );
});

test("a refused full-screen request does not surface as an error", async () => {
  const doc = new FakeDocument();
  doc.fullscreenEnabled = true;
  const control = createFullscreenControl(doc, {
    requestFullscreen: () => Promise.reject(new Error("not allowed")),
  })!;
  control.toggle();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(control.active(), false);
  // Newer Safari's prefixed request may also return a rejected promise.
  const prefixed = new FakeDocument();
  prefixed.webkitFullscreenEnabled = true;
  const safari = createFullscreenControl(prefixed, {
    webkitRequestFullscreen: () => Promise.reject(new Error("not allowed")),
  })!;
  safari.toggle();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(safari.active(), false);
});

test("the pointer surface follows the mouse over the whole window and clears when it leaves", () => {
  const win = Object.assign(new FakeEvents<PointerLike>(), {
    innerWidth: 1280,
    innerHeight: 800,
    document: Object.assign(new FakeEvents<unknown>(), {
      visibilityState: "visible",
      documentElement: new FakeEvents<unknown>(),
    }),
  });
  const surface = createPointerSurface(win);
  assert.deepEqual(surface.size(), { width: 1280, height: 800 });
  const seen: (Point | null)[] = [];
  const stop = surface.watch((p) => seen.push(p));
  const mouse = (x: number, y: number, buttons = 0, pointerType = "mouse") =>
    win.fire("pointermove", { pointerType, buttons, clientX: x, clientY: y });
  mouse(640, 799);
  mouse(640, 799, 1);
  mouse(10, 10, 0, "touch");
  mouse(1279, 400);
  win.document.documentElement.fire("mouseleave", {});
  mouse(0, 0);
  win.fire("blur", { pointerType: "", buttons: 0, clientX: 0, clientY: 0 });
  mouse(5, 5);
  win.document.visibilityState = "hidden";
  win.document.fire("visibilitychange", {});
  assert.deepEqual(seen, [
    { x: 640, y: 799 },
    null,
    null,
    { x: 1279, y: 400 },
    null,
    { x: 0, y: 0 },
    null,
    { x: 5, y: 5 },
    null,
  ]);
  stop();
  assert.equal(
    win.count() + win.document.count() + win.document.documentElement.count(),
    0,
  );
});
