import type { WorldView } from "../../engine/view.js";
import type { ThemeDefinition } from "../themes.js";
import type { PhaserArena, createPhaserArena } from "./arena.js";

/** Injectable loading and deadlines for deterministic lifecycle checks. */
export interface PresentationDependencies {
  loadArena(): Promise<{ createPhaserArena: typeof createPhaserArena }>;
  schedule(delay: number, callback: () => void): () => void;
}
/**
 * How long the arena may take before any of its artwork has arrived. This covers downloading the lazy module and
 * booting Phaser, neither of which reports progress, so a fixed deadline is all there is to go on.
 */
export const STARTUP_DEADLINE_MS = 10000;
/**
 * How long the loader may sit at the same point once it has started reporting. A slow connection keeps advancing and
 * keeps its deadline pushed back; only a load that has actually stopped is failed. Telling a rider on a train that
 * graphics are unavailable, while their artwork is still arriving, is a worse answer than making them wait.
 */
export const LOADING_STALL_MS = 10000;

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
    snapshot: WorldView,
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
        snapshot: WorldView;
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
  // A bar rather than a number: the wait is mostly artwork, and a rider wants to see it moving, not read a percentage.
  const progress = document.createElement("div");
  progress.className = "graphics-progress";
  progress.setAttribute("role", "progressbar");
  progress.setAttribute("aria-valuemin", "0");
  progress.setAttribute("aria-valuemax", "100");
  const progressFill = document.createElement("div");
  progressFill.className = "graphics-progress-fill";
  progress.append(progressFill);
  status.append(message, progress, retry);

  const showStatus = (text: string, canRetry = false) => {
    message.textContent = text;
    retry.hidden = !canRetry;
    progress.hidden = true;
    status.hidden = !text;
    if (text && !status.isConnected) document.body.append(status);
  };
  /**
   * The loading line. `loaded` is undefined until the loader speaks: the module download and Phaser's boot report
   * nothing, so the bar runs indeterminate rather than claiming a figure it does not have.
   */
  const showLoading = (loaded?: number) => {
    const percent = loaded === undefined ? undefined : Math.round(loaded * 100);
    message.textContent =
      percent === undefined
        ? "Loading graphics"
        : `Loading graphics ${percent}%`;
    retry.hidden = true;
    progress.hidden = false;
    progress.classList.toggle("is-indeterminate", percent === undefined);
    progressFill.style.width = percent === undefined ? "" : `${percent}%`;
    if (percent === undefined) progress.removeAttribute("aria-valuenow");
    else progress.setAttribute("aria-valuenow", String(percent));
    status.hidden = false;
    if (!status.isConnected) document.body.append(status);
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
    let reported = -1;
    cancelStartup = dependencies.schedule(STARTUP_DEADLINE_MS, () =>
      fail("startup"),
    );
    showLoading();
    // Until the loader speaks, the deadline covers downloading the lazy module and booting Phaser, which report
    // nothing. From its first word the deadline becomes a stall: each step forward buys another `LOADING_STALL_MS`,
    // so a slow load finishes and only a stopped one fails.
    const advanced = (loaded: number) => {
      if (!current() || state !== "starting" || loaded <= reported) return;
      reported = loaded;
      showLoading(loaded);
      cancelStartup?.();
      cancelStartup = dependencies.schedule(LOADING_STALL_MS, () =>
        fail("startup"),
      );
    };
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
        onProgress: advanced,
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
      showStatus("");
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
