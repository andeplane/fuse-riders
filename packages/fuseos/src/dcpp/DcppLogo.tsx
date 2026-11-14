import type { CSSProperties } from "react";

export type DcppLogoProps = {
  width?: number | string;
  height?: number | string;
  className?: string;
  style?: CSSProperties;
};

/**
 * DC++ 0.4xx's program icon: three glass balls, two lime and one black, on a white disc. Drawn, not
 * bitmapped, so it stays crisp at 16 and 32 pixels.
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
      style={style}
      aria-hidden
      focusable="false"
      data-icon="dcpp"
    >
      <defs>
        <radialGradient id="dcpp-disc" cx="40%" cy="35%" r="70%">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#c8c8c8" />
        </radialGradient>
        <radialGradient id="dcpp-lime" cx="35%" cy="30%" r="70%">
          <stop offset="0" stopColor="#f4ff9a" />
          <stop offset="0.5" stopColor="#c6e000" />
          <stop offset="1" stopColor="#7c9000" />
        </radialGradient>
        <radialGradient id="dcpp-black" cx="35%" cy="30%" r="70%">
          <stop offset="0" stopColor="#8a8a8a" />
          <stop offset="0.5" stopColor="#2a2a2a" />
          <stop offset="1" stopColor="#000" />
        </radialGradient>
      </defs>
      <circle cx="16" cy="16" r="15" fill="url(#dcpp-disc)" stroke="#a0a0a0" />
      <circle cx="21" cy="14.5" r="5.6" fill="url(#dcpp-black)" />
      <circle cx="12.5" cy="10.5" r="5.6" fill="url(#dcpp-lime)" />
      <circle cx="13.5" cy="20.5" r="5.6" fill="url(#dcpp-lime)" />
    </svg>
  );
}
