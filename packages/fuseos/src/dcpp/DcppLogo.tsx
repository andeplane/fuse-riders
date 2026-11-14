import type { CSSProperties } from "react";

export type DcppLogoProps = {
  width?: number | string;
  height?: number | string;
  className?: string;
  style?: CSSProperties;
};

/**
 * DC++'s program icon as the 0.4xx title bar showed it: a bevelled grey disc with a dark "C" and the
 * two pluses. Drawn, not bitmapped, so it stays crisp at 16 and 32 pixels.
 */
export function DcppLogo({
  width = 16,
  height = 16,
  className,
  style,
}: DcppLogoProps) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 32 32"
      className={className}
      style={{ imageRendering: "pixelated", ...style }}
      aria-hidden
      focusable="false"
      data-icon="dcpp"
    >
      <circle cx="16" cy="16" r="15" fill="#404040" />
      <circle cx="16" cy="16" r="13.5" fill="#d4d0c8" />
      <path d="M5 16a11 11 0 0 1 19-7.6L22 10a8 8 0 0 0-14 6z" fill="#fff" />
      <path d="M27 16a11 11 0 0 1-19 7.6L10 22a8 8 0 0 0 14-6z" fill="#808080" />
      {/* The "C". */}
      <path
        d="M21.5 11.2A7 7 0 1 0 21.5 20.8L19.4 18.7A4 4 0 1 1 19.4 13.3z"
        fill="#1c1c1c"
      />
      {/* The pluses. */}
      <path d="M21 14.5h2v-2h1.5v2h2V16h-2v2H23v-2h-2z" fill="#0a246a" />
    </svg>
  );
}
