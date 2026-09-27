# Changing approach after attrition

Repeatedly replacing artillery on the same front can consume construction turns
without approaching the enemy brain. The Synaptic Reach Balanced/Pressure
diagnostic showed a safe route that began with a sideways step: Alpha could move
206 → 207 → 208, but the first step did not improve plain brain distance. The
firing-site choice kept winning over the safe-expansion fallback.

Policy `neural-defence-8-skirmish-5` preserves each strategy's opening, resources,
research and finite supply rules. After two paid-site losses or eight completed
structure losses, an army with at least two fighting structures searches for a
safer approach. It computes route costs from enemy brains over open terrain:
one per step, six per covering active weapon, twelve per occupied enemy cell.
Those values are planning penalties, not simulation damage or movement rules.
Only a legal, unthreatened perimeter cell that improves the best owned route cost
can become a new neuron. Otherwise ordinary repair and combat choices remain.
The existing sustained-attrition counterbattery response can still take priority.

When a firing site remains exposed after two paid-site losses, the AI first
builds a Bastion if ordinary prerequisites allow it and no connected friendly
protector covers the site. It must still pay, build, connect and supply that
Bastion. No free shielding or duplicated protective construction is granted.

The policy uses public checkpointed state, home-relative tie ordering and ordinary
commands. It keeps no private timers, random state or match history. Engine rules
remain 8; the online policy ID changes because generated commands change.

Regressions cover trigger thresholds, legal dispatch, replay, unchanged input
state, reversed structure ordering, rotated starts and existing protection.
Exploratory default-map pairings retained all winners and completed every game;
several formerly stalled wide-map cases finished. These diagnostic single-seat
trials motivated the implementation, but the full committed-source matched-seat
comparison remains necessary before claiming multi-map balance.

## Verification milestone

Source `8e702b82` passes all **1,736 repository tests**, typecheck, build and
focused lint. Chromium and WebKit pass the ordinary desktop, portrait and
landscape menu/game flow. These checks do not replace full-match balance or
physical-phone playtesting.

Independent review found no blocking issue. Its requested detour coverage now
proves that the chosen safe cell is six steps from the brain while an existing
gun is only five away; blocking that safe cell produces a different legal route.
Both cases are checked with rotated starts. The counterbattery override is
deliberate: an existing repair gap threatened by dormant guns can still require
clearance before expansion.

The full 210-match comparison completed from this clean source with the production
tournament harness, split into `close-quarters,narrow-front` and
`skirmish-24,open-front,lean-resources`, each at 900 seconds. The exact matrix and
both manifests are retained in `verification/reactive-approach-2026-09-27/`.
There were no rejected commands. All 105 swapped-seat pairs agree on result,
duration, first contact and every reported player metric; state hashes differ
because the seat positions differ.

| Map            | Policy 4 timeouts | Policy 5 timeouts | Policy 5 mutual destruction |
| -------------- | ----------------: | ----------------: | --------------------------: |
| Close Quarters |                 0 |                 0 |                          12 |
| Narrow Front   |                26 |                24 |                          12 |
| Skirmish 24    |                14 |                 8 |                          12 |
| Open Front     |                18 |                14 |                           8 |
| Lean Resources |                12 |                 6 |                           6 |

Each map has 42 matches. Overall timeouts decreased from 70 to 52. A timeout is
unfinished at the 900-second cap, distinct from both brains being destroyed.
The aggregate improvement hides three new Skirmish 24 stalled pairings:
Balanced/Siege, Pressure/Economy and Economy/Relay. This is not complete multi-map
balance. Policy 4's sampled removed-job counter is not comparable to policy 5's
authoritative `sitesLost`; the new harness retains the former heuristic under
`unfinishedPaidJobsRemoved`.

## Securing the approach (policy 6)

A new artillery site can survive enemy fire yet lose its only connection before
construction finishes. After two paid-site losses or eight completed losses,
policy `neural-defence-8-skirmish-6` reinforces an existing adjacent anchor with
a Bastion before extending to an exposed empty destination, if every available
anchor is threatened. Any safe connected anchor preserves the original build.
Ordinary research, affordability, protection and construction checks still apply.
This changes AI commands only; engine rules remain 8.

The regression covers the loss threshold, legal reinforcement, deterministic
replay, unchanged input state, missing research, existing protection and an
exposed empty destination with a safe anchor. Exploratory trials restored a
Pressure/Economy finish at 752 seconds and preserved all 21 default-map pairing
results and durations. Balanced/Siege and Economy/Relay still reached the cap.
These temporary-policy trials are diagnostic evidence; committed-source
verification is recorded separately.

Source `1e00805e` passes all **1,738 repository tests**, typecheck, build and
focused lint. Its committed-source Skirmish 24 run uses `--strategies
pressure,economy --seconds 900`: all six matches finish with no rejected commands.
Pressure mirrors mutually destroy at 755 seconds, Economy mirrors at 656 seconds,
and Economy beats Pressure at 752 seconds from either seat. All three swapped-seat
pairs agree on result, duration, contact and every player metric. The manifest and
results are in `verification/secure-approach-2026-09-27/`. This targeted check does
not replace the remaining full policy-6 map comparison.

Review found no blocking issue and requested stronger safe-anchor coverage. That
case now removes the destination's existing neuron, proving an exposed empty site
remains the chosen build when its connected adjacent anchor is outside enemy range.

Chromium and WebKit pass the normal desktop, portrait and landscape menu/game
flow. The first WebKit run exposed a one-shot reduced-motion style assertion
returning an empty string, consistent with reading a replaced SVG node. The smoke
now queries the current connected node and waits for the required `none` style;
both browsers pass the corrected flow. This test race is tracked in issue #250.
Independent review found no blocking issue in the fix. Physical-device and human
visual acceptance remain open.
