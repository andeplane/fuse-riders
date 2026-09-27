# Rules 6 balance baseline — 2026-09-27

**The current game is not yet balanced.** Timed neuron specialization works, but the default arena now has a dominant Pressure opening and Twin Pass remains largely stalled. This report preserves negative results so subsequent work can be evaluated against them.

Authoritative source: `4418838b3168f1e10fa602dca940700edd0d6df1`, action rules 6, online policy tag `neural-defence-6-skirmish-2`. Each tournament started with a clean tracked working tree. Later commits only record evidence/design notes and refresh a graphics replay.

## Complete matrix

[All 210 match records](verification/rules6-2026-09-27/matrix.jsonl) use six ordinary-command policies, 21 unordered pairs including mirrors per arena, both starting positions and a 900-second cap. No extra resources, accelerated rules or privileged actions were used. These are deterministic handcrafted policies, not independent statistical samples of human play.

| Arena          | Decisive wins | Actual draws | Timeouts |
| -------------- | ------------: | -----------: | -------: |
| Close Quarters |            30 |           10 |        2 |
| Synaptic Reach |            18 |            0 |       24 |
| Open Synapse   |            16 |            0 |       26 |
| Twin Pass      |             2 |            0 |       40 |
| Scarce Reach   |            30 |            2 |       10 |
| **Total**      |        **96** |       **12** |  **102** |

**108/210 matches finish.** Every emitted command was accepted. All 105 swapped-seat pairs match in outcome, duration, first contact and recorded player metrics. A representative logged-command match on every map independently replayed to the same final state hash.

The original rules-5 expansion matrix finished 100/210, but this is not an isolated test of specialization: defensive policy and supply decisions also changed since that historical source. Higher completion alone does not establish better balance.

## Default-arena counter table

All 30 non-mirror matches finish, but Pressure wins every matchup. Relay mirrors are the only timeouts. Other mirrors end in mutual-destruction draws.

| Opening   | Beats                                      | Loses to                  |
| --------- | ------------------------------------------ | ------------------------- |
| Balanced  | Economy, Defensive                         | Pressure, Siege, Relay    |
| Pressure  | Balanced, Economy, Siege, Relay, Defensive | None                      |
| Economy   | Siege, Defensive                           | Balanced, Pressure, Relay |
| Siege     | Balanced, Defensive                        | Pressure, Economy, Relay  |
| Relay     | Balanced, Economy, Siege, Defensive        | Pressure                  |
| Defensive | None                                       | Every other opening       |

This contradicts the desired varied counterplay. The earlier rules-5 defensive opening's anti-pressure result no longer applies. Further work must restore useful defensive counterplay and address narrow-map stalemates before claiming completion.

## Rejected reserve experiment

A six-match trial gave Defensive up to two low-priority Bastion ammunition reserves while active guns retained priority three. Pressure still won both non-mirror matches at 141 seconds. The change was removed. [Exact candidate patch](verification/rules6-2026-09-27/reserve-trial.patch), based on `f42bd8db` (same AI as `4418838b`), and [raw results](verification/rules6-2026-09-27/reserve-trial.jsonl) are retained. This experiment did not add a protective field; [supplied defensive support](DEFENSIVE_SUPPORT_DESIGN.md) remains only a design hypothesis.

## Verification and reproduction

- 1,709 repository tests passed; build/typecheck and lint passed. Independent specialization and AI reviews found no actionable issues.
- Chromium and WebKit passed normal-time neuron specialization with actual resources on desktop and phone, including ghost, clock, retained source and one completed tower. [Screenshots and behavior](NEURON_UPGRADES.md).
- Current-rules combat replay reproduced hash `c412ba31` after 3,360 ticks; both browsers rendered diagnostic depth/effect frames on desktop and phone. This is not human playtest or physical-phone evidence.

```sh
pnpm exec tsx scripts/fuse-craft-tournament.ts --maps all --seconds 900 --out /tmp/fuse-rules6
pnpm exec tsx scripts/fuse-craft-upgrade-smoke.ts
pnpm exec tsx scripts/fuse-craft-effects-smoke.ts
```

Keep the broader goal active: successful construction UX and reproducible matches do not establish balanced strategy or the requested AAA visual quality.
