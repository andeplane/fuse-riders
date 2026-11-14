import { button, el } from "./dom.js";
export interface AttractDriver {
  advance(): void;
  render(now: number): void;
  tick(): number;
  dispose(): void;
  pause?(paused: boolean): void;
}
export type AttractFactory = (
  host: HTMLElement,
  signal: AbortSignal,
) => Promise<AttractDriver> | AttractDriver;
/** Release a renderer even when navigation interrupts its asset loading. */
export async function awaitAttractReady(
  ready: Promise<unknown>,
  destroy: () => void,
  signal?: AbortSignal,
): Promise<void> {
  let aborted: (() => void) | undefined;
  try {
    await Promise.race([
      ready,
      new Promise<never>((_, reject) => {
        aborted = () => reject(new Error("Background loading cancelled"));
        if (signal?.aborted) aborted();
        else signal?.addEventListener("abort", aborted, { once: true });
      }),
    ]);
  } catch (error) {
    destroy();
    throw error;
  } finally {
    if (aborted) signal?.removeEventListener("abort", aborted);
  }
}
export interface AttractEnvironment {
  requestFrame(draw: (now: number) => void): number;
  cancelFrame(id: number): void;
  hidden(): boolean;
  reducedMotion(): boolean;
  onMotionChange(changed: () => void): () => void;
  onVisibilityChange(changed: () => void): () => void;
}
export function demoCanvas(host: HTMLElement, width = 960, height = 600) {
  const canvas = el("canvas", "", "", host.ownerDocument);
  canvas.width = width;
  canvas.height = height;
  host.append(canvas);
  return canvas;
}
/** A drawn frame followed by a longer wait than this is slow enough to ration (three display frames at 60 Hz). */
const SLOW_FRAME_MS = 50;
/** The longest a rationed background waits: one stall must not stop it for the rest of the visit. */
const SLOWEST_FRAME_MS = 2000;
/** Shared silent lifecycle: fixed ticks, capped drawing, reduced motion and teardown on leaving. */
export function mountAttract(
  root: HTMLElement,
  create: AttractFactory,
  supplied?: AttractEnvironment,
) {
  const doc = root.ownerDocument,
    win = doc.defaultView;
  const host = el("div", "", "fui-attract", doc);
  host.setAttribute("aria-hidden", "true");
  const toggle = button("Pause background", "fui-attract-toggle", doc);
  root.prepend(host);
  root.append(toggle);
  if (
    !supplied &&
    (!win ||
      typeof win.matchMedia !== "function" ||
      typeof win.requestAnimationFrame !== "function")
  ) {
    toggle.hidden = true;
    return () => {};
  }
  const environment = supplied ?? browserEnvironment(doc);
  const cancellation = new AbortController();
  let paused = environment.reducedMotion(),
    disposed = false,
    driver: AttractDriver | undefined;
  let frame = 0,
    previous = 0,
    carry = 0,
    drawn = 0,
    dirty = true,
    // What the last drawn frame cost: the wait for the frame after it. A scene that takes most of a second to draw
    // (WebGL without a GPU) would otherwise own the main thread, and the menu in front of it could not be pressed.
    cost = 0,
    timing = false;
  const label = () => {
    toggle.textContent = paused ? "Play background" : "Pause background";
    toggle.setAttribute("aria-pressed", String(paused));
  };
  label();
  const setMotion = () => {
    paused = environment.reducedMotion();
    driver?.pause?.(paused || environment.hidden());
    dirty = true;
    carry = 0;
    label();
  };
  const visibility = () => {
    previous = 0;
    carry = 0;
    timing = false;
    driver?.pause?.(paused || environment.hidden());
  };
  const stopMotion = environment.onMotionChange(setMotion),
    stopVisibility = environment.onVisibilityChange(visibility);
  toggle.onclick = () => {
    paused = !paused;
    driver?.pause?.(paused || environment.hidden());
    dirty = true;
    carry = 0;
    label();
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancellation.abort();
    environment.cancelFrame(frame);
    driver?.dispose();
    stopMotion();
    stopVisibility();
    toggle.onclick = null;
  };
  root.dataset.attractState = "loading";
  const fail = (error?: unknown) => {
    root.dataset.attractState = "failed";
    root.dataset.attractError =
      error instanceof Error
        ? (error.stack ?? error.message)
        : "Background renderer failed";
    host.hidden = true;
    toggle.hidden = true;
    dispose();
  };
  const draw = (now: number) => {
    if (!root.isConnected || root.closest("[hidden]")) return dispose();
    if (disposed) return;
    if (!driver) {
      frame = environment.requestFrame(draw);
      return;
    }
    try {
      if (timing) {
        cost = now - drawn;
        timing = false;
      }
      if (!environment.hidden()) {
        const elapsed = previous ? Math.min(100, now - previous) : 0;
        if (!paused) {
          carry += elapsed;
          while (carry >= 50) {
            driver.advance();
            carry -= 50;
          }
        }
        // Thirty frames a second while they are cheap. A slow frame waits three times what the last one cost (two
        // seconds at most), so the background leaves the page most of the main thread.
        const every = Math.max(
          1000 / 30,
          cost > SLOW_FRAME_MS ? Math.min(cost * 3, SLOWEST_FRAME_MS) : 0,
        );
        if (dirty || (!paused && now - drawn >= every)) {
          driver.render(now);
          drawn = now;
          timing = true;
          dirty = false;
          root.dataset.attractTick = String(driver.tick());
          root.dataset.attractState = paused ? "paused" : "running";
        }
      }
      previous = now;
      frame = environment.requestFrame(draw);
    } catch (error) {
      fail(error);
    }
  };
  frame = environment.requestFrame(draw);
  Promise.resolve()
    .then(() => (disposed ? undefined : create(host, cancellation.signal)))
    .then((ready) => {
      if (!ready) return;
      driver = ready;
      if (disposed) {
        ready.dispose();
        return;
      }
      if (!root.isConnected) {
        dispose();
        return;
      }
      ready.pause?.(paused || environment.hidden());
    })
    .catch(fail);
  return dispose;
}

function browserEnvironment(doc: Document): AttractEnvironment {
  const win = doc.defaultView!;
  const motion = win.matchMedia("(prefers-reduced-motion: reduce)");
  return {
    requestFrame: (draw) => win.requestAnimationFrame(draw),
    cancelFrame: (id) => win.cancelAnimationFrame(id),
    hidden: () => doc.hidden,
    reducedMotion: () => motion.matches,
    onMotionChange(changed) {
      motion.addEventListener("change", changed);
      return () => motion.removeEventListener("change", changed);
    },
    onVisibilityChange(changed) {
      doc.addEventListener("visibilitychange", changed);
      return () => doc.removeEventListener("visibilitychange", changed);
    },
  };
}
