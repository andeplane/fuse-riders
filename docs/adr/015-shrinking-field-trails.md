# ADR-015: Trim trails to the shrinking field

- Status: Accepted
- Date: 2026-09-13

## Context

Overtime walls shrink while old trail segments retain their original geometry. Neon trails can remain visible on the closed field, and collision geometry no longer matches the playable area.

## Decision

On every playing tick, after computing the authoritative boundary and before pickup placement or collision checks, clip each independent trail segment to the closed playable rectangle. Remove segments completely outside; retain the exact inside portion of crossing segments, preserving creation and expiry ticks. Use a pure typed segment/rectangle clipping helper. Never connect separate retained segments, including portal entry and exit trails.

Apply the same clipping helper to newly committed movement segments, because an immune rider can start outside a freshly advanced boundary and bounce inward. This guarantees snapshots and subsequent collision checks contain only in-field trail centerlines. The closed rectangle retains tangent/edge segments. Keep trail width and collision radius unchanged. Clip the trail rendering pass to the same rectangle so stroke thickness and glow do not spill onto the closed field; other effects retain their current rendering behavior.

The implementation introduces no random state, clock, transport, or physics timing change. Verify exact edges, parallel and zero-length segments, crossings in both directions, independent pieces, overtime removal before collision, immunity bounce and portal discontinuity with deterministic tests.

## Review resolution

Root review accepted the decision before implementation. Tests must include degenerate and tangent closed edges. Fully contained segments can retain their object identity to avoid unnecessary allocation; new movement segments must still be clipped. Trail-only rendering clipping is appropriate.
