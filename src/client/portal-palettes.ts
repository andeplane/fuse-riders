/**
 * One two-tone palette per simultaneous pair: the two gates of a pair always differ from each other,
 * so a rider can still read which end leads where, and pairs differ from one another.
 */
export const PORTAL_PALETTES = [
  ['#b968ff', '#ff9b32'], ['#39ff9e', '#2f9bff'], ['#ff4f9b', '#ffe24f'],
  ['#ff6a3d', '#7cf5ff'], ['#c6ff4f', '#ff5ce0'], ['#4f7bff', '#ffd24f'],
] as const;
/**
 * Preference comes from the pair id rather than its position, so retiring the oldest pair at the cap
 * leaves the survivors on the colours they already had. Two live pairs must never look alike, though,
 * so a pair whose preference is taken walks on to the first free palette.
 */
export function portalPalettes(ids: readonly string[]): Array<readonly [string, string]> {
  const taken = new Set<number>();
  return ids.map((id) => {
    let hash = 0;
    for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
    let slot = hash % PORTAL_PALETTES.length;
    for (let probe = 0; probe < PORTAL_PALETTES.length && taken.has(slot); probe += 1) slot = (slot + 1) % PORTAL_PALETTES.length;
    taken.add(slot);
    return PORTAL_PALETTES[slot]!;
  });
}

