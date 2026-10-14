/** Presentation palette; player identity always includes a slot number, never colour alone. */
export const KEEPER_COLORS = [
  0xffd58b, 0x80dcff, 0xf29abf, 0xaee89a, 0xc4a4ff,
] as const;
export const keeperColor = (slot: number): string =>
  `#${(KEEPER_COLORS[slot] ?? KEEPER_COLORS[0]).toString(16)}`;
