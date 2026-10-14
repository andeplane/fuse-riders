import { parseHTML } from "linkedom";
import type { ArtImage } from "../../src/app/art.js";
import { FakeContext } from "./canvas.js";

/** Where an element is on the page, in CSS px. */
export interface Box {
  left?: number;
  top?: number;
  width: number;
  height: number;
}

const PAGE =
  '<!doctype html><html><head></head><body><div id="app"></div></body></html>';

/**
 * A page for the DOM code (`menu.ts`, `screen.ts`, `main.ts`): linkedom's document and window installed as the
 * globals the page reads, plus what linkedom leaves out. Layout is what the test says it is (`place`), canvases draw
 * into `FakeContext`s, animation frames run when the test calls `frame()`, and `performance.now()` is the test's
 * clock. Each test file runs in its own process, so the globals never leak into another file.
 */
export function installDom(html = PAGE) {
  const { window, document } = parseHTML(html);
  const page = window as unknown as Window & typeof globalThis;
  const doc = document as unknown as Document;
  const boxes = new WeakMap<object, Required<Box>>();
  const contexts = new WeakMap<object, FakeContext>();
  const rect = (element: object): DOMRect => {
    const box = boxes.get(element) ?? { left: 0, top: 0, width: 0, height: 0 };
    return {
      x: box.left,
      y: box.top,
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height,
      right: box.left + box.width,
      bottom: box.top + box.height,
      toJSON: () => ({}),
    };
  };
  const element = page.HTMLElement.prototype;
  Object.defineProperties(element, {
    getBoundingClientRect: {
      configurable: true,
      value(this: object) {
        return rect(this);
      },
    },
    getClientRects: {
      configurable: true,
      value(this: object) {
        const box = boxes.get(this);
        return box && box.width > 0 && box.height > 0 ? [rect(this)] : [];
      },
    },
    offsetWidth: {
      configurable: true,
      get(this: object) {
        return boxes.get(this)?.width ?? 0;
      },
    },
    offsetHeight: {
      configurable: true,
      get(this: object) {
        return boxes.get(this)?.height ?? 0;
      },
    },
  });
  Object.defineProperty(page.HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value(this: object, kind: string) {
      if (kind !== "2d") return null;
      let context = contexts.get(this);
      if (!context) {
        context = new FakeContext();
        contexts.set(this, context);
      }
      return context.context;
    },
  });

  let now = 1000,
    hidden = false;
  Object.defineProperty(performance, "now", {
    configurable: true,
    value: () => now,
  });
  Object.defineProperty(doc, "hidden", {
    configurable: true,
    get: () => hidden,
  });
  let frames: FrameRequestCallback[] = [];
  const requestAnimationFrame = (callback: FrameRequestCallback) =>
    frames.push(callback);
  Object.assign(page, { requestAnimationFrame, devicePixelRatio: 2 });
  Object.assign(globalThis, {
    window: page,
    document: doc,
    HTMLElement: page.HTMLElement,
    HTMLButtonElement: page.HTMLButtonElement,
    HTMLInputElement: page.HTMLInputElement,
    HTMLCanvasElement: page.HTMLCanvasElement,
    requestAnimationFrame,
  });

  return {
    window: page,
    document: doc,
    /** Lays an element out at `box` (zero size: not laid out, as when hidden). */
    place(target: Element, box: Box): void {
      boxes.set(target, { left: 0, top: 0, ...box });
    },
    /** The recording context behind a canvas (made on first use). */
    context(canvas: HTMLCanvasElement): FakeContext {
      canvas.getContext("2d");
      return contexts.get(canvas)!;
    },
    /** Runs the animation frames requested so far (each one asks for the next). */
    frame(): void {
      const due = frames;
      frames = [];
      for (const callback of due) callback(now);
    },
    /** Frames waiting to run. */
    pendingFrames: () => frames.length,
    /** Moves `performance.now()` on. */
    advance(ms: number): void {
      now += ms;
    },
    now: () => now,
    setHidden(value: boolean): void {
      hidden = value;
    },
    /** An event of `type` carrying `props` (linkedom has no KeyboardEvent or PointerEvent). */
    event<T extends object>(type: string, props: T = {} as T): Event & T {
      return Object.assign(new page.Event(type, { bubbles: true }), props);
    },
    $<E extends Element = HTMLElement>(
      selector: string,
      root: ParentNode = doc,
    ): E {
      const found = root.querySelector<E>(selector);
      if (!found) throw new Error(`no ${selector}`);
      return found;
    },
    $$<E extends Element = HTMLElement>(
      selector: string,
      root: ParentNode = doc,
    ): E[] {
      return [...root.querySelectorAll<E>(selector)];
    },
  };
}
export type Dom = ReturnType<typeof installDom>;

/** Images for `createArt` that load or fail when the test says. */
export class FakeImages {
  readonly made: FakeImage[] = [];
  readonly make = (): ArtImage => {
    const image = new FakeImage();
    this.made.push(image);
    return image;
  };
  /** The image made for a file path ending in `file`. */
  find(file: string): FakeImage | undefined {
    return this.made.find((image) => image.src.endsWith(file));
  }
  loadAll(): void {
    for (const image of this.made) if (!image.complete) image.load();
  }
}
export class FakeImage implements ArtImage {
  complete = false;
  naturalWidth = 0;
  src = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  load(width = 64): void {
    this.complete = true;
    this.naturalWidth = width;
    this.onload?.();
  }
  fail(): void {
    this.complete = true;
    this.onerror?.();
  }
}
