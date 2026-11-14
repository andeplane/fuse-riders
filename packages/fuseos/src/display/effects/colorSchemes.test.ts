import { WIN98_PALETTE } from "../../paint/palette";

import type { SchemeRoot } from "./colorSchemes";
import {
  applyColorScheme,
  COLOR_SCHEMES,
  colorScheme,
  colorSchemeByLabel,
  DEFAULT_COLOR_SCHEME,
  isColorSchemeId,
  schemeCssVars,
} from "./colorSchemes";

describe("colour schemes", () => {
  it("lists the seven schemes once each, Windows Standard first", () => {
    expect(COLOR_SCHEMES.map((scheme) => scheme.label)).toEqual([
      "Windows Standard",
      "Rainy Day",
      "Rose",
      "Slate",
      "High Contrast",
      "Hot Dog Stand",
      "Fuse Neon",
    ]);
    expect(new Set(COLOR_SCHEMES.map((scheme) => scheme.id)).size).toBe(
      COLOR_SCHEMES.length,
    );
    expect(DEFAULT_COLOR_SCHEME).toBe("windows-standard");
  });

  it("recognizes only known ids and labels, case insensitively", () => {
    expect(isColorSchemeId("hot-dog-stand")).toBe(true);
    expect(isColorSchemeId("Hot Dog Stand")).toBe(false);
    expect(isColorSchemeId(42)).toBe(false);
    expect(colorSchemeByLabel("  fuse neon ")).toBe("fuse-neon");
    expect(colorSchemeByLabel("Aqua")).toBeUndefined();
  });

  it("suggests a desktop colour the display preferences accept, for every scheme", () => {
    for (const scheme of COLOR_SCHEMES)
      expect(WIN98_PALETTE).toContain(scheme.desktop);
  });

  it("keeps Windows Standard identical to 98.css's own colours", () => {
    const standard = colorScheme("windows-standard");
    expect(standard.surface).toBe("silver");
    expect(standard.titleStart).toBe("navy");
    expect(standard.titleEnd).toBe("#1084d0");
    expect(standard.highlight).toBe("navy");
    expect(standard.darkShadow).toBe("#0a0a0a");
  });

  it("maps every colour of a scheme to a --w95 custom property", () => {
    const vars = schemeCssVars(colorScheme("hot-dog-stand"));
    expect(Object.keys(vars)).toHaveLength(16);
    expect(Object.keys(vars).every((name) => name.startsWith("--w95-"))).toBe(
      true,
    );
    expect(vars["--w95-surface"]).toBe("#ffff00");
    expect(vars["--w95-title-start"]).toBe("#ff0000");
    expect(vars["--w95-highlight-text"]).toBe("#ffffff");
  });

  it("writes the properties on the root it is given and tags it with the scheme", () => {
    const written = new Map<string, string>();
    const attributes = new Map<string, string>();
    const root: SchemeRoot = {
      style: { setProperty: (name, value) => written.set(name, value) },
      setAttribute: (name, value) => attributes.set(name, value),
    };
    applyColorScheme(root, colorScheme("fuse-neon"));
    expect(written.get("--w95-title-start")).toBe("#ff2e9d");
    expect(written.get("--w95-field")).toBe("#030919");
    expect(written.size).toBe(16);
    expect(attributes.get("data-color-scheme")).toBe("fuse-neon");
  });
});
