import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { mountNeuralDefence, type AppDependencies } from "../src/app/app.js";
import { createAttractScene } from "../src/app/attract-scene.js";
import type { MatchSettings } from "../src/engine/types.js";

function fixture() {
  const { document: dom } = parseHTML(
    '<html><body><div id="app"></div></body></html>',
  );
  const document = dom as unknown as Document;
  const root = document.getElementById("app")!;
  const world = createAttractScene();
  let listener: (() => void) | null = null;
  let created = 0;
  let requestedFrames = 0;
  let settings: MatchSettings | null = null;
  const dependencies: AppDependencies = {
    maps: {
      async list() {
        return [
          {
            id: world.map.id,
            title: "Test map",
            description: "",
            width: 14,
            height: 10,
            url: "",
          },
        ];
      },
      async load() {
        return world.map;
      },
    },
    preferences: {
      read: () => ({ mute: true, volume: 0.5, reducedMotion: false }),
      write() {},
    },
    createSession(_map, _slot, _mode, selectedSettings) {
      created++;
      settings = selectedSettings;
      return {
        localPlayerId: "coral",
        view: () => world,
        dispatch() {},
        subscribe(callback) {
          listener = callback;
          return () => {
            listener = null;
          };
        },
        reset() {},
        dispose() {},
      };
    },
    debug: true,
    animationClock: () => 0,
    requestFrame() {
      return ++requestedFrames;
    },
    cancelFrame() {},
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
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
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
    settings: () => settings,
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
