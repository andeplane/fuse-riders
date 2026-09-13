# ADR 029: Simulation time, prediction and rendering

Date: 2026-09-14. Status: proposed; numerical and fairness review required.

## Decision

Preserve the authoritative 20 Hz fixed simulation for existing gameplay. Extract a pure movement kernel shared by authority and predictor, including drunk heading and boundary/portal discontinuity inputs. A clock, scheduler and transport are injected; production time and randomness never enter the kernel. Rendering runs independently at display refresh rate.

Synchronize an estimated authority tick using timestamped ping/response samples and bounded clock-offset changes. Every movement sample carries authority/control epoch, sequence and intended tick. The host accepts a bounded window, assigns the actual application tick, and reports the applied sequence AND tick with authoritative state. Received is not applied. Future commands have bounded storage; commands from an old round, epoch or outside the allowed age window expire. Latest movement supersedes older movement for the same scheduling slot.

The client records the control state used at each predicted fixed tick. On authoritative tick T, replace the simulation base and replay tick T+1 through the bounded predicted present using the exact kernel. Retain the acknowledged held state even with zero pending input events. Do not integrate 16 ms client steps against 50 ms host steps. A partial-tick render preview may provide immediate steering feedback but must never become the next simulation base. Correctness tests compare fixed-tick results, while responsiveness tests inspect the first changed rendered pose.

Predict only locally knowable motion, charging and aim. Newly encountered remote obstacles may cause correction; authoritative deaths and scores are final. Reset visual prediction on epoch/match changes, confirmed death and portal discontinuities. Render a bounded cosmetic connector to the local confirmed trail so the head does not detach. Correction smoothing uses elapsed time, not a per-frame constant. Record p95/p99/max correction and correction frequency.

Remote presentation uses a tick-indexed buffer and a monotonic render timestamp. Start with 100 ms delay, adapt within 50–200 ms based on measured jitter, and cap extrapolation at 100 ms. Bounds are proposals to measure, not production guarantees. Discrete effects use the same render time; do not combine future trail collisions with past heads. Mark projectile bounce/portal discontinuities so interpolation never cuts a chord through a wall.

## Alternatives

Current arrival-based extrapolation is rejected: it has neither an applied-input ledger nor a shared integrator. Full-world rollback is not selected because it would reopen confirmed multiplayer collision outcomes and greatly expand determinism requirements. Position-authoritative clients are rejected because they cannot resolve mutually inconsistent trail crossings.

## Acceptance

Injected-clock replay covers straight/constant turn, both turns, press/release inside a tick, late acknowledgement, zero pending input, drift, 30/60/120 Hz render, drunk mode, portal, death, boundary and reset. Fixed-tick kernel results match authority to floating-point tolerance (1e-6 world units) when supplied the same world/inputs. Network-dependent correction budgets are ADR 032 gates, not a promise of exact prediction for unknown obstacles. Crossing-trail cases with unequal latency document host advantage and confirm one outcome. Irregular snapshot arrival preserves monotonic render time and discontinuities.
