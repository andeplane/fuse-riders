/** Human-only, simultaneous, mean-pairwise Elo. Callers supply the eligible human field. */
export const INITIAL_ELO = 1000;
export const ELO_K = 32;
export interface EloPlayer {
  id: string;
  rating: number;
  score: number;
  wins: number;
}
export function calculateElo(
  players: readonly EloPlayer[],
): Map<string, number> {
  if (
    new Set(players.map((p) => p.id)).size !== players.length ||
    players.some(
      (p) =>
        !Number.isFinite(p.rating) ||
        !Number.isFinite(p.score) ||
        !Number.isFinite(p.wins) ||
        p.id.startsWith("bot:"),
    )
  )
    throw new Error("Invalid human Elo field");
  const next = new Map<string, number>();
  for (const player of players) {
    let delta = 0;
    for (const other of players) {
      if (other.id === player.id) continue;
      const order = player.score - other.score || player.wins - other.wins;
      const actual = order === 0 ? 0.5 : order > 0 ? 1 : 0;
      const expected = 1 / (1 + 10 ** ((other.rating - player.rating) / 400));
      delta += actual - expected;
    }
    next.set(
      player.id,
      player.rating +
        (players.length > 1 ? (ELO_K * delta) / (players.length - 1) : 0),
    );
  }
  return next;
}
