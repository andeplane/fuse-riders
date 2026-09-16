/** Browser-reported capabilities, never proof of physical hardware. Unknown fails closed. */
export interface DeviceProfile { device: 'phone' | 'tablet' | 'desktop' | 'unknown'; input: 'touch' | 'keyboard' | 'unknown' }
export const unknownDevice = (): DeviceProfile => ({ device: 'unknown', input: 'unknown' });
export function isDeviceProfile(value: unknown): value is DeviceProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const profile = value as DeviceProfile;
  return Object.keys(value).length === 2 && ['phone', 'tablet', 'desktop', 'unknown'].includes(profile.device) && ['touch', 'keyboard', 'unknown'].includes(profile.input);
}
export function detectDeviceProfile(userAgent: string, touchPoints: number, coarsePointer: boolean): DeviceProfile {
  if (!userAgent) return unknownDevice();
  // Safari can report zero maxTouchPoints while correctly exposing a coarse touch pointer.
  const touch = touchPoints > 0 || coarsePointer;
  if (/iPhone|iPod|Android.*Mobile/i.test(userAgent)) return { device: 'phone', input: touch ? 'touch' : 'unknown' };
  if (/iPad|Android/i.test(userAgent) || (/Macintosh/i.test(userAgent) && touchPoints > 1)) return { device: 'tablet', input: touch ? 'touch' : 'unknown' };
  return { device: 'desktop', input: 'keyboard' };
}
export function sameDeviceProfile(a: DeviceProfile, b: DeviceProfile): boolean { return a.device === b.device && a.input === b.input; }
/** Count all connected human seats, including eliminated and next-round riders. TV viewers have no seat. */
export function targetBombAvailable(players: Iterable<{ id: string; connected: boolean; deviceProfile?: DeviceProfile }>): boolean {
  const humans = [...players].filter(player => player.connected && !player.id.startsWith('bot:'));
  return humans.length > 0 && humans.every(player => player.deviceProfile?.device === 'phone' && player.deviceProfile.input === 'touch');
}
export function deviceLabel(profile?: DeviceProfile): string {
  if (!profile || profile.device === 'unknown') return 'Unknown device';
  const device = { phone: 'Phone', tablet: 'Tablet', desktop: 'Desktop' }[profile.device];
  return `${device} · ${profile.input === 'keyboard' ? 'keyboard' : profile.input === 'touch' ? 'touch' : 'unknown input'}`;
}
