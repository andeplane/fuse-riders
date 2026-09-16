/** Gold belongs to Power; player names retain their identity color. */
export const POWER_COLOR = '#ffdf55';
export function powerLabel(pickups: number): string {
  return `◆ ${pickups}`;
}
