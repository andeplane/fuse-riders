import type { CSSProperties } from "react";

export type FusteamLogoProps = {
  width?: number | string;
  height?: number | string;
  className?: string;
  style?: CSSProperties;
};

/**
 * The Fusteam mark: a lit fuse coiled into a ring on an olive tile, drawn so it stays crisp at 16 and 32
 * pixels. The desktop icon, the Start menu entry and the launcher's own title bar all use it.
 */
export function FusteamLogo({
  width = 16,
  height = 16,
  className,
  style,
}: FusteamLogoProps) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 32 32"
      className={className}
      style={{ imageRendering: "pixelated", ...style }}
      aria-hidden
      focusable="false"
      data-icon="fusteam"
    >
      {/* Olive tile with the raised edge the launcher's chrome uses. */}
      <rect x="1" y="1" width="30" height="30" fill="#4c5844" />
      <path d="M1 1h30v2H3v28H1z" fill="#7f8c75" />
      <path d="M31 1v30H1v-2h28V1z" fill="#282e22" />
      {/* The coiled fuse. */}
      <circle
        cx="15"
        cy="17"
        r="7"
        fill="none"
        stroke="#d8ded3"
        strokeWidth="3"
      />
      <path d="M15 10v4" stroke="#4c5844" strokeWidth="4" />
      <path
        d="M15 10c0-3 3-4 5-4"
        fill="none"
        stroke="#d8ded3"
        strokeWidth="3"
        strokeLinecap="round"
      />
      {/* The spark, in the launcher's maize. */}
      <circle cx="22" cy="6" r="3" fill="#c4b550" />
      <circle cx="22" cy="6" r="1.5" fill="#fff6c0" />
    </svg>
  );
}
