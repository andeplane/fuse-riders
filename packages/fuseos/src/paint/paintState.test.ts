import { INITIAL_PAINT_STATE, PaintShadow, paintReducer } from "./paintState";

describe(paintReducer.name, () => {
  it("changes tool, sizes and colours", () => {
    let state = paintReducer(INITIAL_PAINT_STATE, {
      type: "setTool",
      tool: "brush",
    });
    state = paintReducer(state, { type: "setBrushSize", size: 8 });
    state = paintReducer(state, { type: "setForeground", color: "#ff0000" });
    state = paintReducer(state, { type: "setBackground", color: "#00ff00" });
    expect(state).toMatchObject({
      tool: "brush",
      brushSize: 8,
      foreground: "#ff0000",
      background: "#00ff00",
      dirty: false,
    });
  });

  it("tracks dirtiness and undo depth through changes, undo, load and save", () => {
    let state = paintReducer(INITIAL_PAINT_STATE, {
      type: "changed",
      undoDepth: 1,
    });
    expect(state).toMatchObject({
      dirty: true,
      undoDepth: 1,
      size: { width: 640, height: 400 },
    });
    state = paintReducer(state, {
      type: "changed",
      undoDepth: 2,
      size: { width: 400, height: 640 },
    });
    expect(state.size).toEqual({ width: 400, height: 640 });
    state = paintReducer(state, {
      type: "undone",
      undoDepth: 1,
      size: { width: 640, height: 400 },
    });
    expect(state).toMatchObject({
      dirty: true,
      undoDepth: 1,
      size: { width: 640, height: 400 },
    });
    state = paintReducer(state, {
      type: "loaded",
      key: "x.png",
      size: { width: 10, height: 10 },
    });
    expect(state).toMatchObject({
      dirty: false,
      undoDepth: 0,
      loadedKey: "x.png",
      dialog: { kind: "none" },
    });
    state = paintReducer(
      { ...state, dirty: true, dialog: { kind: "busy", message: "Saving" } },
      { type: "saved", key: "y.png", name: "y.png" },
    );
    expect(state).toMatchObject({
      dirty: false,
      loadedKey: "y.png",
      dialog: { kind: "none" },
      status: "Saved y.png",
    });
  });

  it("shows dialogs and status text", () => {
    let state = paintReducer(INITIAL_PAINT_STATE, {
      type: "dialog",
      dialog: { kind: "confirmDiscard", next: "open" },
    });
    expect(state.dialog).toEqual({ kind: "confirmDiscard", next: "open" });
    state = paintReducer(state, { type: "status", status: "Brush" });
    expect(state.status).toBe("Brush");
  });
});

describe(PaintShadow.name, () => {
  it("applies actions at once and resyncs from React", () => {
    const shadow = new PaintShadow(INITIAL_PAINT_STATE);
    shadow.apply({ type: "setTool", tool: "brush" });
    expect(shadow.getState().tool).toBe("brush");
    shadow.sync({ ...INITIAL_PAINT_STATE, tool: "eraser" });
    expect(shadow.getState().tool).toBe("eraser");
  });
});
