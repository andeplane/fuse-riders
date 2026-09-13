# ADR 017: Circular blasts and rare Five Shot

Status: Accepted

Reviewed by root agent before implementation.

## Decision

Replace explosion crosses with authoritative disks: center at the bomb landing position and radius 150 plus 75 per blast upgrade. A disk intersects a moving rider when the movement segment passes within radius plus rider radius. The same disk geometry determines trail removal, bomb chains and portal exit safety. Visible explosions are clipped to the live arena; collision candidates remain constrained by arena rules. Retain instantaneous damage and existing visual lifetime, star and shield behavior.

Add Five Shot alongside Triple Shot. Five Shot arms the next accepted launch with offsets -0.44, -0.22, 0, 0.22, 0.44 radians; Triple remains -0.22, 0, 0.22. The strongest pending volley wins, so collecting Triple cannot downgrade Five. A rejected or cancelled launch keeps the modifier. A successful volley shares charge and cooldown, and any live owned bomb prevents another launch. Round reset clears the modifier.

Use a seeded weighted drop table with Five weight 1 and every other available pickup weight 3. This makes Five one third as likely as Triple without extra scheduling state. Publish Five status and pickup statistics, supply assets for both themes, and use the same fan offsets in TV charge preview as simulation.

## Validation

Pure disk geometry tests cover tangent and diagonal misses plus swept intersections. Engine tests cover diagonal disk hits, chains, clearing and portal safety. Volley tests cover five trajectories, upgrade precedence, cancellation, cooldown, reset, statistics and weighted boundaries with reproducibility. Browser fixtures use disk blast payloads and both themes.

## Consequences

This supersedes the cross geometry in ADR 002 and expands launch modifier decisions. Large blasts affect substantially more arena area; existing range upgrades intentionally remain powerful. Protocol blast geometry changes atomically with server and clients.
