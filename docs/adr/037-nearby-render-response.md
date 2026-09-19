# ADR 037: faster publication and conservative nearby presentation delay

Status: **superseded** by [docs/online/P2P-INPUT-LOG-BRIEF.md](../online/P2P-INPUT-LOG-BRIEF.md): there is no host publication or remote world buffer; every device simulates locally and presents one tick behind its own clock with the local rider led by its held controls (`games/fuse-riders/src/online/prediction.ts`). Originally: implemented and independently reviewed. The measured candidate was accepted on 2026-09-14 after the fixed response batch; final CI and public release checks remain required.

## Problem and evidence

The actual heading benchmark on d715642 measured local p95 28ms, TV p95 162.5ms (one-degree departure174.6ms), with17valid observations,21rejected/confounded observations and0eligible timeouts. The proposed nearby TV target100ms failed. Full raw failure remains in `docs/online/evidence/response-d715642.json`. A valid CPU render-submission benchmark is not physical touch-to-photon evidence.

Runtime currently publishes on even simulation ticks only (10Hz), while RemoteWorldBuffer renders estimated authority tick minus2 (100ms at20Hz physics). Those independent waits explain a substantial avoidable response budget. This change must preserve authority, direct-only communication, monotonic presentation and realistic regional buffering.

## Proposed bounded decision

1. Publish a snapshot after every completed authoritative50ms tick (20Hz). Physics/input scheduling remain20Hz. Event delivery, generations, keyframe receipts, encoder deltas, per-peer motion ledger and existing backpressure remain unchanged. Do not send a full keyframe on every tick. The host already checkpoints only tick%20; no doubled durable writes.
2. Keep the default remote presentation delay at2ticks. Use0.5tick only after one accepted unpaused tick-clock sample with measured RTT<=40ms, same complete control scope, strictly increasing received timestamps and no sample gap over1000ms. RTT includes host handling time, so this is a conservative nearby classification, not a network-distance estimate.
3. Revert immediately to2ticks on any finite observed RTT>40ms, including samples rejected for excessive RTT, paused clock, scope reset, time discontinuity, or sample age>1000ms. Immediate conservative exit remains; one-sample entry removes temporal hysteresis and may oscillate, so pose-hold measurements are required. Invalid/stale samples cannot qualify a link; no lowest-ever-RTT heuristic. Classification reads the same injected monotonic clock used by PredictionClock. No new clock protocol, probes, browser geolocation or RTT inference from replication arrivals.
4. PredictionClock will expose a presentation-delay getter returning only0.5or2. Only samples passing its existing validity/time-order checks can improve quality; finite high-RTT observations can only downgrade it. Clock reset also resets quality. A rejected sample cannot renew freshness or advance the qualifying streak. A scope change restarts qualification even when there was no explicit reset.
5. RemoteWorldBuffer accepts an optional delay argument default2, bounded to0.5,1or2. Without an authority-clock estimate, preserve the existing newest-available-snapshot fallback; this is not a confirmed100ms history delay. With an estimate its target remains clamped to available snapshots and never below its already-presented tick. Reducing delay may advance presentation within known snapshots; increasing delay holds the current presentation until the deeper buffer catches up. Never extrapolate riders/projectiles, rewind within scope, interpolate portal crossings, or expose future discrete state. Existing scope/phase resets remain intact.
6. UI passes the clock's current qualified delay to the remote buffer. Local prediction, command timestamps, host authority leases and gameplay collision outcomes are untouched. The host's RTT0 samples qualify after the same policy; no special identity bypass.

## Why this variant

Universal50ms buffering can starve on the existing regional80msRTT profile:40msone-way plus up to50ms publication spacing exceeds50ms. Keeping100ms there protects interpolation coverage. Always100ms buffering plus20Hz helps but leaves avoidable nearby latency. Zero-delay/extrapolation introduces guessed collisions and is outside this change. Adaptive per-packet jitter estimation or a new unreliable channel would add unrelated mechanisms; this two-level policy is deliberately narrow.

The20Hz publication cost is additional JSON envelope/player state traffic and host encoding work. Existing delta compression limits world geometry retransmission, but that is not proof the new bandwidth passes. Existing backpressure continues to fail visibly instead of unbounded queues.

## Required tests and review

- Injected clock: one fresh same-scope low-RTT sample qualifies; absent/invalid samples do not; highRTT, stale samples, pause, explicit reset, backwards time and changed scope fall back. Invalid/replayed probes cannot qualify or extend freshness.
- Remote buffer:0.5tick target differs by exactly1.5ticks where available; shifting0.5→2never rewinds;2→0.5never exceeds newest; unknown clock remains newest-only/no extrapolation and omitted delay with valid clock remains2ticks; portal/death/discrete interpolation guards retained.
- Browser host snapshot-tick trace checks publication on each completed simulation tick rather than introducing a loop helper solely to mirror implementation. No physics-rate or keyframe-ack contract change; checkpoint cadence remains one second.
- Full tests/typecheck and unchanged coverage gates before client release. Independent implementation review.

## Before/after evidence and release decision

Serialize all browser runs, using the exact built source/asset hash. Preserve the original failed artifact.

1. Repeat60second actual response benchmark: localp95<=33ms, nearbyTVp95<=100ms, >=10eligible samples per view and0eligible timeouts. Keep every confounded/rejected attempt and one-degree metric; insufficient sample count is not a pass.
2. Repeat regional impaired network benchmark with20Hz. Check accepted-world freshness/recovery, monotonicity, correction distribution, no errors, bounded queues and zero gameplay relay. Verify clocks stay at2tick policy for regionalRTT (expose opt-in diagnostic delay if needed).
3. Record actual serialized gameplay payload egress average and p95 one-second windows for every peer, especially total host egress. Proposed budget inherited from ADR032: <=0.5Mbps average and <=1Mbps p95 per full-view downlink; report host aggregate separately. Payload excludes SCTP/DTLS/IP overhead. Compare to the archived10Hz regional result. Do not claim full wire budget.
4. If TV response still fails, buffering becomes unstable or bandwidth exceeds budget, retain failed evidence and investigate the measured cause before further tuning. Do not silently lower sample requirements, delete the old failure or mark the candidate target passed by code inspection.

No browser runs occur concurrently with the already queued public/mobile acceptance runs. This ADR changes no service infrastructure or deployment permissions.

## Measured eligibility correction, 2026-09-14

The initial20ms threshold never qualified any TVprobe in the same-machine diagnostic run:57accepted RTTs ranged23.3–33.2ms, every eligible response useddelay2, andTVp95remained161.8ms. Full evidence remains in `docs/online/evidence/response-e473a10.json`. Root and independent network/security reviewer approved calibrating only the eligibility threshold to40ms, preserving three fresh consecutive probes, scope/reset bounds,1second freshness and every benchmark trial/threshold. Exact40ms qualifies;40ms+epsilon andregional60ms do not. This is host-probe roundtrip including handling, not a claim ofLANdistance. Asymmetric/jittery40ms paths may briefly freeze at newestavailable state; clamping still prevents extrapolation. The unchanged100msTV response candidate must be remeasured; no earlier failure is waived.

## Bounded25ms / immediate-qualification experiment

Root and independent reviewer approved an experiment after02a982f: firstvalidTVresponses stillused2ticks duringqualification (112.9–136.6ms), whilealreadyqualified1tick responses reached114.7ms withcontinuouslyadvancing renderticks. Use onefresh<=40ms sample and0.5tick nearbybuffer, retainingregional2ticks and allstale/reset/authority/noextrapolationguards. This removes startup hysteresis and25ms ofpresentation delay; it may increase newest-snapshot holds at20Hz. Measure repeatedrenderedtick spans/ratio andframeintervals foraliveactor/playing/samescope windows, using all captured frames for the new run. Compare fixed200ms pre-pointer windows with the same windows in02raw, since its response windows end atfirstchange and would bias an unequal comparison. Count/report all gaps>100ms separately (they may be real hitches in fullcapture); exclude phase/death transitions from continuity. Latencypassing alone doesnotqualify the producttradeoff. Everytrial and100msTV target remains unchanged; root must review actualhold distributions before shipping this experiment.

## Final measured candidate decision

The predeclared180second follow-up and combined240second batch passed the unchanged first-departure criteria, including the earlier failed60second trial:69eligible samples per view, localp95 27.6ms, TVp95 88.2ms, zero eligible timeouts. The original local34.1ms maximum remains. Both runs used the identical served bundle hash. Full180second TV continuity showed3.41% repeated tick intervals, holdp95 34.0ms/max51.2ms, framep95 28.2ms, and no gap over100ms. The old full-run continuity was not captured, so the limited pre-input baseline comparison does not prove unchanged full-run holdfrequency.

Root and the independent reviewer accepted this measured latency/presentation tradeoff as a release candidate, conditional on finalCI and public-browser checks. This does not claim physical-phone, OS-packet-loss or scanout qualification. Complete evidence and unsuccessful trials are retained in `docs/online/RESPONSE-BENCHMARK.md`, with the new raw stream at `docs/online/evidence/response-c3bb4cb-180s.json` and combined report at `docs/online/evidence/response-fixed-batch-summary.json`. No additional repeat-until-pass runs were performed.
