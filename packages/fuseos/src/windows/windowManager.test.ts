import {
  COMPACT_MAX_WIDTH,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  TASKBAR_HEIGHT,
  clampRect,
  defaultRect,
  isCompactViewport,
} from "./windowManager";

const viewport = { width: 1200, height: 800 };

describe(defaultRect.name, () => {
  it("uses the preferred size of a window that asks for one, clamped to the desktop", () => {
    const viewport = { width: 1280, height: 800 };
    expect(
      defaultRect(0, viewport, { width: 1120, height: 720 }),
    ).toMatchObject({ width: 1120, height: 720 });
    const clamped = defaultRect(
      0,
      { width: 1000, height: 600 },
      { width: 1120, height: 720 },
    );
    expect(clamped).toMatchObject({
      x: 0,
      y: 0,
      width: 1000,
      height: 600 - TASKBAR_HEIGHT,
    });
  });

  it("cascades subsequent windows", () => {
    const first = defaultRect(0, viewport);
    const second = defaultRect(1, viewport);
    expect(second.x - first.x).toBe(24);
    expect(second.y - first.y).toBe(24);
    expect(first.width).toBe(760);
  });

  it("shrinks on small viewports but respects minimums", () => {
    const rect = defaultRect(0, { width: 300, height: 200 });
    expect(rect.width).toBe(MIN_WINDOW_WIDTH);
    expect(rect.height).toBe(MIN_WINDOW_HEIGHT);
  });
});

describe(clampRect.name, () => {
  it("keeps the window above the taskbar and inside the viewport", () => {
    const rect = clampRect(
      { x: 1100, y: 790, width: 400, height: 300 },
      viewport,
    );
    expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.width);
    expect(rect.y + rect.height).toBeLessThanOrEqual(
      viewport.height - TASKBAR_HEIGHT,
    );
  });

  it("never goes negative", () => {
    const rect = clampRect(
      { x: -50, y: -50, width: 400, height: 300 },
      viewport,
    );
    expect(rect.x).toBe(0);
    expect(rect.y).toBe(0);
  });
});

describe(isCompactViewport.name, () => {
  it("is compact below the window launch cut-off, whatever the height", () => {
    expect(isCompactViewport({ width: 390, height: 844 })).toBe(true);
    expect(
      isCompactViewport({ width: COMPACT_MAX_WIDTH - 1, height: 400 }),
    ).toBe(true);
    expect(isCompactViewport({ width: COMPACT_MAX_WIDTH, height: 400 })).toBe(
      false,
    );
    expect(isCompactViewport({ width: 1280, height: 800 })).toBe(false);
  });
});
