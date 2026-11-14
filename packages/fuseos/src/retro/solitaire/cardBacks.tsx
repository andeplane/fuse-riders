import type { ReactNode } from "react";

import { CARD_HEIGHT, CARD_WIDTH } from "./cascade";

/** Card backs drawn in SVG, in the spirit of the twelve Windows 98 designs without copying them. */
export type CardBackDesign = { name: string; art: ReactNode };

function frame(children: ReactNode, background: string) {
  return (
    <svg
      viewBox={`0 0 ${CARD_WIDTH} ${CARD_HEIGHT}`}
      width={CARD_WIDTH}
      height={CARD_HEIGHT}
      aria-hidden="true"
      style={{ display: "block", shapeRendering: "auto" }}
    >
      <rect
        x="0.5"
        y="0.5"
        width={CARD_WIDTH - 1}
        height={CARD_HEIGHT - 1}
        rx="4"
        fill="#fff"
        stroke="#000"
      />
      <clipPath id="card-back-clip">
        <rect
          x="4"
          y="4"
          width={CARD_WIDTH - 8}
          height={CARD_HEIGHT - 8}
          rx="2"
        />
      </clipPath>
      <g clipPath="url(#card-back-clip)">
        <rect
          x="4"
          y="4"
          width={CARD_WIDTH - 8}
          height={CARD_HEIGHT - 8}
          fill={background}
        />
        {children}
      </g>
    </svg>
  );
}

function diamonds(id: string, background: string, line: string) {
  return frame(
    <>
      <pattern id={id} width="8" height="8" patternUnits="userSpaceOnUse">
        <path
          d="M4 0 L8 4 L4 8 L0 4 Z"
          fill="none"
          stroke={line}
          strokeWidth="1"
        />
      </pattern>
      <rect
        x="4"
        y="4"
        width={CARD_WIDTH - 8}
        height={CARD_HEIGHT - 8}
        fill={`url(#${id})`}
      />
    </>,
    background,
  );
}

function fish() {
  return frame(
    <>
      {[16, 40, 64].map((y, i) => (
        <g key={y} transform={`translate(${i % 2 ? 14 : 30} ${y})`}>
          <ellipse cx="14" cy="8" rx="12" ry="6" fill="#ff8000" />
          <path d="M2 8 L-6 2 L-6 14 Z" fill="#ff8000" />
          <circle cx="20" cy="6" r="1.5" fill="#000" />
          <path d="M10 3 Q14 -2 18 3" fill="none" stroke="#c00" />
        </g>
      ))}
      {[10, 50, 30].map((x, i) => (
        <circle
          key={x}
          cx={x}
          cy={12 + i * 30}
          r="2"
          fill="none"
          stroke="#9cf"
        />
      ))}
      <path d="M6 92 Q10 78 6 66 Q12 74 10 92 Z" fill="#0a0" />
      <path d="M62 92 Q58 76 64 62 Q60 74 66 92 Z" fill="#0a0" />
    </>,
    "#0000a8",
  );
}

function ivy() {
  return frame(
    <>
      <path
        d="M8 92 C 30 70, 20 40, 40 4"
        fill="none"
        stroke="#3a3"
        strokeWidth="2"
      />
      <path
        d="M62 92 C 44 70, 56 40, 30 4"
        fill="none"
        stroke="#3a3"
        strokeWidth="2"
      />
      {[
        [18, 74],
        [30, 52],
        [38, 26],
        [50, 72],
        [40, 44],
        [28, 14],
      ].map(([x, y]) => (
        <path
          key={`${x}-${y}`}
          d={`M${x} ${y} q8 -10 16 0 q-8 10 -16 0`}
          fill="#0c0"
          stroke="#050"
        />
      ))}
    </>,
    "#004000",
  );
}

function robot() {
  return frame(
    <>
      <rect x="24" y="12" width="22" height="16" fill="#e00" stroke="#000" />
      <rect x="29" y="18" width="4" height="4" fill="#ff0" />
      <rect x="37" y="18" width="4" height="4" fill="#ff0" />
      <line x1="35" y1="12" x2="35" y2="6" stroke="#000" />
      <circle cx="35" cy="5" r="2" fill="#ff0" />
      <rect x="20" y="30" width="30" height="30" fill="#e00" stroke="#000" />
      <rect x="26" y="36" width="18" height="10" fill="#0af" stroke="#000" />
      <rect x="26" y="50" width="4" height="4" fill="#ff0" />
      <rect x="33" y="50" width="4" height="4" fill="#ff0" />
      <rect x="40" y="50" width="4" height="4" fill="#ff0" />
      <rect x="12" y="32" width="6" height="22" fill="#e00" stroke="#000" />
      <rect x="52" y="32" width="6" height="22" fill="#e00" stroke="#000" />
      <rect x="24" y="62" width="8" height="22" fill="#e00" stroke="#000" />
      <rect x="38" y="62" width="8" height="22" fill="#e00" stroke="#000" />
      <rect x="20" y="82" width="14" height="6" fill="#000" />
      <rect x="36" y="82" width="14" height="6" fill="#000" />
    </>,
    "#0000c0",
  );
}

function roses() {
  return frame(
    <>
      {(
        [
          [20, 24],
          [50, 40],
          [26, 66],
        ] as const
      ).map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <path d={`M${x - 10} ${y + 6} q6 6 12 0`} fill="#0a0" />
          <path d={`M${x + 8} ${y + 4} q-6 8 -12 2`} fill="#0a0" />
          <circle cx={x} cy={y} r="8" fill="#c00" />
          <circle cx={x} cy={y} r="5" fill="none" stroke="#800" />
          <circle cx={x} cy={y} r="2" fill="#800" />
        </g>
      ))}
    </>,
    "#000",
  );
}

function shell() {
  return frame(
    <>
      <path
        d="M36 74 C 10 74, 10 40, 36 30 C 58 30, 60 60, 40 60 C 28 60, 28 44, 40 44 C 48 44, 48 54, 40 54"
        fill="none"
        stroke="#ffe"
        strokeWidth="3"
      />
      <path
        d="M36 74 L 12 80 M36 74 L 60 82 M36 74 L 36 88"
        stroke="#ffe"
        strokeWidth="2"
      />
    </>,
    "#008080",
  );
}

function castle() {
  return frame(
    <>
      <circle cx="52" cy="18" r="8" fill="#ffc" />
      {[
        [14, 12],
        [24, 30],
        [60, 40],
        [10, 46],
      ].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="1" fill="#fff" />
      ))}
      <rect x="10" y="50" width="51" height="40" fill="#000" />
      <rect x="10" y="44" width="10" height="8" fill="#000" />
      <rect x="30" y="34" width="12" height="18" fill="#000" />
      <rect x="51" y="44" width="10" height="8" fill="#000" />
      <rect x="32" y="26" width="2" height="8" fill="#000" />
      <path d="M34 26 h6 v3 h-6 Z" fill="#c00" />
      <rect x="32" y="70" width="8" height="20" rx="4" fill="#ff8" />
    </>,
    "#000060",
  );
}

function beach() {
  return frame(
    <>
      <rect x="4" y="56" width="63" height="36" fill="#ffe680" />
      <rect x="4" y="50" width="63" height="8" fill="#0af" />
      <circle cx="18" cy="18" r="7" fill="#ff0" />
      <rect x="44" y="34" width="4" height="30" fill="#840" />
      {[0, 1, 2, 3].map((i) => (
        <path
          key={i}
          d={`M46 34 q${i % 2 ? 14 : -14} ${-6 - i * 3} ${i % 2 ? 20 : -20} ${2 - i * 2}`}
          fill="none"
          stroke="#0a0"
          strokeWidth="3"
        />
      ))}
      <path d="M16 80 l 8 -6 l 8 6 Z" fill="#c00" />
      <rect x="18" y="80" width="12" height="4" fill="#fff" />
    </>,
    "#8cf",
  );
}

function hand() {
  return frame(
    <>
      {[-24, -8, 8].map((angle, i) => (
        <g
          key={angle}
          transform={`translate(36 68) rotate(${angle}) translate(-14 -40)`}
        >
          <rect
            x="0"
            y="0"
            width="28"
            height="40"
            rx="2"
            fill="#fff"
            stroke="#000"
          />
          <text
            x="4"
            y="12"
            fontSize="10"
            fontFamily="serif"
            fill={i === 1 ? "#c00" : "#000"}
          >
            {["A", "K", "Q"][i]}
          </text>
          <text
            x="10"
            y="30"
            fontSize="14"
            fontFamily="serif"
            fill={i === 1 ? "#c00" : "#000"}
          >
            {["♠", "♥", "♣"][i]}
          </text>
        </g>
      ))}
    </>,
    "#ffd000",
  );
}

function weave() {
  return frame(
    <>
      <pattern
        id="card-back-weave"
        width="12"
        height="12"
        patternUnits="userSpaceOnUse"
      >
        <rect x="0" y="0" width="6" height="6" fill="#c8a050" />
        <rect x="6" y="6" width="6" height="6" fill="#c8a050" />
        <rect x="6" y="0" width="6" height="6" fill="#8a5a20" />
        <rect x="0" y="6" width="6" height="6" fill="#8a5a20" />
        <line x1="0" y1="3" x2="6" y2="3" stroke="#a07030" />
        <line x1="6" y1="9" x2="12" y2="9" stroke="#a07030" />
        <line x1="9" y1="0" x2="9" y2="6" stroke="#6a4010" />
        <line x1="3" y1="6" x2="3" y2="12" stroke="#6a4010" />
      </pattern>
      <rect
        x="4"
        y="4"
        width={CARD_WIDTH - 8}
        height={CARD_HEIGHT - 8}
        fill="url(#card-back-weave)"
      />
    </>,
    "#8a5a20",
  );
}

function argyle() {
  return frame(
    <>
      <pattern
        id="card-back-argyle"
        width="16"
        height="24"
        patternUnits="userSpaceOnUse"
      >
        <path d="M8 0 L16 12 L8 24 L0 12 Z" fill="#006000" />
        <path
          d="M8 4 L14 12 L8 20 L2 12 Z"
          fill="none"
          stroke="#ff0"
          strokeWidth="0.7"
        />
      </pattern>
      <rect
        x="4"
        y="4"
        width={CARD_WIDTH - 8}
        height={CARD_HEIGHT - 8}
        fill="url(#card-back-argyle)"
      />
    </>,
    "#00a000",
  );
}

export const CARD_BACKS: CardBackDesign[] = [
  {
    name: "Blue diamonds",
    art: diamonds("card-back-blue", "#0000a0", "#6c8cff"),
  },
  {
    name: "Red diamonds",
    art: diamonds("card-back-red", "#a00000", "#ff8c8c"),
  },
  { name: "Fish", art: fish() },
  { name: "Ivy", art: ivy() },
  { name: "Robot", art: robot() },
  { name: "Roses", art: roses() },
  { name: "Shell", art: shell() },
  { name: "Castle", art: castle() },
  { name: "Beach", art: beach() },
  { name: "Hand of cards", art: hand() },
  { name: "Weave", art: weave() },
  { name: "Argyle", art: argyle() },
];
