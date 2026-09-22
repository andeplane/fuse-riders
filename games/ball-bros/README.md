# Ball Bros — multiplayer POC

An unranked experiment for two to five players and bots, or solo against four bots. Defend colored cores with orbital paddles, break enemy armor and be the last core standing. Ball ownership changes on a paddle hit, but your own ball can still destroy your core.

Run `pnpm dev`, then open the printed server URL at `/ball-bros/?mute`. The Fuse Riders landing page also links here. `service/dev.ts` chooses a free port if the requested one is occupied.

- **A / D** or left/right arrows: counterclockwise / clockwise.
- **W / S** or up/down arrows: reach outward / pull inward. Combine with A/D. The paddle stays the same length: reaching out intercepts earlier, pulling in covers a wider angle.
- **Space**: launch your starting ball after the countdown. Unlaunched balls release automatically after three seconds.
- Touch: left, in, launch, out and right buttons. Multiple movement buttons can be held while launching.
- One core hit eliminates a player. Remaining players and bots finish the round. Solo has a restart button; online, the manager can rematch after the result. A two-minute time limit draws. **Play again** resets through the room log.

This implements phases 0–5 of [the design](../../docs/design/ball-bros-poc.md). Ranked reporting remains later work. The service registration rejects all statistics reports and production rooms are not enabled automatically (`EXTRA_GAME_IDS=ball-bros`).

## Arenas

Choose an arena before solo play or from the online lobby. The manager's selection applies to the next match and survives rematches and peer recovery.

- **Classic Circuit:** the original clean field and 48-block defenses.
- **Crossfire:** 32-block defenses with open attack lanes for faster, more exposed rounds.
- **Ricochet Reactor:** Classic defenses plus five permanent neutral center bumpers. Bumpers redirect balls without changing ownership, speed or armed powers.

## Fuse Frenzy

With 01:00 left, every base begins moving clockwise around the octagon and a neutral ball launches from the center. Another neutral ball appears every ten seconds, up to the shared 20-ball limit. The first paddle to return a neutral ball claims it. A five-second warning, magenta arena pulse and live ball count announce the transition. Speed does not increase: Frenzy pressure comes from the moving formation and the growing rally.

## Power-ups and presentation

Your ball collects power-ups for you, even after it travels across the arena. Paddle hits transfer ball ownership. Neutral balls cannot collect powers.

| Pickup | Effect                                                                                                                                                                  |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shrink | Rivals' paddles shrink to 75% length for eight seconds; stacks twice.                                                                                                   |
| Bomb   | Arms the collecting ball. Its next block hit blasts nearby armor; a paddle hit stuns that paddle for one second. The ball survives; splash never kills a core directly. |
| Sticky | For eight seconds, catches one ball at a time. Space / LAUNCH releases it; automatic release after three seconds.                                                       |
| Thief  | For eight seconds, enemy blocks you destroy repair missing blocks in your base.                                                                                         |
| Split  | Fans the collecting ball into two at unchanged speed/size, retaining ownership and bomb charge. Up to two splits per lineage, twenty balls total.                       |

Pickups appear in the center every four seconds after the first second of play. Effect timers appear on player cards and phone controllers. Ghosted paddles are stunned; white paddles are sticky; gold rings mark Thief; orange halos mark bomb balls.

Choose **YOUR CORE** before solo or joining for an avatar from the shared Fuse Riders sheet. **RADIO OFF** explicitly enables the shared music catalog; **NEXT ♫** changes tracks. The radio starts off, pauses on leaving/reconnecting, and is hidden on shared phone controllers. Use the TV's radio for shared play. The SOUND toggle controls impact effects separately. Missing portrait/music assets leave the game playable.

## Playing together

Choose **CREATE ROOM**, enter your name, and share the room code or QR invite. Friends choose **JOIN ROOM**. The room manager can add/remove bots in the lobby and start with at least two players. Everyone has the full arena on an individual device. A new arrival during a match waits for the lobby; a returning member recovers its existing seat from peers.

For one TV plus phones, check **Shared TV + phone controllers** before creating the room, then choose **OPEN TV SCREEN**. That display takes no player slot. Player devices show large left/right/out/in/launch controls, their color and armor. Keep the display tab visible. The manager uses **PLAY AGAIN** after a result or **BACK TO LOBBY** to change the group. Starts are manager-controlled in this POC.

**RECONNECT** rebuilds the connection and recovers from a peer. **LEAVE** does not end the room for remaining players. A hidden/disconnected player stops moving; their base remains vulnerable. A fast reload clears inputs from the old page's generation. Credentials/preferences are stored per game; live matches are never stored. If browser storage is refused, same-page create/join/reconnect still works, but a full page reload loses that page-only identity.

Use a reachable service URL for other devices: `localhost` invites work only on the same computer. The service signals a direct WebRTC connection and does not relay gameplay; connection failures remain visible with RECONNECT available.

The octagonal arena keeps bases near its perimeter. W/S moves only the paddle's orbit; Fuse Frenzy moves the full formation. Faint rings show minimum and maximum reach. Straight walls and corner banks shape every map, while Ricochet Reactor adds the first internal obstacles.

## Ownership

- `src/engine/`: pure state, collision sweeps, bots, rules and validated arena codec.
- `src/online/`: shared RoomRuntime adapter, generation/match-scoped inputs and complete checkpoint/hash.
- `src/render/`: Phaser Canvas presentation and cosmetic interpolation. One app frame loop, no Phaser physics.
- `src/app/`: solo and online screens, room lobby, TV/phone controls and small synthesized sound effects.

Five 10 ms physics substeps fit inside each fixed 50 ms network-log tick. Core deaths commit together per substep; ball and collider ordering is stable. Physics is capped at eight contacts per ball/substep, stopping the remaining motion if exhausted. Blocks and paddles are base-relative; during Frenzy their base center follows the authoritative inset-octagon formation.

## Verification

`pnpm exec tsx --test games/ball-bros/tests/*.test.ts`

`ONLINE_URL=http://localhost:PORT/ pnpm exec tsx games/ball-bros/smoke.ts`

`ONLINE_URL=http://localhost:PORT/ pnpm exec tsx games/ball-bros/online-smoke.ts`

`ONLINE_URL=http://localhost:PORT/ pnpm exec tsx games/ball-bros/presentation-smoke.ts`

The browser check follows the real menu, selects Ricochet Reactor, starts solo, steers/launches, observes damage, restarts, reaches Fuse Frenzy, runs to a result, rematches and checks a phone viewport. Screenshots are saved under `artifacts/ball-bros-*.png`. This is browser emulation, not physical-phone evidence. On Windows set `ONLINE_URL` with PowerShell's `$env:ONLINE_URL` syntax.

The online check covers create retry, real WebRTC peers, bot seating, reload recovery, agreed results/rematch, creator departure, TV/phone layout and blocked-storage creation/reconnect. Unit tests also inject fast-packet loss/duplication/reordering, hidden inputs and corrupt snapshots. These checks do not qualify physical phones or cross-network connectivity.

The presentation check covers core selection and aborts the optional avatar request to verify that gameplay still starts. All browser runs stay muted. Unit tests cover radio playback/rejection/teardown through a typed media player.

The `ball-bros-6` golden in `tests/engine.test.ts` records a complete deterministic five-bot match including authoritative map state, powers, Frenzy motion/pressure and complete checkpoints. Old Ball Bros clients must refresh before joining this version. Change the game rules version and review/refresh its hash for intended physics changes. Fuse Riders' rules and golden remain unchanged.
