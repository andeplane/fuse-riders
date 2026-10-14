export interface SpriteImageLoader {
  /** Resolve only after the source has decoded successfully. */
  load(url: string): Promise<void>;
}

/** Readable art while a request fails; never substitute gameplay geometry. */
export function spriteFallback(name: string): string {
  const art = name.startsWith("deposit-")
    ? `<g fill="${name === "deposit-biomass" ? "#b8ef43" : "#ca80ff"}" stroke="#192735" stroke-width="2"><path d="M32 4L46 25L32 50L18 25Z"/><path d="M14 24L26 40L14 60L2 40Z"/><path d="M50 24L62 40L50 60L38 40Z"/></g>`
    : name.startsWith("blocker-")
      ? '<path d="M4 44L10 20L28 7L52 18L61 42L43 58L18 57Z" fill="#68757a" stroke="#29383d" stroke-width="3"/><path d="M10 20L32 31L52 18M32 31L43 58" fill="none" stroke="#8d9b9c" stroke-width="3"/>'
      : name.startsWith("terrain-")
        ? ""
        : '<circle cx="32" cy="32" r="22" fill="#233c50" stroke="#6aebff" stroke-width="4"/><path d="M32 12V52M12 32H52" stroke="#6aebff" stroke-width="3"/>';
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${art}</svg>`)}`;
}

/**
 * SVG image errors do not bubble. Catch them on the app root, display a safe
 * fallback immediately, and share at most two fresh loads per failed source.
 * Rebuilt terrain and duplicate deposits reuse the same recovery result.
 */
export function installSpriteRecovery(
  root: Element,
  loader: SpriteImageLoader,
): () => void {
  const recoveries = new Map<string, Promise<string | null>>();
  let disposed = false;
  const recover = (source: string) => {
    let pending = recoveries.get(source);
    if (!pending) {
      pending = (async () => {
        for (let attempt = 1; attempt <= 2; attempt++) {
          // Bypass a cached failed HTTP response, retaining the bundled hash.
          const url = /^https?:|^\//.test(source)
            ? `${source}${source.includes("?") ? "&" : "?"}sprite-retry=${attempt}`
            : source;
          try {
            await loader.load(url);
            return url;
          } catch {
            // A permanent failure retains readable fallback art.
          }
        }
        return null;
      })();
      recoveries.set(source, pending);
    }
    return pending;
  };
  const onError = (event: Event) => {
    const image = event.target as Element | null;
    if (image?.localName !== "image" || !image.hasAttribute("data-sprite"))
      return;
    const failed = image.getAttribute("href");
    const source = image.getAttribute("data-sprite-source") ?? failed;
    if (!source || source.startsWith("data:")) return;
    image.setAttribute("data-sprite-source", source);
    image.setAttribute(
      "href",
      spriteFallback(image.getAttribute("data-sprite")!),
    );
    void recover(source).then((url) => {
      if (
        !disposed &&
        url &&
        url !== failed &&
        root.contains(image) &&
        image.getAttribute("data-sprite-source") === source
      )
        image.setAttribute("href", url);
    });
  };
  root.addEventListener("error", onError, true);
  return () => {
    disposed = true;
    root.removeEventListener("error", onError, true);
  };
}

/** Browser decoding adapter supplied by the application composition root. */
export function createBrowserSpriteImageLoader(
  createImage: () => HTMLImageElement,
): SpriteImageLoader {
  return {
    async load(url) {
      const image = createImage();
      image.src = url;
      await image.decode();
    },
  };
}
