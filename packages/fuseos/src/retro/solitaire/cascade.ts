import type { Card } from './solitaireRules';

/**
 * The winning cascade: one card at a time flies off a foundation, bounces
 * along the bottom of the table and leaves the screen, painting a trail
 * because the table is never repainted. Pure so tests can step it.
 */

export const CARD_WIDTH = 71;
export const CARD_HEIGHT = 96;

export type FlyingCard = { card: Card; x: number; y: number; vx: number; vy: number };

export type CascadeSource = { card: Card; x: number; y: number };

export type Cascade = {
  /** Cards still waiting, in the order they take off. */
  queue: CascadeSource[];
  flying?: FlyingCard;
  /** Where the flying card has been drawn since the last step. */
  trail: FlyingCard[];
  width: number;
  height: number;
  done: boolean;
};

const GRAVITY = 0.6;
const BOUNCE = -0.85;
const MIN_SPEED = 3;
const MAX_SPEED = 8;

/** Takes the top card of each foundation in turn, kings first, like the original. */
export function cascadeOrder(foundations: Card[][], positions: { x: number; y: number }[]): CascadeSource[] {
  const order: CascadeSource[] = [];
  const height = Math.max(0, ...foundations.map((pile) => pile.length));
  for (let depth = 1; depth <= height; depth += 1) {
    foundations.forEach((pile, index) => {
      const card = pile[pile.length - depth];
      const position = positions[index];
      if (card && position) order.push({ card, x: position.x, y: position.y });
    });
  }
  return order;
}

export function createCascade(queue: CascadeSource[], width: number, height: number): Cascade {
  return { queue, trail: [], width, height, done: queue.length === 0 };
}

function launch(source: CascadeSource, random: () => number): FlyingCard {
  const direction = random() < 0.5 ? -1 : 1;
  const speed = MIN_SPEED + random() * (MAX_SPEED - MIN_SPEED);
  return { card: source.card, x: source.x, y: source.y, vx: speed * direction, vy: -random() * 6 };
}

/** One frame: gravity, a bounce off the bottom edge, the next card when this one has left. */
export function stepCascade(cascade: Cascade, random: () => number): Cascade {
  if (cascade.done) return cascade;
  let flying = cascade.flying;
  let queue = cascade.queue;
  if (!flying) {
    const [next, ...rest] = queue;
    if (!next) return { ...cascade, trail: [], done: true };
    flying = launch(next, random);
    queue = rest;
  }
  let vy = flying.vy + GRAVITY;
  let y = flying.y + vy;
  const floor = cascade.height - CARD_HEIGHT;
  if (y > floor) {
    y = floor;
    vy *= BOUNCE;
  }
  const moved: FlyingCard = { ...flying, x: flying.x + flying.vx, y, vy };
  const gone = moved.x + CARD_WIDTH < 0 || moved.x > cascade.width;
  return { ...cascade, queue, flying: gone ? undefined : moved, trail: [moved], done: gone && queue.length === 0 };
}
