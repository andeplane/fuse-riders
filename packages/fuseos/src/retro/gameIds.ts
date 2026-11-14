/** Ids of the games under Programs > Games, kept apart from the catalogue so the app state can import them without the UI. */
export const GAME_IDS = ['doom', 'wolf3d', 'keen1', 'duke3d', 'minesweeper', 'skifree', 'micropolis', 'solitaire'] as const;

export type GameId = (typeof GAME_IDS)[number];

export function isGameId(value: unknown): value is GameId {
  return typeof value === 'string' && (GAME_IDS as readonly string[]).includes(value);
}
