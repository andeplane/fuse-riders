# Defensive opening follow-up — 2026-09-27

Source `84b2ed3b3d5fe17addc1e3146a8c07085cc4c0ee`, action rules 5, online compatibility `neural-defence-5-skirmish-2`.

The old Defensive policy tried to establish range-one weapons only once enemies were already adjacent. It also spent its opening on harvesting and lateral expansion. Its default-arena matrix lost to every other policy and timed out against itself.

The new opening researches Ballistics earlier, postpones economic specialization, establishes up to two spaced Bastion anchors on safe tiles two or three steps from the living enemy network, then uses artillery behind that line. Lost anchors can be rebuilt. All choices still use public state, ordinary commands, the shared affordability/placement rules and normal construction/supply timing. Other policy definitions and action resolution are unchanged. The online tag changed because AI commands are emitted inside synchronized match ticks.

## Exact-source trials

Each unordered pair is run in both starting positions, including mirrors, with a 900-second cap. Rows preserve the source, policies, durations, outcome, hash and player metrics. A timeout is not a draw.

- [Close Quarters: 42 matches](verification/defensive-2026-09-27/close-quarters.jsonl): **30 decisive wins, ten actual draws and two timeouts**. All 30 non-mirror matches finish. Only Relay versus itself times out. Defensive now beats Pressure in **168 seconds** and draws against itself in **188 seconds**. Balanced beats Defensive in 188 seconds; Economy in 236; Siege in 168; Relay in 137. The other matchups retain their prior outcomes.
- [Twin Pass: 12 matches](verification/defensive-2026-09-27/twin-pass.jsonl), covering Pressure, Siege and Defensive: **all time out**. The prior Pressure–Defensive result was a Pressure win at 453 seconds. The new opening survives, but cannot finish. This is a bounded check on a second layout, not a complete new five-map matrix.

The opening now has a useful anti-pressure role; it is not equally strong against every opponent. The choke-map stalemate remains an explicit failure to resolve, and the broader balance goal stays open. Do not infer human competitive balance from six handcrafted policies.

All 54 matches accepted every emitted command. Swapping starting positions preserves result and duration in every pair. The tournament independently replayed a representative recorded-command match on each map and verified its final hash.

## Verification

All 1,702 repository tests passed, plus 18 focused network tests after changing the compatibility tag. Build/typecheck and lint passed. Independent review found the missing compatibility bump, which was fixed. The new regression verifies pre-contact Bastion placement, accepted ordinary commands and input immutability.

Reproduce:

```sh
pnpm exec tsx scripts/fuse-craft-tournament.ts --maps close-quarters --seconds 900 --out /tmp/fuse-anchor-close
pnpm exec tsx scripts/fuse-craft-tournament.ts --maps narrow-front --strategies pressure,siege,defensive --seconds 900 --out /tmp/fuse-anchor-narrow
```
