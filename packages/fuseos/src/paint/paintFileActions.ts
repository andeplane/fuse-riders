import type { PaintFileDeps } from "./paintFiles";
import type { PaintPrefsStore } from "./paintPrefsStore";
import type { PaintSession } from "./paintSession";
import type { PaintAction } from "./paintState";
import type { ImageMimeType } from "./paintTools";
import { fileNameFor } from "./paintTools";

/** The file a Paint window is on, as the window state records it. */
export type PaintFile = { name: string; sourceUrl?: string };

export type PaintFileActionsDeps = {
  session: PaintSession;
  files: PaintFileDeps;
  prefs: PaintPrefsStore;
  dispatch: (action: PaintAction) => void;
  /** Records the file the window is on (persisted in the window); undefined returns it to untitled. */
  setFile: (file: PaintFile | undefined) => void;
  /** A Win98 error box over the desktop, titled Paint. */
  showError: (message: string) => void;
};

/**
 * File > Open, File > Save and opening an image by URL: everything in Paint that touches a file.
 * Pure logic over the injected `PaintFileDeps`, the session and the reducer, so it runs in tests
 * without a picker, a download or a network. Every failure ends in one error box and a canvas that
 * is still usable; nothing here is ever sent anywhere.
 */
export interface PaintFileActions {
  /** File > Open once any discard confirmation is behind us: the picker, then the chosen image on the canvas. */
  openPicked(): Promise<void>;
  /** Draws the image at `url` and names the window `name`; on failure the window is untitled again. */
  openUrl(url: string, name: string): Promise<void>;
  /** Encodes the canvas as `mimeType` and downloads it as `name` with the matching extension; remembers the format. */
  saveAs(name: string, mimeType: ImageMimeType): Promise<void>;
}

export function describeError(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return typeof error === "string" && error.length > 0
    ? error
    : "an unknown error";
}

export function createPaintFileActions(
  deps: PaintFileActionsDeps,
): PaintFileActions {
  const { session, files, prefs, dispatch, setFile, showError } = deps;

  const draw = async (blob: Blob, file: PaintFile): Promise<void> => {
    dispatch({
      type: "dialog",
      dialog: { kind: "busy", message: `Opening ${file.name}...` },
    });
    try {
      const size = await session.loadImage(blob);
      dispatch({ type: "loaded", key: file.name, size });
      dispatch({
        type: "status",
        status: `Opened ${file.name} (${size.width}x${size.height})`,
      });
      setFile(file);
    } catch (error) {
      dispatch({ type: "dialog", dialog: { kind: "none" } });
      setFile(undefined);
      showError(`Paint cannot open ${file.name}: ${describeError(error)}`);
    }
  };

  return {
    async openPicked() {
      let picked: File | undefined;
      try {
        picked = await files.pickImage();
      } catch (error) {
        showError(`Paint cannot open the file: ${describeError(error)}`);
        return;
      }
      if (!picked) return;
      await draw(picked, { name: picked.name });
    },
    async openUrl(url, name) {
      dispatch({
        type: "dialog",
        dialog: { kind: "busy", message: `Opening ${name}...` },
      });
      let blob: Blob;
      try {
        blob = await files.fetchImage(url);
      } catch (error) {
        dispatch({ type: "dialog", dialog: { kind: "none" } });
        setFile(undefined);
        showError(`Paint cannot open ${name}: ${describeError(error)}`);
        return;
      }
      await draw(blob, { name, sourceUrl: url });
    },
    async saveAs(name, mimeType) {
      const fileName = fileNameFor(name, mimeType);
      dispatch({
        type: "dialog",
        dialog: { kind: "busy", message: `Saving ${fileName}...` },
      });
      try {
        const blob = await session.toBlob(mimeType);
        files.download(blob, fileName);
        prefs.set({ ...prefs.get(), format: mimeType });
        dispatch({ type: "saved", key: fileName, name: fileName });
        setFile({ name: fileName });
      } catch (error) {
        dispatch({ type: "dialog", dialog: { kind: "none" } });
        showError(`Paint could not save ${fileName}: ${describeError(error)}`);
      }
    },
  };
}
