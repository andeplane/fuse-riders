# Independent implementation review: direct-action core

Date: 2026-09-14. Scope: `src/shared/direct-input.ts`, `src/online/direct-stream.ts`, and `src/online/rollback-world.ts` against amended ADR041. Tests were still being written at initial inspection. Runtime, clock/coordinator integration and online release are outside this review's completion scope.

## Initial findings

1. **Earlier watermark constraints are discarded.** `DirectStream` retains only its newest watermark. Accepting `(5,1)`, then `(10,2)`, then actions `(sequence=1,tick=3)` and `(sequence=2,tick=4)` currently returns accepted throughout. The second action violates the earlier promise that no sequence after 1 can occur through tick 5. This was reproduced with actual exported module calls. Retain bounded unfinalized cuts or equivalent interval constraints; validate existing records and future arrivals against them, including when older cuts arrive late. Trim constraints only when their meaning is preserved by the finalized base or a truly stronger equivalent constraint.

2. **A newer incomplete cut erases earlier completeness.** With action 1 at tick 3 and cut `(5,1)`, `completeThrough(5)` is true. Receiving cut `(10,2)` before action 2 makes it false, even though completeness through tick 5 remains proven. This was reproduced through exported module calls. Select a retained certified cut that proves the requested tick, rather than requiring possession through the newest unverified watermark. Otherwise future packet loss unnecessarily delays finality and can force an avoidable pause.

3. **Bootstrap permits an impossible active gesture.** A valid game plus held bomb flag and gesture `{active:1, latest:2}` is admitted by `RollbackWorld.open(packBootstrap(...))`. The reducer can only produce `active=0` or `active=latest`: a newer press replaces the prior active gesture. Validate this invariant and retain rejection atomicity. The executable reproduction used an ordinary game with default room settings and a roster entry; no private state mutation was used.

## Positive observations and remaining gates

Per-tick folding preserves player iteration order, command-local aim, replacement cancellation, and matching release semantics. Stream admission builds a candidate before installing it, validates identities and tick order, and only exposes contiguous records. Rollback restores strictly before newly admitted actions; event storage is rebuilt for replayed ticks and only emitted on verified finality. Exact finalized prefixes are distinct from newer completeness cuts, and same-finality duplicates are checked without re-emitting events.

The initial findings require fixes and regressions before approving this core. Completed real-MessagePack tests must cover delivery permutations, last-release and receipt loss, same-tick gesture/aim order, watermark history/finality, bounds, corrupt bootstrap and six-replica convergence. These tests do not establish real WebRTC latency, full runtime replacement, mobile performance or release acceptance.

## Fix verification and disposition

Approve the inspected core as the foundation for integration. All three initial findings are resolved. `DirectStream` now retains at most 64 unfinalized completeness cuts, validates new and retained actions against every cut, rejects incompatible older cuts, and keeps earlier certified progress usable when a newer cut has missing records. Finality trimming preserves a baseline sequence/tick fence and later cuts; encoded cut storage is included in the world budget. Bootstrap admission now requires an active gesture to equal the latest gesture, or to be zero.

Independently ran `node --import tsx --test tests/direct-actions.test.ts` against the inspected working-tree sources: 19 tests passed, zero failed, zero skipped. Regressions reproduce both older-promise arrival orders, preservation of certified progress despite a newer gap, cut overflow/trimming, and rejection of a rehashed impossible gesture state. Additional tests cover full absolute ticks, bounded real MessagePack decoding, sequence gaps/conflicts, late whole-world rollback, all six same-tick packet permutations, replacement gestures, idle final-release repair, lost receipts, pending finality, exact checkpoint prefixes, speculative pause/resume, malformed boundaries, atomic encoded-history overflow, and six replicas across three seeds.

This approval is deliberately a core implementation disposition. The six-replica test uses in-process deterministic delivery and a short fixed workload; it does not establish sustained active gameplay, cross-browser behavior, actual WebRTC delivery, clock quality, TV/controller runtime roles, or measured latency/heap/wire costs. Complete repository checks, actual integration, sustained impairment evidence and independent runtime review remain required for the requested online replacement. No public release is approved.
