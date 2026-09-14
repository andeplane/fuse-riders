import { uint32, UINT32_MAX } from '../shared/direct-input.js';
import { DIRECT_VERSION } from './direct-stream.js';
import type { ClockProbe, ClockReply } from './direct-clock.js';
import type { Finality } from './rollback-world.js';

export const BOUND_CONTROL_BYTES = 2048;
export type BoundControl = ClockProbe | ClockReply | Finality;

/** Shape validation only: the bound RTC association and segment still authenticate the sender and role. */
export function isBoundControl(raw: unknown): raw is BoundControl {
  if (!Array.isArray(raw) || raw[0] !== DIRECT_VERSION || !uint32(raw[1]) || !raw[1]) return false;
  if (raw[2] === 'clock') return raw.length === 4 && uint32(raw[3]) && raw[3] > 0;
  if (raw[2] === 'time') return raw.length === 5 && uint32(raw[3]) && raw[3] > 0 && typeof raw[4] === 'number' && Number.isFinite(raw[4]) && raw[4] >= -20 && raw[4] <= UINT32_MAX;
  if (raw[2] !== 'final' || raw.length !== 6 || !uint32(raw[3]) || !Array.isArray(raw[4]) || raw[4].length > 5 || typeof raw[5] !== 'string' || !/^[0-9a-f]{16}$/.test(raw[5])) return false;
  const seen = new Set<number>();
  for (const prefix of raw[4]) {
    if (!Array.isArray(prefix) || prefix.length !== 2 || !uint32(prefix[0]) || prefix[0] > 4 || !uint32(prefix[1]) || seen.has(prefix[0])) return false;
    seen.add(prefix[0]);
  }
  return true;
}
