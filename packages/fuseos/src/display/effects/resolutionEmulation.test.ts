import { DESKTOP_AREAS } from "../../desktop/displayModes";

import {
  emulatedGeometry,
  KEEP_SETTINGS_SECONDS,
  RESOLUTIONS,
  resolutionLabel,
} from "./resolutionEmulation";

describe("resolution emulation", () => {
  it("offers every desktop area, Native for the fluid one", () => {
    expect(RESOLUTIONS.map((resolution) => resolution.value)).toEqual(
      DESKTOP_AREAS.map((area) => area.value),
    );
    expect(resolutionLabel("current")).toBe("Native");
    expect(resolutionLabel("640x480")).toBe("640 by 480");
    expect(resolutionLabel("1024x768")).toBe("1024 by 768");
    expect(KEEP_SETTINGS_SECONDS).toBe(15);
  });

  it("keeps the native resolution fluid", () => {
    expect(emulatedGeometry("current", { width: 1200, height: 700 })).toEqual({
      viewport: { width: 1200, height: 700 },
      scale: 1,
    });
  });

  it("scales a fixed resolution up to fill the window, keeping logical pixels", () => {
    const geometry = emulatedGeometry("640x480", { width: 1280, height: 800 });
    expect(geometry.viewport).toEqual({ width: 640, height: 480 });
    expect(geometry.scale).toBeCloseTo(800 / 480);
    expect(emulatedGeometry("800x600", { width: 1600, height: 1200 })).toEqual({
      viewport: { width: 800, height: 600 },
      scale: 2,
    });
  });

  it("still scales down when the window is smaller than the resolution", () => {
    expect(emulatedGeometry("1024x768", { width: 512, height: 384 })).toEqual({
      viewport: { width: 1024, height: 768 },
      scale: 0.5,
    });
  });

  it("falls back to the fitted scale on an unusable window size", () => {
    const geometry = emulatedGeometry("800x600", {
      width: NaN,
      height: Infinity,
    });
    expect(geometry.viewport).toEqual({ width: 800, height: 600 });
    expect(Number.isFinite(geometry.scale)).toBe(true);
    expect(geometry.scale).toBeGreaterThan(0);
    // A zero-sized host is clamped to 1x1 by displayGeometry; a zero fill scale is never used.
    expect(
      emulatedGeometry("640x480", { width: 0, height: 0 }).scale,
    ).toBeCloseTo(1 / 640);
  });
});
