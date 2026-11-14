import assert from "node:assert/strict";
import test from "node:test";
import { page } from "./dom-fixture.js";
import { playtestCanvasImages } from "../src/playtest-input.js";
import {
  registerPhaserPlaytestCapture,
  type SnapshotRenderer,
} from "../src/playtest-renderer.js";

test("a discarded framebuffer is redrawn and captured without stepping the game", async () => {
  const { document } = page();
  const canvas = document.createElement("canvas");
  document.body.append(canvas);
  const calls: string[] = [];
  let read: ((image: unknown) => void) | undefined;
  let pixels = "discarded";
  const renderer: SnapshotRenderer = {
    snapshot(callback) {
      calls.push("snapshot");
      read = callback;
    },
    preRender() {
      calls.push("preRender");
      pixels = "cleared";
    },
    postRender() {
      calls.push("postRender");
      read?.({ src: `data:image/png;base64,${pixels}` });
      pixels = "discarded";
    },
  };
  const game = {
    canvas,
    renderer,
    scene: {
      render(value: SnapshotRenderer) {
        assert.equal(value, renderer);
        calls.push("render");
        pixels = "actual-frame";
      },
    },
    step() {
      assert.fail("report capture must not update scenes or simulation");
    },
  };
  const dispose = registerPhaserPlaytestCapture(document, game);
  assert.equal(
    (await playtestCanvasImages(document)).get(canvas),
    "data:image/png;base64,actual-frame",
  );
  assert.deepEqual(calls, ["snapshot", "preRender", "render", "postRender"]);
  dispose();
  assert.equal((await playtestCanvasImages(document)).size, 0);
});

test("disconnected canvases are ignored and invalid renderer snapshots fail explicitly", async () => {
  const { document } = page();
  const canvas = document.createElement("canvas");
  let read: ((image: unknown) => void) | undefined;
  const renderer: SnapshotRenderer = {
    snapshot(callback) {
      read = callback;
    },
    preRender() {},
    postRender() {
      read?.({ red: 0 });
    },
  };
  const dispose = registerPhaserPlaytestCapture(document, {
    canvas,
    renderer,
    scene: { render() {} },
  });
  assert.equal((await playtestCanvasImages(document)).size, 0);
  document.body.append(canvas);
  await assert.rejects(playtestCanvasImages(document), /could not be read/);
  dispose();
});
