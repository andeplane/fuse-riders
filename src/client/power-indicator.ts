/** Gold belongs to Power; player names retain their identity color. */
export const POWER_COLOR = '#ffdf55';
export const POWER_ICON_SIZE = 10;
export const POWER_ICON_GAP = 1;
export function powerLabel(pickups: number): string {
  return `◆ ${pickups}`;
}
