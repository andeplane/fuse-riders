/**
 * Klondike as Windows 98 Solitaire plays it: draw one or three, Standard,
 * Vegas or no scoring, an optional timer, one level of Undo. Pure functions
 * over an immutable state; randomness and the clock are passed in.
 */

export type Suit = 'C' | 'D' | 'H' | 'S';

/** 1 is the ace, 11 to 13 are jack, queen and king. */
export type Card = { suit: Suit; rank: number; faceUp: boolean };

export type PileKind = 'stock' | 'waste' | 'foundation' | 'tableau';

/** `index` is 0 for the stock and the waste, 0-3 for foundations and 0-6 for tableau columns. */
export type Location = { pile: PileKind; index: number };

export type DrawCount = 1 | 3;

export type Scoring = 'standard' | 'vegas' | 'none';

export type SolitaireOptions = { draw: DrawCount; scoring: Scoring; timed: boolean };

export type SolitaireStatus = 'ready' | 'playing' | 'won';

export type SolitaireState = {
  options: SolitaireOptions;
  /** Index into CARD_BACKS. */
  cardBack: number;
  /** Face down; the last card is the one drawn next. */
  stock: Card[];
  /** Face up; the last card is on top and the only one that can move. */
  waste: Card[];
  /** How many of the top waste cards the last draw turned; drawn three are shown fanned. */
  fanned: number;
  foundations: Card[][];
  tableau: Card[][];
  score: number;
  /** Times the waste went back onto the stock. */
  passes: number;
  status: SolitaireStatus;
  startedAt?: number;
  /** Whole seconds since the first move. */
  elapsed: number;
  /** Ten second periods already charged in timed Standard scoring. */
  penalties: number;
  previous?: SolitaireState;
};

export type SolitaireAction =
  | { type: 'deal'; random: () => number }
  | { type: 'draw'; now: number }
  | { type: 'move'; from: Location; count: number; to: Location; now: number }
  | { type: 'autoMove'; from: Location; now: number }
  | { type: 'tick'; now: number }
  | { type: 'setOptions'; options: SolitaireOptions; random: () => number }
  | { type: 'setCardBack'; cardBack: number }
  | { type: 'undo' };

export const SUITS: Suit[] = ['C', 'D', 'H', 'S'];
export const KING = 13;
export const ACE = 1;
export const DEFAULT_OPTIONS: SolitaireOptions = { draw: 3, scoring: 'standard', timed: true };
export const VEGAS_STAKE = -52;

const RANK_NAMES = ['Ace', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'Jack', 'Queen', 'King'];
const SUIT_NAMES: Record<Suit, string> = { C: 'clubs', D: 'diamonds', H: 'hearts', S: 'spades' };

export function isRed(suit: Suit): boolean {
  return suit === 'D' || suit === 'H';
}

/** "Ace of spades", the way a screen reader should say it. */
export function cardName(card: Card): string {
  return `${RANK_NAMES[card.rank - 1]} of ${SUIT_NAMES[card.suit]}`;
}

export function sameCard(a: Card, b: Card): boolean {
  return a.suit === b.suit && a.rank === b.rank;
}

export function orderedDeck(): Card[] {
  return SUITS.flatMap((suit) => Array.from({ length: KING }, (_, i) => ({ suit, rank: i + 1, faceUp: false })));
}

/** Fisher-Yates with an injected uniform random in [0, 1). */
export function shuffle<T>(items: T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.min(i, Math.floor(random() * (i + 1)));
    // i counts down from length - 1 and j is clamped to i, so both indexes are in bounds.
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

function startingScore(options: SolitaireOptions): number {
  return options.scoring === 'vegas' ? VEGAS_STAKE : 0;
}

/** A fresh game: seven columns of one to seven cards, the top one face up, the rest on the stock. */
export function deal(options: SolitaireOptions, random: () => number, cardBack = 0): SolitaireState {
  const deck = shuffle(orderedDeck(), random);
  const tableau: Card[][] = [];
  let next = 0;
  for (let column = 0; column < 7; column += 1) {
    const cards = deck.slice(next, next + column + 1).map((card, i) => ({ ...card, faceUp: i === column }));
    tableau.push(cards);
    next += column + 1;
  }
  return {
    options,
    cardBack,
    stock: deck.slice(next),
    waste: [],
    fanned: 0,
    foundations: [[], [], [], []],
    tableau,
    score: startingScore(options),
    passes: 0,
    status: 'ready',
    elapsed: 0,
    penalties: 0,
  };
}

export function pileAt(state: SolitaireState, location: Location): Card[] {
  switch (location.pile) {
    case 'stock':
      return state.stock;
    case 'waste':
      return state.waste;
    case 'foundation':
      return state.foundations[location.index] ?? [];
    case 'tableau':
      return state.tableau[location.index] ?? [];
  }
}

function top(pile: Card[]): Card | undefined {
  return pile[pile.length - 1];
}

/** The face-up run a drag may pick up from `location`: `count` cards from the top. Empty when the drag is not allowed. */
export function liftable(state: SolitaireState, location: Location, count: number): Card[] {
  const pile = pileAt(state, location);
  if (count < 1 || count > pile.length) return [];
  if (location.pile === 'stock') return [];
  if (location.pile !== 'tableau' && count !== 1) return [];
  const cards = pile.slice(pile.length - count);
  return cards.every((card) => card.faceUp) ? cards : [];
}

/** Whether the run `cards` may be put down on `target`. */
export function canDrop(state: SolitaireState, cards: Card[], target: Location): boolean {
  const first = cards[0];
  if (!first) return false;
  const targetTop = top(pileAt(state, target));
  if (target.pile === 'foundation') {
    if (cards.length !== 1) return false;
    return targetTop ? targetTop.suit === first.suit && targetTop.rank === first.rank - 1 : first.rank === ACE;
  }
  if (target.pile === 'tableau') {
    return targetTop ? isRed(targetTop.suit) !== isRed(first.suit) && targetTop.rank === first.rank + 1 : first.rank === KING;
  }
  return false;
}

export function isWon(state: SolitaireState): boolean {
  return state.foundations.every((pile) => pile.length === KING);
}

function clampScore(state: SolitaireState, score: number): number {
  return state.options.scoring === 'standard' ? Math.max(0, score) : score;
}

function addScore(state: SolitaireState, points: number): SolitaireState {
  if (state.options.scoring === 'none') return state;
  return { ...state, score: clampScore(state, state.score + points) };
}

/** Records the state for Undo and starts the clock on the first move. */
function beginMove(state: SolitaireState, now: number): SolitaireState {
  const previous = { ...state, previous: undefined };
  if (state.status === 'ready') return { ...state, status: 'playing', startedAt: now, previous };
  return { ...state, previous };
}

/** Recycling the waste is limited in Vegas: one pass drawing one, three passes drawing three. */
export function canRecycle(state: SolitaireState): boolean {
  if (state.waste.length === 0) return false;
  if (state.options.scoring !== 'vegas') return true;
  return state.passes < (state.options.draw === 1 ? 0 : 2);
}

/** Turns the next one or three cards from the stock, or puts the waste back when the stock is empty. */
export function draw(state: SolitaireState, now: number): SolitaireState {
  if (state.status === 'won') return state;
  if (state.stock.length > 0) {
    const next = beginMove(state, now);
    const count = Math.min(next.options.draw, next.stock.length);
    const turned = next.stock.slice(next.stock.length - count).reverse().map((card) => ({ ...card, faceUp: true }));
    return { ...next, stock: next.stock.slice(0, next.stock.length - count), waste: [...next.waste, ...turned], fanned: count };
  }
  if (!canRecycle(state)) return state;
  const next = beginMove(state, now);
  const passes = next.passes + 1;
  const recycled: SolitaireState = { ...next, stock: [...next.waste].reverse().map((card) => ({ ...card, faceUp: false })), waste: [], fanned: 0, passes };
  if (recycled.options.scoring !== 'standard') return recycled;
  if (recycled.options.draw === 1) return addScore(recycled, -100);
  return passes >= 4 ? addScore(recycled, -20) : recycled;
}

function replacePile(state: SolitaireState, location: Location, cards: Card[]): SolitaireState {
  switch (location.pile) {
    case 'stock':
      return { ...state, stock: cards };
    case 'waste':
      return { ...state, waste: cards, fanned: Math.min(state.fanned, cards.length) };
    case 'foundation':
      return { ...state, foundations: state.foundations.map((pile, i) => (i === location.index ? cards : pile)) };
    case 'tableau':
      return { ...state, tableau: state.tableau.map((pile, i) => (i === location.index ? cards : pile)) };
  }
}

function movePoints(state: SolitaireState, from: PileKind, to: PileKind): number {
  if (state.options.scoring === 'vegas') {
    if (to === 'foundation' && from !== 'foundation') return 5;
    if (from === 'foundation' && to !== 'foundation') return -5;
    return 0;
  }
  if (to === 'foundation' && from !== 'foundation') return 10;
  if (from === 'waste' && to === 'tableau') return 5;
  if (from === 'foundation' && to === 'tableau') return -15;
  return 0;
}

function winBonus(state: SolitaireState): number {
  if (state.options.scoring !== 'standard' || !state.options.timed) return 0;
  return state.elapsed > 30 ? Math.floor(700000 / state.elapsed) : 0;
}

function currentElapsed(state: SolitaireState, now: number): number {
  return state.startedAt === undefined ? state.elapsed : Math.max(state.elapsed, Math.floor((now - state.startedAt) / 1000));
}

/** Moves `count` cards from the top of `from` onto `to`; returns the same state when the move is illegal. */
export function move(state: SolitaireState, from: Location, count: number, to: Location, now: number): SolitaireState {
  if (state.status === 'won') return state;
  if (from.pile === to.pile && from.index === to.index) return state;
  const cards = liftable(state, from, count);
  if (!canDrop(state, cards, to)) return state;
  let next = beginMove(state, now);
  const source = pileAt(next, from);
  const remaining = source.slice(0, source.length - count);
  next = replacePile(next, from, remaining);
  next = replacePile(next, to, [...pileAt(next, to), ...cards]);
  next = addScore(next, movePoints(next, from.pile, to.pile));
  const exposed = top(remaining);
  if (from.pile === 'tableau' && exposed && !exposed.faceUp) {
    next = replacePile(next, from, [...remaining.slice(0, -1), { ...exposed, faceUp: true }]);
    if (next.options.scoring === 'standard') next = addScore(next, 5);
  }
  if (isWon(next)) {
    const finished = { ...next, elapsed: currentElapsed(next, now) };
    return { ...addScore(finished, winBonus(finished)), status: 'won' };
  }
  return next;
}

/** The foundation the top card of `from` can go to, if any. */
export function foundationFor(state: SolitaireState, from: Location): Location | undefined {
  const [card] = liftable(state, from, 1);
  if (!card) return undefined;
  const index = state.foundations.findIndex((_, i) => canDrop(state, [card], { pile: 'foundation', index: i }));
  return index === -1 ? undefined : { pile: 'foundation', index };
}

/** Double click: sends the top card of `from` to a foundation when it fits. */
export function autoMove(state: SolitaireState, from: Location, now: number): SolitaireState {
  const target = foundationFor(state, from);
  return target ? move(state, from, 1, target, now) : state;
}

/** Advances the clock; timed Standard games lose two points every ten seconds. */
export function tick(state: SolitaireState, now: number): SolitaireState {
  if (state.status !== 'playing' || !state.options.timed || state.startedAt === undefined) return state;
  const elapsed = currentElapsed(state, now);
  if (elapsed === state.elapsed) return state;
  let next = { ...state, elapsed };
  if (next.options.scoring === 'standard') {
    const due = Math.floor(elapsed / 10);
    if (due > next.penalties) next = { ...addScore(next, -2 * (due - next.penalties)), penalties: due };
  }
  return next;
}

export function undo(state: SolitaireState): SolitaireState {
  return state.previous ?? state;
}

export function scoreText(state: SolitaireState): string {
  return state.options.scoring === 'vegas' ? `$${state.score}` : String(state.score);
}

export function solitaireReducer(state: SolitaireState, action: SolitaireAction): SolitaireState {
  switch (action.type) {
    case 'deal':
      return deal(state.options, action.random, state.cardBack);
    case 'draw':
      return draw(state, action.now);
    case 'move':
      return move(state, action.from, action.count, action.to, action.now);
    case 'autoMove':
      return autoMove(state, action.from, action.now);
    case 'tick':
      return tick(state, action.now);
    case 'setOptions':
      return deal(action.options, action.random, state.cardBack);
    case 'setCardBack':
      return { ...state, cardBack: action.cardBack };
    case 'undo':
      return undo(state);
  }
}
