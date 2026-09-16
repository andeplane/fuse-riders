import { detectDeviceProfile } from '../shared/device-profile.js';
export function browserDeviceProfile() {
  return detectDeviceProfile(navigator.userAgent, navigator.maxTouchPoints, matchMedia('(pointer: coarse)').matches);
}
