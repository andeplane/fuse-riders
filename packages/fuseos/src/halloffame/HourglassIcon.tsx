/** The Win95 "busy" hourglass, on a 16x16 grid; shown in place of the list while a leaderboard loads. */
export function HourglassIcon({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      style={{ imageRendering: "pixelated" }}
      aria-hidden
      focusable="false"
      data-icon="hourglass"
      shapeRendering="crispEdges"
    >
      {/* frame */}
      <path d="M3 1h10v2H3zM3 13h10v2H3z" fill="#000000" />
      {/* glass: two bulbs meeting at the waist */}
      <path d="M4 3h8v1l-3 3v2l3 3v1H4v-1l3-3V7L4 4z" fill="#ffffff" />
      <path d="M4 3h1v1l3 3h0v1L5 5V4H4zM11 3h1v1l-3 3V6l2-2z" fill="#808080" />
      {/* sand: what is left above, the pile below */}
      <path d="M6 4h4L8 6z" fill="#00c0c0" />
      <path d="M8 8h1v3H8zM6 11h4v1H6zM5 12h6v1H5z" fill="#00c0c0" />
    </svg>
  );
}
