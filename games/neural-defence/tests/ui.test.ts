import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { mountNeuralDefence, type AppDependencies } from "../src/app/app.js";
import { createAttractScene } from "../src/app/attract-scene.js";
import type { MapRepository, MapSummary } from "../src/app/contracts.js";
import type { MatchSettings } from "../src/engine/types.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function fixture(maps?: MapRepository) {
  const { document: dom } = parseHTML(
    '<html><body><div id="app"></div></body></html>',
  );
  const document = dom as unknown as Document;
  const root = document.getElementById("app")!;
  const world = createAttractScene();
  let listener: (() => void) | null = null;
  let created = 0;
  let requestedFrames = 0;
  let unsubscribed = 0;
  let disposedSessions = 0;
  const cancelledFrames: number[] = [];
  const frameCallbacks = new Map<number, FrameRequestCallback>();
  let settings: MatchSettings | null = null;
  let createdMapId: string | null = null;
  const summary: MapSummary = {
    id: world.map.id,
    title: "Test map",
    description: "",
    width: 14,
    height: 10,
    url: "",
  };
  const dependencies: AppDependencies = {
    maps: maps ?? {
      async list() {
        return [summary];
      },
      async load() {
        return world.map;
      },
    },
    preferences: {
      read: () => ({ mute: true, volume: 0.5, reducedMotion: false }),
      write() {},
    },
    createSession(map, _slot, _mode, selectedSettings) {
      created++;
      createdMapId = map.id;
      settings = selectedSettings;
      return {
        localPlayerId: "coral",
        view: () => world,
        dispatch() {},
        subscribe(callback) {
          listener = callback;
          return () => {
            listener = null;
            unsubscribed++;
          };
        },
        reset() {},
        dispose() {
          disposedSessions++;
        },
      };
    },
    debug: true,
    animationClock: () => 0,
    requestFrame(callback) {
      const handle = ++requestedFrames;
      frameCallbacks.set(handle, callback);
      return handle;
    },
    cancelFrame(handle) {
      cancelledFrames.push(handle);
    },
  };
  const app = mountNeuralDefence(root, dependencies);
  function click(action: string) {
    const button = root.querySelector<HTMLButtonElement>(
      `[data-action="${action}"]`,
    );
    assert.ok(button, `Missing ${action}`);
    button.click();
  }
  async function start() {
    click("new-game");
    // The repository resolves a catalog, then its selected map, in two microtasks.
    await settle();
    click("start");
  }
  return {
    root,
    app,
    world,
    click,
    start,
    publish: () => listener?.(),
    counts: () => ({ created, requestedFrames }),
    lifecycle: () => ({
      unsubscribed,
      disposedSessions,
      cancelledFrames: [...cancelledFrames],
    }),
    frameCallback: (handle: number) => frameCallbacks.get(handle),
    settings: () => settings,
    createdMapId: () => createdMapId,
    summary,
  };
}

test("menu uses Fuse controls and actual board scenery without starting a simulation or animation loop", () => {
  const f = fixture();
  assert.ok(f.root.classList.contains("fui-app"));
  assert.deepEqual(
    Array.from(f.root.querySelectorAll("button"), (b) => b.dataset.action),
    ["new-game", "settings"],
  );
  assert.ok(
    f.root
      .querySelector('[data-action="new-game"]')
      ?.classList.contains("fui-button-primary"),
  );
  assert.ok(f.root.querySelector("#nd-attract-board .terrain-layer"));
  assert.ok(f.root.querySelector("#nd-attract-board .structure-layer"));
  assert.deepEqual(f.counts(), { created: 0, requestedFrames: 0 });
  f.click("settings");
  assert.equal(f.root.querySelector("h1")?.textContent, "Settings");
  f.click("back-menu");
  assert.deepEqual(f.counts(), { created: 0, requestedFrames: 0 });
  f.app.dispose();
});

test("context tools remain reachable and stable during updates, using the local player resources", async () => {
  const f = fixture();
  f.world.players[0]!.biomass = 12000;
  f.world.players[1]!.biomass = 99000;
  await f.start();
  assert.deepEqual(f.settings(), {
    instantConstruction: false,
    instantResearch: false,
  });
  assert.ok(
    f.root.querySelector(".resource-row")?.textContent?.includes("99.0"),
  );
  assert.equal(
    f.root.querySelector(".research-panel")?.hasAttribute("hidden"),
    true,
  );
  f.click("panel-research");
  const research = f.root.querySelector('[data-action="research-growth"]');
  assert.equal(
    f.root.querySelector(".research-panel")?.hasAttribute("hidden"),
    false,
  );
  f.world.tick++;
  f.publish();
  assert.equal(
    f.root.querySelector('[data-action="research-growth"]'),
    research,
  );
  assert.equal(
    f.root.querySelector(".research-panel")?.hasAttribute("hidden"),
    false,
  );
  f.click("panel-inspect");
  assert.equal(
    f.root.querySelector(".inspector")?.hasAttribute("hidden"),
    false,
  );
  f.click("leave");
  assert.ok(f.root.querySelector('[role="alertdialog"]'));
  assert.ok(f.root.querySelector(".game-layout")?.hasAttribute("inert"));
  f.click("cancel-confirm");
  assert.equal(f.root.querySelector('[role="alertdialog"]'), null);
  f.app.dispose();
});

test("catalog and map failures show a retry that can launch after recovery", async () => {
  let catalogCalls = 0;
  let mapCalls = 0;
  const world = createAttractScene();
  const f = fixture({
    async list() {
      if (++catalogCalls === 1) throw new Error("catalog offline");
      return [
        {
          id: world.map.id,
          title: "Recovered map",
          description: "",
          width: 14,
          height: 10,
          url: "",
        },
      ];
    },
    async load() {
      if (++mapCalls === 1) throw new Error("map offline");
      return world.map;
    },
  });
  f.click("new-game");
  await settle();
  assert.match(
    f.root.querySelector('[role="alert"]')?.textContent ?? "",
    /catalog offline/,
  );
  assert.equal(
    f.root.querySelector<HTMLButtonElement>('[data-action="start"]')?.disabled,
    true,
  );
  f.click("retry-catalog");
  await settle();
  assert.match(
    f.root.querySelector('[role="alert"]')?.textContent ?? "",
    /map offline/,
  );
  assert.equal(
    f.root.querySelector<HTMLButtonElement>('[data-action="start"]')?.disabled,
    true,
  );
  f.click("retry-map");
  await settle();
  assert.equal(f.root.querySelector('[role="alert"]'), null);
  assert.equal(
    f.root.querySelector<HTMLButtonElement>('[data-action="start"]')?.disabled,
    false,
  );
  f.click("start");
  assert.equal(f.counts().created, 1);
  assert.equal(catalogCalls, 2);
  assert.equal(mapCalls, 2);
  f.app.dispose();
});

test("superseded map response is ignored even when its repository ignores abort", async () => {
  const world = createAttractScene();
  const first = deferred<unknown>();
  const second = deferred<unknown>();
  const requests: Array<{ id: string; signal: AbortSignal }> = [];
  const f = fixture({
    async list() {
      return [
        {
          id: world.map.id,
          title: "First",
          description: "",
          width: 14,
          height: 10,
          url: "",
        },
        {
          id: "combat-lab-12",
          title: "Second",
          description: "",
          width: 14,
          height: 10,
          url: "",
        },
      ];
    },
    load(id, signal) {
      requests.push({ id, signal });
      return id === "combat-lab-12" ? second.promise : first.promise;
    },
  });
  f.click("new-game");
  await settle();
  assert.equal(requests[0]?.id, world.map.id);
  f.click("mode-combat-lab");
  assert.equal(requests[0]?.signal.aborted, true);
  second.resolve({ ...world.map, id: "combat-lab-12" });
  await settle();
  assert.equal(
    f.root.querySelector<HTMLButtonElement>('[data-action="start"]')?.disabled,
    false,
  );
  first.resolve(world.map);
  await settle();
  assert.equal(
    f.root.querySelector<HTMLSelectElement>('[data-field="map"]')?.value,
    "combat-lab-12",
  );
  f.click("start");
  assert.equal(f.createdMapId(), "combat-lab-12");
  f.app.dispose();
});

test("dispose unsubscribes and cancels the active frame without scheduling another", async () => {
  const f = fixture();
  await f.start();
  const frame = f.counts().requestedFrames;
  assert.ok(frame > 0);
  const callback = f.frameCallback(frame);
  assert.ok(callback);
  f.app.dispose();
  assert.equal(f.lifecycle().unsubscribed, 1);
  assert.equal(f.lifecycle().disposedSessions, 1);
  assert.equal(f.lifecycle().cancelledFrames.at(-1), frame);
  callback(16);
  f.publish();
  assert.equal(f.counts().requestedFrames, frame);
  assert.equal(f.root.innerHTML, "");
  f.app.dispose();
  assert.equal(f.lifecycle().unsubscribed, 1);
});
