import { FakePaintSurface } from "../__mocks__/paintSurface";

import type { StrokeSettings } from "./paintSession";
import { MAX_UNDO, PaintSession } from "./paintSession";

const settings: StrokeSettings = {
  foreground: "#ff0000",
  background: "#ffffff",
  brushSize: 5,
};

describe(PaintSession.name, () => {
  it("ignores input until a surface is attached", () => {
    const session = new PaintSession();
    expect(session.isAttached).toBe(false);
    expect(session.begin("pencil", { x: 1, y: 1 }, 0, settings)).toEqual({
      changed: false,
    });
    expect(session.end({ x: 1, y: 1 })).toBe(false);
    expect(session.undo()).toBe(false);
    expect(session.size()).toEqual({ width: 640, height: 400 });
  });

  it("draws freehand strokes with the pencil, brush and eraser", () => {
    const { session, surface } = attached();
    session.begin("pencil", { x: 1, y: 1 }, 0, settings);
    session.move({ x: 2, y: 3 });
    expect(session.end({ x: 4, y: 4 })).toBe(true);
    expect(surface.ops).toEqual([
      "line 1,1-1,1 #ff0000 1",
      "line 1,1-2,3 #ff0000 1",
      "line 2,3-4,4 #ff0000 1",
    ]);

    surface.ops = [];
    session.begin("brush", { x: 0, y: 0 }, 2, settings);
    session.end({ x: 1, y: 0 });
    expect(surface.ops).toEqual([
      "line 0,0-0,0 #ffffff 5",
      "line 0,0-1,0 #ffffff 5",
    ]);

    surface.ops = [];
    session.begin("eraser", { x: 0, y: 0 }, 0, settings);
    session.end({ x: 0, y: 0 });
    expect(surface.ops[0]).toBe("line 0,0-0,0 #ffffff 9");
    expect(session.undoDepth).toBe(3);
  });

  it("previews shapes while dragging and keeps only the final one", () => {
    const { session, surface } = attached();
    session.begin("rect", { x: 10, y: 10 }, 0, settings);
    session.move({ x: 20, y: 5 });
    session.move({ x: 30, y: 40 });
    session.end({ x: 30, y: 40 });
    expect(surface.ops).toEqual(["rect 10,10 20x30 #ff0000/- 5"]);

    surface.ops = [];
    session.begin("filledRect", { x: 0, y: 0 }, 0, settings);
    session.end({ x: 2, y: 2 });
    expect(surface.ops).toEqual(["rect 0,0 2x2 #ff0000/#ff0000 5"]);

    surface.ops = [];
    session.begin("ellipse", { x: 0, y: 0 }, 0, settings);
    session.end({ x: 4, y: 2 });
    expect(surface.ops).toEqual(["ellipse 0,0 4x2 #ff0000/- 5"]);

    surface.ops = [];
    session.begin("line", { x: 0, y: 0 }, 0, settings);
    session.end({ x: 4, y: 2 });
    expect(surface.ops).toEqual(["line 0,0-4,2 #ff0000 5"]);
  });

  it("fills and picks colours; the text tool is a no-op for begin", () => {
    const { session, surface } = attached();
    expect(session.begin("fill", { x: 3, y: 3 }, 0, settings)).toEqual({
      changed: true,
    });
    expect(surface.ops).toEqual(["fill 3,3 #ff0000"]);

    surface.ops = [];
    expect(session.begin("text", { x: 1, y: 2 }, 0, settings)).toEqual({
      changed: false,
    });
    expect(surface.ops).toEqual([]);

    surface.pixelColor = "#123456";
    expect(session.begin("picker", { x: 1, y: 2 }, 0, settings)).toEqual({
      changed: false,
      picked: "#123456",
    });
    expect(session.undoDepth).toBe(1);
  });

  it("places text as one undo step, ignoring blank text or no surface", () => {
    const { session, surface } = attached();
    expect(session.placeText({ x: 1, y: 2 }, "Pump 42", "#ff0000")).toBe(true);
    expect(surface.ops).toEqual(['text 1,2 "Pump 42" #ff0000']);
    expect(session.undoDepth).toBe(1);

    expect(session.placeText({ x: 1, y: 2 }, "   ", "#ff0000")).toBe(false);
    expect(session.undoDepth).toBe(1);

    session.detach();
    expect(session.placeText({ x: 1, y: 2 }, "Hi", "#ff0000")).toBe(false);
  });

  it("undoes step by step and caps the history", () => {
    const { session, surface } = attached();
    session.begin("fill", { x: 0, y: 0 }, 0, settings);
    session.clear("#00ff00");
    expect(surface.ops).toEqual(["fill 0,0 #ff0000", "clear #00ff00"]);
    expect(session.undo()).toBe(true);
    expect(surface.ops).toEqual(["fill 0,0 #ff0000"]);
    expect(session.undo()).toBe(true);
    expect(surface.ops).toEqual([]);
    expect(session.undo()).toBe(false);

    for (let index = 0; index < MAX_UNDO + 5; index += 1)
      session.begin("fill", { x: index, y: 0 }, 0, settings);
    expect(session.undoDepth).toBe(MAX_UNDO);
  });

  it("flips, rotates, starts new images and loads files", async () => {
    const { session, surface } = attached();
    session.flip("horizontal");
    session.rotate();
    expect(surface.ops).toEqual(["flip horizontal", "rotate"]);
    expect(session.size()).toEqual({ width: 400, height: 640 });
    expect(session.undoDepth).toBe(2);

    session.newImage({ width: 100, height: 50 }, "#ffffff");
    expect(session.size()).toEqual({ width: 100, height: 50 });
    expect(session.undoDepth).toBe(0);

    surface.nextImageSize = { width: 320, height: 200 };
    expect(
      await session.loadImage(new Blob(["x"], { type: "image/png" })),
    ).toEqual({ width: 320, height: 200 });
    expect(surface.ops).toEqual(["image image/png 320x200"]);
    expect((await session.toBlob("image/png")).type).toBe("image/png");
    expect(session.toDataUrl("image/jpeg")).toBe("data:image/jpeg;base64,FAKE");

    session.detach();
    await expect(session.loadImage(new Blob())).rejects.toThrow("No canvas");
    await expect(session.toBlob("image/png")).rejects.toThrow("No canvas");
    expect(session.toDataUrl("image/png")).toBeUndefined();
  });
});

function attached() {
  const session = new PaintSession();
  const surface = new FakePaintSurface();
  session.attach(surface);
  return { session, surface };
}
