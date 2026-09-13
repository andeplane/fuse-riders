# ADR-021: Ink cloud pickup

- Status: Accepted; root reviewed before implementation
- Date: 2026-09-13

## Decision

Add ordinary-weight (3) Ink pickup. Collection sets each other living rider's `inkUntilTick` to current tick + 20 (one second), refreshing rather than stacking. Collector is excluded, and collecting Ink does not clear an existing effect. The effect changes no movement, collision, launch, or invulnerability rule and resets at the next round.

Draw dark opaque animated ink clouds centered on affected riders on the TV arena only, never the HUD. Cloud radius is about 130 world units. Carve a clear 80 unit circle around every unaffected living rider, including the collector, using an offscreen layer so overlapping clouds cannot darken the protected area. Visual shape uses deterministic tick/id trigonometric offsets, without mutating simulation state. An already inked collector remains affected by their prior debuff; immunity to one's own pickup is not a cure.

Snapshots carry the deadline; controller displays an affected countdown. Both themes get an ink icon, legend explains one-second rival clouds, and match statistics count ink collections. Exact expiry and round reset follow other timed effects. Use typed engine state and renderer inputs, deterministic seeded pickup selection, and unit/browser validation.
