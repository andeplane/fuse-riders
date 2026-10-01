# Durable reconnection — AI policy 5

Implementation: `9567b319`, world rules 9, adapter `neural-defence-9-watch-4`.
When the selected flank conduit is also a safe reconnection gap threatened by a
dormant enemy gun, the AI preserves the existing durable repair choice at that
same cell. Finishing shots and critical counterbattery priority remain intact.

The previous Balanced mirror repeatedly rebuilt a neuron, lost it when enemy
guns reconnected, and canceled its finishing Siege before completion. Both
fresh seat assignments now finish in a simultaneous-destruction draw at 572
seconds. Previously both remained unfinished at 1,800 seconds.

## Full comparison

All 210 cases completed: five maps, 21 opening pairs including mirrors, both
seats, and a 900-second cap. The baseline is AI policy 4's retained comparison.
`matrix-manifest.json` locks engine and map hashes; the integrated engine is
byte-identical to the isolated candidate.

- 208 finish within the cap; two reach it (previously 206 and four).
- No new timeouts, winner changes, rejected commands or source/map drift.
- Both Narrow Front Balanced mirrors now finish. The remaining capped cases
  are Narrow Front Pressure/Relay, both seats.
- All swapped-seat outcomes agree. Balanced/Defensive retains its existing
  duration difference, 540 versus 568 seconds, with Defensive winning both.

The default map supports distinct winning openings. Wins against the five other
openings, counting one seat per pair (the other agrees):

| Opening   | Close Quarters | Skirmish | Open Front | Narrow Front | Lean Resources |
| --------- | -------------: | -------: | ---------: | -----------: | -------------: |
| Balanced  |              3 |        3 |          4 |            1 |              0 |
| Pressure  |              1 |        1 |          0 |            3 |              3 |
| Economy   |              2 |        4 |          4 |            2 |              1 |
| Siege     |              4 |        3 |          3 |            1 |              2 |
| Relay     |              2 |        1 |          2 |            4 |              4 |
| Defensive |              3 |        3 |          2 |            3 |              5 |

Pressure/Relay on Narrow Front is excluded from wins because it reaches the cap.
No opening dominates every map; several have pronounced map weaknesses. These
are deterministic AI policies, not estimates of human win rates or proof of
equal strategic strength.

## Focused verification

Eight regressions cover both repair orientations, structure ordering, checkpoint
replay, absence of dormant guns, missing Growth, and an unpaid Bastion queue that
eventually dispatches through ordinary income. Tower is always available under
the same valid-gap constraints as a neuron, so a research-only scenario with
both durable types unavailable is not possible. Independent review's missing
prerequisite and low-resource coverage requests are addressed. All 1,803 repository
tests, typecheck, focused lint and build pass.

Run the exact-source command/replay verifier:

```sh
pnpm exec tsx docs/neural-defence/verification/durable-reconnect-2026-09-27/verify.ts
```

It checks both 572-second Balanced mirrors and the retained 968-second
Pressure/Relay extensions, including every generated AI command and final hash.
The full comparison can be reproduced with the tournament runner:

```sh
pnpm exec tsx scripts/fuse-craft-tournament.ts --maps all --seconds 900 --out /tmp/fuse-durable-reconnect-reproduction
```
