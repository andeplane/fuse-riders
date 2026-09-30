# Graveyard Shift

A playable ghost-catching proof of concept in St. Hollow Cemetery. Two to five hunters compete over one 90-second shift. Solo starts with three bots; online rooms support mixed crews, individual screens, and a shared TV with phone controllers.

## Play

Run `pnpm install`, `pnpm build`, then `pnpm exec tsx service/dev.ts --port 8797` from the repository root. The service selects a free port if needed. Open its printed origin followed by `/graveyard-shift/?mute`. The portfolio menu also lists the game. `?mute` is temporary and never writes audio preferences.

Create a room, join the crew, invite friends, and optionally add bots. Every connected human presses **READY**. For a shared screen, check **Shared TV + phone controllers** before creating the room, then open **OPEN TV** and join from phones using the invite. **RECONNECT** retries a failed connection or recovers a page from a peer. A late entrant participates in the next shift.

| Action        | Keyboard / mouse                  | Phone         |
| ------------- | --------------------------------- | ------------- |
| Move and face | WASD or arrow keys                | Direction pad |
| Vacuum        | Hold J or left mouse on the arena | Hold VACUUM   |
| Air pulse     | Space or K                        | AIR PULSE     |

## Rules

- Face a ghost within suction range. Holding vacuum slows movement and drains its resistance ring. Wisps bank 1 energy; wraiths bank 4 and pull hunters toward them.
- When multiple hunters contest a ghost, sustained suction contribution determines ownership after a short tug window. Exact ties use rotating deterministic priority. The tug ends within 24 simulation ticks while contested.
- Tanks hold five ghosts. Carried energy remains unsecured. Stand still at either gold shrine for 1.25 seconds to deposit the whole tank; moving or being hit interrupts it.
- Air pulse knocks back nearby rivals, interrupts suction and releases one of their captured ghosts. It recharges in 3.5 seconds; victims receive brief hit protection. Banked energy is permanent.
- Emergence is telegraphed. At most 18 ghosts exist across the arena and tanks. Depositing removes ghosts and makes room for replenishment.
- Highest banked energy wins after 90 seconds; ties share placement. No health or elimination. Everyone readies again for a rematch.

## Implementation and verification

The integer engine owns gameplay. Rendering reads detached views; it cannot advance the simulation. The existing `RoomRuntime`, shared management entries, WebRTC transport, rollback, snapshot protocol and platform admission are reused. Held controls are scoped to match, round and member generation; cancellation clears pending pulse taps. Checkpoints validate bounds and unique ghost ownership atomically. Bots emit ordinary inputs.

Focused regressions: `pnpm exec tsx --test games/graveyard-shift/tests/*.test.ts`.

Browser smoke against a running local service: `node games/graveyard-shift/preview/smoke.mjs http://localhost:8797/`. It exercises the menu/tutorial, keyboard solo, mixed online crew, guest reload, shared TV, phone controls, result agreement and rematch. Real-flow screenshots are under `preview/screenshots/`.

POC limits: one arena, two ghost types, synthesized audio, and simple directional bot navigation. Platform integration provides room admission; persistent career statistics are deferred. Phone coverage uses Chromium touch emulation, not physical phones or WAN qualification. Nothing in this PR is merged or deployed.
