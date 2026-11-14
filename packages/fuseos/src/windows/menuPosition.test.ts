import {
  isContextMenuKey,
  menuPositionAt,
  menuPositionFor,
} from "./menuPosition";

describe(isContextMenuKey.name, () => {
  it("recognises Shift+F10 and the menu key only", () => {
    expect(isContextMenuKey({ key: "ContextMenu", shiftKey: false })).toBe(
      true,
    );
    expect(isContextMenuKey({ key: "F10", shiftKey: true })).toBe(true);
    expect(isContextMenuKey({ key: "F10", shiftKey: false })).toBe(false);
    expect(isContextMenuKey({ key: "Enter", shiftKey: true })).toBe(false);
  });
});

describe(menuPositionFor.name, () => {
  it("places the menu just inside the top left corner of the element", () => {
    const element = document.createElement("div");
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
      left: 100,
      top: 40,
      width: 80,
      height: 60,
      right: 180,
      bottom: 100,
      x: 100,
      y: 40,
      toJSON: () => undefined,
    });
    expect(menuPositionFor(element)).toEqual({ x: 116, y: 56 });
  });
});

describe(menuPositionAt.name, () => {
  it("places the menu at the pointer", () => {
    expect(menuPositionAt({ clientX: 12, clientY: 34 })).toEqual({
      x: 12,
      y: 34,
    });
  });
});
