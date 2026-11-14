import { CARD_HEIGHT, CARD_WIDTH } from './cascade';
import type { Card, Location, SolitaireState } from './solitaireRules';
import { canDrop } from './solitaireRules';

/** Table geometry in pixels, the way Windows 98 spaced its 71x96 cards. */
export const TABLE_LEFT = 10;
export const TABLE_TOP = 8;
export const COLUMN_PITCH = 82;
export const TABLEAU_TOP = TABLE_TOP + CARD_HEIGHT + 12;
export const FACE_DOWN_STEP = 3;
export const FACE_UP_STEP = 16;
export const WASTE_FAN_STEP = 14;
export const TABLE_WIDTH = TABLE_LEFT * 2 + COLUMN_PITCH * 6 + CARD_WIDTH;

export type Rect = { x: number; y: number; width: number; height: number };

export function columnX(column: number): number {
  return TABLE_LEFT + column * COLUMN_PITCH;
}

export const STOCK_POSITION = { x: columnX(0), y: TABLE_TOP };
export const WASTE_POSITION = { x: columnX(1), y: TABLE_TOP };

export function foundationPosition(index: number): { x: number; y: number } {
  return { x: columnX(3 + index), y: TABLE_TOP };
}

/** Top edge of card `index` in a tableau column: face down cards peek 3px, face up ones 16px. */
export function tableauCardY(pile: Card[], index: number): number {
  let y = TABLEAU_TOP;
  for (let i = 0; i < index; i += 1) y += pile[i]?.faceUp ? FACE_UP_STEP : FACE_DOWN_STEP;
  return y;
}

/** Cards of the waste that are shown, fanned to the right; only the last one can move. */
export function wasteFan(state: SolitaireState): { card: Card; x: number }[] {
  const shown = Math.max(1, Math.min(state.fanned, state.waste.length, 3));
  const cards = state.waste.slice(state.waste.length - shown);
  return cards.map((card, i) => ({ card, x: WASTE_POSITION.x + i * WASTE_FAN_STEP }));
}

/** Where a run of `count` cards picked up from `from` sits on the table. */
export function runOrigin(state: SolitaireState, from: Location, count: number): { x: number; y: number } {
  switch (from.pile) {
    case 'stock':
      return STOCK_POSITION;
    case 'waste': {
      const fan = wasteFan(state);
      return { x: fan[fan.length - 1]?.x ?? WASTE_POSITION.x, y: WASTE_POSITION.y };
    }
    case 'foundation':
      return foundationPosition(from.index);
    case 'tableau': {
      const pile = state.tableau[from.index] ?? [];
      return { x: columnX(from.index), y: tableauCardY(pile, pile.length - count) };
    }
  }
}

export function runHeight(count: number): number {
  return CARD_HEIGHT + Math.max(0, count - 1) * FACE_UP_STEP;
}

function columnRect(state: SolitaireState, column: number): Rect {
  const pile = state.tableau[column] ?? [];
  const bottom = pile.length === 0 ? TABLEAU_TOP + CARD_HEIGHT : tableauCardY(pile, pile.length - 1) + CARD_HEIGHT;
  return { x: columnX(column), y: TABLEAU_TOP, width: CARD_WIDTH, height: bottom - TABLEAU_TOP };
}

function overlap(a: Rect, b: Rect): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

/** The legal pile under a dropped run, chosen by the largest overlap, if any. */
export function dropTarget(state: SolitaireState, cards: Card[], dropped: Rect): Location | undefined {
  const candidates: { location: Location; rect: Rect }[] = [
    ...state.foundations.map((_, index) => ({ location: { pile: 'foundation' as const, index }, rect: { ...foundationPosition(index), width: CARD_WIDTH, height: CARD_HEIGHT } })),
    ...state.tableau.map((_, index) => ({ location: { pile: 'tableau' as const, index }, rect: columnRect(state, index) })),
  ];
  let best: { location: Location; area: number } | undefined;
  candidates.forEach(({ location, rect }) => {
    const area = overlap(dropped, rect);
    if (area > 0 && (!best || area > best.area) && canDrop(state, cards, location)) best = { location, area };
  });
  return best?.location;
}
