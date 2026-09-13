# ADR-018: Paired portal walls

- Status: Accepted
- Date: 2026-09-13

## Decision

Replace round portal gates with paired vertical luminous walls. Each wall starts with length `min(300, playableHeight / 3)` and an 8-unit visible thickness. Gate state stores its center and half-length. Keep the existing 10-second pair lifetime, 15-tick rider cooldown, 10-tick defensive exit grace and heading preservation.

Treat the wall as a vertical capsule, expanded by the rider radius for swept entry. Detect the earliest outside-to-inside contact, including crossing both sides in one tick and rounded endpoint contact. Being inside or moving away is not a fresh entry. Ordinary hazards resolve before teleporting. Record the trail only up to entry, then resume a separate segment at exit.

Map entry height proportionally to the linked wall, preserving top/bottom position even if shrinking has shortened one wall. Exit just beyond the linked wall on the side consistent with horizontal movement; an endpoint approach with zero horizontal movement uses the approach side deterministically. Reject an unsafe or out-of-bounds exit rather than placing a rider into an overlap. Continue using typed injected safety checks and seeded random placement.

Placement stays bounded to 24 candidate walls. Reserve the full wall plus rider clearance inside the field, and conservatively cover its entire length with overlapping safety disks so hazards between endpoints cannot be missed. Require at least 400 units of horizontal separation, preventing overlapping linked walls. If no pair fits, leave the pickup available.

On every playing tick after boundary movement, shorten each wall to its intersection with the safe field and to at most one third of the current playable height. Do not move walls horizontally. Remove the pair if either wall loses usable length or its x coordinate no longer leaves safe clearance. Publish the adjusted geometry before collision and render it in both themes as glowing segmented walls with endpoint caps and direction chevrons.

## Validation

Test swept side and endpoint entry, misses, stationary/inside behavior, earliest hit, reverse transit, proportional exit, unsafe exits, cooldown/grace and exact expiry. Test placement length/separation/full-length hazard checks and bounded failure. Test authoritative overtime trimming/removal, trail discontinuity and wall payload copying. Update the browser fixture and inspect both theme renderings.

## Review resolution

Root accepted before implementation. Safety disk spacing and padding must cover the full capsule, and realistic occupied-field placement must remain useful within the bounded attempt budget.
