import type { CSSProperties } from "react";

export type NapsterLogoProps = {
  width?: number | string;
  height?: number | string;
  className?: string;
  style?: CSSProperties;
};

/**
 * The cat in headphones, drawn as an SVG so it stays crisp from the 16px title bar to the Home tab's big mark:
 * a black head with pointed ears, headphones over the top and wide white eyes.
 */
export function NapsterLogo({
  width = 16,
  height = 16,
  className,
  style,
}: NapsterLogoProps) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 32 32"
      className={className}
      style={style}
      aria-hidden
      focusable="false"
      data-icon="napster"
    >
      <path
        d="M5 18 C5 6 27 6 27 18"
        fill="none"
        stroke="#000"
        strokeWidth="2.6"
      />
      <path d="M8 14 L9.5 4.5 L15 10 Z" fill="#000" />
      <path d="M24 14 L22.5 4.5 L17 10 Z" fill="#000" />
      <ellipse cx="16" cy="18.5" rx="10" ry="9" fill="#000" />
      <rect x="2.5" y="15" width="5" height="9" rx="1.5" fill="#000" />
      <rect x="24.5" y="15" width="5" height="9" rx="1.5" fill="#000" />
      <rect x="3.6" y="16.2" width="1.4" height="6.4" fill="#555" />
      <rect x="27" y="16.2" width="1.4" height="6.4" fill="#555" />
      <ellipse cx="12.4" cy="17" rx="2.6" ry="3.2" fill="#fff" />
      <ellipse cx="19.6" cy="17" rx="2.6" ry="3.2" fill="#fff" />
      <circle cx="13" cy="17.6" r="1.2" fill="#000" />
      <circle cx="19" cy="17.6" r="1.2" fill="#000" />
      <ellipse cx="16" cy="23.2" rx="3.4" ry="2.2" fill="#fff" />
      <path d="M14.8 22.2 L17.2 22.2 L16 23.4 Z" fill="#000" />
    </svg>
  );
}
