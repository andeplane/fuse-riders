/** Gold belongs to Power; player names retain their identity color. */
export const POWER_COLOR = '#ffdf55';
export const POWER_ICON_SIZE = 10;
export const POWER_ICON_GAP = 1;
/** Only show the bomb count once upgraded, keeping the starting HUD compact. */
export function powerCountText(pickups: number, extraBombs = 0): string {
  return `${pickups}${extraBombs > 0 ? ` · B×${1 + extraBombs}` : ''}`;
}
export function powerLabel(pickups: number, extraBombs = 0): string {
  return `◆ ${powerCountText(pickups, extraBombs)}`;
}
