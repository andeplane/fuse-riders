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
    dirty = true;
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
      if (!environment.hidden()) {
        const elapsed = previous ? Math.min(100, now - previous) : 0;
        if (!paused) {
          carry += elapsed;
          while (carry >= 50) {
            driver.advance();
            carry -= 50;
          }
        }
        if (dirty || (!paused && now - drawn >= 1000 / 30)) {
          driver.render(now);
          drawn = now;
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
