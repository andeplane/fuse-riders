# Phase 6A: solo combat sandbox

Two selectable experiments use the existing aimed hook. The movement course and player tuning stay unchanged. A hit retracts the hook; holding never repeats a shot. Platforms win equal-time contact ties and block shots. Targets do not damage or collide with the keeper.

- **Knockback target:** a brass practice effigy on the starting terrace. A shot gives it directional horizontal impulse plus a small upward lift. It collides with the existing platforms, falls, and returns after half a second. Hit and fall counters expose the result.
- **Splitting ball:** one amber orb inside a visible, ball-only containment field in the empty lower-right space (850–1450 × 650–850). Gravity and bounces keep every descendant available. Three sizes produce at most four live balls and seven successful hits to clear. The field is neither a player platform nor a hook anchor. This deliberately isolates aiming/splitting from a future arena-wide hazard system.
- Changing experiment or pressing R resets the trial. An automatic keeper respawn preserves combat progress, with combat paused during the return. No scores, damage, pickups, multiplayer or phone controls yet.

The engine owns entities, hit ordering, impulses, split IDs, counters and last-impact data. All enter the validated checkpoint and hash under `hook-havok-2`. Presentation reads the view contract; code-drawn brass/amber props and bounded impact particles fit the existing palette without requiring new generated artwork. Impact and pop sounds reuse the synthesized effects path and mute handling.

Verification covers first-contact ordering, one shot per press, split limits, reset/respawn, checkpoint rejection and continuation, the unchanged traversal fixture, and actual-room browser interaction. The next design decision comes from playtesting: whether aiming remains enjoyable while traversing, and whether target knockback or splitting merits multiplayer first.

## Playtesting

Enter the belfry, then choose an experiment above the scene. Aim at the effigy's central brass disk or an amber orb. Hold until the hook reaches it, then release to rearm. R or **Restart experiment** restores the trial. Falling preserves progress. The orb field is beyond the starting terrace: practise from its edge or climb to the lower-middle ledge to reach farther orbs. The movement workshop still allows range adjustments, resetting the trial when applied.

Code-drawn props are deliberately an inexpensive art experiment: dark ink silhouettes, warm brass rims and amber cores. They can later receive illustrated sprite replacements without changing their engine shapes. Target body collision is 32 × 52; the circular disk is its 16-unit shot hurt shape. Ball radii are 40, 24 and 14 units. Ball bodies do not collide with one another or the keeper; their field occupies empty space clear of platforms.

Presentation interpolates matching entities between snapshots; split children and returning targets appear directly at their new positions. Particles and two new short sound cues are cosmetic, bounded, and respect reduced motion/mute.

Run `node games/hook-havok/preview/combat-check.mjs http://localhost:PORT/` against the built dev service. This checks the real menu/room path, mode selection, target hit/fall, hold/release, first split, reset, return to movement, narrow layout and mute. It captures [target](evidence/combat-target-desktop.png), [orb](evidence/combat-ball-desktop.png) and [split](evidence/combat-split-desktop.png). These are real gameplay screenshots. Automated checks establish behavior; they do not establish acceptance of combat feel or physical-phone usability.
