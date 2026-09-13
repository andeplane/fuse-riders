# ADR-014: Portal pair pickup

- Status: Accepted
- Date: 2026-09-13

## Context

Portals can add a dramatic escape route to the arena, but arbitrary teleport locations and repeated re-entry could make collisions unfair or difficult to reproduce. The effect needs deterministic placement and a clear interaction with continuous trails and temporary defenses.

## Decision

Add a `portal` pickup that creates one linked pair of safe gates for 10 seconds. Each gate has radius 24 world units. A new portal pickup replaces the previous pair. Placement uses the match seed and 24 deterministic bounded attempts to find two fair interior sites, separated by at least 400 units and kept away from rider heads, bombs, active trails, walls, and each other. If no valid pair is found, the pickup is not consumed and no portals are created. A portal pair is visible in full display snapshots; compact controller payloads omit its geometry.

When a living rider enters either gate, mark it for transit after ordinary collision resolution for that tick, then teleport it to the linked gate while preserving its heading and current movement intent. This prevents a portal from skipping an entry-hazard collision. The exit is clamped to the safe interior boundary. Teleporting keeps the movement trail up to the entry point, breaks the current segment, and does not append a joining segment between gates. The rider receives a fifteen-tick (0.75-second) per-rider portal cooldown after exit, preventing immediate re-entry. The cooldown is per rider and survives pair replacement until its tick deadline.

Portal exit is conservative: if the linked exit is occupied by a rider, bomb, active trail, blast, or unsafe boundary position, the teleport is deferred/ignored for that tick rather than placing the rider into a lethal overlap. Portal transport does not consume Star or Orbit Shield, does not bypass entry hazards. Star and Shield interactions remain separate contracts; an active defense may protect a rider from an unrelated collision on the same tick. Portal grace lasts ten ticks and protects the exiting rider from all hazards without offensively killing another rider; it is separate from Star's visual/invulnerability state.

Portal lifetime, entry, exit, cooldown, and replacement are authoritative simulation state. Round reset clears all pairs and cooldowns. The display may render a pulsing ring and linked tether, but portals never change hitboxes outside the explicit teleport operation.

## Review resolution

Root review accepts bounded placement, post-collision transit, safe-exit checks, 15-tick re-entry cooldown independent of pair replacement, and separate 10-tick defensive exit grace. An unsafe exit skips transit for this tick; the rider continues its ordinary movement. Site clearance must cover the 24-unit gate radius plus rider radius. Portal persistence across rounds, chained portal pairs, and offensive portal effects are outside this ADR.
