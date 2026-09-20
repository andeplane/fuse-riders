# ADR-001: Authoritative LAN server with WebSocket controllers

- Status: **Historical — the subsystem this ADR decided no longer exists.** [#271](https://github.com/andeplane/fuse-riders/pull/271) deleted `src/server/`, with its `/display` and `/controller` routes, the WebSocket snapshot broadcast and the per-seat reconnect tokens. Nothing in the tree is server-authoritative: every game, including solo play and a shared TV with phone controllers, is an online room in which every device simulates the same input log ([ADR 047](047-p2p-input-log-lockstep-rollback.md)). The shared-screen mode survives as `?room=CODE&display=1`, not as a LAN route ([ADR-003](003-display-controller-session-boundary.md)). The text below is the original decision, kept as history; `docs/architecture.md` no longer holds the limits and lifecycles it refers to.
- Date: 2026-09-13

## Context

Five phones need to control one view shown on a TV. The laptop hosting the TV view is on the same LAN as the phones. WebRTC would add peer discovery, NAT, and authority questions even though controllers only need to send input.

## Decision

Run a Node.js server on the laptop. It serves the Vite-built display and controller pages, owns the match, and broadcasts snapshots/events over `ws`. The host display opens `/display`; each phone opens the same QR-encoded LAN controller URL. This trusted household-LAN MVP has no lobby admission token. A separate host-control token is generated on the server and is never sent to controller clients. The server accepts at most five player slots, validates every message, and remains authoritative on disconnects and reconnects.

The display renders complete server snapshots. Phones send input intents only; they never submit position, collision, bomb, or score state. A new player receives a random per-seat reconnect token valid across rounds until explicit leave, expired-seat removal, or server restart. A reconnect atomically replaces any prior socket for that seat. The server rejects non-increasing sequences, applies neutral input after 500 ms without input, and disconnects sockets after six seconds without a heartbeat. There is one shared room for the evening; no room browser or matchmaking is needed.

The server prints a display URL whose fragment contains the host token. The display removes the fragment from browser history and authenticates its WebSocket once; host actions are then authorized by socket role. Fragments never reach HTTP requests. Host and player tokens are excluded from QR payloads, public snapshots, and logs. Exact rate limits, catch-up behavior, and token lifecycles are frozen in `docs/architecture.md`.

## Consequences

The architecture is simple to run over household Wi-Fi and gives every viewer the same state. It depends on the laptop's LAN address being reachable and does not provide internet matchmaking. WebSocket reconnect and clear “waiting for host” UI are required for a phone leaving sleep mode.

## Review resolution

Independent review accepted WebSocket authority after the QR/join contradiction, reconnect duration, host bootstrap, stale input, and recovery limits were made explicit in `docs/architecture.md`.
