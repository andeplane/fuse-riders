import * as T from "./tuning.js";

/**
 * The courts: the original's 800 px for one blob a side, a wider one for two a side and a wider still for three. Everything the rules
 * place by x (the walls, the serve, the blobs' limits, the net's pole and its tunnelling guard, the line that clears
 * a side's touches) is measured from the net here, so the wide court plays the narrow one's net exactly. The narrow
 * court's numbers are the exe's (`tuning.ts`); `tests/engine.test.ts` holds them in step.
 */
export interface Court {
  /** Blobs a side on the court at once: 1, 2 or 3. */
  team: 1 | 2 | 3;
  /** Width and the net's line, px. */
  w: number;
  net: number;
  /** The side walls for the ball's centre, ball units. */
  ballLeft: number;
  ballRight: number;
  /** Where a serve hovers, ball units, by side. */
  serveX: readonly [number, number];
  /** Blob centre x limits, px, by side. */
  blobMin: readonly [number, number];
  blobMax: readonly [number, number];
  /** Where each slot's blob starts, px. */
  start: readonly number[];
  /** The net's top point, ball units. */
  netTopX: number;
  /** The pole's band for a ball's near edge, px, and where it puts a ball it turns back, ball units. */
  poleLow: number;
  poleHigh: number;
  polePutLeft: number;
  polePutRight: number;
  /** The tunnelling guard's watched lines, band and put-back positions, ball units. */
  guardLine: number;
  guardMirror: number;
  guardLow: number;
  guardHigh: number;
  guardPutLeft: number;
  guardPutRight: number;
  /** A ball this far past the net clears the other side's touches, ball units. */
  clearLeft: number;
  clearRight: number;
}

export function court(
  team: 1 | 2 | 3,
  w: number,
  start: readonly number[],
): Court {
  const net = w / 2,
    n = net * T.BU;
  return {
    team,
    w,
    net,
    ballLeft: T.BALL_LEFT,
    ballRight: w * T.BU - T.BALL_LEFT,
    serveX: [(w / 4) * T.BU, ((3 * w) / 4) * T.BU],
    blobMin: [0, net + T.NET_GAP],
    blobMax: [net - T.NET_GAP, w],
    start,
    netTopX: n,
    poleLow: net + T.POLE_LOW - T.NET_X,
    poleHigh: net + T.POLE_HIGH - T.NET_X,
    polePutLeft: n + T.POLE_PUT_LEFT - T.NET_X * T.BU,
    polePutRight: n + T.POLE_PUT_RIGHT - T.NET_X * T.BU,
    guardLine: n + T.GUARD_LINE - T.NET_X * T.BU,
    guardMirror: n + (T.NET_X * T.BU - T.GUARD_LINE) + 1,
    guardLow: n + T.GUARD_LOW - T.NET_X * T.BU,
    guardHigh: n + T.GUARD_HIGH - T.NET_X * T.BU,
    guardPutLeft: n + T.GUARD_PUT_LEFT - T.NET_X * T.BU,
    guardPutRight: n + T.GUARD_PUT_RIGHT - T.NET_X * T.BU,
    clearLeft: n + T.CLEAR_LEFT - T.NET_X * T.BU,
    clearRight: n + T.CLEAR_RIGHT - T.NET_X * T.BU,
  };
}

const W = T.TEAM_COURT_W,
  NET = W / 2;
/** One blob a side: the exe's court. */
export const SINGLES = court(1, T.COURT_W, T.BLOB_START);
/** Two blobs a side. Slots alternate sides (0 and 2 left, 1 and 3 right); the first of each pair starts nearer the net. */
export const DOUBLES = court(2, W, [
  NET - T.TEAM_FRONT,
  NET + T.TEAM_FRONT,
  NET - T.TEAM_BACK,
  NET + T.TEAM_BACK,
]);

const W3 = T.TRIPLE_COURT_W,
  NET3 = W3 / 2;
/** Three blobs a side on one big court. Slots alternate sides (0, 2, 4 left; 1, 3, 5 right): front, middle, back. */
export const TRIPLES = court(
  3,
  W3,
  [T.TRIPLE_FRONT, T.TRIPLE_MID, T.TRIPLE_BACK].flatMap((out) => [
    NET3 - out,
    NET3 + out,
  ]),
);

/**
 * The formats a match can have: one, two or three blobs a side, or three teams of two playing king of the court on the
 * doubles court (`KINGS` in `tuning.ts`).
 */
export const FORMATS = ["1v1", "2v2", "3v3", "2v2v2"] as const;
export type Format = (typeof FORMATS)[number];
export const isFormat = (value: unknown): value is Format =>
  FORMATS.some((format) => format === value);
/** Blobs (and seats) a format takes. */
export const blobsFor = (format: Format): number =>
  format === "1v1" ? 2 : format === "2v2" ? 4 : 6;
/** The format two, four or six blobs play by default: six are three a side. */
export const formatFor = (blobs: number): Format =>
  blobs === 6 ? "3v3" : blobs === 4 ? "2v2" : "1v1";

/** The court a format plays on: three teams of two share the doubles court. */
export const courtFor = (format: Format): Court =>
  format === "3v3"
    ? TRIPLES
    : format === "2v2" || format === "2v2v2"
      ? DOUBLES
      : SINGLES;
