/**
 * The #ddrnorway conversation that runs once the language model is loaded.
 * A group of 3–5 players, drawn with probability proportional to how many CCBS tournaments they played,
 * talks one line at a time. The gap until the next line is a random 10–120 seconds (about once a minute).
 */

export const SCENE_SIZE = { min: 3, max: 5 } as const;
export const SCENE_GAP_SECONDS = { min: 10, max: 120 } as const;

export type WeightedPlayer = { nick: string; weight: number };

/** Milliseconds until the next line. `random` in [0, 1] maps onto 10–120 seconds inclusive. */
export function sceneGapMs(random: () => number): number {
  const span = SCENE_GAP_SECONDS.max - SCENE_GAP_SECONDS.min; // 110 steps above the minimum
  const seconds =
    SCENE_GAP_SECONDS.min +
    Math.floor(Math.min(random(), 0.999999) * (span + 1));
  return seconds * 1000;
}

/** How many people are in the next conversation: 3, 4 or 5. */
export function sceneSize(random: () => number): number {
  const span = SCENE_SIZE.max - SCENE_SIZE.min;
  return SCENE_SIZE.min + Math.floor(Math.min(random(), 0.999999) * (span + 1));
}

/**
 * `count` distinct nicks. Each draw's chance is that player's weight over the weight still in the pool,
 * so someone with more tournaments is more likely to be in the conversation.
 */
export function pickScene(
  players: readonly WeightedPlayer[],
  random: () => number,
): string[] {
  const pool = players
    .filter((player) => player.weight > 0)
    .map((player) => ({ nick: player.nick, weight: player.weight }));
  const count = Math.min(sceneSize(random), pool.length);
  const picked: string[] = [];
  for (let n = 0; n < count; n += 1) {
    const index = takeWeighted(pool, random);
    const player = pool[index];
    if (!player) break;
    picked.push(player.nick);
    pool.splice(index, 1);
  }
  return picked;
}

function takeWeighted(
  pool: readonly WeightedPlayer[],
  random: () => number,
): number {
  const total = pool.reduce((sum, player) => sum + player.weight, 0);
  if (total <= 0) return 0;
  let mark = Math.min(random(), 0.999999) * total;
  for (let index = 0; index < pool.length; index += 1) {
    mark -= pool[index]?.weight ?? 0;
    if (mark < 0) return index;
  }
  return pool.length - 1;
}

/** True when `nick` stands as its own word, so "Al" does not match inside "skal" or "Andeplane". */
export function nickMentioned(text: string, nick: string): boolean {
  const wanted = nick.toLowerCase();
  if (wanted.length === 0) return false;
  return text
    .toLowerCase()
    .split(/[^a-z0-9[\]\\`_^{|}-]+/)
    .includes(wanted);
}
