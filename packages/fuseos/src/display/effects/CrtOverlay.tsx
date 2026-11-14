import { CURVATURE_SCALE } from "./curvatureMap";
import type { CrtMode } from "./effectsStore";
import { PaletteFilterDefs } from "./paletteFilters";

import "./crt.css";

export const CURVATURE_FILTER_ID = "crt-curvature";

export type CrtOverlayProps = {
  mode: CrtMode;
  /** The displacement map's data URL; without one the curvature filter is not defined and the picture stays flat. */
  curvatureMap: string | undefined;
};

/**
 * The CRT sheet over the page plus the hidden SVG that defines every filter the effects use:
 * the two extra palettes and the curvature. Pointer events pass straight through the sheet.
 */
export function CrtOverlay({ mode, curvatureMap }: CrtOverlayProps) {
  return (
    <>
      <svg
        aria-hidden="true"
        width="0"
        height="0"
        style={{ position: "absolute", pointerEvents: "none" }}
      >
        <defs>
          <PaletteFilterDefs />
          {curvatureMap ? (
            <filter
              id={CURVATURE_FILTER_ID}
              x="0"
              y="0"
              width="100%"
              height="100%"
              colorInterpolationFilters="sRGB"
            >
              <feImage
                href={curvatureMap}
                preserveAspectRatio="none"
                result="map"
              />
              <feDisplacementMap
                in="SourceGraphic"
                in2="map"
                scale={CURVATURE_SCALE}
                xChannelSelector="R"
                yChannelSelector="G"
              />
            </filter>
          ) : null}
        </defs>
      </svg>
      {mode === "off" ? null : (
        <div
          className="crt-overlay"
          data-crt={mode}
          data-testid="crt-overlay"
          aria-hidden="true"
        />
      )}
    </>
  );
}
