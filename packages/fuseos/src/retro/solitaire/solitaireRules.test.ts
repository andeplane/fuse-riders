import type { Card, Location, SolitaireOptions, SolitaireState, Suit } from './solitaireRules';
import {
  ACE,
  DEFAULT_OPTIONS,
  KING,
  VEGAS_STAKE,
  autoMove,
  canDrop,
  canRecycle,
  cardName,
  deal,
  draw,
  foundationFor,
  isRed,
  isWon,
  liftable,
  move,
  orderedDeck,
  scoreText,
  shuffle,
  solitaireReducer,
  tick,
  undo,
} from './solitaireRules';

const T0 = Date.UTC(1998, 5, 25, 12, 0, 0);
const STOCK: Location = { pile: 'stock', index: 0 };
const WASTE: Location = { pile: 'waste', index: 0 };

describe(cardName.name, () => {
  it('names aces, numbers and court cards with their suit', () => {
    expect(cardName(card('S', ACE))).toBe('Ace of spades');
    expect(cardName(card('H', 10))).toBe('10 of hearts');
    expect(cardName(card('D', KING))).toBe('King of diamonds');
  });
});

describe(isRed.name, () => {
  it('colours hearts and diamonds red, clubs and spades black', () => {
    expect(isRed('H')).toBe(true);
    expect(isRed('D')).toBe(true);
    expect(isRed('C')).toBe(false);
    expect(isRed('S')).toBe(false);
  });
});

describe(shuffle.name, () => {
  it('keeps every card exactly once and depends on the injected random', () => {
    const deck = orderedDeck();
    expect(deck).toHaveLength(52);
    const shuffled = shuffle(deck, sequence());
    expect(shuffled).toHaveLength(52);
    expect(new Set(shuffled.map((c) => c.suit + c.rank)).size).toBe(52);
    expect(shuffled).not.toEqual(deck);
    expect(shuffle(deck, () => 0)).not.toEqual(shuffled);
    expect(shuffle(deck, () => 0.999999)).toEqual(deck);
  });
});

describe(deal.name, () => {
  it('lays out seven columns of one to seven cards with the top face up and 24 on the stock', () => {
    const state = deal(DEFAULT_OPTIONS, sequence());
    expect(state.tableau.map((pile) => pile.length)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    state.tableau.forEach((pile) => {
      pile.forEach((c, i) => expect(c.faceUp).toBe(i === pile.length - 1));
    });
    expect(state.stock).toHaveLength(24);
    expect(state.stock.every((c) => !c.faceUp)).toBe(true);
    expect(state.waste).toEqual([]);
    expect(state.foundations).toEqual([[], [], [], []]);
    expect(state.status).toBe('ready');
    expect(state.score).toBe(0);
    expect(state.elapsed).toBe(0);
  });

  it('starts Vegas games 52 dollars down and keeps the chosen card back', () => {
    const state = deal({ ...DEFAULT_OPTIONS, scoring: 'vegas' }, sequence(), 7);
    expect(state.score).toBe(VEGAS_STAKE);
    expect(state.cardBack).toBe(7);
    expect(scoreText(state)).toBe('$-52');
  });
});

describe(draw.name, () => {
  it('turns three cards onto the waste, the last drawn on top, and starts the clock', () => {
    const state = deal(DEFAULT_OPTIONS, sequence());
    const drawn = state.stock.slice(-3);
    expect(drawn).toHaveLength(3);
    const next = draw(state, T0);
    expect(next.stock).toHaveLength(21);
    expect(next.waste.map(strip)).toEqual([...drawn].reverse().map(strip));
    expect(next.waste.every((x) => x.faceUp)).toBe(true);
    expect(next.fanned).toBe(3);
    expect(next.status).toBe('playing');
    expect(next.startedAt).toBe(T0);
  });

  it('turns one card when drawing one and what is left when the stock runs short', () => {
    const state = deal({ ...DEFAULT_OPTIONS, draw: 1 }, sequence());
    expect(draw(state, T0).waste).toHaveLength(1);
    const short: SolitaireState = { ...deal(DEFAULT_OPTIONS, sequence()), stock: state.stock.slice(0, 2) };
    const next = draw(short, T0);
    expect(next.waste).toHaveLength(2);
    expect(next.fanned).toBe(2);
    expect(next.stock).toEqual([]);
  });

  it('puts the waste back on the stock face down in order when the stock is empty', () => {
    let state = deal({ ...DEFAULT_OPTIONS, draw: 1, scoring: 'none' }, sequence());
    const order = [...state.stock].reverse().map(strip);
    for (let i = 0; i < 24; i += 1) state = draw(state, T0);
    expect(state.stock).toEqual([]);
    expect(state.waste.map(strip)).toEqual(order);
    const recycled = draw(state, T0);
    expect(recycled.waste).toEqual([]);
    expect(recycled.stock.every((c) => !c.faceUp)).toBe(true);
    expect(recycled.stock.map(strip)).toEqual([...order].reverse());
    expect(recycled.passes).toBe(1);
    expect(draw(recycled, T0).waste.map(strip)).toEqual([order[0]]);
  });

  it('charges 100 per pass drawing one and 20 from the fifth pass drawing three in Standard scoring', () => {
    const base = { ...deal(DEFAULT_OPTIONS, sequence()), score: 500, stock: [], waste: [card('S', 5, true)] };
    expect(draw({ ...base, options: { ...DEFAULT_OPTIONS, draw: 1 } }, T0).score).toBe(400);
    expect(draw({ ...base, passes: 2 }, T0).score).toBe(500);
    expect(draw({ ...base, passes: 3 }, T0).score).toBe(480);
    expect(draw({ ...base, options: { ...DEFAULT_OPTIONS, draw: 1 }, score: 30 }, T0).score).toBe(0);
  });

  it('limits Vegas to one pass drawing one and three passes drawing three', () => {
    const vegas: SolitaireOptions = { draw: 1, scoring: 'vegas', timed: false };
    const base = { ...deal(vegas, sequence()), stock: [], waste: [card('S', 5, true)] };
    expect(canRecycle(base)).toBe(false);
    expect(draw(base, T0)).toBe(base);
    const three = { ...base, options: { ...vegas, draw: 3 as const } };
    expect(canRecycle(three)).toBe(true);
    expect(canRecycle({ ...three, passes: 1 })).toBe(true);
    expect(canRecycle({ ...three, passes: 2 })).toBe(false);
    expect(canRecycle({ ...three, waste: [] })).toBe(false);
  });

  it('does nothing once the game is won', () => {
    const state = { ...deal(DEFAULT_OPTIONS, sequence()), status: 'won' as const };
    expect(draw(state, T0)).toBe(state);
  });
});

describe(liftable.name, () => {
  it('lifts face up runs from a column, only the top of waste and foundations, nothing from the stock', () => {
    const state = withTableau(deal(DEFAULT_OPTIONS, sequence()), 0, [card('S', 9, false), card('H', 8), card('C', 7)]);
    expect(liftable(state, { pile: 'tableau', index: 0 }, 2).map(strip)).toEqual([card('H', 8), card('C', 7)]);
    expect(liftable(state, { pile: 'tableau', index: 0 }, 3)).toEqual([]);
    expect(liftable(state, { pile: 'tableau', index: 0 }, 4)).toEqual([]);
    expect(liftable(state, STOCK, 1)).toEqual([]);
    const withWaste = { ...state, waste: [card('D', 2, true), card('D', 3, true)] };
    expect(liftable(withWaste, WASTE, 1).map(strip)).toEqual([card('D', 3)]);
    expect(liftable(withWaste, WASTE, 2)).toEqual([]);
  });
});

describe(canDrop.name, () => {
  const state = deal(DEFAULT_OPTIONS, sequence());

  it('builds foundations up by suit from the ace, one card at a time', () => {
    const empty: Location = { pile: 'foundation', index: 0 };
    expect(canDrop(state, [card('S', ACE)], empty)).toBe(true);
    expect(canDrop(state, [card('S', 2)], empty)).toBe(false);
    const withAce = { ...state, foundations: [[card('S', ACE, true)], [], [], []] };
    expect(canDrop(withAce, [card('S', 2)], empty)).toBe(true);
    expect(canDrop(withAce, [card('H', 2)], empty)).toBe(false);
    expect(canDrop(withAce, [card('S', 2), card('S', 3)], empty)).toBe(false);
  });

  it('builds columns down in alternating colours and only kings on empty columns', () => {
    const column = withTableau(state, 0, [card('H', 8, true)]);
    const target: Location = { pile: 'tableau', index: 0 };
    expect(canDrop(column, [card('S', 7)], target)).toBe(true);
    expect(canDrop(column, [card('S', 7), card('D', 6)], target)).toBe(true);
    expect(canDrop(column, [card('D', 7)], target)).toBe(false);
    expect(canDrop(column, [card('S', 6)], target)).toBe(false);
    const empty = withTableau(state, 0, []);
    expect(canDrop(empty, [card('C', KING)], target)).toBe(true);
    expect(canDrop(empty, [card('C', 5)], target)).toBe(false);
    expect(canDrop(empty, [], target)).toBe(false);
    expect(canDrop(empty, [card('C', 5)], STOCK)).toBe(false);
    expect(canDrop(empty, [card('C', 5)], WASTE)).toBe(false);
  });
});

describe(move.name, () => {
  it('scores waste to column 5, anything to a foundation 10 and a turned card 5, and refuses illegal moves', () => {
    let state = withTableau(deal(DEFAULT_OPTIONS, sequence()), 0, [card('S', 9, false), card('H', 8)]);
    state = withTableau(state, 1, [card('S', 8)]);
    state = { ...state, waste: [card('C', 7)], fanned: 1 };
    const toColumn = move(state, WASTE, 1, { pile: 'tableau', index: 0 }, T0);
    expect(toColumn.tableau[0]?.map(strip)).toEqual([card('S', 9), card('H', 8), card('C', 7)]);
    expect(toColumn.waste).toEqual([]);
    expect(toColumn.score).toBe(5);
    expect(toColumn.status).toBe('playing');

    const illegal = move(state, WASTE, 1, { pile: 'tableau', index: 1 }, T0);
    expect(illegal).toBe(state);

    const withAce = withTableau(state, 1, [card('D', 4, false), card('H', ACE)]);
    const toFoundation = move(withAce, { pile: 'tableau', index: 1 }, 1, { pile: 'foundation', index: 2 }, T0);
    expect(toFoundation.foundations[2]?.map(strip)).toEqual([card('H', ACE)]);
    // The four of diamonds is turned over: 10 for the foundation plus 5 for the turn.
    expect(toFoundation.tableau[1]).toEqual([card('D', 4, true)]);
    expect(toFoundation.score).toBe(15);
  });

  it('moves whole runs between columns and charges 15 for taking a card back off a foundation', () => {
    let state = withTableau(deal(DEFAULT_OPTIONS, sequence()), 0, [card('S', 9, true), card('H', 8, true), card('C', 7, true)]);
    state = withTableau(state, 1, [card('D', 10, true)]);
    const run = move(state, { pile: 'tableau', index: 0 }, 3, { pile: 'tableau', index: 1 }, T0);
    expect(run.tableau[1]?.map(strip)).toEqual([card('D', 10), card('S', 9), card('H', 8), card('C', 7)]);
    expect(run.tableau[0]).toEqual([]);
    expect(run.score).toBe(0);

    const withFoundation = { ...withTableau(state, 1, [card('H', 3)]), score: 100, foundations: [[card('S', ACE), card('S', 2)], [], [], []] };
    const back = move(withFoundation, { pile: 'foundation', index: 0 }, 1, { pile: 'tableau', index: 1 }, T0);
    expect(back.score).toBe(85);
    expect(back.foundations[0]?.map(strip)).toEqual([card('S', ACE)]);
    // Vegas pays 5 per foundation card and takes it back.
    const vegas = { ...withFoundation, options: { ...DEFAULT_OPTIONS, scoring: 'vegas' as const }, score: -40 };
    expect(move(vegas, { pile: 'foundation', index: 0 }, 1, { pile: 'tableau', index: 1 }, T0).score).toBe(-45);
    expect(move({ ...vegas, waste: [card('D', 9, true)] }, WASTE, 1, { pile: 'tableau', index: 1 }, T0).score).toBe(-40);
    expect(move({ ...vegas, waste: [card('H', ACE, true)] }, WASTE, 1, { pile: 'foundation', index: 1 }, T0).score).toBe(-35);
  });

  it('wins when the last card reaches a foundation and adds the time bonus in a timed Standard game', () => {
    const state = { ...almostWon(), startedAt: T0, elapsed: 60, score: 100 };
    const won = move(state, WASTE, 1, { pile: 'foundation', index: 3 }, T0 + 70000);
    expect(isWon(won)).toBe(true);
    expect(won.status).toBe('won');
    expect(won.elapsed).toBe(70);
    expect(won.score).toBe(100 + 10 + Math.floor(700000 / 70));
    const quick = move({ ...state, elapsed: 0 }, WASTE, 1, { pile: 'foundation', index: 3 }, T0 + 20000);
    expect(quick.score).toBe(110);
    const untimed = move({ ...state, options: { ...DEFAULT_OPTIONS, timed: false } }, WASTE, 1, { pile: 'foundation', index: 3 }, T0 + 70000);
    expect(untimed.score).toBe(110);
  });
});

describe(foundationFor.name, () => {
  it('finds the foundation a top card fits and double click moves it there', () => {
    const state = { ...deal(DEFAULT_OPTIONS, sequence()), waste: [card('C', ACE, true)], fanned: 1, foundations: [[card('S', ACE, true)], [], [], []] };
    expect(foundationFor(state, WASTE)).toEqual({ pile: 'foundation', index: 1 });
    expect(foundationFor({ ...state, waste: [card('C', 5, true)] }, WASTE)).toBeUndefined();
    expect(foundationFor(state, STOCK)).toBeUndefined();
    const moved = autoMove(state, WASTE, T0);
    expect(moved.foundations[1]?.map(strip)).toEqual([card('C', ACE)]);
    expect(moved.score).toBe(10);
    expect(autoMove({ ...state, waste: [card('C', 5, true)] }, WASTE, T0).waste.map(strip)).toEqual([card('C', 5)]);
  });
});

describe(tick.name, () => {
  it('counts whole seconds while playing and takes two points every ten seconds in timed Standard games', () => {
    const state = { ...draw(deal(DEFAULT_OPTIONS, sequence()), T0), score: 50 };
    expect(tick(state, T0 + 900)).toBe(state);
    const nine = tick(state, T0 + 9500);
    expect(nine.elapsed).toBe(9);
    expect(nine.score).toBe(50);
    const twenty = tick(nine, T0 + 21000);
    expect(twenty.elapsed).toBe(21);
    expect(twenty.score).toBe(46);
    expect(twenty.penalties).toBe(2);
    expect(tick(twenty, T0 + 22000).score).toBe(46);
  });

  it('ignores the clock before the first move, when untimed, in Vegas and after winning', () => {
    const ready = deal(DEFAULT_OPTIONS, sequence());
    expect(tick(ready, T0 + 5000)).toBe(ready);
    const untimed = draw(deal({ ...DEFAULT_OPTIONS, timed: false }, sequence()), T0);
    expect(tick(untimed, T0 + 5000)).toBe(untimed);
    const vegas = draw(deal({ ...DEFAULT_OPTIONS, scoring: 'vegas' }, sequence()), T0);
    expect(tick(vegas, T0 + 15000).score).toBe(VEGAS_STAKE);
    expect(tick(vegas, T0 + 15000).elapsed).toBe(15);
    const won = { ...draw(ready, T0), status: 'won' as const };
    expect(tick(won, T0 + 5000)).toBe(won);
  });
});

describe(undo.name, () => {
  it('takes back the last move only, once', () => {
    const state = deal(DEFAULT_OPTIONS, sequence());
    const drawn = draw(state, T0);
    const twice = draw(drawn, T0);
    const undone = undo(twice);
    expect(undone.waste).toEqual(drawn.waste);
    expect(undone.previous).toBeUndefined();
    expect(undo(undone)).toBe(undone);
    expect(undo(state)).toBe(state);
  });
});

describe(solitaireReducer.name, () => {
  it('forwards every action and redeals with new options or the same card back', () => {
    const state = deal(DEFAULT_OPTIONS, sequence(), 3);
    expect(solitaireReducer(state, { type: 'draw', now: T0 }).waste).toHaveLength(3);
    const options: SolitaireOptions = { draw: 1, scoring: 'none', timed: false };
    const redealt = solitaireReducer(state, { type: 'setOptions', options, random: sequence() });
    expect(redealt.options).toEqual(options);
    expect(redealt.cardBack).toBe(3);
    expect(solitaireReducer(state, { type: 'setCardBack', cardBack: 9 }).cardBack).toBe(9);
    const dealt = solitaireReducer(draw(state, T0), { type: 'deal', random: sequence(7) });
    expect(dealt.waste).toEqual([]);
    expect(dealt.status).toBe('ready');
    expect(solitaireReducer(draw(state, T0), { type: 'undo' }).waste).toEqual([]);
    expect(solitaireReducer(draw(state, T0), { type: 'tick', now: T0 + 3000 }).elapsed).toBe(3);
    const withAce = { ...state, waste: [card('H', ACE, true)], fanned: 1 };
    expect(solitaireReducer(withAce, { type: 'autoMove', from: WASTE, now: T0 }).foundations[0]).toHaveLength(1);
    expect(solitaireReducer(withAce, { type: 'move', from: WASTE, count: 1, to: { pile: 'foundation', index: 2 }, now: T0 }).foundations[2]).toHaveLength(1);
  });
});

function card(suit: Suit, rank: number, faceUp = true): Card {
  return { suit, rank, faceUp };
}

function strip(c: Card): Card {
  return { suit: c.suit, rank: c.rank, faceUp: true };
}

function sequence(seed = 1): () => number {
  let value = seed;
  return () => {
    value = (value * 9301 + 49297) % 233280;
    return value / 233280;
  };
}

function withTableau(state: SolitaireState, index: number, cards: Card[]): SolitaireState {
  return { ...state, tableau: state.tableau.map((pile, i) => (i === index ? cards : pile)) };
}

/** Every card on the foundations except the king of spades, which sits on the waste. */
function almostWon(): SolitaireState {
  const foundations = (['C', 'D', 'H', 'S'] as const).map((suit) => Array.from({ length: suit === 'S' ? 12 : 13 }, (_, i) => card(suit, i + 1)));
  return {
    ...deal(DEFAULT_OPTIONS, sequence()),
    status: 'playing',
    stock: [],
    waste: [card('S', KING)],
    fanned: 1,
    foundations,
    tableau: [[], [], [], [], [], [], []],
  };
}
