# ADR-011: Triple Shot one-use pickup

- Status: Accepted
- Date: 2026-09-13

## Context

The charged bomb launch creates a strong tactical moment. A rare upgrade can add variety by turning one accepted launch into a forward fan without introducing another persistent resource or cooldown track.

## Decision

Add a `triple` pickup that arms the collecting rider's next successful bomb launch. The armed state is one pending use and does not stack; collecting another `triple` while armed refreshes the same armed state. On an accepted release, consume it and launch exactly three bombs at relative angles `-0.22`, `0`, and `+0.22` radians around the release direction. Each bomb uses the same authoritative charged range and six-tick flight, has its own fuse/chain identity, and can explode or chain independently after landing. The volley shares one four-second cooldown, and its three bombs count as one active volley for capacity: another launch is blocked until all three are gone and cooldown is ready.

Cancel, disconnect, watchdog neutralization, death before release, and invalid/stale release do not consume the pending upgrade. Bomb actions are applied only after that tick's collision transaction, so a rider eliminated on the release tick creates no volley and retains no usable in-round state. Only creation of the three-bomb volley consumes the upgrade. Round reset clears the armed state. `bombsPlaced` counts the three physical bombs, and match stats include a `triplePickups` counter. Triple-shot does not change ordinary bomb range or collision geometry.

The TV and controller show a compact armed indicator and fan preview. The server remains authoritative for the pending flag, accepted release, and resulting projectile set.

## Review resolution

The review accepted a `0.22` radian fan, one active volley until all its bombs are gone, and `triplePickups` in match statistics. Extra charges, wider fans, and persistent stacking are outside this ADR.
