# Isolated safe artillery fallback

This candidate is **rejected and not integrated**. Its base is `0f7d326f`, whose engine matches
`99c820e1`. The source patch, manifest and results accompany this note.

At 900 seconds on Narrow Front, Pressure/Relay has six Towers versus six Relays,
no live targets and no damage or losses in the last minute. Both sides reject all
seven threatened short-range firing sites, despite researched, legal, safe Siege
positions and plentiful resources. They build rear neurons instead.

The candidate considers safe, researched artillery only after the selected
short-range weapon fails to produce an admissible firing site. It does not add a
global distance restriction or alter construction costs or combat.

The initial twenty-five probes have zero rejected commands. All 21 default-map outcomes are
unchanged, with no new timeouts; Balanced/Defensive changes from 171 to 160 seconds
and Economy/Relay from 281 to 282 seconds. Both Narrow Front Pressure/Relay seats
finish with Relay winning at 599 seconds. Balanced/Defensive also finishes, with
Balanced winning at 737 and 616 seconds. That starting-side duration difference
needs investigation; the other maps remain unqualified. Do not treat this small
sample as proof of overall balance.

## Complete comparison and rejection

All 210 cases finished: 42 per map, zero rejected commands, 12 timeouts versus
20 under policy 2. There are four new timeout cases: Narrow Front Economy/Relay
and Siege/Relay, both starting sides, previously Relay wins at 382 and 398 seconds.
Eight remaining timeouts are mirrors. The reduction in total timeouts does not
justify silently regressing these two working matchups. Production stays at
`neural-defence-9-skirmish-2`.

The Economy/Relay trace reproduces final hash `67bc4013`. The first changed
decision occurs at 143 seconds: Relay queues Siege 295 rather than Neuron 295.
Neither side has dealt damage, lost structures or built a dedicated weapon.
Relay has no short-range firing sites at all, while the new Siege can target
Economy's Neuron 222. The fallback therefore changes an ordinary pre-contact
opening, not just the demonstrated blocked firing front. At 900 seconds both
sides are trapped in peripheral artillery exchanges with intact brains.

The idle-decision cost was also excessive: on a fixed real Pressure/Relay world
(advanced without commands from tick 18000 to 18100; hash `f3c1d5d0`), 50 calls
after five warmups measured about 5.28 ms median for policy 2 and 39.73 ms for this
candidate. The candidate recomputes identical attack cells inside `enemy.some()`.
A subsequent isolated version computes them once per site. These timings were
collected while tournament processes ran; they are a narrow diagnostic, not
browser or worst-case performance acceptance.

## Focused verification

The isolated candidate passes 20 focused regression cases. The same cases on
unchanged policy 2 pass 16 and fail the four positive Pressure/Relay fallback
cases, in both map rotations. Those four cases verify an accepted construction
dispatch, replay, input immutability, structure-order independence, a target in
Siege range and a position outside enemy weapon coverage. Negative cases cover
missing Ballistics, retained short-range choices, disconnected targets and
unusable close or threatened corridors. The close-corridor case is not an
isolated minimum-range test; the engine's attack-range tests cover that rule.
Review corrected two fixture issues: harvesters now have adjacent deposits, and
the close-corridor test no longer claims to isolate the blind spot.

## Starting-side duration difference

`seat-divergence.ts.txt` exhaustively checks Narrow Front terrain, adjacency and
Siege-range rotation, then compares normalized worlds tick by tick. Both worlds
remain equivalent through tick 5660. At tick 5661, both players request the same
cell (246, or 233 after rotation): Balanced requests a Tower and Defensive a
Bastion. Existing slot-based arbitration grants different players the cell in
the two orientations. An earlier command-order difference at tick 2880 changes
no world state. `seat-divergence.json` records the first divergence and commands.
This explains why durations need not be identical even when AI choices are
rotation-symmetric; it does not alter arbitration or eliminate the need to
compare winners across starting sides.
