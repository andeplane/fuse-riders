import type { PaintWindowContent } from "../state/appState";

/**
 * The browser's file plumbing Paint needs: the file picker, downloads and fetching an image by URL.
 * Injected through `PaintDeps.files` so tests hand Paint a File or a URL without a real picker,
 * and so nothing here ever reaches a server: a picked file stays in memory, Save hands the
 * encoded image back to the browser as a download.
 */
export interface PaintFileDeps {
  /** Opens the browser's file picker for one image; resolves undefined when the user cancels. */
  pickImage(): Promise<File | undefined>;
  /** Hands `blob` to the browser as a download named `name` (the browser's Downloads folder). */
  download(blob: Blob, name: string): void;
  /** Fetches an image by URL (same origin or CORS enabled, e.g. a raw repo file) as a Blob. */
  fetchImage(url: string): Promise<Blob>;
}

/** What the browser implementation uses, replaceable in tests: the document to mount inputs in, object URLs, fetch and a timer. */
export type BrowserPaintFileOptions = {
  document?: () => Document;
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
  fetch?: (url: string) => Promise<Response>;
  /** Delays revoking a download's object URL until the browser has started the download. */
  schedule?: (callback: () => void) => void;
};

export const REVOKE_DELAY_MS = 1_000;

/** The real thing: a hidden `<input type="file">`, an `<a download>` and `fetch`. */
export function createBrowserPaintFileDeps(
  options: BrowserPaintFileOptions = {},
): PaintFileDeps {
  const doc = options.document ?? (() => document);
  const createObjectURL =
    options.createObjectURL ?? ((blob) => URL.createObjectURL(blob));
  const revokeObjectURL =
    options.revokeObjectURL ?? ((url) => URL.revokeObjectURL(url));
  const fetchUrl = options.fetch ?? ((url) => fetch(url));
  const schedule =
    options.schedule ??
    ((callback) => {
      setTimeout(callback, REVOKE_DELAY_MS);
    });
  return {
    pickImage() {
      return new Promise((resolve) => {
        const input = doc().createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.style.display = "none";
        input.setAttribute("aria-label", "Open image file");
        const finish = (file: File | undefined) => {
          input.remove();
          resolve(file);
        };
        input.addEventListener("change", () =>
          finish(input.files?.[0] ?? undefined),
        );
        // Chromium, Firefox and Safari fire `cancel` when the picker closes without a file.
        input.addEventListener("cancel", () => finish(undefined));
        doc().body.append(input);
        input.click();
      });
    },
    download(blob, name) {
      const url = createObjectURL(blob);
      const anchor = doc().createElement("a");
      anchor.href = url;
      anchor.download = name;
      anchor.style.display = "none";
      doc().body.append(anchor);
      anchor.click();
      anchor.remove();
      schedule(() => revokeObjectURL(url));
    },
    async fetchImage(url) {
      const response = await fetchUrl(url);
      if (!response.ok)
        throw new Error(`The server answered ${response.status}`);
      return response.blob();
    },
  };
}

/** The last path segment of `url`, decoded; `untitled` when there is none. */
export function fileNameFromUrl(url: string): string {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    // Relative: strip the query and fragment by hand.
    path = url.split(/[?#]/, 1)[0] ?? "";
  }
  const last =
    path
      .split("/")
      .filter((part) => part.length > 0)
      .pop() ?? "";
  try {
    return decodeURIComponent(last) || "untitled";
  } catch {
    return last || "untitled";
  }
}

/**
 * The Paint window that shows the image at `url`: for Explorer (B11) opening a repo image, or any
 * other app that has a URL. Paint fetches it once the window mounts, draws it on the canvas and
 * names the window after `name` (the URL's file name when omitted). It is an import: Save never
 * writes back to the URL, it downloads a copy, like opening a file on a read-only drive.
 */
export function imageFromUrl(url: string, name?: string): PaintWindowContent {
  return {
    kind: "paint",
    sourceUrl: url,
    fileName: name ?? fileNameFromUrl(url),
  };
}

/** Opens `url` in a new Paint window through the window commands: `openImageFromUrl(commands, url, name)`. */
export function openImageFromUrl(
  commands: { open: (content: PaintWindowContent) => void },
  url: string,
  name?: string,
): void {
  commands.open(imageFromUrl(url, name));
}
