# ADR-003: Separate display and controller session surfaces

- Status: Accepted
- Date: 2026-09-13

## Context

The TV needs a readable spectator surface while phones need large touch controls, join/reconnect feedback, and protection from accidental browser gestures. Mixing those responsibilities makes the game difficult to operate from across a room.

## Decision

Use two explicit client surfaces: `/display` for the Canvas arena, QR code, roster, countdown, round result, and rematch status; `/controller` for a player colour/name, connection state, and large left/right/bomb controls. Pointer events are used for touch and mouse, with cleanup on `pointerup`, `pointercancel`, `blur`, `visibilitychange`, and component teardown. Controllers send a monotonic input sequence and periodic heartbeat; the server treats missing heartbeats/input as neutral after the watchdog threshold.

The display can request host actions only through a host-authenticated connection bootstrapped from the server-printed URL fragment. The controller QR contains only the LAN controller endpoint. Player names are length-limited and inserted with text APIs. The controller stores its own player token locally for reconnect and offers an explicit “leave” action; it does not expose host controls.

Fresh controllers may claim open seats during `lobby`, `roundOver`, and `matchOver`. Allowing admission at `matchOver` prevents an empty finished room from requiring a server restart; joining alone does not reset scores or start play. New seats remain inactive until the authenticated host requests `rematch`.

Snapshots carry authoritative phase timing, scores, bomb readiness, trails, bombs, and lingering blast geometry, so reconnect never depends on replaying events. Events are effects only. The display receives a complete snapshot on authentication/reconnect and interpolates snapshots for presentation without predicting gameplay.

## Consequences

The TV remains glanceable and the phone interaction remains one-handed. The browser must be kept awake on the host display, and controller UX must explain when the round has started, ended, or lost the connection. Responsive CSS should target narrow portrait phones while keeping controls reachable without scrolling.

## Review resolution

Independent review accepted the split surfaces after host bootstrap, QR contents, touch cleanup, reconnect resync, and controller denial of host actions were made explicit in `docs/architecture.md`.
