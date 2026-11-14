import { FakePaintSurface } from "../__mocks__/paintSurface";

import { createPaintControls } from "./paintControls";
import { PaintSession } from "./paintSession";
import type { PaintState } from "./paintState";
import { INITIAL_PAINT_STATE, paintReducer } from "./paintState";

describe(createPaintControls.name, () => {
  it("reports the toolbox, palette, canvas and dialog as status", () => {
    const { controls } = mounted();
    expect(controls.status()).toEqual({
      size: { width: 640, height: 400 },
      tool: "pencil",
      brushSize: 5,
      foreground: "#000000",
      background: "#ffffff",
      unsaved: false,
      canUndo: false,
      dialog: "none",
    });
  });

  it("applies a tool, colour and size change to the very next pointer event, and names the tool in the status bar", () => {
    const { controls, surface, getState } = mounted();
    controls.setTool("brush");
    controls.setBrushSize(8);
    controls.setForeground("#ff0000");
    controls.setBackground("#0000ff");
    controls.pointerDown({ x: 1, y: 1 }, 0);
    controls.pointerMove({ x: 2, y: 2 });
    controls.pointerUp({ x: 3, y: 3 });
    controls.pointerDown({ x: 5, y: 5 }, 2);
    controls.pointerUp({ x: 5, y: 5 });
    expect(surface.ops).toEqual([
      "line 1,1-1,1 #ff0000 8",
      "line 1,1-2,2 #ff0000 8",
      "line 2,2-3,3 #ff0000 8",
      "line 5,5-5,5 #0000ff 8",
    ]);
    expect(getState().status).toBe("Brush");
    expect(controls.status()).toMatchObject({
      tool: "brush",
      brushSize: 8,
      foreground: "#ff0000",
      background: "#0000ff",
      unsaved: true,
      canUndo: true,
    });
  });

  it("places text given directly (the agent path) without opening the Text dialog, and picks colours into the palette", () => {
    const { controls, surface } = mounted();
    controls.setTool("text");
    controls.pointerDown({ x: 4, y: 4 }, 0, { text: "Pump 42" });
    expect(surface.ops).toEqual(['text 4,4 "Pump 42" #000000']);
    expect(controls.status().dialog).toBe("none");

    surface.pixelColor = "#00ff00";
    controls.setTool("picker");
    controls.pointerDown({ x: 1, y: 1 }, 2);
    expect(controls.status().background).toBe("#00ff00");
  });

  it("opens the Text dialog on a plain click, recording the point and the colour for the button used", () => {
    const { controls, surface, getState } = mounted();
    controls.setForeground("#ff0000");
    controls.setBackground("#0000ff");
    controls.setTool("text");
    controls.pointerDown({ x: 6, y: 6 }, 0);
    expect(getState().dialog).toEqual({
      kind: "text",
      at: { x: 6, y: 6 },
      color: "#ff0000",
      text: "",
    });
    expect(surface.ops).toEqual([]);

    controls.cancelText();
    expect(getState().dialog).toEqual({ kind: "none" });
    expect(surface.ops).toEqual([]);

    controls.pointerDown({ x: 8, y: 8 }, 2);
    expect(getState().dialog).toMatchObject({ kind: "text", color: "#0000ff" });
  });

  it("draws the Text dialog draft on OK and closes it either way", () => {
    const { controls, surface, getState } = mounted();
    controls.setTool("text");
    controls.pointerDown({ x: 6, y: 6 }, 0);
    controls.setDialogText("Pump 42");
    expect(getState().dialog).toMatchObject({ kind: "text", text: "Pump 42" });
    controls.submitText();
    expect(surface.ops).toEqual(['text 6,6 "Pump 42" #000000']);
    expect(getState().dialog).toEqual({ kind: "none" });
    expect(controls.status()).toMatchObject({ unsaved: true, canUndo: true });

    // OK with nothing typed draws nothing but still closes the dialog.
    controls.pointerDown({ x: 1, y: 1 }, 0);
    controls.submitText();
    expect(surface.ops).toEqual(['text 6,6 "Pump 42" #000000']);
    expect(getState().dialog).toEqual({ kind: "none" });

    // setDialogText, submitText and cancelText are no-ops without a Text dialog open.
    controls.setDialogText("ignored");
    controls.submitText();
    controls.cancelText();
    expect(surface.ops).toEqual(['text 6,6 "Pump 42" #000000']);
  });

  it("starts a new image right away when nothing is unsaved, otherwise asks first and goes ahead on Yes", () => {
    const { controls, surface, setFile } = mounted();
    controls.newImage();
    expect(surface.ops).toEqual(["reset 640x400 #ffffff"]);
    expect(setFile).toHaveBeenCalledWith(undefined);

    controls.pointerDown({ x: 1, y: 1 }, 0);
    controls.pointerUp({ x: 1, y: 1 });
    controls.newImage();
    expect(controls.status()).toMatchObject({
      unsaved: true,
      dialog: "confirmDiscard",
    });
    expect(surface.ops).toHaveLength(2);
    controls.confirmDiscard();
    expect(surface.ops).toEqual(["reset 640x400 #ffffff"]);
    expect(controls.status()).toMatchObject({ unsaved: false, dialog: "none" });
  });

  it("opens a file straight away when nothing is unsaved, otherwise after the discard confirmation", () => {
    const { controls, openFile } = mounted();
    controls.openImage();
    expect(openFile).toHaveBeenCalledTimes(1);

    controls.pointerDown({ x: 1, y: 1 }, 0);
    controls.pointerUp({ x: 1, y: 1 });
    openFile.mockClear();
    controls.openImage();
    expect(openFile).not.toHaveBeenCalled();
    expect(controls.status().dialog).toBe("confirmDiscard");
    controls.confirmDiscard();
    expect(openFile).toHaveBeenCalledTimes(1);
    expect(controls.status().dialog).toBe("none");
  });

  it("confirms nothing when no discard confirmation is showing", () => {
    const { controls, surface, setFile, openFile } = mounted();
    controls.confirmDiscard();
    expect(surface.ops).toEqual([]);
    expect(setFile).not.toHaveBeenCalled();
    expect(openFile).not.toHaveBeenCalled();
  });
});

function mounted() {
  const surface = new FakePaintSurface();
  const session = new PaintSession();
  session.attach(surface);
  let state: PaintState = INITIAL_PAINT_STATE;
  const setFile = vi.fn<(name: string | undefined) => void>();
  const openFile = vi.fn<() => void>();
  const controls = createPaintControls({
    session,
    getState: () => state,
    dispatch: (action) => {
      state = paintReducer(state, action);
    },
    setFile,
    openFile,
  });
  return { controls, surface, setFile, openFile, getState: () => state };
}
