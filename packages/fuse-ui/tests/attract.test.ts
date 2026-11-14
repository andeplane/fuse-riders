import assert from "node:assert/strict";
import { test } from "node:test";
import {
  awaitAttractReady,
  demoCanvas,
  mountAttract,
  type AttractDriver,
  type AttractEnvironment,
} from "fuse-ui";
import { page } from "./dom-fixture.js";
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function clock() {
  let next = 1,
    hidden = false,
    reduced = false;
  const frames = new Map<number, (now: number) => void>();
  const motion = new Set<() => void>(),
    visibility = new Set<() => void>();
  const environment: AttractEnvironment = {
    requestFrame(draw) {
      const id = next++;
      frames.set(id, draw);
      return id;
    },
    cancelFrame(id) {
      frames.delete(id);
    },
    hidden: () => hidden,
    reducedMotion: () => reduced,
    onMotionChange(changed) {
      motion.add(changed);
      return () => {
        motion.delete(changed);
      };
    },
    onVisibilityChange(changed) {
      visibility.add(changed);
      return () => {
        visibility.delete(changed);
      };
    },
  };
  return {
    environment,
    frame(now: number) {
      const pending = [...frames.values()];
      frames.clear();
      for (const draw of pending) draw(now);
    },
    hide(value: boolean) {
      hidden = value;
      for (const changed of visibility) changed();
    },
    reduce(value: boolean) {
      reduced = value;
      for (const changed of motion) changed();
    },
    pending: () => frames.size,
    listeners: () => motion.size + visibility.size,
  };
}
function demo() {
  const calls = { ticks: 0, renders: 0, disposed: 0, paused: false };
  const driver: AttractDriver = {
    advance() {
      calls.ticks++;
    },
    render() {
      calls.renders++;
    },
    tick: () => calls.ticks,
    pause(value) {
      calls.paused = value;
    },
    dispose() {
      calls.disposed++;
    },
  };
  return { calls, driver };
}

test("shared attract player pauses physics, honours visibility/reduced motion and disposes on leaving", async () => {
  const { document } = page(),
    root = document.createElement("section"),
    time = clock(),
    { calls, driver } = demo();
  document.body.append(root);
  const stop = mountAttract(
    root,
    (host) => {
      demoCanvas(host);
      return driver;
    },
    time.environment,
  );
  await settle();
  time.frame(100);
  time.frame(150);
  assert.equal(calls.ticks, 1);
  root.querySelector<HTMLButtonElement>("button")!.click();
  time.frame(200);
  time.frame(300);
  assert.equal(calls.ticks, 1);
  assert.equal(calls.paused, true);
  assert.equal(root.dataset.attractState, "paused");
  time.reduce(false);
  time.frame(350);
  time.frame(400);
  assert.equal(calls.ticks, 3);
  time.hide(true);
  time.frame(450);
  assert.equal(calls.ticks, 3);
  assert.equal(calls.paused, true);
  time.hide(false);
  time.frame(10000);
  time.frame(10050);
  assert.equal(calls.ticks, 4, "returning never catches up hidden time");
  time.reduce(true);
  time.frame(10100);
  assert.equal(calls.ticks, 4);
  root.remove();
  time.frame(10150);
  assert.equal(calls.disposed, 1);
  assert.equal(time.pending(), 0);
  assert.equal(time.listeners(), 0);
  stop();
  assert.equal(calls.disposed, 1);
});

test("leaving during async preparation cleans up listeners and destroys a late renderer", async () => {
  const { document } = page(),
    root = document.createElement("section"),
    time = clock(),
    { calls, driver } = demo();
  document.body.append(root);
  let ready!: (driver: AttractDriver) => void;
  const loading = new Promise<AttractDriver>((resolve) => {
    ready = resolve;
  });
  mountAttract(root, () => loading, time.environment);
  await settle();
  root.remove();
  time.frame(100);
  assert.equal(time.listeners(), 0);
  ready(driver);
  await settle();
  assert.equal(calls.disposed, 1);
  assert.equal(time.pending(), 0);
});

test("a renderer failure cannot block the menu or leak its loop", async () => {
  const { document } = page(),
    root = document.createElement("section"),
    time = clock(),
    { calls, driver } = demo();
  document.body.append(root);
  mountAttract(
    root,
    () => ({
      ...driver,
      render() {
        throw new Error("draw failed");
      },
    }),
    time.environment,
  );
  await settle();
  time.frame(100);
  assert.equal(root.dataset.attractState, "failed");
  assert.match(root.dataset.attractError!, /draw failed/);
  assert.equal(calls.disposed, 1);
  assert.equal(time.listeners(), 0);
  assert.equal(time.pending(), 0);
});

test("leaving cancels an asset load and releases its allocated renderer", async () => {
  const { document } = page(),
    root = document.createElement("section"),
    time = clock();
  document.body.append(root);
  let destroyed = 0;
  mountAttract(
    root,
    async (_host, signal) => {
      await awaitAttractReady(
        new Promise<void>(() => {}),
        () => {
          destroyed++;
        },
        signal,
      );
      return demo().driver;
    },
    time.environment,
  );
  await settle();
  root.remove();
  time.frame(100);
  await settle();
  assert.equal(destroyed, 1);
  assert.equal(time.listeners(), 0);
  await assert.rejects(
    awaitAttractReady(Promise.reject(new Error("missing art")), () => {
      destroyed++;
    }),
    /missing art/,
  );
  assert.equal(destroyed, 2);
});

test("a background whose frames are slow to draw leaves the page most of the main thread", async () => {
  const { document } = page(),
    root = document.createElement("section"),
    time = clock(),
    { calls, driver } = demo();
  document.body.append(root);
  const stop = mountAttract(
    root,
    (host) => {
      demoCanvas(host);
      return driver;
    },
    time.environment,
  );
  await settle();
  // Cheap frames: one every display frame that is a thirtieth of a second after the last.
  time.frame(0);
  time.frame(40);
  time.frame(80);
  assert.equal(calls.renders, 3);
  // The frame drawn at 80 holds the page until 580: it cost 500 ms.
  time.frame(580);
  assert.equal(calls.renders, 3, "the frame after a slow one draws nothing");
  for (let now = 600; now < 1580; now += 20) time.frame(now);
  assert.equal(
    calls.renders,
    3,
    "and nothing is drawn for three times its cost",
  );
  time.frame(1580);
  assert.equal(calls.renders, 4);
  // Cheap again: the ration lifts with the very next frame.
  time.frame(1600);
  time.frame(1640);
  assert.equal(calls.renders, 5);
  // A frame that cost a whole second waits two, not three: the ration has a ceiling.
  time.frame(2640);
  for (let now = 2660; now < 3640; now += 20) time.frame(now);
  assert.equal(calls.renders, 5);
  time.frame(3640);
  assert.equal(calls.renders, 6);
  stop();
});
