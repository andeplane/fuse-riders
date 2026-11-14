import type { DesktopArea, DisplayGeometry } from "../../desktop/displayModes";
import { DESKTOP_AREAS, displayGeometry } from "../../desktop/displayModes";
import type { Size } from "../../windows/windowManager";

/**
 * Display Properties, Effects, Screen resolution: the same choices as `desktop/displayModes`'s
 * desktop areas, but emulated the way a monitor set to 640x480 looks: the desktop keeps its
 * logical pixels and is scaled to fill the browser window, up as well as down, chunky included.
 * `displayGeometry` alone only ever scales down (a fitted preview); this is the fill variant.
 */
export const RESOLUTIONS: readonly { value: DesktopArea; label: string }[] =
  DESKTOP_AREAS.map((area) => ({
    value: area.value,
    label:
      area.value === "current" ? "Native" : `${area.width} by ${area.height}`,
  }));

export function resolutionLabel(area: DesktopArea): string {
  return (
    RESOLUTIONS.find((resolution) => resolution.value === area)?.label ??
    "Native"
  );
}

/** How many seconds the "Keep these settings?" dialog waits before putting the old resolution back. */
export const KEEP_SETTINGS_SECONDS = 15;

export function emulatedGeometry(
  area: DesktopArea,
  available: Size,
): DisplayGeometry {
  const fitted = displayGeometry(area, available);
  if (area === "current") return fitted;
  const scale = Math.min(
    available.width / fitted.viewport.width,
    available.height / fitted.viewport.height,
  );
  return {
    viewport: fitted.viewport,
    scale: Number.isFinite(scale) && scale > 0 ? scale : fitted.scale,
  };
}
