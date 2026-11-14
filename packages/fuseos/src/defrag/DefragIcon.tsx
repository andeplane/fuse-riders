import type { CSSProperties } from "react";

export type DefragIconProps = {
  width?: number | string;
  height?: number | string;
  className?: string;
  style?: CSSProperties;
};

/**
 * Disk Defragmenter's icon: a hard drive with its clusters being put in order above it. Drawn on a
 * 32-pixel grid so it stays crisp at 16 and 32.
 */
export function DefragIcon({
  width = 16,
  height = 16,
  className,
  style,
}: DefragIconProps) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 32 32"
      className={className}
      style={{ imageRendering: "pixelated", ...style }}
      shapeRendering="crispEdges"
      aria-hidden
      focusable="false"
      data-icon="defrag"
    >
      {/* Clusters: scattered on the left, in order on the right. */}
      <rect x="3" y="2" width="5" height="5" fill="#00c0c0" />
      <rect x="9" y="2" width="5" height="5" fill="#ff0000" />
      <rect x="3" y="8" width="5" height="5" fill="#fff" stroke="#808080" />
      <rect x="9" y="8" width="5" height="5" fill="#00c0c0" />
      <rect x="18" y="2" width="5" height="5" fill="#000080" />
      <rect x="24" y="2" width="5" height="5" fill="#000080" />
      <rect x="18" y="8" width="5" height="5" fill="#000080" />
      <rect x="24" y="8" width="5" height="5" fill="#000080" />
      <path d="M15 6h2v-2l2 3-2 3v-2h-2z" fill="#000" />
      {/* The drive. */}
      <rect x="2" y="17" width="28" height="12" fill="#c0c0c0" />
      <path d="M2 17h28v1H3v11H2z" fill="#fff" />
      <path d="M30 17v12H2v-1h27V17z" fill="#404040" />
      <rect x="5" y="24" width="16" height="2" fill="#808080" />
      <rect x="24" y="23" width="3" height="3" fill="#00c000" />
    </svg>
  );
}
