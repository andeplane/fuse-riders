import type { ViewSnapshot } from "../snapshot-stream.js";
import type { ThemeDefinition } from "../themes.js";
import type { PhaserArena, createPhaserArena } from "./arena.js";

/** Injectable loading and deadlines for deterministic lifecycle checks. */
export interface PresentationDependencies {
  loadArena(): Promise<{ createPhaserArena: typeof createPhaserArena }>;
  schedule(delay: number, callback: () => void): () => void;
}
const browserDependencies: PresentationDependencies = {
  loadArena: () => import("./arena.js"),
  schedule: (delay, callback) => {
    const timer = setTimeout(callback, delay);
    return () => clearTimeout(timer);
  },
};

/**
 * What happened to the graphics, for product analytics. `ready` fires each time an attempt starts drawing (so again
 * after a successful RETRY GRAPHICS); `failed` fires once per attempt that ends in the retry card:
 * `startup` = download, boot or its deadline; `context` = a lost GPU context that did not come back; `render` = a
 * frame that threw.
 */
export type GraphicsReport =
  | { kind: "ready"; renderer: string }
  | { kind: "failed"; stage: "startup" | "context" | "render" };

/** One lazy Phaser scene. Graphics failure pauses the view; retry leaves the game connection intact. */
export function mountArenaPresentation(
  initialCanvas: HTMLCanvasElement,
  replaced: (canvas: HTMLCanvasElement) => void,
  report: (event: GraphicsReport) => void = () => {},
  dependencies: PresentationDependencies = browserDependencies,
): {
  render(
    snapshot: ViewSnapshot,
    now: number,
    theme: ThemeDefinition,
    scope: string,
    selfId?: string,
    /** A replayed moment is not the round opening for the viewer, so it never points them out. */
    replay?: boolean,
  ): void;
  destroy(): void;
} {
  let canvas = initialCanvas;
  let engine: PhaserArena | undefined;
  let state: "idle" | "starting" | "running" | "failed" | "disposed" = "idle";
  let generation = 0;
  let metricsAt = 0;
  let cancelStartup: (() => void) | undefined;
  let cancelRestore: (() => void) | undefined;
  let latest:
    | {
        snapshot: ViewSnapshot;
        now: number;
        theme: ThemeDefinition;
        scope: string;
        selfId?: string;
        replay?: boolean;
      }
    | undefined;
  const status = document.createElement("div");
  status.className = "graphics-status";
  status.hidden = true;
  const message = document.createElement("span");
  message.setAttribute("role", "status");
  const retry = document.createElement("button");
  retry.type = "button";
  retry.textContent = "RETRY GRAPHICS";
  status.append(message, retry);

  const showStatus = (text: string, canRetry = false) => {
    message.textContent = text;
    retry.hidden = !canRetry;
    status.hidden = !text;
    if (text && !status.isConnected) document.body.append(status);
  };
  const clearTimers = () => {
    cancelStartup?.();
    cancelStartup = undefined;
    cancelRestore?.();
    cancelRestore = undefined;
  };
  const notify = (event: GraphicsReport) => {
    try {
      report(event);
    } catch {
      /* reporting never breaks the view */
    }
  };
  const fail = (stage: "startup" | "context" | "render") => {
    if (state === "disposed" || state === "failed") return;
    state = "failed";
    generation++; // Late imports, readiness and context events cannot revive this attempt.
    clearTimers();
    const previous = engine;
    engine = undefined;
    previous?.destroy();
    canvas.dataset.rendererStatus = "failed";
    delete canvas.dataset.rendererMetrics;
    canvas.style.opacity = ".35";
    showStatus(
      "Graphics unavailable. The game continues while your view is paused.",
      true,
    );
    notify({ kind: "failed", stage });
  };
  const paint = () => {
    if (!engine || !latest || state !== "running") return;
    try {
      engine.render(
        latest.snapshot,
        latest.now,
        latest.theme,
        latest.scope,
        latest.selfId,
        latest.replay,
      );
      if (latest.now - metricsAt > 500) {
        canvas.dataset.rendererMetrics = JSON.stringify(engine.metrics());
        metricsAt = latest.now;
      }
    } catch {
      fail("render");
    }
  };
  const initialize = () => {
    if (state !== "idle") return;
    state = "starting";
    const attempt = ++generation;
    const current = () => attempt === generation;
    canvas.dataset.rendererStatus = "starting";
    cancelStartup = dependencies.schedule(10000, () => fail("startup"));
    // The deadline includes downloading the lazy module, not just Phaser boot.
    void (async () => {
      const module = await dependencies.loadArena();
      if (!current()) return;
      const arena = module.createPhaserArena(canvas, {
        rotateToFit: canvas.classList.contains("online-arena"),
        renderer:
          new URLSearchParams(location.search).get("renderer") ===
          "phaser-canvas"
            ? "canvas"
            : "auto",
        quality: matchMedia("(max-width: 700px)").matches ? "low" : "high",
        onStatus: (value) => {
          if (!current()) return;
          canvas.dataset.rendererStatus = value;
          cancelRestore?.();
          cancelRestore = undefined;
          canvas.style.opacity = value === "context-lost" ? ".35" : "1";
          if (value === "context-lost") {
            showStatus("Graphics paused — restoring GPU context");
            cancelRestore = dependencies.schedule(2000, () => fail("context"));
          } else {
            showStatus("");
            if (value === "restored") paint();
          }
        },
      });
      engine = arena;
      await arena.ready;
      if (!current()) return;
      cancelStartup?.();
      cancelStartup = undefined;
      state = "running";
      const renderer = arena.metrics().renderer;
      canvas.dataset.renderer = `phaser-${renderer}`;
      notify({ kind: "ready", renderer });
      paint(); // Also paints a paused landing demo after startup or retry.
    })().catch(() => {
      if (current()) fail("startup");
    });
  };
  retry.onclick = () => {
    if (state !== "failed") return;
    // A canvas's context type is immutable. A new node also discards the failed GPU context.
    const replacement = canvas.cloneNode(false) as HTMLCanvasElement;
    delete replacement.dataset.renderer;
    delete replacement.dataset.rendererStatus;
    replacement.style.opacity = "1";
    canvas.replaceWith(replacement);
    canvas = replacement;
    replaced(canvas);
    metricsAt = 0;
    showStatus("");
    state = "idle";
    initialize();
  };
  return {
    render(snapshot, now, theme, scope, selfId, replay) {
      if (state === "disposed") return;
      latest = { snapshot, now, theme, scope, selfId, replay };
      initialize();
      paint();
    },
    destroy() {
      if (state === "disposed") return;
      state = "disposed";
      generation++;
      clearTimers();
      retry.onclick = null;
      status.remove();
      engine?.destroy();
      engine = undefined;
      latest = undefined;
    },
  };
}
