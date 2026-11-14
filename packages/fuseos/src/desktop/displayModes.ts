import type { Size } from "../windows/windowManager";

/** The 16-colour and monochrome filters are defined by display/effects (paletteFilters.tsx); the other two here (DisplaySurface). */
export type ColorMode =
  "true-color" | "high-color" | "256-colors" | "16-colors" | "monochrome";
export type DesktopArea = "current" | "640x480" | "800x600" | "1024x768";
export type DisplayGeometry = { viewport: Size; scale: number };

export const COLOR_MODES: { value: ColorMode; label: string }[] = [
  { value: "monochrome", label: "Monochrome (4 shades)" },
  { value: "16-colors", label: "16 colors (4 bit)" },
  { value: "256-colors", label: "256 colors (8 bit)" },
  { value: "high-color", label: "High Color (16 bit)" },
  { value: "true-color", label: "True Color (24 bit)" },
];

export const DESKTOP_AREAS: {
  value: DesktopArea;
  label: string;
  width?: number;
  height?: number;
}[] = [
  { value: "current", label: "Current window" },
  { value: "640x480", label: "640 by 480 pixels", width: 640, height: 480 },
  { value: "800x600", label: "800 by 600 pixels", width: 800, height: 600 },
  { value: "1024x768", label: "1024 by 768 pixels", width: 1024, height: 768 },
];

export function isColorMode(value: unknown): value is ColorMode {
  return COLOR_MODES.some((mode) => mode.value === value);
}

export function isDesktopArea(value: unknown): value is DesktopArea {
  return DESKTOP_AREAS.some((area) => area.value === value);
}

export function colorModeByLabel(label: string): ColorMode | undefined {
  return COLOR_MODES.find(
    (mode) => mode.label.toLowerCase() === label.trim().toLowerCase(),
  )?.value;
}

export function desktopAreaByLabel(label: string): DesktopArea | undefined {
  return DESKTOP_AREAS.find(
    (area) => area.label.toLowerCase() === label.trim().toLowerCase(),
  )?.value;
}

function channelTable(levels: number): string {
  return Array.from({ length: levels }, (_unused: unknown, index: number) =>
    String(index / (levels - 1)),
  ).join(" ");
}

/** Discrete RGB332 and RGB565 channel tables; the browser quantizes the final composite. */
export function colorFilterTables(mode: Exclude<ColorMode, "true-color">): {
  red: string;
  green: string;
  blue: string;
} {
  const levels: [number, number, number] =
    mode === "256-colors" ? [8, 8, 4] : [32, 64, 32];
  return {
    red: channelTable(levels[0]),
    green: channelTable(levels[1]),
    blue: channelTable(levels[2]),
  };
}

export function displayColorFilter(mode: ColorMode): string | undefined {
  return mode === "true-color" ? undefined : `url(#display-${mode})`;
}

/** Logical desktop pixels stay fixed. Only its presentation scales down to fit the host. */
export function displayGeometry(
  area: DesktopArea,
  available: Size,
): DisplayGeometry {
  const safe = {
    width: Number.isFinite(available.width)
      ? Math.max(1, available.width)
      : 1024,
    height: Number.isFinite(available.height)
      ? Math.max(1, available.height)
      : 768,
  };
  const chosen = DESKTOP_AREAS.find((candidate) => candidate.value === area);
  const viewport = {
    width: chosen?.width ?? safe.width,
    height: chosen?.height ?? safe.height,
  };
  return {
    viewport,
    scale: Math.min(
      1,
      safe.width / viewport.width,
      safe.height / viewport.height,
    ),
  };
}
