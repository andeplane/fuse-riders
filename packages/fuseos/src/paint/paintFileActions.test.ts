import { FakePaintFileDeps } from "../__mocks__/paintFiles";
import { FakePaintSurface } from "../__mocks__/paintSurface";

import type { PaintFile } from "./paintFileActions";
import { createPaintFileActions, describeError } from "./paintFileActions";
import { MemoryPaintPrefsStore } from "./paintPrefsStore";
import { PaintSession } from "./paintSession";
import type { PaintAction, PaintState } from "./paintState";
import { INITIAL_PAINT_STATE, paintReducer } from "./paintState";

describe(createPaintFileActions.name, () => {
  it("opens the picked image: busy while decoding, then loaded, named and reported in the status bar", async () => {
    const t = mounted();
    t.files.nextPick = new File(["x"], "cat.png", { type: "image/png" });
    await t.actions.openPicked();
    // The picker resolves first, then the window is busy until the image is decoded.
    expect(t.actions_dispatched[0]).toEqual({
      type: "dialog",
      dialog: { kind: "busy", message: "Opening cat.png..." },
    });
    expect(t.surface.ops).toEqual(["image image/png 320x200"]);
    expect(t.getState()).toMatchObject({
      dialog: { kind: "none" },
      dirty: false,
      undoDepth: 0,
      size: { width: 320, height: 200 },
      loadedKey: "cat.png",
      status: "Opened cat.png (320x200)",
    });
    expect(t.setFile).toHaveBeenCalledWith({ name: "cat.png" });
    expect(t.showError).not.toHaveBeenCalled();
  });

  it("does nothing when the picker is cancelled", async () => {
    const t = mounted();
    await t.actions.openPicked();
    expect(t.actions_dispatched).toEqual([]);
    expect(t.setFile).not.toHaveBeenCalled();
    expect(t.showError).not.toHaveBeenCalled();
  });

  it("reports a picker failure, and a file that does not decode, as one error each; the window is untitled after a bad file", async () => {
    const t = mounted();
    t.files.pickError = new Error("Not allowed");
    await t.actions.openPicked();
    expect(t.showError).toHaveBeenCalledWith(
      "Paint cannot open the file: Not allowed",
    );
    expect(t.setFile).not.toHaveBeenCalled();

    t.files.pickError = undefined;
    t.files.nextPick = new File(["x"], "notes.txt", { type: "text/plain" });
    t.surface.loadError = new Error("Could not decode the image");
    await t.actions.openPicked();
    expect(t.showError).toHaveBeenLastCalledWith(
      "Paint cannot open notes.txt: Could not decode the image",
    );
    expect(t.setFile).toHaveBeenCalledWith(undefined);
    expect(t.getState().dialog).toEqual({ kind: "none" });
    expect(t.surface.ops).toEqual([]);
  });

  it("opens an image by URL and records the URL with the name", async () => {
    const t = mounted();
    const url = "https://raw.example.test/repo/sha/logo.png";
    t.files.images.set(url, new Blob(["png"], { type: "image/png" }));
    const opening = t.actions.openUrl(url, "logo.png");
    expect(t.getState().dialog).toEqual({
      kind: "busy",
      message: "Opening logo.png...",
    });
    await opening;
    expect(t.files.fetched).toEqual([url]);
    expect(t.surface.ops).toEqual(["image image/png 320x200"]);
    expect(t.getState()).toMatchObject({
      dialog: { kind: "none" },
      loadedKey: "logo.png",
      status: "Opened logo.png (320x200)",
    });
    expect(t.setFile).toHaveBeenCalledWith({
      name: "logo.png",
      sourceUrl: url,
    });
  });

  it("reports a URL that cannot be fetched and returns the window to untitled", async () => {
    const t = mounted();
    await t.actions.openUrl("https://raw.example.test/missing.png", "m.png");
    expect(t.showError).toHaveBeenCalledWith(
      "Paint cannot open m.png: The server answered 404",
    );
    expect(t.setFile).toHaveBeenCalledWith(undefined);
    expect(t.getState().dialog).toEqual({ kind: "none" });
    expect(t.surface.ops).toEqual([]);
  });

  it("saves by encoding the canvas, downloading it with the format's extension and remembering the format", async () => {
    const t = mounted();
    t.prefs.set({ format: "image/png" });
    const saving = t.actions.saveAs("sketch.png", "image/jpeg");
    expect(t.getState().dialog).toEqual({
      kind: "busy",
      message: "Saving sketch.jpg...",
    });
    await saving;
    expect(t.files.downloads).toHaveLength(1);
    expect(t.files.downloads[0]?.name).toBe("sketch.jpg");
    expect(t.files.downloads[0]?.blob.type).toBe("image/jpeg");
    expect(t.prefs.get()).toEqual({ format: "image/jpeg" });
    expect(t.getState()).toMatchObject({
      dialog: { kind: "none" },
      dirty: false,
      loadedKey: "sketch.jpg",
      status: "Saved sketch.jpg",
    });
    expect(t.setFile).toHaveBeenCalledWith({ name: "sketch.jpg" });
  });

  it("reports a save that fails and leaves the drawing unsaved", async () => {
    const t = mounted();
    t.session.detach();
    await t.actions.saveAs("sketch", "image/png");
    expect(t.showError).toHaveBeenCalledWith(
      "Paint could not save sketch.png: No canvas to save",
    );
    expect(t.files.downloads).toEqual([]);
    expect(t.getState().dialog).toEqual({ kind: "none" });
    expect(t.setFile).not.toHaveBeenCalled();
  });
});

describe(describeError.name, () => {
  it("uses an Error's message or a string, else a generic phrase", () => {
    expect(describeError(new Error("boom"))).toBe("boom");
    expect(describeError(new Error(""))).toBe("an unknown error");
    expect(describeError("plain")).toBe("plain");
    expect(describeError("")).toBe("an unknown error");
    expect(describeError(42)).toBe("an unknown error");
    expect(describeError(undefined)).toBe("an unknown error");
  });
});

function mounted() {
  const surface = new FakePaintSurface();
  const session = new PaintSession();
  session.attach(surface);
  const files = new FakePaintFileDeps();
  const prefs = new MemoryPaintPrefsStore();
  let state: PaintState = INITIAL_PAINT_STATE;
  const actions_dispatched: PaintAction[] = [];
  const setFile = vi.fn<(file: PaintFile | undefined) => void>();
  const showError = vi.fn<(message: string) => void>();
  const actions = createPaintFileActions({
    session,
    files,
    prefs,
    dispatch: (action) => {
      actions_dispatched.push(action);
      state = paintReducer(state, action);
    },
    setFile,
    showError,
  });
  return {
    actions,
    surface,
    session,
    files,
    prefs,
    setFile,
    showError,
    actions_dispatched,
    getState: () => state,
  };
}
