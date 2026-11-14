import type { ColorMode } from "../../desktop/displayModes";

/**
 * The two palettes this package adds to `desktop/displayModes`'s colour modes, as SVG filters.
 * `displayColorFilter(mode)` there already names them `url(#display-<mode>)`; these definitions
 * only have to exist somewhere in the document (`DisplayEffectsLayer` renders them). The filter
 * sits on the display footprint, an ancestor of every window, so embedded game iframes are
 * quantized too, exactly like the 256-colour and High Color filters next to them.
 */
export const EFFECT_PALETTE_MODES = ["16-colors", "monochrome"] as const;

export type EffectPaletteMode = (typeof EFFECT_PALETTE_MODES)[number];

export function isEffectPaletteMode(
  mode: ColorMode,
): mode is EffectPaletteMode {
  return EFFECT_PALETTE_MODES.some((candidate) => candidate === mode);
}

/**
 * A discrete table that maps a channel to 0 below `threshold` and to 1 from it on, with `bins`
 * equal steps (so the threshold must be a multiple of 1/bins to land exactly).
 */
export function thresholdTable(bins: number, threshold: number): string {
  return Array.from({ length: bins }, (_unused: unknown, index: number) =>
    index / bins >= threshold ? "1" : "0",
  ).join(" ");
}

/** `levels` evenly spaced grey levels from black to white. */
export function greyLevelsTable(levels: number): string {
  return Array.from({ length: levels }, (_unused: unknown, index: number) =>
    String(Number((index / (levels - 1)).toFixed(4))),
  ).join(" ");
}

/**
 * VGA's 16 colours are the 8 combinations of each channel being off or on (at 2/3), plus an
 * intensity bit that adds 1/3 to every channel. The filter rebuilds exactly that: each channel
 * is thresholded (base), the luminance is thresholded (intensity), and the two are summed.
 */
export const VGA_BASE_THRESHOLD = 0.4;
export const VGA_INTENSITY_THRESHOLD = 0.8;
export const VGA_BASE_WEIGHT = 2 / 3;
export const VGA_INTENSITY_WEIGHT = 1 / 3;

/** Rec. 601 luminance in every colour channel, alpha untouched. */
export const LUMINANCE_MATRIX =
  "0.299 0.587 0.114 0 0 0.299 0.587 0.114 0 0 0.299 0.587 0.114 0 0 0 0 0 1 0";

export const MONOCHROME_LEVELS = 4;

export function paletteFilterId(mode: EffectPaletteMode): string {
  return `display-${mode}`;
}

/** The `<filter>` elements for the 16-colour and monochrome palettes; render inside an SVG `<defs>`. */
export function PaletteFilterDefs() {
  const base = thresholdTable(5, VGA_BASE_THRESHOLD);
  const intensity = thresholdTable(10, VGA_INTENSITY_THRESHOLD);
  const greys = greyLevelsTable(MONOCHROME_LEVELS);
  return (
    <>
      <filter
        id={paletteFilterId("16-colors")}
        x="0"
        y="0"
        width="100%"
        height="100%"
        colorInterpolationFilters="sRGB"
      >
        <feComponentTransfer in="SourceGraphic" result="base">
          <feFuncR type="discrete" tableValues={base} />
          <feFuncG type="discrete" tableValues={base} />
          <feFuncB type="discrete" tableValues={base} />
        </feComponentTransfer>
        <feColorMatrix
          in="SourceGraphic"
          type="matrix"
          values={LUMINANCE_MATRIX}
          result="luminance"
        />
        <feComponentTransfer in="luminance" result="intensity">
          <feFuncR type="discrete" tableValues={intensity} />
          <feFuncG type="discrete" tableValues={intensity} />
          <feFuncB type="discrete" tableValues={intensity} />
        </feComponentTransfer>
        <feComposite
          in="base"
          in2="intensity"
          operator="arithmetic"
          k1="0"
          k2={String(VGA_BASE_WEIGHT)}
          k3={String(VGA_INTENSITY_WEIGHT)}
          k4="0"
        />
      </filter>
      <filter
        id={paletteFilterId("monochrome")}
        x="0"
        y="0"
        width="100%"
        height="100%"
        colorInterpolationFilters="sRGB"
      >
        <feColorMatrix
          in="SourceGraphic"
          type="matrix"
          values={LUMINANCE_MATRIX}
        />
        <feComponentTransfer>
          <feFuncR type="discrete" tableValues={greys} />
          <feFuncG type="discrete" tableValues={greys} />
          <feFuncB type="discrete" tableValues={greys} />
        </feComponentTransfer>
      </filter>
    </>
  );
}
