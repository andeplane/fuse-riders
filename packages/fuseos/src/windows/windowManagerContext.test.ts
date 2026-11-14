import { renderHook } from "@testing-library/react";
import { useContext } from "react";

import { WindowManagerContext } from "./windowManagerContext";

describe("WindowManagerContext", () => {
  it("defaults to a 1024x768 desktop with a 640x480 window and inert setters, outside the provider", () => {
    const { result } = renderHook(() => useContext(WindowManagerContext));
    const manager = result.current;
    expect(manager.rects).toEqual({});
    expect(manager.viewport).toEqual({ width: 1024, height: 768 });
    expect(manager.compact).toBe(false);
    expect(manager.rectFor("w1", 0)).toEqual({
      x: 0,
      y: 0,
      width: 640,
      height: 480,
    });
    expect(
      manager.setRect("w1", { x: 1, y: 1, width: 2, height: 2 }),
    ).toBeUndefined();
    expect(manager.pruneRects([])).toBeUndefined();
  });
});
