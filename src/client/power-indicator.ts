/** Gold belongs to Power; player names retain their identity color. */
export const POWER_COLOR = '#ffdf55';
export const POWER_ICON_SIZE = 10;
export const POWER_ICON_GAP = 1;
/** Only show the bomb count once upgraded, keeping the starting HUD compact. */
export function powerCountText(pickups: number, extraBombs = 0, grip = false): string {
  return `${pickups}${extraBombs > 0 ? ` · B×${1 + extraBombs}` : ''}${grip ? ' · GRIP' : ''}`;
}
/**
 * A phone chip for a stacked speed effect: the factor every unexpired deadline multiplies into, and the longest time
 * left. `NITRO · ×4 · 3.2s` reads as "you are at four times speed, for another 3.2 seconds"; `NITRO · --` when none is in force.
 */
export function speedEffectLabel(name: string, factor: number, deadlines: ReadonlyArray<number>, tick: number, tickHz = 20): string {
  const active = deadlines.filter(until => until > tick);
  if (active.length === 0) return `${name} · --`;
  return `${name} · ×${factor ** active.length} · ${((Math.max(...active) - tick) / tickHz).toFixed(1)}s`;
}
export function powerLabel(pickups: number, extraBombs = 0, grip = false): string {
  return `◆ ${powerCountText(pickups, extraBombs, grip)}`;
}
