# Artillery and close-range support

Rules 9 gives Siege a two-step blind spot: it attacks only targets exactly three
traversable hex steps away. Pulse, Relay, Bastion, Neuron and Brain retain their
existing reach. Siege's cost, health, cadence, volley and supply demands are
unchanged. Protect artillery with shorter-range weapons; a successful close
approach can now bypass unsupported artillery fire.

`attackCells` is the shared weapon contract for combat, retaliation priority,
AI threat assessment, counterbattery positioning and firing-site selection.
`weaponCells` remains general terrain-aware reach, and Bastion protection keeps
its filled radius. Minimum range follows the existing traversable graph metric,
not geometric distance: an obstacle can make a nearby cell three steps away.

When an AI would build Siege but the closest connected enemy is inside the blind
spot, it builds its opening's short-range weapon instead. Siege/Economy openings
use Pulse towers for this support. This preserves artillery at distance while
allowing mixed close-range defenses, without hidden resources or private AI state.

World/checkpoint rules advance to 9 and online compatibility to
`neural-defence-9-skirmish-1`. Rules-8 checkpoints are rejected. New visual replay
evidence must be generated with rules 9; historical recordings retain their
original versions and hashes.

The command card explains the exact range and need for close support before
purchase. Focused tests cover blind distances one/two, firing at three, finite
ammunition, retaliation priority, terrain detours, unchanged shielding, source
immutability, replay and rejection of the previous checkpoint version. Existing
target-priority and cadence fixtures now use legal Siege firing distances.

The isolated comparisons and rejected alternatives are in
`SIEGE_COUNTERPLAY_EXPERIMENT.md`. The selected prototype completed all 21 default
pairings with every strategy winning and losing; it resolved Narrow Front
Pressure/Siege from both starting sides, while Balanced/Relay still stalled.
Those prototype results do not replace committed-source qualification or human
playtesting. Full production verification is recorded at the next milestone.
