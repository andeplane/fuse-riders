import type { ReactNode } from "react";

/** The toolbar's buttons, by what they do. */
export type ToolbarIconName =
  | "publicHubs"
  | "reconnect"
  | "redirect"
  | "favorites"
  | "favoriteUsers"
  | "search"
  | "adlSearch"
  | "searchSpy"
  | "queue"
  | "finished"
  | "finishedUploads"
  | "openFileList"
  | "settings"
  | "notepad";

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      aria-hidden
      focusable="false"
    >
      {children}
    </svg>
  );
}

const Magnifier = ({ lens = "#9fd3ff" }: { lens?: string }) => (
  <>
    <circle cx="6.5" cy="6.5" r="4.5" fill={lens} stroke="#404040" />
    <path d="M4 5h2v1H4zM4 6h1v2H4z" fill="#fff" />
    <path
      d="M10 10l1-1 4 4-2 2-4-4z"
      fill="#8a5a1a"
      stroke="#3a2205"
      strokeWidth="0.5"
    />
  </>
);

/** 16x16 icons in the spirit of DC++ 0.4xx's toolbar bitmap: bold outlines, a handful of saturated colours. */
export function ToolbarIcon({ name }: { name: ToolbarIconName }) {
  switch (name) {
    case "publicHubs":
      return (
        <Svg>
          <path d="M1 2h11v8H1z" fill="#c0c0c0" stroke="#000" />
          <path d="M2.5 3.5h8v5h-8z" fill="#2f6fd6" />
          <path d="M3 4h3v1H3z" fill="#bfe0ff" />
          <path d="M4 11h5v1H4zM2 12h9v2H2z" fill="#808080" />
          <circle cx="12" cy="11" r="3.5" fill="#3aa0ff" stroke="#003d80" />
          <path d="M9 11h6M12 7.5v7" stroke="#bfe6ff" strokeWidth="0.8" />
        </Svg>
      );
    case "reconnect":
      return (
        <Svg>
          <path
            d="M3 8a5 5 0 0 1 8.5-3.5L13 3v5H8l1.8-1.8A2.6 2.6 0 0 0 5.4 8z"
            fill="#1fa31f"
            stroke="#0b4d0b"
            strokeWidth="0.7"
          />
          <path
            d="M13 8a5 5 0 0 1-8.5 3.5L3 13V8h5l-1.8 1.8A2.6 2.6 0 0 0 10.6 8z"
            fill="#33c433"
            stroke="#0b4d0b"
            strokeWidth="0.7"
          />
        </Svg>
      );
    case "redirect":
      return (
        <Svg>
          <path d="M8 1l7 7-7 7-7-7z" fill="#d97a1c" stroke="#5a2d00" />
          <path d="M4 7h4V5l3 3-3 3V9H4z" fill="#fff" />
        </Svg>
      );
    case "favorites":
    case "favoriteUsers": {
      const fill = name === "favorites" ? "#ffd400" : "#7ab8ff";
      const edge = name === "favorites" ? "#a06a00" : "#1e4f8f";
      return (
        <Svg>
          <path
            d="M8 1l2 4.6 5 .4-3.8 3.3L12.4 14 8 11.4 3.6 14l1.2-4.7L1 6l5-.4z"
            fill={fill}
            stroke={edge}
            strokeLinejoin="round"
          />
        </Svg>
      );
    }
    case "search":
      return (
        <Svg>
          <Magnifier />
        </Svg>
      );
    case "adlSearch":
      return (
        <Svg>
          <Magnifier lens="#ffe680" />
        </Svg>
      );
    case "searchSpy":
      return (
        <Svg>
          <Magnifier lens="#b6f0a8" />
        </Svg>
      );
    case "queue":
      return (
        <Svg>
          <path d="M1 5h5l1 1h7v8H1z" fill="#f0d070" stroke="#7a5a00" />
          <circle cx="11.5" cy="11.5" r="3" fill="#fff" stroke="#404040" />
          <path d="M11.5 9.5v2h1.5" stroke="#000" fill="none" />
          <path
            d="M4 0h3v3h2L5.5 7 2 3h2z"
            fill="#2fb52f"
            stroke="#0b4d0b"
            strokeWidth="0.7"
          />
        </Svg>
      );
    case "finished":
      return (
        <Svg>
          <path d="M1 5h5l1 1h7v8H1z" fill="#f0d070" stroke="#7a5a00" />
          <path
            d="M4 5l2.5 3L12 2l1.5 1.5-7 7.5L2.5 6.5z"
            fill="#2fb52f"
            stroke="#0b4d0b"
            strokeWidth="0.7"
          />
        </Svg>
      );
    case "finishedUploads":
      return (
        <Svg>
          <path d="M1 5h5l1 1h7v8H1z" fill="#f0d070" stroke="#7a5a00" />
          <path
            d="M4 8V4H2l3.5-4L9 4H7v4z"
            fill="#e2332b"
            stroke="#6b0e0a"
            strokeWidth="0.7"
          />
          <path
            d="M8 10l2 2 4-4 1 1-5 5-3-3z"
            fill="#2fb52f"
            stroke="#0b4d0b"
            strokeWidth="0.5"
          />
        </Svg>
      );
    case "openFileList":
      return (
        <Svg>
          <path d="M1 4h5l1 1h6v8H1z" fill="#e8c34a" stroke="#6b5000" />
          <path d="M3 7h12l-2 6H1z" fill="#ffe27a" stroke="#6b5000" />
          <path d="M9 1q5 0 5 5h1.5l-2.5 3-2.5-3H12q0-3-3-3z" fill="#1a1a1a" />
        </Svg>
      );
    case "settings":
      return (
        <Svg>
          <path d="M2 1h9v14H2z" fill="#fff" stroke="#203a8a" />
          <path
            d="M4 4h2v2H4zM4 8h2v2H4z"
            fill="#fff"
            stroke="#203a8a"
            strokeWidth="0.8"
          />
          <path d="M7 4.5h3M7 8.5h3" stroke="#203a8a" />
          <path
            d="M9 13l5-6 1.5 1.3-5 6-2 .7z"
            fill="#ffcf3f"
            stroke="#5a3d00"
            strokeWidth="0.6"
          />
        </Svg>
      );
    case "notepad":
      return (
        <Svg>
          <path d="M3 1h10v14H3z" fill="#4f86e0" stroke="#0c2f73" />
          <path d="M5 3h7v10H5z" fill="#e8f0ff" />
          <path d="M6 5h5M6 7h5M6 9h5M6 11h3" stroke="#7a9cd6" />
          <path d="M2 3h2M2 6h2M2 9h2M2 12h2" stroke="#000" />
        </Svg>
      );
  }
}

/**
 * The user list's person, as DC++ 0.4xx drew it: a green shirt for other clients, blue for DC++ users,
 * a brick wall in front of passive (firewalled) users and a gold key beside ops.
 */
export function UserIcon({
  dcpp,
  op,
  passive,
}: {
  dcpp: boolean;
  op: boolean;
  passive: boolean;
}) {
  const shirt = dcpp ? "#2f5fe0" : "#22a05a";
  const brick = dcpp ? "#3b5bea" : "#e0561c";
  const kind = `${dcpp ? "dcpp" : "other"}${passive ? "-passive" : ""}${op ? "-op" : ""}`;
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      aria-hidden
      focusable="false"
      data-user-icon={kind}
    >
      <path d="M3 2h1V1h4v1h1v2H8V3H4v1H3z" fill="#1a1a1a" />
      <path d="M4 3h4v4H4z" fill="#d79a5c" />
      <path d="M3 4h1v2H3zM8 4h1v2H8z" fill="#1a1a1a" />
      <path d="M5 6h2v1H5z" fill="#b5523a" />
      <path d="M1 10l2-2h6l2 2v6H1z" fill={shirt} />
      <path d="M5 8h2v3H5z" fill="#d79a5c" />
      {passive ? (
        <g>
          <path d="M0 10h12v6H0z" fill={brick} />
          <path
            d="M0 12h12M0 14h12M3 10v2M8 10v2M1 12v2M6 12v2M11 12v2M3 14v2M8 14v2"
            stroke="#3a1a0a"
            strokeWidth="0.6"
          />
        </g>
      ) : null}
      {op ? (
        <g>
          <path
            d="M11 1h1v8h-1zM12 2h2v1h-2zM12 4h2v1h-2z"
            fill="#f0e000"
            stroke="#6b6000"
            strokeWidth="0.3"
          />
          <path
            d="M9 9h5v1h1v3h-1v1H9v-1H8v-3h1z"
            fill="#f0e000"
            stroke="#6b6000"
            strokeWidth="0.5"
          />
          <path d="M10 10h3v3h-3z" fill="#a0a0a0" />
        </g>
      ) : null}
    </svg>
  );
}

/** A Windows folder for the queue and file list trees. */
export function FolderIcon({ open = false }: { open?: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      aria-hidden
      focusable="false"
    >
      <path d="M1 3h5l1 1h7v9H1z" fill="#e8c34a" stroke="#6b5000" />
      {open ? (
        <path d="M3 7h12l-2 6H1z" fill="#ffe27a" stroke="#6b5000" />
      ) : null}
    </svg>
  );
}

/** A document for file rows. */
export function FileIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      aria-hidden
      focusable="false"
    >
      <path d="M3 1h7l3 3v11H3z" fill="#fff" stroke="#404040" />
      <path d="M10 1v3h3" fill="#c0c0c0" stroke="#404040" />
    </svg>
  );
}
