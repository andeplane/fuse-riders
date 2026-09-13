# ADR-013: Orbit Shield defensive pickup

- Status: Accepted
- Date: 2026-09-13

## Context

The arena has several lethal hazards, and a defensive pickup can create a readable last-second escape without adding another permanent health system. The protection must cover exactly one collision transaction and compose cleanly with Star invulnerability and the new launch modifiers.

## Decision

Add an `orbitShield` pickup that arms one shield on collection. A second pickup refreshes the armed state but does not stack additional shields. The shield remains orbiting the rider until consumed or the round ends. Any lethal hazard in one simulation tick—wall, trail, explosion, or rider-body collision—consumes the shield and protects the rider for that entire collision transaction. It does not offensively kill another rider merely because the shield was consumed during head contact; rider collision remains lethal to the opponent only when the ordinary collision rules say so.

After a shield breaks, grant a strict ten-tick (0.5-second) grace window. During grace, wall contact reflects and clamps the rider inside the current safe boundary, matching Star's wall escape behavior, and trail, explosion, and rider collisions cannot eliminate it. Grace is independent from Star state and does not create a second shield. While Star is active it handles hazards first and preserves the stored shield; Star does not restore a shield already consumed.

Shield collection and consumption are authoritative and deterministic. Collection follows ADR-005 swept-path ordering. Round reset clears the shield and grace state. The display shows an orbiting segmented ring, a break flash, and a short `SHIELD 0.5s` grace indicator; these visuals never alter hitboxes or physics. The full snapshot may expose `shielded` and `shieldGraceUntilTick`; compact controller state may expose only the player's own shield/grace status.

Shield composes with Triple Shot and Homing Spark without changing their launch range, target selection, flight, fuse, cooldown, or capacity rules.

## Review resolution

The review accepted consuming both shields when two shielded riders collide, protecting against every hazard throughout the ten-tick grace window, reflecting walls during grace, and preserving a shield while Star is active. Persistent health, multiple stacked shields, and offensive shield damage are outside this ADR.
