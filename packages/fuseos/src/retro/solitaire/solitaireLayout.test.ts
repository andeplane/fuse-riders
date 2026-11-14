import { CARD_HEIGHT, CARD_WIDTH } from './cascade';
import {
  COLUMN_PITCH,
  FACE_DOWN_STEP,
  FACE_UP_STEP,
  STOCK_POSITION,
  TABLEAU_TOP,
  TABLE_LEFT,
  TABLE_TOP,
  TABLE_WIDTH,
  WASTE_FAN_STEP,
  WASTE_POSITION,
  columnX,
  dropTarget,
  foundationPosition,
  runHeight,
  runOrigin,
  tableauCardY,
  wasteFan,
} from './solitaireLayout';
import type { Card, SolitaireState, Suit } from './solitaireRules';
import { DEFAULT_OPTIONS, deal } from './solitaireRules';

describe('table geometry', () => {
  it('spaces seven columns of 71px cards and puts the stock, waste and foundations on the top row', () => {
    expect(columnX(0)).toBe(TABLE_LEFT);
    expect(columnX(6)).toBe(TABLE_LEFT + 6 * COLUMN_PITCH);
    expect(TABLE_WIDTH).toBe(TABLE_LEFT * 2 + 6 * COLUMN_PITCH + CARD_WIDTH);
    expect(STOCK_POSITION).toEqual({ x: columnX(0), y: TABLE_TOP });
    expect(WASTE_POSITION).toEqual({ x: columnX(1), y: TABLE_TOP });
    expect(foundationPosition(0)).toEqual({ x: columnX(3), y: TABLE_TOP });
    expect(foundationPosition(3)).toEqual({ x: columnX(6), y: TABLE_TOP });
    expect(TABLEAU_TOP).toBeGreaterThan(TABLE_TOP + CARD_HEIGHT);
  });
});

describe(tableauCardY.name, () => {
  it('peeks face down cards a little and face up cards enough to read them', () => {
    const pile = [card('S', 9, false), card('H', 8, false), card('C', 7), card('D', 6)];
    expect(tableauCardY(pile, 0)).toBe(TABLEAU_TOP);
    expect(tableauCardY(pile, 1)).toBe(TABLEAU_TOP + FACE_DOWN_STEP);
    expect(tableauCardY(pile, 2)).toBe(TABLEAU_TOP + 2 * FACE_DOWN_STEP);
    expect(tableauCardY(pile, 3)).toBe(TABLEAU_TOP + 2 * FACE_DOWN_STEP + FACE_UP_STEP);
    expect(runHeight(1)).toBe(CARD_HEIGHT);
    expect(runHeight(3)).toBe(CARD_HEIGHT + 2 * FACE_UP_STEP);
  });
});

describe(wasteFan.name, () => {
  it('fans the cards of the last draw, at most three, and always shows the top card', () => {
    const state = { ...blank(), waste: [card('S', 2), card('S', 3), card('S', 4), card('S', 5)], fanned: 3 };
    expect(wasteFan(state).map((entry) => entry.card.rank)).toEqual([3, 4, 5]);
    expect(wasteFan(state).map((entry) => entry.x)).toEqual([WASTE_POSITION.x, WASTE_POSITION.x + WASTE_FAN_STEP, WASTE_POSITION.x + 2 * WASTE_FAN_STEP]);
    expect(wasteFan({ ...state, fanned: 0 }).map((entry) => entry.card.rank)).toEqual([5]);
    expect(wasteFan({ ...state, waste: [card('S', 2)], fanned: 3 }).map((entry) => entry.card.rank)).toEqual([2]);
    expect(wasteFan({ ...state, waste: [] })).toEqual([]);
  });
});

describe(runOrigin.name, () => {
  it('locates the run being picked up on the stock, the waste fan, a foundation or a column', () => {
    const state = { ...blank(), waste: [card('S', 2), card('S', 3)], fanned: 2, tableau: [[card('S', 9, false), card('H', 8), card('C', 7)], [], [], [], [], [], []] };
    expect(runOrigin(state, { pile: 'stock', index: 0 }, 1)).toEqual(STOCK_POSITION);
    expect(runOrigin(state, { pile: 'waste', index: 0 }, 1)).toEqual({ x: WASTE_POSITION.x + WASTE_FAN_STEP, y: WASTE_POSITION.y });
    expect(runOrigin({ ...state, waste: [] }, { pile: 'waste', index: 0 }, 1)).toEqual(WASTE_POSITION);
    expect(runOrigin(state, { pile: 'foundation', index: 2 }, 1)).toEqual(foundationPosition(2));
    expect(runOrigin(state, { pile: 'tableau', index: 0 }, 2)).toEqual({ x: columnX(0), y: TABLEAU_TOP + FACE_DOWN_STEP });
  });
});

describe(dropTarget.name, () => {
  const state: SolitaireState = {
    ...blank(),
    foundations: [[card('S', 1)], [], [], []],
    tableau: [[card('H', 8)], [card('C', 8)], [], [card('D', 3, false), card('S', 2)], [], [], []],
  };

  it('picks the legal pile with the most overlap under the dropped run', () => {
    const seven = [card('S', 7)];
    expect(dropTarget(state, seven, { x: columnX(0) + 20, y: TABLEAU_TOP + 30, width: CARD_WIDTH, height: CARD_HEIGHT })).toEqual({ pile: 'tableau', index: 0 });
    // Mostly over column 2 (same colour, illegal) but touching column 1: the legal one wins.
    expect(dropTarget(state, seven, { x: columnX(1) - 30, y: TABLEAU_TOP, width: CARD_WIDTH, height: CARD_HEIGHT })).toEqual({ pile: 'tableau', index: 0 });
    expect(dropTarget(state, [card('S', 2)], { x: foundationPosition(0).x + 10, y: TABLE_TOP + 10, width: CARD_WIDTH, height: CARD_HEIGHT })).toEqual({ pile: 'foundation', index: 0 });
    expect(dropTarget(state, [card('H', 2)], { x: foundationPosition(0).x + 10, y: TABLE_TOP + 10, width: CARD_WIDTH, height: CARD_HEIGHT })).toBeUndefined();
    expect(dropTarget(state, [card('K', 13)], { x: columnX(2), y: TABLEAU_TOP, width: CARD_WIDTH, height: CARD_HEIGHT })).toEqual({ pile: 'tableau', index: 2 });
  });

  it('accepts a drop lower down a long column and ignores empty space', () => {
    const long = { ...state, tableau: state.tableau.map((pile, i) => (i === 0 ? [card('S', 13, false), card('S', 12, false), card('H', 8)] : pile)) };
    expect(dropTarget(long, [card('S', 7)], { x: columnX(0), y: TABLEAU_TOP + 80, width: CARD_WIDTH, height: CARD_HEIGHT })).toEqual({ pile: 'tableau', index: 0 });
    expect(dropTarget(long, [card('S', 7)], { x: columnX(0), y: TABLEAU_TOP + 400, width: CARD_WIDTH, height: CARD_HEIGHT })).toBeUndefined();
    expect(dropTarget(long, [], { x: columnX(0), y: TABLEAU_TOP, width: CARD_WIDTH, height: CARD_HEIGHT })).toBeUndefined();
  });
});

function card(suit: Suit | 'K', rank: number, faceUp = true): Card {
  return { suit: suit === 'K' ? 'S' : suit, rank, faceUp };
}

function blank(): SolitaireState {
  return { ...deal(DEFAULT_OPTIONS, () => 0), stock: [], waste: [], fanned: 0, foundations: [[], [], [], []], tableau: [[], [], [], [], [], [], []] };
}
