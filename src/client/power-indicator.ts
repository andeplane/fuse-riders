/** Gold belongs to Power; player names retain their identity color. */
export const POWER_COLOR = '#ffdf55';
export const POWER_ICON_SIZE = 10;
export const POWER_ICON_GAP = 1;
/** Only show the bomb count once upgraded, keeping the starting HUD compact. */
export function powerCountText(pickups: number, extraBombs = 0, grip = false): string {
  return `${pickups}${extraBombs > 0 ? ` · B×${1 + extraBombs}` : ''}${grip ? ' · GRIP' : ''}`;
}
/**
 * A phone chip for one stacked speed effect: the factor its unexpired deadlines multiply into, and the time until the
 * earliest of them expires, which is when that factor next drops. `NITRO · ×4 · 1.2s` reads as "Nitro is worth four
 * times right now, and in 1.2 seconds it will be worth less"; `NITRO · --` when none is in force. The opposing effect
 * has its own chip, so a rider on two Nitros and a Snail reads ×4 beside ×0.5 rather than a single net figure.
 */
export function speedEffectLabel(name: string, factor: number, deadlines: ReadonlyArray<number>, tick: number, tickHz = 20): string {
  const active = deadlines.filter(until => until > tick);
  if (active.length === 0) return `${name} · --`;
  return `${name} · ×${factor ** active.length} · ${((Math.min(...active) - tick) / tickHz).toFixed(1)}s`;
}
export function powerLabel(pickups: number, extraBombs = 0, grip = false): string {
  return `◆ ${powerCountText(pickups, extraBombs, grip)}`;
}
