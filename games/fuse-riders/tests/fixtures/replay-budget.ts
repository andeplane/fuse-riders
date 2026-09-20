/**
 * How thoroughly the whole-recording replays (`golden-hash`, `order-independence`) check the fold.
 *
 * Every tick is always simulated: the stride changes only how often the replay stops to *verify* what the
 * simulation produced. Measured on the 15,776-tick pinned recording, the fold itself is 4.2 s of a 28.7 s
 * replay — the other 24.5 s is `hashRoomState` on every tick. Verifying one tick in ten keeps the whole
 * recording playing, start to finish, for a quarter of the time.
 *
 * A divergence is sticky: `hashRoomState` covers the whole room, and two engines that disagree at one tick
 * fold different states from then on, so a sampled comparison still catches it — it just names a later tick.
 * What a stride can miss is a divergence that heals within the stride, which is why **main pushes and the
 * release suite run at stride 1** (the default) and only the pull-request gate samples. `pnpm test` is
 * therefore the full check wherever nobody has asked for less.
 *
 * Node-only: the browsers in `scripts/determinism-replay.ts` import `replay-log.ts` directly and never
 * reach this module, so `process` stays out of the bundle.
 */
export const STRIDE_VAR = "FUSE_REPLAY_STRIDE";

/** Rejects a value the replays would silently misread; TypeScript types are not runtime validation. */
export function strideFrom(raw: string | undefined): number {
  if (raw === undefined || raw === "") return 1;
  // Plain digits only: `Number` would read "0x10" as 16 and "1e3" as 1000, and a budget nobody meant to set
  // is worse than a refusal — it decides how much of the recording is actually checked.
  if (!/^\d+$/.test(raw) || Number(raw) < 1)
    throw new Error(
      `${STRIDE_VAR}=${raw}: the replay stride must be a whole number of ticks, 1 or more (1 checks every tick).`,
    );
  return Number(raw);
}

/** One tick in `REPLAY_STRIDE` is verified; 1 verifies every tick. */
export const REPLAY_STRIDE = strideFrom(process.env[STRIDE_VAR]);

/** What a replay test prints about the budget it ran on, so a sampled run never reads as a full one. */
export function strideNote(stride = REPLAY_STRIDE, ticks?: number): string {
  return stride === 1
    ? `checking every tick${ticks === undefined ? "" : ` of ${ticks}`}`
    : `checking 1 tick in ${stride}${ticks === undefined ? "" : ` of ${ticks}`} (${STRIDE_VAR}=${stride}); main runs every tick`;
}
