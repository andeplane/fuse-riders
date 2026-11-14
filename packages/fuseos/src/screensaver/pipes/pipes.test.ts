import type { PerspectiveCamera, Scene } from "three";

import { scriptedRandom, seededRandom } from "../../__mocks__/seededRandom";

import type { PipesDeps, PipesOptions, PipesRenderer } from "./pipes";
import { createCandyCaneTexture, startPipes } from "./pipes";

/** A renderer that records what it was asked to draw; the scene graph is real three.js, the GPU is not. */
class FakeRenderer implements PipesRenderer {
  sizes: [number, number][] = [];
  renders = 0;
  clears = 0;
  disposed = false;
  lastScene: Scene | undefined;
  lastCamera: PerspectiveCamera | undefined;
  constructor(readonly canvas: HTMLCanvasElement) {}
  setSize(width: number, height: number): void {
    this.sizes.push([width, height]);
  }
  render(scene: Scene, camera: PerspectiveCamera): void {
    this.renders += 1;
    this.lastScene = scene;
    this.lastCamera = camera;
  }
  clear(): void {
    this.clears += 1;
  }
  dispose(): void {
    this.disposed = true;
  }
}

function harness(seed = 1) {
  const renderers: FakeRenderer[] = [];
  let frame: ((time: number) => void) | undefined;
  let frameHandle = 0;
  let cancelled: number[] = [];
  const timers = new Map<
    ReturnType<typeof setTimeout>,
    { callback: () => void; ms: number }
  >();
  let onResize: (() => void) | undefined;
  let resizeUnsubscribed = false;
  const deps: PipesDeps = {
    createRenderer: (canvas) => {
      const renderer = new FakeRenderer(canvas);
      renderers.push(renderer);
      return renderer;
    },
    requestFrame: (callback) => {
      frame = callback;
      frameHandle += 1;
      return frameHandle;
    },
    cancelFrame: (handle) => {
      cancelled.push(handle);
      frame = undefined;
    },
    setTimeout: (callback, ms) => {
      const handle = globalThis.setTimeout(() => undefined, 0);
      timers.set(handle, { callback, ms });
      return handle;
    },
    clearTimeout: (handle) => {
      timers.delete(handle);
    },
    subscribeResize: (callback) => {
      onResize = callback;
      return () => {
        resizeUnsubscribed = true;
      };
    },
    random: seededRandom(seed),
  };
  return {
    deps,
    renderers,
    renderer: () => {
      const renderer = renderers[0];
      if (!renderer) throw new Error("no renderer created");
      return renderer;
    },
    tick: (frames = 1) => {
      for (let index = 0; index < frames; index += 1) {
        const current = frame;
        frame = undefined;
        if (!current) throw new Error("no frame scheduled");
        current(index * 16);
      }
    },
    hasFrame: () => frame !== undefined,
    cancelled: () => cancelled,
    timers: () => [...timers.values()],
    fireTimers: () => {
      const pending = [...timers.entries()];
      timers.clear();
      for (const [, timer] of pending) timer.callback();
    },
    resize: () => onResize?.(),
    resizeUnsubscribed: () => resizeUnsubscribed,
  };
}

const options: PipesOptions = {
  joints: "mixed",
  teapots: true,
  multiple: false,
};

describe("startPipes", () => {
  let container: HTMLDivElement;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });
  afterEach(() => {
    container.remove();
  });

  it("mounts two canvases, sizes the renderer to the host, and grows one pipe frame by frame", () => {
    const h = harness();
    const handle = startPipes(container, options, h.deps);
    expect(container.querySelectorAll("canvas")).toHaveLength(2);
    expect(h.renderer().canvas).toBe(
      container.querySelector("[data-testid=pipes-webgl]"),
    );
    expect(h.renderer().sizes[0]).toEqual([
      window.innerWidth,
      window.innerHeight,
    ]);
    expect(h.renderer().lastCamera).toBeUndefined();
    expect(handle.stats()).toMatchObject({
      scenes: 0,
      pipes: 0,
      meshes: 0,
      dissolving: false,
      style: undefined,
    });
    expect(h.timers()).toHaveLength(1);
    const lifetime = h.timers()[0]?.ms ?? 0;
    expect(lifetime).toBeGreaterThanOrEqual(16000);
    expect(lifetime).toBeLessThanOrEqual(24000);

    h.tick();
    expect(handle.stats()).toMatchObject({
      scenes: 1,
      pipes: 1,
      meshes: 1,
      style: "mixed",
    });
    expect(h.renderer().renders).toBe(1);
    expect(
      h
        .renderer()
        .lastScene?.children.filter((child) => child.type === "Object3D"),
    ).toHaveLength(1);
    const camera = h.renderer().lastCamera;
    expect(camera?.position.length()).toBeCloseTo(14, 5);

    h.tick(200);
    const stats = handle.stats();
    expect(stats.meshes).toBeGreaterThan(20);
    expect(h.renderer().renders).toBe(201);
    expect(h.hasFrame()).toBe(true);
  });

  it("stops cleanly: cancels the frame and the timer, disposes the renderer and empties the host", () => {
    const h = harness();
    const handle = startPipes(container, options, h.deps);
    h.tick(10);
    handle.stop();
    expect(h.cancelled()).toHaveLength(1);
    expect(h.hasFrame()).toBe(false);
    expect(h.timers()).toHaveLength(0);
    expect(h.renderer().disposed).toBe(true);
    expect(h.resizeUnsubscribed()).toBe(true);
    expect(container.querySelectorAll("canvas")).toHaveLength(0);
    expect(handle.stats().pipes).toBe(0);
  });

  it("spawns two or three pipes with Multiple and only one without, from the same seed", () => {
    const single = harness(5);
    const multi = harness(5);
    const one = startPipes(
      container,
      { ...options, multiple: false },
      single.deps,
    );
    const several = startPipes(
      container,
      { ...options, multiple: true },
      multi.deps,
    );
    single.tick();
    multi.tick();
    expect(one.stats().pipes).toBe(1);
    expect(several.stats().pipes).toBeGreaterThanOrEqual(2);
    expect(several.stats().pipes).toBeLessThanOrEqual(3);
    one.stop();
    several.stop();
  });

  it("dissolves after the scene timer, draws nothing meanwhile, then starts a fresh scene with a new camera", () => {
    const h = harness(11);
    const handle = startPipes(container, options, h.deps);
    h.tick(50);
    const rendersBefore = h.renderer().renders;
    const cameraBefore = h.renderer().lastCamera?.position.clone();
    h.fireTimers();
    expect(handle.stats().dissolving).toBe(true);
    // The timer re-arms itself so the next scene dissolves too.
    expect(h.timers()).toHaveLength(1);
    // 52 x 39 blocks at 16 a frame: 127 frames; nothing rendered while dissolving.
    h.tick(126);
    expect(handle.stats().dissolving).toBe(true);
    expect(h.renderer().renders).toBe(rendersBefore);
    expect(handle.stats().scenes).toBe(1);
    h.tick(1);
    expect(handle.stats().dissolving).toBe(false);
    expect(handle.stats().scenes).toBe(1);
    expect(handle.stats().pipes).toBe(0);
    expect(h.renderer().clears).toBe(1);
    h.tick(1);
    expect(handle.stats()).toMatchObject({ scenes: 2, pipes: 1, meshes: 1 });
    expect(h.renderer().renders).toBe(rendersBefore + 1);
    // Firing the timer during a dissolve does not stack another dissolve.
    h.fireTimers();
    h.fireTimers();
    expect(handle.stats().dissolving).toBe(true);
    h.tick(127);
    expect(handle.stats().dissolving).toBe(false);
    expect(h.renderer().clears).toBe(2);
    const positions = [cameraBefore, h.renderer().lastCamera?.position];
    expect(
      positions.every(
        (position) => position && Math.abs(position.length() - 14) < 1e-5,
      ),
    ).toBe(true);
    handle.stop();
  });

  it("cycles the joint style one scene at a time", () => {
    const h = harness(2);
    const handle = startPipes(
      container,
      { ...options, joints: "cycle" },
      h.deps,
    );
    const styles: (string | undefined)[] = [];
    for (let scene = 0; scene < 4; scene += 1) {
      h.tick();
      styles.push(handle.stats().style);
      h.fireTimers();
      h.tick(127);
    }
    expect(styles).toEqual(["elbow", "ball", "mixed", "elbow"]);
    handle.stop();
  });

  it("puts teapots at joints only with the easter egg on, from the same seed", () => {
    const withTeapots = harness(77);
    const without = harness(77);
    const a = startPipes(
      container,
      { ...options, teapots: true, multiple: true },
      withTeapots.deps,
    );
    const b = startPipes(
      container,
      { ...options, teapots: false, multiple: true },
      without.deps,
    );
    // `teapots` counts the current scene only, so add up each scene before it dissolves.
    let teapots = 0;
    let none = 0;
    for (let scene = 0; scene < 12; scene += 1) {
      withTeapots.tick(400);
      without.tick(400);
      teapots += a.stats().teapots;
      none += b.stats().teapots;
      withTeapots.fireTimers();
      without.fireTimers();
      withTeapots.tick(127);
      without.tick(127);
    }
    expect(teapots).toBeGreaterThan(0);
    expect(none).toBe(0);
    a.stop();
    b.stop();
  });

  it("follows the host size on resize and when it changes between frames", () => {
    const h = harness();
    const handle = startPipes(container, options, h.deps);
    Object.defineProperty(container, "clientWidth", {
      value: 640,
      configurable: true,
    });
    Object.defineProperty(container, "clientHeight", {
      value: 480,
      configurable: true,
    });
    h.resize();
    expect(h.renderer().sizes.at(-1)).toEqual([640, 480]);
    expect(h.renderer().lastCamera).toBeUndefined();
    h.tick();
    expect(h.renderer().lastCamera?.aspect).toBeCloseTo(640 / 480);
    Object.defineProperty(container, "clientWidth", {
      value: 320,
      configurable: true,
    });
    h.tick();
    expect(h.renderer().sizes.at(-1)).toEqual([320, 480]);
    const overlay = container.querySelector<HTMLCanvasElement>(
      "[data-testid=pipes-dissolve]",
    );
    expect(overlay?.width).toBe(320);
    expect(overlay?.height).toBe(480);
    // A resize during a dissolve repaints what was dissolved so far (no 2D context here: just no crash).
    h.fireTimers();
    h.tick(3);
    h.resize();
    expect(handle.stats().dissolving).toBe(true);
    handle.stop();
  });

  it("uses the candy cane scene when the dice say so, with teapots one turn in twenty", () => {
    // Scene roll 0.01 < 1/20: candy cane. The rest drives one pipe, so the run stays deterministic.
    const script = scriptedRandom([0.5, 0.5, 0.5, 0.01, 0.5]);
    const fallback = seededRandom(3);
    let calls = 0;
    const h = harness();
    const deps: PipesDeps = {
      ...h.deps,
      random: () => {
        calls += 1;
        return calls <= 5 ? script() : fallback();
      },
    };
    const handle = startPipes(container, options, deps);
    h.tick(1);
    expect(handle.stats()).toMatchObject({ scenes: 1, pipes: 1 });
    // No 2D canvas in this DOM: the texture is skipped and the pipe keeps a plain material.
    expect(createCandyCaneTexture()).toBeUndefined();
    handle.stop();
  });
});
