import type { CSSProperties } from "react";

import { CARD_HEIGHT, CARD_WIDTH } from "./cascade";
import type { Card, Suit } from "./solitaireRules";

/**
 * Card faces come from one sprite sheet (Vector Playing Cards, public
 * domain, rasterised by scripts/vendor-web-games.py): 13 columns ace to
 * king, 4 rows clubs, diamonds, hearts, spades, drawn at twice the 71x96
 * card size. Card backs are drawn here in SVG, in the spirit of the twelve
 * Windows 98 designs without copying them.
 */
export const CARD_SHEET_PATH = "games/solitaire/cards.png";

const SHEET_COLUMNS = 13;
const SHEET_ROWS: Suit[] = ["C", "D", "H", "S"];

/** Where a card sits on the sheet, in 71x96 card units. */
export function spriteOffset(card: Card): { x: number; y: number } {
  return {
    x: (card.rank - 1) * CARD_WIDTH,
    y: SHEET_ROWS.indexOf(card.suit) * CARD_HEIGHT,
  };
}

/** Inline style that shows `card` from the sheet at `sheetUrl`. */
export function faceStyle(card: Card, sheetUrl: string): CSSProperties {
  const offset = spriteOffset(card);
  return {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    backgroundImage: `url("${sheetUrl}")`,
    backgroundSize: `${CARD_WIDTH * SHEET_COLUMNS}px ${CARD_HEIGHT * SHEET_ROWS.length}px`,
    backgroundPosition: `-${offset.x}px -${offset.y}px`,
    backgroundRepeat: "no-repeat",
  };
}
