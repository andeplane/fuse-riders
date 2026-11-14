import type { CSSProperties } from "react";

export type WinampLogoProps = {
  width?: number | string;
  height?: number | string;
  className?: string;
  style?: CSSProperties;
};

/**
 * The Winamp lightning bolt, drawn rather than bitmapped so it stays crisp at 16 and 32 pixels.
 * A generic speaker icon read as "some audio thing"; this is the mark people recognise on a
 * Windows 98 desktop. Webamp draws the real skin inside the window — this is only the icon.
 */
export function WinampLogo({
  width = 16,
  height = 16,
  className,
  style,
}: WinampLogoProps) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 32 32"
      className={className}
      style={{ imageRendering: "pixelated", ...style }}
      aria-hidden
      focusable="false"
      data-icon="winamp"
    >
      {/* The player's dark body, with the Win98 raised-edge treatment. */}
      <rect x="1" y="1" width="30" height="30" fill="#3b3b4f" />
      <path d="M1 1h30v2H3v28H1z" fill="#8b8ba0" />
      <path d="M31 1v30H1v-2h28V1z" fill="#16161f" />
      <rect x="4" y="4" width="24" height="24" fill="#1d1d28" />

      {/* The bolt: a warm highlight down the leading edge, the body in Winamp's orange. */}
      <path d="M19 4l-9 13h5l-3 11 10-14h-5z" fill="#ff9d1e" />
      <path d="M19 4l-9 13h2.5L20 6z" fill="#ffd280" />
      <path d="M12 28l10-14h-2.5L13.6 24z" fill="#c96a00" />
    </svg>
  );
}
