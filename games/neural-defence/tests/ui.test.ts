import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { mountNeuralDefence, type AppDependencies } from "../src/app/app.js";
import { createAttractScene } from "../src/app/attract-scene.js";
import type { MapRepository, MapSummary } from "../src/app/contracts.js";
import type { Action, MatchSettings } from "../src/engine/types.js";
import { RESEARCH, researchPrerequisites } from "../src/engine/catalog.js";
import { requirementText } from "../src/app/command-card.js";

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
  const EventConstructor = dom.defaultView!.Event;
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
  const actions: Action[] = [];
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
        dispatch(action) {
          actions.push(action);
        },
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
    actions,
    selectCell(cell: number) {
      root
        .querySelector(`[data-cell="${cell}"]`)!
        .dispatchEvent(new EventConstructor("click", { bubbles: true }));
    },
    press(
      key: string,
      selector = "#nd-board",
      modifiers: {
        ctrlKey?: boolean;
        metaKey?: boolean;
        altKey?: boolean;
        repeat?: boolean;
      } = {},
    ) {
      class KeyEvent extends EventConstructor {
        readonly key = key;
        readonly ctrlKey = modifiers.ctrlKey ?? false;
        readonly metaKey = modifiers.metaKey ?? false;
        readonly altKey = modifiers.altKey ?? false;
        readonly repeat = modifiers.repeat ?? false;
      }
      root
        .querySelector(selector)!
        .dispatchEvent(
          new KeyEvent("keydown", { bubbles: true, cancelable: true }),
        );
    },
  };
}

test("completed matches show a result and offer restart", async () => {
  const f = fixture();
  await f.start();
  assert.equal(
    f.root.querySelector("#match-result")!.hasAttribute("hidden"),
    true,
  );
  f.world.finished = true;
  f.world.winnerId = "coral";
  f.publish();
  const result = f.root.querySelector("#match-result")!;
  assert.equal(result.hasAttribute("hidden"), false);
  assert.match(result.textContent!, /Victory/);
  assert.match(result.textContent!, /Play again/);
  f.world.winnerId = null;
  f.publish();
  assert.match(result.textContent!, /Draw/);
  f.app.dispose();
});

test("command shortcuts respect selection, availability, research context and input focus", async () => {
  const f = fixture();
  await f.start();
  f.press("q");
  f.press("q");
  assert.deepEqual(f.actions, [], "building is disabled on an occupied brain");
  f.press("a");
  const local = f.world.players.find((p) => p.id === "coral")!;
  local.insight = 10_000;
  f.selectCell(
    f.world.structures.find(
      (s) => s.ownerId === local.id && s.kind === "brain",
    )!.cell,
  );
  f.publish();
  f.press("w", "#priority-slider");
  assert.equal(
    f.root.querySelector(".command-card")?.getAttribute("data-panel"),
    "inspect",
    "slider keys must not enter a submenu",
  );
  f.press("w");
  assert.equal(
    f.root.querySelector(".command-card")?.getAttribute("data-panel"),
    "research",
  );
  assert.equal(f.root.querySelectorAll(".hud-popover").length, 0);
  for (const key of ["q", "w", "e"]) f.press(key);
  assert.deepEqual(f.actions, [
    { type: "startResearch", research: "growth" },
    { type: "startResearch", research: "excitation" },
    { type: "startResearch", research: "conduction" },
  ]);
  for (const modifier of [
    { ctrlKey: true },
    { metaKey: true },
    { altKey: true },
    { repeat: true },
  ])
    f.press("q", "#nd-board", modifier);
  assert.equal(
    f.actions.length,
    3,
    "typing and browser shortcuts are not game commands",
  );
  local.insight = 0;
  f.publish();
  f.press("q");
  assert.equal(
    f.actions.length,
    3,
    "unavailable research cannot be triggered by shortcut",
  );
  f.click("leave");
  f.press("q");
  assert.equal(f.actions.length, 3, "confirmation blocks gameplay shortcuts");
  f.app.dispose();
});

test("unavailable commands explain live rule requirements without dispatching", async () => {
  const f = fixture();
  await f.start();
  const player = f.world.players.find((p) => p.id === "coral")!;
  player.insight = 0;
  f.click("panel-research");
  const button = f.root.querySelector<HTMLButtonElement>(
    '[data-action="research-growth"]',
  )!;
  assert.equal(button.disabled, false, "grey commands remain focusable");
  assert.equal(button.getAttribute("aria-disabled"), "true");
  const help = () =>
    f.root.querySelector("#help-research-growth")!.textContent!;
  assert.match(help(), /Need 10.0 more insight/);
  f.click("research-growth");
  assert.deepEqual(f.actions, []);
  player.insight = RESEARCH.growth.cost - 1500;
  f.publish();
  assert.match(help(), /Need 1.5 more insight/);
  player.insight = RESEARCH.growth.cost;
  f.publish();
  assert.equal(button.getAttribute("aria-disabled"), "false");
  f.click("research-growth");
  assert.deepEqual(f.actions, [{ type: "startResearch", research: "growth" }]);
  assert.deepEqual(
    researchPrerequisites(player, ["growth"]).map(requirementText),
    ["Research Growth first."],
  );
  player.research.push("growth");
  assert.deepEqual(researchPrerequisites(player, ["growth"]), []);
  f.publish();
  assert.match(help(), /Growth is already researched/);
  f.app.dispose();
});

test("command clock overlays follow authoritative construction and research progress", async () => {
  const f = fixture();
  await f.start();
  const player = f.world.players.find((p) => p.id === "coral")!;
  player.queue = [
    {
      cell: 0,
      kind: "neuron",
      paid: true,
      progress: 30,
      duration: 120,
      hp: 20,
    },
  ];
  player.researchJob = {
    kind: "growth",
    completesAt: f.world.tick + RESEARCH.growth.duration / 2,
  };
  f.publish();
  const progress = (action: string) =>
    f.root
      .querySelector(`[data-action="${action}"] [role="progressbar"]`)
      ?.getAttribute("aria-valuenow");
  assert.equal(progress("panel-build"), "25");
  assert.equal(progress("panel-research"), "50");
  f.click("panel-build");
  assert.equal(progress("build-neuron"), "25");
  player.queue[0]!.progress = 90;
  f.publish();
  assert.equal(progress("build-neuron"), "75");
  player.queue = [];
  f.publish();
  assert.equal(progress("build-neuron"), undefined);
  f.app.dispose();
});

test("auto expand is a persistent toggle only in the local brain commands", async () => {
  const f = fixture();
  await f.start();
  const player = f.world.players.find((p) => p.id === "coral")!;
  assert.equal(
    f.root.querySelector('[data-action="auto-expand"]'),
    null,
    "enemy brain has no expansion control",
  );
  const brain = f.world.structures.find(
    (s) => s.kind === "brain" && s.ownerId === player.id,
  )!;
  f.selectCell(brain.cell);
  f.press("s");
  assert.deepEqual(f.actions, [{ type: "setAutoExpand", enabled: true }]);
  player.autoExpand = true;
  f.publish();
  assert.equal(
    f.root
      .querySelector('[data-action="auto-expand"]')
      ?.getAttribute("aria-pressed"),
    "true",
  );
  f.click("auto-expand");
  assert.deepEqual(f.actions.at(-1), { type: "setAutoExpand", enabled: false });
  f.selectCell(0);
  assert.equal(f.root.querySelector('[data-action="auto-expand"]'), null);
  f.app.dispose();
});

test("build commands arm placement, reject occupied tiles, place once, and cancel without spending", async () => {
  const f = fixture();
  await f.start();
  f.click("panel-build");
  f.click("build-neuron");
  assert.deepEqual(
    f.actions,
    [],
    "choosing a type does not place on the current selection",
  );
  assert.ok(f.root.querySelector(".placement-instructions"));
  f.selectCell(f.world.structures.find((s) => s.kind === "brain")!.cell);
  assert.deepEqual(f.actions, [], "occupied placement stays armed");
  assert.equal(
    f.root.querySelector(".placement-preview")?.getAttribute("data-valid"),
    "false",
  );
  const open = f.world.map.cells.findIndex(
    (c, i) =>
      c.terrain === "open" &&
      !f.world.structures.some((s) => s.cell === i) &&
      !f.world.players.some((p) => p.queue.some((j) => j.cell === i)),
  );
  f.selectCell(open);
  assert.deepEqual(f.actions, [
    { type: "queueConstruction", kind: "neuron", cell: open },
  ]);
  assert.equal(f.root.querySelector(".placement-instructions"), null);
  f.selectCell(open);
  assert.equal(f.actions.length, 1, "later selection does not place again");
  f.click("build-tower");
  f.click("cancel-placement");
  f.selectCell(open);
  assert.equal(f.actions.length, 1);
  f.click("build-neuron");
  f.press("Escape");
  assert.equal(f.root.querySelector(".placement-instructions"), null);
  f.app.dispose();
});

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
    f.root.querySelector(".command-card")?.getAttribute("data-panel"),
    "inspect",
  );
  f.click("panel-research");
  const research = f.root.querySelector('[data-action="research-growth"]');
  assert.equal(
    f.root.querySelector(".command-card")?.getAttribute("data-panel"),
    "research",
  );
  f.world.tick++;
  f.publish();
  assert.equal(
    f.root.querySelector('[data-action="research-growth"]'),
    research,
  );
  assert.equal(
    f.root.querySelector(".command-card")?.getAttribute("data-panel"),
    "research",
  );
  f.press("a");
  assert.equal(
    f.root.querySelector(".command-card")?.getAttribute("data-panel"),
    "inspect",
  );
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
