import type { Cascade } from './cascade';
import { CARD_HEIGHT, CARD_WIDTH, cascadeOrder, createCascade, stepCascade } from './cascade';
import type { Card } from './solitaireRules';

const positions = [
  { x: 256, y: 8 },
  { x: 338, y: 8 },
  { x: 420, y: 8 },
  { x: 502, y: 8 },
];

describe(cascadeOrder.name, () => {
  it('takes the top card of each foundation in turn, from the kings down', () => {
    const foundations: Card[][] = [
      [card('C', 1), card('C', 2)],
      [card('D', 1)],
      [],
      [card('S', 1), card('S', 2)],
    ];
    const order = cascadeOrder(foundations, positions);
    expect(order.map((source) => `${source.card.suit}${source.card.rank}`)).toEqual(['C2', 'D1', 'S2', 'C1', 'S1']);
    expect(order[0]).toMatchObject({ x: 256, y: 8 });
    expect(order[2]).toMatchObject({ x: 502, y: 8 });
    expect(cascadeOrder([[], [], [], []], positions)).toEqual([]);
  });
});

describe(stepCascade.name, () => {
  it('is done straight away without cards', () => {
    const cascade = createCascade([], 600, 400);
    expect(cascade.done).toBe(true);
    expect(stepCascade(cascade, () => 0.5)).toBe(cascade);
  });

  it('launches a card, pulls it down, bounces it off the bottom and finishes when it leaves the table', () => {
    // Arrange: random 0.9 sends the card to the right, fast, with a small upward kick.
    let cascade: Cascade = createCascade([{ card: card('S', 13), x: 100, y: 10 }], 2000, 200);
    const random = () => 0.9;
    // Act: first frame launches and moves.
    cascade = stepCascade(cascade, random);
    expect(cascade.queue).toEqual([]);
    expect(cascade.flying?.card).toEqual(card('S', 13));
    expect(cascade.flying!.x).toBeGreaterThan(100);
    expect(cascade.trail).toHaveLength(1);
    expect(cascade.trail[0]).toEqual(cascade.flying);
    expect(cascade.done).toBe(false);
    // Fall until the floor.
    let bounced = false;
    let lowest = 0;
    for (let i = 0; i < 400 && cascade.flying; i += 1) {
      const before = cascade.flying;
      cascade = stepCascade(cascade, random);
      if (cascade.flying) {
        lowest = Math.max(lowest, cascade.flying.y);
        if (before.vy > 0 && cascade.flying.vy < 0) bounced = true;
      }
    }
    expect(lowest).toBe(200 - CARD_HEIGHT);
    expect(bounced).toBe(true);
    expect(cascade.done).toBe(true);
    expect(cascade.flying).toBeUndefined();
  });

  it('sends a card to the left when random is low and moves on to the next card', () => {
    let cascade: Cascade = createCascade(
      [
        { card: card('H', 13), x: 50, y: 10 },
        { card: card('D', 13), x: 50, y: 10 },
      ],
      300,
      200
    );
    const random = () => 0.1;
    cascade = stepCascade(cascade, random);
    expect(cascade.flying!.vx).toBeLessThan(0);
    while (cascade.flying?.card.suit === 'H') cascade = stepCascade(cascade, random);
    expect(cascade.done).toBe(false);
    cascade = stepCascade(cascade, random);
    expect(cascade.flying?.card).toEqual(card('D', 13));
    expect(cascade.flying!.x).toBeGreaterThan(-CARD_WIDTH);
  });
});

function card(suit: Card['suit'], rank: number): Card {
  return { suit, rank, faceUp: true };
}
