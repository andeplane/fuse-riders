# Phase 6C: shared free-play arena

Up to five keepers share one fixed map, dummy and split tree. This increment uses respawning free play without health, scoring, elimination or match reports. Each device can render and play; a seatless display URL can show the same arena while phones run their controls.

The room adapter owns membership and scoped input logs. The engine arena owns keeper motion states and one shared combat state. The existing single-keeper motion kernel remains reusable by both the arena and focused movement tests. Checkpoints store combat once, validate every keeper and seat association, then restore shared references only after validation. Rules advance to `hook-havok-3`.

Each physics step samples eligible opponent hurt shapes before moving any keeper, resolves shots in stable slot order, and applies all player impulses afterward. Terrain wins ties; player slot then dummy/ball ID resolves equal entity contacts. Contested balls belong to the first slot-resolved shot. Targets cannot be pulled; a hit retracts the hook. Keeper bodies do not block one another. Departed/disconnected keepers cannot hit or be hit. Half a second of protection follows spawn/return. Player markers and per-player hit/return counts expose identity and ownership, without treating those counts as scored results.

Personal reset returns that keeper; in a solo room it also resets the trial as before. Manager restart and settings changes reset the shared arena and advance its input scope. Membership generations cancel old controls; public invites contain only a room code, never host/member tokens. Refresh recovers state from peers through the existing shared runtime. The room service continues to signal only, with no simulation server or gameplay relay.

## Playtest

Open `/hook-havok/?mute`, enter the belfry, and copy the invite. Each friend opens that link on their own device or independent browser session. Refreshing the same tab keeps its identity. Open **Shared display** for a seatless TV view. Phones use the existing touch pads and also render their own arena; controller-only pairing is not implemented.

For LAN testing, explicitly allow the exact page origin, for example `node --import tsx service/dev.ts --host 0.0.0.0 --port 56659 --allow-origin http://192.168.50.27:56659` (replace the IP with your computer's LAN address). Binding to all interfaces alone does not allow LAN page requests. If the chosen port is occupied, the service selects another; restart with that port and update the allowed origin to match. Use the same LAN address on every device, including the creator. A localhost invite cannot reach another device. Separate service processes have separate rooms. Production deployment is not part of this phase.

Player rings and labels distinguish the five keepers. Shoot rivals to knock them from ledges; there is half a second of protection after returning. Personal reset affects only you when multiple keepers are present. **Restart shared trial** resets everybody. The next connected manager can change settings when the creator leaves.

## Verification

`tests/multiplayer.test.ts` covers mutual hits, five bounded seats, shared props, corrupt checkpoints, scoped replay, delayed/duplicated/lost packets, refreshed membership, creator departure and session credential handling. `preview/multiplayer-check.mjs` exercises real WebRTC with independent browser contexts, player hit ownership, refresh recovery, late join, a seatless display, shared restart and manager succession. Its diagnostic instrumentation records connection states only, never credentials or signalling payloads. The browser requires ordinary network permissions: the restricted sandbox blocks ICE candidate gathering on this machine.

Remaining design work: physical-phone playtesting, movement/aim tuning, a more reachable ball field, stronger character colour differentiation, and choosing scoring/elimination rules. No cross-device latency or physical-phone qualification is claimed.
