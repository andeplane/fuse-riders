import type { CSSProperties } from "react";

export type TrophyIconProps = {
  width?: number | string;
  height?: number | string;
  className?: string;
  style?: CSSProperties;
  /** Cup colour: the podium's gold, silver and bronze, or the app's plain gold. */
  metal?: "gold" | "silver" | "bronze";
  variant?: string;
};

const METALS = {
  gold: { light: "#ffff00", base: "#ffcc00", dark: "#808000" },
  silver: { light: "#ffffff", base: "#c0c0c0", dark: "#808080" },
  bronze: { light: "#ffa060", base: "#c06020", dark: "#804010" },
} as const;

/**
 * A 16-colour trophy, drawn on a 16x16 grid so it reads at both icon sizes, like the Win95 shell's own
 * bitmaps. @react95/icons has no trophy, so the Hall of Fame brings its own.
 */
export function TrophyIcon({
  width = 16,
  height = 16,
  className,
  style,
  metal = "gold",
  variant: _variant,
}: TrophyIconProps) {
  const colours = METALS[metal];
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 16 16"
      className={className}
      style={{ imageRendering: "pixelated", ...style }}
      aria-hidden
      focusable="false"
      data-icon="trophy"
      shapeRendering="crispEdges"
    >
      {/* handles */}
      <path d="M2 3h2v1H3v3h1v1H2z" fill={colours.dark} />
      <path d="M12 3h2v5h-2V7h1V4h-1z" fill={colours.dark} />
      {/* cup */}
      <path d="M4 2h8v5l-1 2H5L4 7z" fill={colours.base} />
      <path d="M5 2h1v6H5z" fill={colours.light} />
      <path d="M10 3h1v4h-1z" fill={colours.dark} />
      <path d="M4 2h8v1H4z" fill={colours.light} />
      {/* stem */}
      <path d="M7 9h2v3H7z" fill={colours.base} />
      <path d="M8 9h1v3H8z" fill={colours.dark} />
      {/* base */}
      <path d="M5 12h6v1H5z" fill="#404040" />
      <path d="M4 13h8v2H4z" fill="#000000" />
      <path d="M4 13h8v1H4z" fill="#808080" />
    </svg>
  );
}
