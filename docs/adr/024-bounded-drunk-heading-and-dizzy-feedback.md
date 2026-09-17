# ADR-024: Bounded drunk heading and stronger dizzy feedback

- Status: Accepted; root reviewed before implementation. The waveform and its 15 degree bound are superseded by [ADR-046](046-drunk-stagger-and-lurch.md)
- Date: 2026-09-13

## Decision

Replace accumulated angular noise with an explicit heading offset bounded by 15 degrees. The offset follows a deterministic two-second sinusoidal cycle with a seed/player-dependent direction, a smooth half-second onset, and a smooth half-second fade to zero before expiry. Keep the current four-second effect duration. Refresh extends the deadline without restarting the onset or phase.

Store the prior applied offset and effect start tick in authoritative player state (not additional visual protocol). Each movement removes the prior offset, applies ordinary steering, then adds the new bounded offset. This prevents angular random walk and returns to the intended heading at expiry. Hazard reflections transform the stored offset consistently with the reflected angle. Round setup clears both internal fields.

Increase the dizzy feedback with bright orbiting stars, a double orbit, and an explicit DIZZY countdown below the rider. Avoid per-particle shadow blur; keep the effect visually obvious while preserving rendering performance.

## Verification

Integrate offset deltas over many seeds and ticks and assert at most 15 degrees of deviation, zero residual at expiry, a two-second cycle, deterministic output, and refresh without restarting the phase or accumulating drift. Engine tests compare ordinary and affected steering trajectories by heading and verify expiry and reset. Browser fixture validates the stronger aura.
