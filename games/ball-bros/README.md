# Ball Bros — core POC

An unranked solo experiment: you and four bots defend colored cores with orbital paddles. Break enemy armor, save incoming balls and be the last core standing. Ball ownership changes on a paddle hit, but your own ball can still destroy your core.

Run `pnpm dev`, then open the printed server URL at `/ball-bros/?mute`. The Fuse Riders landing page also links here. `service/dev.ts` chooses a free port if the requested one is occupied.

- **A / D** or left/right arrows: counterclockwise / clockwise.
- **W / S** or up/down arrows: reach outward / pull inward. Combine with A/D. The paddle stays the same length: reaching out intercepts earlier, pulling in covers a wider angle.
- **Space**: launch your starting ball after the countdown. Unlaunched balls release automatically after three seconds.
- Touch: left, in, launch, out and right buttons. Multiple movement buttons can be held while launching.
- One core hit eliminates a player. Remaining bots finish the round; restart is always available. A two-minute time limit draws. **Play again** resets through the room log.

This implements phases 0–1 of [the design](../../docs/design/ball-bros-poc.md). Online joining, shared-screen play, avatars, music, pickups, moving bases and ranked reporting are later phases. The service registration rejects all statistics reports and production is not enabled automatically.

The second playtest iteration uses an octagonal arena, bases near its perimeter, and 48 blocks in three dense rings per core. Bases remain fixed; W/S moves only the paddle's orbit. Faint rings show minimum and maximum reach. Straight walls and corner banks change ricochet angles without adding obstacles.

## Ownership

- `src/engine/`: pure state, collision sweeps, bots, rules and validated arena codec.
- `src/online/`: shared RoomRuntime adapter, generation/match-scoped inputs and complete checkpoint/hash.
- `src/render/`: Phaser Canvas presentation and cosmetic interpolation. One app frame loop, no Phaser physics.
- `src/app/`: solo screen, multi-input controls and small synthesized sound effects.

Five 10 ms physics substeps fit inside each fixed 50 ms network-log tick. Core deaths commit together per substep; ball and collider ordering is stable. Physics is capped at eight contacts per ball/substep, stopping the remaining motion if exhausted. Blocks and paddles are base-relative but bases do not move.

## Verification

`pnpm exec tsx --test games/ball-bros/tests/*.test.ts`

`ONLINE_URL=http://localhost:PORT/ pnpm exec tsx games/ball-bros/smoke.ts`

The browser check follows the real menu, starts solo, steers/launches, observes damage, runs to a result, rematches and checks a phone viewport. Screenshots are saved under `artifacts/ball-bros-*.png`. This is browser emulation, not physical-phone evidence. On Windows set `ONLINE_URL` with PowerShell's `$env:ONLINE_URL` syntax.

The `ball-bros-2` golden in `tests/engine.test.ts` records a complete deterministic five-bot match. Change the game rules version and review/refresh its hash for intended physics changes. Fuse Riders' rules and golden remain unchanged.
