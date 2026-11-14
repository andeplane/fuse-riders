import { playtestCanvasImages } from "./playtest-input.js";

/** Freeze the live DOM and renderer snapshots before displaying the report UI. Never mutate the running canvas. */
export async function capturePlaytestPage(document: Document): Promise<string> {
  const view = document.defaultView;
  if (!view)
    throw new Error("Screenshot capture is unavailable in this browser.");
  const images = await playtestCanvasImages(document);
  const clone = freezePlaytestPage(document, images);
  // A frozen DOM is rendered off screen. Capturing the live tree after awaiting assets would risk a later frame.
  const mount = document.createElement("div");
  mount.dataset.fuiPlaytest = "capture";
  mount.setAttribute("aria-hidden", "true");
  mount.inert = true;
  mount.style.cssText = `position:fixed;left:-100000px;top:0;pointer-events:none;contain:layout paint style;transform:translateZ(0);overflow:hidden;width:${view.innerWidth}px;height:${view.innerHeight}px;`;
  clone.style.width = `${view.innerWidth}px`;
  clone.style.height = `${view.innerHeight}px`;
  clone.style.overflow = "hidden";
  clone.style.margin = "0";
  mount.append(clone);
  document.body.append(mount);
  let timeout: number | undefined;
  try {
    const { toJpeg } = await import("html-to-image");
    const capture = toJpeg(clone, {
      width: view.innerWidth,
      height: view.innerHeight,
      canvasWidth: Math.min(1280, view.innerWidth),
      canvasHeight: Math.round(
        view.innerHeight * Math.min(1, 1280 / view.innerWidth),
      ),
      quality: 0.78,
      pixelRatio: 1,
      backgroundColor: "#080b12",
      skipAutoScale: false,
    });
    return await Promise.race([
      capture,
      new Promise<never>((_resolve, reject) => {
        timeout = view.setTimeout(
          () =>
            reject(
              new Error(
                "Screenshot capture timed out. Retry when the game finishes loading.",
              ),
            ),
          8000,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) view.clearTimeout(timeout);
    mount.remove();
  }
}

/** Preserve the visible frame, without asking the image encoder to load hidden UI assets. */
export function freezePlaytestPage(
  document: Document,
  images: ReadonlyMap<HTMLCanvasElement, string>,
): HTMLElement {
  const view = document.defaultView;
  if (!view)
    throw new Error("Screenshot capture is unavailable in this browser.");
  const root = document.documentElement;
  const clone = root.cloneNode(true) as HTMLElement;
  const originals = [root, ...root.querySelectorAll<HTMLElement>("*")];
  const copies = [clone, ...clone.querySelectorAll<HTMLElement>("*")];
  for (let i = 0; i < originals.length; i++) {
    const original = originals[i],
      copy = copies[i];
    // Descendants of a pruned subtree still occur in these parallel arrays.
    if (!original || !copy || (copy !== clone && !clone.contains(copy)))
      continue;
    if (
      original.matches("script,link[rel=stylesheet],style,[data-fui-playtest]")
    ) {
      copy.remove();
      continue;
    }
    const style = view.getComputedStyle(original);
    if (style.display === "none") {
      copy.remove();
      continue;
    }
    for (let index = 0; index < style.length; index++) {
      const property = style.item(index);
      copy.style.setProperty(
        property,
        style.getPropertyValue(property),
        style.getPropertyPriority(property),
      );
    }
    if (original.tagName === "CANVAS") {
      const canvas = original as HTMLCanvasElement;
      let image = images.get(canvas);
      if (!image) {
        if (canvas.getContext("webgl") || canvas.getContext("webgl2"))
          throw new Error(
            "The game renderer has not supplied a screenshot. Try again after the game loads.",
          );
        image = canvas.toDataURL("image/png");
      }
      const replacement = document.createElement("img");
      replacement.src = image;
      replacement.style.cssText = copy.style.cssText;
      replacement.width = canvas.width;
      replacement.height = canvas.height;
      copy.replaceWith(replacement);
    } else if (original.tagName === "IMG") {
      const image = original as HTMLImageElement;
      // An empty src resolves to the page URL; html-to-image would fetch HTML as
      // an image and reject the whole report. Keep its box without that request.
      (copy as HTMLImageElement).src =
        image.currentSrc ||
        (image.getAttribute("src")?.trim() ? image.src : "") ||
        "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/%3E";
      copy.removeAttribute("srcset");
    } else if (original.tagName === "INPUT") {
      const input = original as HTMLInputElement,
        target = copy as HTMLInputElement;
      target.value = input.type === "password" ? "" : input.value;
      target.setAttribute("value", target.value);
      if (input.checked) target.setAttribute("checked", "");
      else target.removeAttribute("checked");
    } else if (original.tagName === "TEXTAREA")
      copy.textContent = (original as HTMLTextAreaElement).value;
    else if (original.tagName === "SELECT") {
      const value = (original as HTMLSelectElement).value;
      for (const option of copy.querySelectorAll("option"))
        option.toggleAttribute("selected", option.value === value);
    }
    copy.scrollTop = original.scrollTop;
    copy.scrollLeft = original.scrollLeft;
  }
  return clone;
}
