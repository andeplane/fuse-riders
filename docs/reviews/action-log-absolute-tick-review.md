# Independent review: absolute action ticks

Date: 2026-09-14. Scope: the absolute-action-tick amendment in [ADR040](../adr/040-deterministic-action-replication.md#absolute-action-ticks-amendment-approved), against the current shared reducer and action replication boundaries. This review does not reopen publication cadence, simulation timing or transport topology.

## Design disposition

Approve implementation of `[slot, absoluteAppliedTick, flags, aim, bombs]` in place of the same-arity tuple whose second field was a per-player delta. An action's absolute tick must equal its containing step operation's tick, while the containing step must remain exactly one tick after the current game state. Per-player prior held timestamps no longer participate in timestamp decoding. This simplifies inspection and independent timestamp interpretation without weakening complete-history requirements.

Keep `held.at` as the actual tick of the latest accepted control change; it remains part of replica checkpoint/hash state. Continue persisting unchanged controls and treating bomb commands as transient. Preserve duplicate-slot rejection, safe integer/range checks, scoped journal sequence, atomic candidate installation, checkpoint generation fences and bounded repair. Absolute timestamps do not permit replay across a missing operation or admit out-of-order lifecycle changes.

The `fuse-actions-3` replay-rules identifier is the correct compatibility gate because the tuple arity and primitive MessagePack layout cannot distinguish old and new semantics. Use it in both capability negotiation and replica checkpoint validation. Do not infer legacy semantics from field values or auto-convert incoming unversioned tuples. `fuse-simulation-2` host checkpoint compatibility can remain unchanged: game physics and stored absolute held timestamps are unchanged, and existing host saves start a new journal after restore.

The existing 20 Hz simulation and publication cadence, reliable host coordinator and upstream refresh semantics remain outside this amendment. Any later batching/cadence change needs its own latency/recovery decision. The modest increase in action bytes depends on integer magnitude; preserve actual encoded measurements rather than presenting a fixed byte saving or overhead for all ticks.

## Required implementation evidence

Use real MessagePack round trips for multiple changes from the same player after differing gaps and for ticks above 65,535. Assert that second fields are the actual enclosing ticks and that replay succeeds even when the prior held timestamp is not useful for delta decoding. Reject mismatched action/enclosing ticks without changing healthy receiver state. Cover continued held-state checkpoint/suffix replay, transient bomb transitions and the existing dropped/duplicate/reordered batch recovery.

Verify an old `fuse-actions-2` replica checkpoint is rejected and negotiation cannot accept an old-rule peer. Retain host save compatibility with `fuse-simulation-2`. Run exact Chromium/WebKit replay on the new tuple semantics and appropriate typecheck, unit/coverage and build checks. Update current ADR statements that still describe deltas while preserving historical evidence as historical. No public release is approved by this design review; implementation acceptance requires targeted follow-up inspection.

## Targeted implementation review

Approved the inspected bounded schema implementation; no new correctness blocker found. `ControlChange` now names its second field `appliedTick`, capture writes the enclosing absolute tick directly, and both structural admission and reducer execution require equality with that tick. No previous `held.at` value participates in timestamp decoding. Existing change detection, held timestamps, transient bomb handling, contiguous-step enforcement and receiver candidate atomicity remain intact.

`REPLAY_RULES` is now `fuse-actions-3`; the existing handshake and replica checkpoint checks consume that constant, fencing peers/checkpoints with old semantics. The physics checkpoint identifier remains unchanged. The real MessagePack regressions cover sparse ticks 66/70 and exactly one bomb, tick 72,002 with different prior held timestamps producing equivalent final state, rejection of a formerly valid delta tuple without replacing healthy state, old-rule checkpoint rejection and host-save restoration. The existing signed-zero regression was adjusted to use an otherwise valid absolute timestamp, preserving its original negative-zero test purpose.

Inspected completed outputs in `artifacts/absolute-tick-targeted.log` and `artifacts/absolute-tick-typecheck.log`: all 18 targeted tests passed with zero failures, and TypeScript completed without errors. Full coverage/build and exact Chromium/WebKit replay for the revised schema were still scheduled at this review point. Their completed evidence, final source identity and documentation alignment remain required before reporting the complete change verified; this targeted approval does not waive those checks or authorize public release.
