import type { CSSProperties, ReactNode } from "react";

/**
 * mIRC's toolbar and window icons, drawn as 16×16 pixel art so they stay crisp. They follow the shapes and
 * colours of the period toolbar (a yellow bolt, a hammer, folders, sheets with red letters) without copying
 * any bitmap. The app icon is our own: two chat bubbles, not the mIRC logo.
 */

export type MircIconName =
  | "connect"
  | "disconnect"
  | "options"
  | "channelsFolder"
  | "listChannels"
  | "aliases"
  | "popups"
  | "remote"
  | "finger"
  | "timer"
  | "colours"
  | "addressBook"
  | "dccSend"
  | "dccChat"
  | "dccOptions"
  | "notify"
  | "urlList"
  | "tile"
  | "cascade"
  | "help"
  | "about"
  | "status"
  | "channel"
  | "query"
  | "list";

const sheet = (
  <>
    <path d="M3 1h7l3 3v11H3z" fill="#fff" />
    <path d="M3 1h7l3 3v11H3zM4 2v12h8V5H9V2z" fill="#000" fillRule="evenodd" />
  </>
);

const folder = (
  <>
    <path d="M1 5h5l1 1h7v8H1z" fill="#ffd800" />
    <path
      d="M1 5h5l1 1h7v8H1zM2 6v7h11V7H6.5l-1-1z"
      fill="#806000"
      fillRule="evenodd"
    />
  </>
);

function miniWindow(x: number, y: number, w: number, h: number): ReactNode {
  return (
    <g key={`${x}${y}`}>
      <rect x={x} y={y} width={w} height={h} fill="#000" />
      <rect x={x + 1} y={y + 1} width={w - 2} height={h - 2} fill="#fff" />
      <rect x={x + 1} y={y + 1} width={w - 2} height={2} fill="#000080" />
    </g>
  );
}

const ICONS: Record<MircIconName, ReactNode> = {
  connect: (
    <>
      <path d="M10 0L3 9h4l-2 7 8-10H9l3-6z" fill="#000" />
      <path d="M10 1L4 8h4l-1.5 5.5L12 7H8l2.5-6z" fill="#ffff00" />
    </>
  ),
  disconnect: (
    <>
      <path d="M10 0L3 9h4l-2 7 8-10H9l3-6z" fill="#000" />
      <path d="M10 1L4 8h4l-1.5 5.5L12 7H8l2.5-6z" fill="#c0c0c0" />
      <path d="M1 1l14 14M1 2l13 13" stroke="#ff0000" strokeWidth="1.5" />
    </>
  ),
  options: (
    <>
      <rect x="1" y="7" width="12" height="8" fill="#806000" />
      <rect x="2" y="8" width="10" height="6" fill="#ffd800" />
      <path d="M6 1h7v3H6z" fill="#808080" />
      <path d="M6 1h7v1H6z" fill="#c0c0c0" />
      <rect x="9" y="4" width="2" height="7" fill="#804000" />
    </>
  ),
  channelsFolder: (
    <>
      {folder}
      <path d="M5 7v6M8 7v6M4 9h5M4 11h5" stroke="#000080" />
    </>
  ),
  listChannels: (
    <>
      <circle cx="10" cy="6" r="5.5" fill="#0000c0" />
      <path d="M7 3h3v2H8v2H6zM11 6h3v3h-2v2h-2z" fill="#00a000" />
      <path d="M1 6h6v9H1z" fill="#000" />
      <path d="M2 7h4v7H2z" fill="#fff" />
      <path d="M3 9h2M3 11h2" stroke="#000" />
    </>
  ),
  aliases: (
    <>
      <rect x="1" y="1" width="14" height="14" fill="#008000" />
      <path d="M2 2h12v1H3v11H2z" fill="#40c040" />
      <path d="M7 4L4 12" stroke="#fff" strokeWidth="1.4" />
      <path d="M9 7h3v5H9v-2h3" stroke="#fff" fill="none" />
    </>
  ),
  popups: (
    <>
      <rect x="1" y="2" width="9" height="12" fill="#000" />
      <rect x="2" y="3" width="7" height="10" fill="#c0c0c0" />
      <path d="M3 5h5M3 8h5M3 11h5" stroke="#000080" />
      <rect x="9" y="6" width="6" height="7" fill="#000" />
      <rect x="10" y="7" width="4" height="5" fill="#fff" />
    </>
  ),
  remote: (
    <>
      <rect x="1" y="2" width="14" height="12" fill="#000" />
      <rect x="2" y="3" width="12" height="10" fill="#fff" />
      <path d="M4 6h5M4 8h4M4 10h6" stroke="#000" />
      <circle cx="12" cy="6" r="1.5" fill="#ff0000" />
      <circle cx="12" cy="10" r="1.5" fill="#ff0000" />
    </>
  ),
  finger: (
    <>
      <path
        d="M1 9h4V5h9v2H8v2h3v2H8v2H4V9"
        fill="#ffd0a0"
        stroke="#000"
        strokeWidth="0.8"
      />
      <rect x="0" y="8" width="3" height="6" fill="#0000c0" />
    </>
  ),
  timer: (
    <>
      <circle cx="3" cy="3" r="2" fill="#ff0000" />
      <circle cx="13" cy="3" r="2" fill="#ff0000" />
      <circle cx="8" cy="9" r="6" fill="#000" />
      <circle cx="8" cy="9" r="5" fill="#fff" />
      <path d="M8 5v4h3" stroke="#000" fill="none" />
    </>
  ),
  colours: (
    <>
      {["#ff0000", "#fc7f00", "#ffff00", "#00c000", "#0000fc", "#9c009c"].map(
        (fill, index) => (
          <rect
            key={fill}
            x={1 + index * 2.4}
            y={2 + (index % 2)}
            width="2.2"
            height="12"
            fill={fill}
            stroke="#000"
            strokeWidth="0.4"
          />
        ),
      )}
    </>
  ),
  addressBook: (
    <>
      <rect x="2" y="1" width="12" height="14" fill="#000080" />
      <rect x="4" y="2" width="9" height="12" fill="#fff" />
      <path d="M6 5h5M6 8h5M6 11h5" stroke="#000080" />
      <path d="M2 3h3M2 7h3M2 11h3" stroke="#c0c0c0" />
    </>
  ),
  dccSend: (
    <>
      {sheet}
      <text
        x="5"
        y="11"
        fontSize="8"
        fontWeight="bold"
        fill="#ff0000"
        fontFamily="Arial"
      >
        S
      </text>
      <path d="M9 13h5l-2-2" stroke="#000080" fill="none" />
    </>
  ),
  dccChat: (
    <>
      {sheet}
      <text
        x="5"
        y="11"
        fontSize="8"
        fontWeight="bold"
        fill="#ff0000"
        fontFamily="Arial"
      >
        C
      </text>
    </>
  ),
  dccOptions: (
    <>
      {sheet}
      <path d="M5 6h6M5 9h6M5 12h6" stroke="#ff0000" strokeWidth="1.5" />
    </>
  ),
  notify: (
    <>
      {sheet}
      <text
        x="4"
        y="11"
        fontSize="7"
        fontWeight="bold"
        fill="#000"
        fontFamily="Arial"
      >
        N
      </text>
      <path d="M11 5v5M11 11v1" stroke="#ff0000" strokeWidth="1.5" />
    </>
  ),
  urlList: (
    <>
      {sheet}
      <path d="M5 5h6M5 8h6M5 11h4" stroke="#0000fc" />
    </>
  ),
  tile: (
    <>
      {miniWindow(1, 1, 14, 7)}
      {miniWindow(1, 8, 14, 7)}
    </>
  ),
  cascade: (
    <>
      {miniWindow(1, 1, 10, 9)}
      {miniWindow(5, 6, 10, 9)}
    </>
  ),
  help: (
    <>
      <circle cx="8" cy="8" r="7" fill="#ff0000" />
      <path
        d="M8 1a7 7 0 0 1 7 7h-3a4 4 0 0 0-4-4zM8 15a7 7 0 0 1-7-7h3a4 4 0 0 0 4 4z"
        fill="#fff"
      />
      <circle cx="8" cy="8" r="3" fill="#c0c0c0" />
      <circle cx="8" cy="8" r="7" fill="none" stroke="#000" strokeWidth="0.8" />
    </>
  ),
  about: (
    <>
      <circle
        cx="8"
        cy="5"
        r="4"
        fill="#ffff00"
        stroke="#000"
        strokeWidth="0.8"
      />
      <rect
        x="6"
        y="9"
        width="4"
        height="5"
        fill="#ffff00"
        stroke="#000"
        strokeWidth="0.8"
      />
      <path d="M8 3v1M8 5v3" stroke="#000080" strokeWidth="1.2" />
    </>
  ),
  status: (
    <>
      <rect x="1" y="2" width="14" height="12" fill="#000" />
      <rect x="2" y="3" width="12" height="10" fill="#fff" />
      <rect x="2" y="3" width="12" height="2" fill="#000080" />
      <path d="M3 7h9M3 9h7M3 11h8" stroke="#808080" />
    </>
  ),
  channel: (
    <>
      <rect x="1" y="2" width="14" height="12" fill="#000" />
      <rect x="2" y="3" width="12" height="10" fill="#fff" />
      <rect x="2" y="3" width="12" height="2" fill="#000080" />
      <path d="M3 7h6M3 9h5M3 11h6" stroke="#808080" />
      <rect x="10" y="5" width="1" height="8" fill="#000" />
      <path d="M12 7h1M12 9h1M12 11h1" stroke="#000080" />
    </>
  ),
  query: (
    <>
      <rect x="1" y="2" width="14" height="12" fill="#000" />
      <rect x="2" y="3" width="12" height="10" fill="#fff" />
      <rect x="2" y="3" width="12" height="2" fill="#008080" />
      <path d="M3 7h9M3 9h5M3 11h7" stroke="#808080" />
    </>
  ),
  list: (
    <>
      <rect x="1" y="2" width="14" height="12" fill="#000" />
      <rect x="2" y="3" width="12" height="10" fill="#fff" />
      <rect x="2" y="3" width="12" height="2" fill="#000080" />
      <path d="M4 6v6M7 6v6M3 8h5M3 10h5" stroke="#000080" />
      <path d="M9 8h4M9 10h4" stroke="#808080" />
    </>
  ),
};

export function MircIcon({
  name,
  size = 16,
}: {
  name: MircIconName;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden
      focusable="false"
      shapeRendering="crispEdges"
      data-mirc-icon={name}
    >
      {ICONS[name]}
    </svg>
  );
}

export type MircLogoProps = {
  width?: number | string;
  height?: number | string;
  className?: string;
  style?: CSSProperties;
};

/** The program icon: two chat bubbles, a blue `#` and a yellow smile. Drawn for FuseOS, not the mIRC logo. */
export function MircLogo({
  width = 16,
  height = 16,
  className,
  style,
}: MircLogoProps) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 32 32"
      className={className}
      style={{ imageRendering: "pixelated", ...style }}
      aria-hidden
      focusable="false"
      data-icon="mirc"
    >
      <path d="M2 3h20v14H11l-5 5v-5H2z" fill="#000" />
      <path d="M4 5h16v10H10l-2 2v-2H4z" fill="#fff" />
      <path
        d="M9 6v8M14 6v8M7 8.5h9M7 11.5h9"
        stroke="#0000c0"
        strokeWidth="1.6"
      />
      <path d="M13 15h17v12h-4v4l-4-4h-9z" fill="#000" />
      <path d="M15 17h13v8h-3v2l-2-2h-8z" fill="#ffd800" />
      <rect x="18" y="19" width="2" height="2" fill="#000" />
      <rect x="23" y="19" width="2" height="2" fill="#000" />
      <path
        d="M18 22.5q3.5 2.5 7 0"
        stroke="#000"
        strokeWidth="1.2"
        fill="none"
      />
    </svg>
  );
}
