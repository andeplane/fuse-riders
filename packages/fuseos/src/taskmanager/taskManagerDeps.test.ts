import {
  browserTaskManagerDeps,
  findWindowIframe,
  frameWindowOf,
  readHeap,
  TICK_MS,
} from "./taskManagerDeps";

function fakePerformance(memory: unknown): Performance {
  return { memory } as Partial<Performance> as Performance;
}

describe(readHeap.name, () => {
  it("reads Chromium's performance.memory", () => {
    expect(
      readHeap(
        fakePerformance({ usedJSHeapSize: 1024, totalJSHeapSize: 4096 }),
      ),
    ).toEqual({ usedBytes: 1024, totalBytes: 4096 });
  });

  it("is undefined where the browser has no memory report, or a malformed one", () => {
    expect(readHeap(fakePerformance(undefined))).toBeUndefined();
    expect(readHeap(fakePerformance(null))).toBeUndefined();
    expect(readHeap(fakePerformance("lots"))).toBeUndefined();
    expect(
      readHeap(fakePerformance({ usedJSHeapSize: "1024" })),
    ).toBeUndefined();
  });
});

type FrameStub = {
  contentWindow: Window | null;
};

function iframeWith(contentWindow: FrameStub["contentWindow"]) {
  return { contentWindow } as Partial<HTMLIFrameElement> as HTMLIFrameElement;
}

describe(frameWindowOf.name, () => {
  it("is undefined for no frame, a frame that has not loaded, or a page without animation frames", () => {
    expect(frameWindowOf(null)).toBeUndefined();
    expect(frameWindowOf(iframeWith(null))).toBeUndefined();
    expect(
      frameWindowOf(iframeWith({} as Partial<Window> as Window)),
    ).toBeUndefined();
  });

  it("is undefined for a cross-origin page, whose window refuses the read", () => {
    const hostile = new Proxy({} as Window, {
      get() {
        throw new DOMException("Blocked a frame", "SecurityError");
      },
    });
    expect(frameWindowOf(iframeWith(hostile))).toBeUndefined();
  });

  it("forwards animation frame calls to the page and hands out the same wrapper for the same page", () => {
    const requestAnimationFrame = vi.fn((_callback: FrameRequestCallback) => 7);
    const cancelAnimationFrame = vi.fn();
    const page = { requestAnimationFrame, cancelAnimationFrame } as Pick<
      Window,
      "requestAnimationFrame" | "cancelAnimationFrame"
    > as Window;
    const frame = frameWindowOf(iframeWith(page));
    expect(frame).toBeDefined();
    expect(frameWindowOf(iframeWith(page))).toBe(frame);
    const callback = vi.fn();
    expect(frame?.requestAnimationFrame(callback)).toBe(7);
    expect(requestAnimationFrame).toHaveBeenCalledWith(callback);
    frame?.cancelAnimationFrame(7);
    expect(cancelAnimationFrame).toHaveBeenCalledWith(7);
  });
});

describe(findWindowIframe.name, () => {
  it("finds the iframe inside the frame rendered for a window id, and nothing for other windows", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div data-window-id="w1"><iframe title="Fuseball"></iframe></div>
      <div data-window-id="w2"><p>Paint</p></div>
    `;
    expect(findWindowIframe(root, "w1")?.title).toBe("Fuseball");
    expect(findWindowIframe(root, "w2")).toBeNull();
  });
});

describe("browserTaskManagerDeps", () => {
  it("ticks on a timer and stops when unsubscribed", () => {
    vi.useFakeTimers();
    try {
      const onTick = vi.fn();
      const unsubscribe = browserTaskManagerDeps.subscribeTicks(onTick);
      vi.advanceTimersByTime(TICK_MS * 2);
      expect(onTick).toHaveBeenCalledTimes(2);
      unsubscribe();
      vi.advanceTimersByTime(TICK_MS * 2);
      expect(onTick).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads the desktop's clock, frames and heap from the real window", () => {
    expect(typeof browserTaskManagerDeps.now()).toBe("number");
    const callback = vi.fn();
    const handle =
      browserTaskManagerDeps.desktopFrame.requestAnimationFrame(callback);
    browserTaskManagerDeps.desktopFrame.cancelAnimationFrame(handle);
    expect(callback).not.toHaveBeenCalled();
    expect(browserTaskManagerDeps.frameWindowFor("nothing")).toBeUndefined();
    // happy-dom has no performance.memory; Chromium would report a sample here.
    expect(browserTaskManagerDeps.heap()).toBeUndefined();
  });
});
