# Review of proposed online ADRs 028–032

Date: 2026-09-14. Reviewed proposed ADRs 028–032 and `docs/online/ROADMAP.md`. Design review only; no implementation or commits. **Conditional direction approval, not protocol approval or release approval.** The proposals address the initial review's subjects, but several safety contracts still permit incompatible implementations. Resolve the following amendments before parallel implementation.

## P1: A larger authority epoch alone does not fence partitioned peers

ADR 028 permits existing RTC to continue during signalling failure under a ten-second lease, while allocating a new epoch on host connection replacement. A guest isolated from signalling can still accept the old host's valid lease while other guests accept the replacement. Broadcasting revocation does not reach a partition. “Exactly one accepted authority” therefore does not follow from the described procedure.

**Minimum amendment:** define one service-serialized lease record, including room incarnation, holder identity, authority epoch, grant ID, service-time `validFrom` and `expiresAt`. A replacement epoch may be reserved immediately, but cannot simulate or emit accepted game state before the preceding grant expires (plus the clock uncertainty guard), unless every admitted participant has acknowledged fencing and the service has defined safe exclusion of the others. The simpler morning implementation should wait for expiry. Renewals must compare-and-swap the current holder/epoch and must never extend an already superseded grant. A delayed old socket close must not revoke the replacement.

Specify how participants learn an authentic grant from the service, map expiry to a monotonic local deadline conservatively, bound time uncertainty and stop when certainty is lost. Host-generated epoch numbers are insufficient. Check grant validity at receive, simulation, and resume after event-loop suspension; do not rely on a timer firing on time. Define room incarnation so eviction/recreation cannot reuse a previously accepted epoch. Do not claim trusted-friend leases stop a deliberately modified host; their purpose here is accidental split-brain fencing.

Acceptance trace: old host and guest A lose WSS but retain RTC; guest B and replacement host obtain WSS; delayed renewal and revoke frames cross; prove non-overlapping acceptance intervals and that replacement input is neutral. Test frozen old tabs waking after the new lease starts. Specify whether “exactly one” means at most one authorized simulation or merely one stream per receiver—the former is the required safety property.

## P1: Applied input sequence and tick need a complete scheduling contract

ADR 029 says the host assigns an actual tick and reports sequence plus tick. It does not define rounding, allowed past/future windows, late-command handling, holding behavior or which controls replay should retain when the host reschedules/supersedes samples. Those choices directly affect both responsiveness and the one-radius correction budget. A single cumulative sequence/tick cannot describe several queued changes assigned to different ticks unless earlier applications are separately recoverable.

**Minimum amendment:** publish the command/snapshot types and tick semantics before extraction. State whether snapshot T is before or after simulation tick T. Specify a deterministic schedule rule (for example, latest received eligible sample wins at the next unexecuted tick, with bounded future scheduling and no host rewind), integer rounding, maximum lead/age, tie-breaking and what acknowledgement says about dropped/superseded samples. State the authoritative held control and last applied sequence in each baseline, and transmit enough applied/rejected history to resolve outstanding client samples. Treat cumulative receive ACK and applied ACK as different concepts. Define command coalescing without dropping a necessary neutral/release state.

Select a bounded prediction lead derived from estimated tick and uncertainty, independently of render interpolation delay. For the first implementation, retaining immediate local preview and accepting honest corrections is preferable to inventing competitive lag compensation. The kernel's inputs must explicitly include all deterministic movement state (drunk seed/start/previous offset, heading, speed, arena state and discontinuities); a promise to share “portal inputs” does not explain predicting an unseen portal. Unknown-world corrections remain explicit exceptions, not numerical-kernel failures.

Acceptance traces must include two opposite direction changes mapped to one tick, one late and one future sample, lost application acknowledgements, a completely acknowledged held turn, host pause/resume, drift change, and 300 ms delayed snapshot. Compare predicted and authoritative fixed-tick states using the actual scheduling decisions, not only a helper fed identical commands.

## P1: Fire recovery mixes action sequencing with charge authority

ADR 030 requires ordered logical actions and release metadata sufficient to recover a missing press. Missing information remains: who determines start time/duration, whether charge may start in a previous round, whether release may fire twice after cache eviction, and whether an out-of-order cancel can undo an applied release. Using client-declared charge without tick/window validation can create full-charge shots immediately. Requiring a strictly ordered lane without a gap-expiry rule can instead block all later shots behind one lost press.

**Minimum amendment:** distinguish gesture ID, transition sequence and independently identified management actions. Define a per-gesture state machine and terminal results. Release includes claimed start/release ticks, final aim and scoped ID; the host clamps or rejects the duration against its bounded scheduling window, cooldown and current powerup state. For missing press, explicitly choose bounded reconstructed charge or a weaker zero/minimum-charge shot; do not silently imply authoritative history exists. A gesture from any previous match/round/control epoch is cancelled. Once applied, a later cancel cannot undo it; acknowledged cancellation prevents later release. Invalid final metadata produces a terminal acknowledgement.

Set action retry deadline and maximum gap wait, plus dedup retention that outlives the retry horizon and delayed transport queues. After retention expires the message must still be rejected by scope/age, so eviction cannot resurrect it. Retry across carriers preserves the same logical ID. No reliable management action should be blocked forever by a missing fire transition. Record limits in the protocol, not only prose saying “bounded.”

Acceptance: all permutations of press/update/release/cancel, lost press, duplicate release after terminal result, cancel after applied release, invalid future duration, near-round-boundary shot, lost ACK and gesture ID reused after reconnect. Each trace must have one deterministic outcome plus stable acknowledgement.

## P1: Encoder generations need ownership and atomic validation rules

ADR 030 fixes UUID arrival ordering but does not define who owns generation counters or when they reset. `per peer within an authority epoch` is ambiguous across guest reconnects/control epochs and replacement runtime restore. Also, a malformed higher-generation keyframe must not retire the valid stream before validation.

**Minimum amendment:** define world stream identity as room incarnation + authority epoch + receiver connection/control epoch, with a host-owned monotonically increasing encoder generation and frame sequence inside that identity. Reconnecting either establishes a fresh service-authenticated receiver epoch or preserves the counter; never reset counters under the same identity. Baseline and authority tick must not regress within an identity. Validate the entire envelope, lease, schema, generation and baseline in temporary state before atomically changing decoder state. Define keyframe generation/resync-request relationship; stale or superseded responses cannot commit. Pin one resync request in flight with a bounded retry timer and rate budget.

For morning implementation, one reliable bounded world lane with explicit reset is reasonable. State exactly what “coalescing unsent” means: only data not yet encoded against a committed baseline can be superseded. Once a delta is encoded/queued, later deltas cannot depend on dropping it. If send queues overflow, terminate that generation, issue a new baseline and reject old generation traffic. Transport switch must not bypass these rules.

Acceptance: invalid newer keyframe leaves current state byte-for-byte unchanged; reconnect, overflow and crossed resync responses never reduce authority tick or accepted generation; delayed unseen old keyframe remains rejected; new epoch checkpoint restore has an explicit discontinuity and permits intentional world rewind only across that epoch.

## P2: Recovery budgets need clock origin and host-loss boundaries

ADR 030 proposes fallback within 750 ms; ADR 032 proposes recovery after a three-second outage within two seconds. Host takeover may wait up to the remaining ten-second lease, so the two-second promise contradicts strict fencing if it includes refresh/replacement. The 750 ms gate also lacks heartbeat cadence, failure threshold, probe acknowledgement definition and whether WSS is already open.

**Minimum amendment:** make two-second recovery apply to path-only outage with the same valid authority and established membership. Give host replacement a separate bound: remaining lease plus uncertainty and a measured handshake budget. State that host suspension pauses game time and is not packet-loss compensation. Define latency measurement start/end (first dropped probe to first applied neutral/fresh input plus accepted current baseline), heartbeat period and tolerated scheduling pauses. WSS must be warm for the fast fallback target; otherwise measure setup explicitly. Do not repeatedly alternate paths on a single delayed probe; require hysteresis and a baseline/application acknowledgement before cutover.

## P2: “Morning ship” must name a release class without erasing gates

ADR 032 correctly requires physical iOS/Android, real loss/congestion, sustained soak, ownership and final reviews. ROADMAP cannot certify these using deterministic delay injection or browser emulation by morning if physical/network access is unavailable. The correction gate needs a specified trace/profile (jitter, loss, control workload and sample exclusion rules), and “nearby network” TV p95 needs concrete RTT/jitter. Traffic average needs a duration and defined cohort so a mostly-empty lobby cannot satisfy it.

**Minimum amendment:** define two labels: experimental preview (feature exercise with known failures/unverified evidence clearly listed), and public-ready release (all existing ADR 032 mandatory gates). A morning preview is possible after correctness blockers are fixed; it is not completion of the robust-online goal. Do not silently relabel preview as production. Keep the requested gates unchanged unless the user explicitly changes scope. Pin the benchmark matrix, workloads, minimum duration, output schema, test revision and uncertainty handling before collecting results. Physical-device availability is an honest pending gate, not a reason to substitute weak evidence.

## Recommended amendment/implementation order

1. Agree on the concrete protocol structs and the above lease/tick/action/generation state transitions in an ADR appendix. One owner integrates them; independently implemented interpretations are a risk.
2. Add deterministic adversarial trace tests for lease overlap, action permutations and atomic world generation acceptance. These are small, bounded correctness work suitable before deployment.
3. Implement shared fixed-tick motion and replay against the specified applied-command ledger; retain partial-tick rendering as cosmetic only.
4. Implement transport liveness and bounded recovery using the same protocol epochs; run the full fanout forced-fallback test before performance tuning.
5. Re-review the resulting code and publish evidence against the explicit release class. Keep LAN available and avoid advertising network-proof behavior.

The browser-authority/edge-signalling direction is defensible for trusted friends and idle cost. These amendments are the minimum to make its claimed guarantees implementable; they do not require switching to a continuously running server or full-world rollback.
