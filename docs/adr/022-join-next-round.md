# ADR-022: Join during a round

Status: Accepted after review, 2026-09-13

Accept new controllers whenever a seat is free. A player added during countdown or play starts inactive and stays outside the immutable current-round participant set. The next prepareRound includes connected waiting players automatically. Waiting players cannot collide, fire, collect pickups or receive current-round placement points. Reconnection preserves their reserved seat.

Expose a derived waitingForNextRound flag in snapshots when a player is absent from the current participant set outside the lobby. The controller explains the wait rather than claiming the player died. If the current round ends the match, the waiting player enters on rematch. Keep five-seat limits, token checks and join throttling unchanged.

Validate through real serialized WebSocket joins in countdown and play, inactive input, scoring exclusion, reconnect, and automatic next-round activation.
