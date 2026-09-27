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

The full 210-match comparison runs from this clean source with the production
tournament harness, split into `close-quarters,narrow-front` and
`skirmish-24,open-front,lean-resources`, each at 900 seconds. Results are pending;
do not combine the exploratory trials with that exact-source matrix.
