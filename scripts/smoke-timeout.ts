/**
 * Every browser smoke deadline, scaled.
 *
 * A CI runner has two cores and each smoke drives several browser contexts at once, some of them
 * on software GL, so a deadline tuned on a developer machine is not a deadline there. Three CI
 * failures on 2026-09-15 were timeouts in three different steps — the LAN bomb launch, Phaser
 * presentation recovery and the shared-room controller — on revisions whose code was fine; the LAN
 * smoke passed locally on the same commit that failed it in CI. Stretching the deadlines removes
 * that whole class of failure without weakening a single assertion: a smoke still fails when the
 * behaviour is wrong, just not when the runner is slow.
 *
 * `SMOKE_TIMEOUT_SCALE` defaults to 1, so a local run keeps the deadlines these smokes were written
 * against. CI sets it once for the whole browser job.
 */
const raw = Number(process.env.SMOKE_TIMEOUT_SCALE ?? 1);
export const TIMEOUT_SCALE = Number.isFinite(raw) && raw >= 1 ? raw : 1;
/** Scale one deadline in milliseconds. */
export const smokeTimeout = (ms: number): number => Math.round(ms * TIMEOUT_SCALE);
