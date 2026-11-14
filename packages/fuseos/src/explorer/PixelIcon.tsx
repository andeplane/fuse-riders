import { MARK_COLOURS } from "../assets/fuseOsMark";

import type { PixelIconName } from "./pixelIcons";
import {
  colourLayers,
  inkPath,
  PIXEL_ICON_SIZE,
  PIXEL_ICONS,
} from "./pixelIcons";

export type PixelIconProps = {
  name: PixelIconName;
  /** Embossed grey with a white shadow, as Windows draws a disabled toolbar picture. */
  disabled?: boolean;
};

/** A toolbar picture at its native 20x20, one square per pixel so it stays crisp at any font scale. */
export function PixelIcon({ name, disabled = false }: PixelIconProps) {
  const grid = PIXEL_ICONS[name];
  return (
    <svg
      className="explorer-pixel-icon"
      width={PIXEL_ICON_SIZE}
      height={PIXEL_ICON_SIZE}
      viewBox={`0 0 ${PIXEL_ICON_SIZE} ${PIXEL_ICON_SIZE}`}
      shapeRendering="crispEdges"
      aria-hidden
      data-pixel-icon={name}
      data-disabled={disabled ? "true" : undefined}
    >
      {disabled ? (
        <>
          <path d={inkPath(grid)} fill="#ffffff" transform="translate(1 1)" />
          <path d={inkPath(grid)} fill="#808080" />
        </>
      ) : (
        colourLayers(grid).map((layer) => (
          <path key={layer.colour} d={layer.path} fill={layer.colour} />
        ))
      )}
    </svg>
  );
}

/** The four panes of the FuseOS mark, each a few rows of a waving flag. */
const PANES: readonly { colour: string; x: number; y: number }[] = [
  { colour: MARK_COLOURS.pink, x: 0, y: 0 },
  { colour: MARK_COLOURS.green, x: 8, y: 1 },
  { colour: MARK_COLOURS.cyan, x: 0, y: 7 },
  { colour: MARK_COLOURS.yellow, x: 8, y: 8 },
];

export type ThrobberProps = {
  /** Explorer is reading a drive: the flag waves. */
  busy: boolean;
};

/** The black box at the right end of the menu band whose logo moves while Explorer is busy. */
export function Throbber({ busy }: ThrobberProps) {
  return (
    <div
      className={`explorer-throbber ${busy ? "busy" : ""}`}
      role="img"
      aria-label={busy ? "Working" : "FuseOS"}
    >
      <svg
        width={15}
        height={14}
        viewBox="0 0 15 14"
        shapeRendering="crispEdges"
        aria-hidden
      >
        {PANES.map((pane) => (
          <rect
            key={pane.colour}
            x={pane.x}
            y={pane.y}
            width={7}
            height={6}
            fill={pane.colour}
          />
        ))}
      </svg>
    </div>
  );
}
