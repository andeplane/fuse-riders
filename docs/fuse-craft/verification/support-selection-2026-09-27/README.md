# Local support-selection experiments

Base engine: `290c4086add601da89249a79544036a3d499208d`, unchanged through
`2ce780ab`. These are isolated unshipped AI variants, not production qualification.
Copy the engine directory to a temporary directory, apply the recorded AI diff,
place the runner there as `.ts` and run with `pnpm exec tsx`. Runner map paths
refer to the originating checkout. All runs cap simulation at 18,000 ticks
(900 seconds) and use ordinary AI commands and simulation steps.

The safe-artillery candidate retained Siege selection at a close front whenever
an eligible, unthreatened artillery site could hit a connected enemy. This tests
whether the production global nearest-enemy fallback discards useful artillery
positions elsewhere in the network.

All 21 single-seat default-map pairings and eight swapped-seat Skirmish probes
completed with no rejected commands. The candidate is **rejected**: default-map
Economy/Defensive regresses from an Economy win at 296 seconds to a timeout.
Skirmish Balanced/Relay and Balanced/Defensive improve to Balanced wins at 512
and 548 seconds respectively from both seats, but Balanced/Economy and
Pressure/Siege still time out. The improvements do not justify the default-map
regression. Exact rows and the unapplied patch are retained here.

## Rejected mixed-support follow-up

A second variant retained safe artillery only when no owned Siege could already
fire. All 21 default-map pairings finished without rejected commands, but six of
eight Skirmish probes timed out. It regressed Balanced/Defensive's previously
finishing second seat to a timeout, while resolving Pressure/Siege to Siege wins
at 822 seconds. Balanced/Economy and Balanced/Relay still stalled from both
seats. This variant is also rejected; the same runners produced the
`mixed-support-*.jsonl` rows. Neither patch is applied to production.
