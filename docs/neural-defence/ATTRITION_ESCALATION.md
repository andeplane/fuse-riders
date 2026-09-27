# Counterbattery escalation after sustained losses

Immediately building counterbattery artillery for an isolated supply cut caused
the Twin Pass Pressure and Relay mirrors to change from completed games into
900-second timeouts. Extra ammunition for an active Bastion, waiting for
clearance, and target-health-based ammunition ordering did not resolve them.
The active-Bastion experiment also timed out at 1,800 seconds. Those experiments
are not part of the final policy.

The AI now tries its existing durable repair first. It escalates to a safe Siege
position only after losing at least three buildings and at least half as many
buildings as completed construction jobs. Jobs include upgrades, so this ratio
is an attrition heuristic rather than the fraction of buildings destroyed.
The existing public, checkpointed construction
and loss statistics drive this decision; there is no map-name exception, hidden
memory, artificial damage, or extra resource grant. Counterbattery construction
still requires Ballistics, a legal connected site, and ordinary resources.
Existing counterbattery guns retain their ammunition reservation.

Engine rules remain 7. The online AI policy becomes
`neural-defence-7-skirmish-4`, since the generated command sequence changes.
Tests cover the minimum loss count, loss fraction, ordinary repair before
escalation, legal counterbattery dispatch, and finite supply reservation.

Initial diagnostic mirrors with the earlier active-Bastion weighting finished
at 450 seconds (Twin Pass Pressure), 440.5 seconds (Twin Pass Relay), and 452
seconds (Close Quarters Pressure). The final candidate restores the original
ammunition weighting to isolate construction policy. These exploratory results
are not exact-source tournament evidence; the complete comparison is pending.
