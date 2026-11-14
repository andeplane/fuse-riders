import type { CSSProperties } from "react";

import { MARK_COLOURS, markPixels, wordPixels, wordWidth } from "./fuseOsMark";

export type FuseOsSplashProps = {
  width?: number | string;
  height?: number | string;
  className?: string;
  style?: CSSProperties;
};

const VIEW_WIDTH = 640;
const VIEW_HEIGHT = 360;

/** Pixel size of the wordmark and the mark, in SVG units. */
const WORD_SCALE = 9;
const MARK_SCALE = 7;

const FUSE = wordPixels(["F", "u", "s", "e"]);
const OS = wordPixels(["O", "S"]);
const FUSE_WIDTH = wordWidth(4) * WORD_SCALE;
const OS_WIDTH = wordWidth(2) * WORD_SCALE;
const WORD_GAP = 2 * WORD_SCALE;
const MARK_WIDTH = 7 * MARK_SCALE;
const MARK_GAP = 4 * WORD_SCALE;
const TOTAL_WIDTH = MARK_WIDTH + MARK_GAP + FUSE_WIDTH + WORD_GAP + OS_WIDTH;
const LEFT = (VIEW_WIDTH - TOTAL_WIDTH) / 2;
const TOP = 118;

/** A few fixed stars, so the sky is the same every boot (no randomness: the splash is a picture). */
const STARS: readonly { x: number; y: number; size: number }[] = [
  { x: 42, y: 30, size: 2 },
  { x: 118, y: 72, size: 3 },
  { x: 200, y: 24, size: 2 },
  { x: 296, y: 58, size: 2 },
  { x: 372, y: 18, size: 3 },
  { x: 458, y: 80, size: 2 },
  { x: 540, y: 36, size: 2 },
  { x: 604, y: 96, size: 3 },
  { x: 86, y: 140, size: 2 },
  { x: 582, y: 160, size: 2 },
  { x: 24, y: 214, size: 2 },
  { x: 612, y: 232, size: 2 },
];

/** Horizon lines of the floor grid, closer together towards the horizon. */
const GRID_ROWS = [264, 272, 284, 300, 322, 350] as const;
const GRID_COLUMNS = 13;

/**
 * The FuseOS boot splash: a pixel wordmark and a four-pane mark in the Fuse games' neon accents
 * over a night sky and a synth floor grid. Drawn here rather than loaded as a bitmap so it is
 * crisp at any size, weighs nothing and is ours.
 */
export function FuseOsSplash({
  width = "100%",
  height = "100%",
  className,
  style,
}: FuseOsSplashProps) {
  const markLeft = LEFT;
  const fuseLeft = markLeft + MARK_WIDTH + MARK_GAP;
  const osLeft = fuseLeft + FUSE_WIDTH + WORD_GAP;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      preserveAspectRatio="xMidYMid meet"
      className={className}
      style={{ shapeRendering: "crispEdges", ...style }}
      role="img"
      aria-label="FuseOS"
      data-splash="fuseos"
    >
      <defs>
        <linearGradient id="fuseos-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#02020f" />
          <stop offset="0.7" stopColor="#0a0a3a" />
          <stop offset="1" stopColor="#1a0b3f" />
        </linearGradient>
        <linearGradient id="fuseos-floor" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1a0b3f" />
          <stop offset="1" stopColor="#040414" />
        </linearGradient>
        <linearGradient id="fuseos-sun" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={MARK_COLOURS.yellow} />
          <stop offset="1" stopColor={MARK_COLOURS.pink} />
        </linearGradient>
        <filter id="fuseos-glow" x="-20%" y="-40%" width="140%" height="180%">
          <feGaussianBlur stdDeviation="6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <rect width={VIEW_WIDTH} height={VIEW_HEIGHT} fill="url(#fuseos-sky)" />
      {STARS.map((star) => (
        <rect
          key={`${star.x},${star.y}`}
          x={star.x}
          y={star.y}
          width={star.size}
          height={star.size}
          fill="#dfe9ff"
          opacity={0.8}
        />
      ))}

      {/* A striped sun sitting on the horizon, as every synthwave poster insists. */}
      <g data-part="sun">
        {[0, 1, 2, 3, 4, 5].map((band) => (
          <rect
            key={band}
            x={VIEW_WIDTH / 2 - 64 + band * 4}
            y={206 + band * 9}
            width={128 - band * 8}
            height={6}
            fill="url(#fuseos-sun)"
            opacity={0.9 - band * 0.1}
          />
        ))}
      </g>

      <rect
        y={260}
        width={VIEW_WIDTH}
        height={VIEW_HEIGHT - 260}
        fill="url(#fuseos-floor)"
      />
      <g
        data-part="grid"
        stroke={MARK_COLOURS.cyan}
        strokeWidth={1}
        opacity={0.55}
      >
        {GRID_ROWS.map((y) => (
          <line key={y} x1={0} y1={y} x2={VIEW_WIDTH} y2={y} />
        ))}
        {Array.from({ length: GRID_COLUMNS }, (_, index) => {
          const spread =
            (index - (GRID_COLUMNS - 1) / 2) / ((GRID_COLUMNS - 1) / 2);
          return (
            <line
              key={index}
              x1={VIEW_WIDTH / 2 + spread * 60}
              y1={260}
              x2={VIEW_WIDTH / 2 + spread * 520}
              y2={VIEW_HEIGHT}
            />
          );
        })}
      </g>

      <g data-part="mark" filter="url(#fuseos-glow)">
        {markPixels().map((pixel) => (
          <rect
            key={`${pixel.x},${pixel.y}`}
            x={markLeft + pixel.x * MARK_SCALE}
            y={TOP - 4 + pixel.y * MARK_SCALE}
            width={MARK_SCALE}
            height={MARK_SCALE}
            fill={MARK_COLOURS[pixel.colour]}
          />
        ))}
      </g>

      <g data-part="wordmark" filter="url(#fuseos-glow)">
        {FUSE.map((pixel) => (
          <rect
            key={`fuse-${pixel.x},${pixel.y}`}
            x={fuseLeft + pixel.x * WORD_SCALE}
            y={TOP + pixel.y * WORD_SCALE}
            width={WORD_SCALE}
            height={WORD_SCALE}
            fill="#f4fbff"
          />
        ))}
        {OS.map((pixel) => (
          <rect
            key={`os-${pixel.x},${pixel.y}`}
            x={osLeft + pixel.x * WORD_SCALE}
            y={TOP + pixel.y * WORD_SCALE}
            width={WORD_SCALE}
            height={WORD_SCALE}
            fill={MARK_COLOURS.cyan}
          />
        ))}
      </g>
    </svg>
  );
}
