# Phase 3 — Movement playground

The belfry is playable with one keeper and the eight fixed ledges. This phase establishes controllable movement and collision; the authored art showcase remains at `?showcase=1&mute`. No new image files are needed.

## Controls and route to try

- Click **Enter the belfry**, then keep keyboard focus on the scene.
- A/D or arrows: accelerate and brake. Space: jump; release early to reduce height. A short grace period after leaving a ledge and a short landing buffer make near-miss presses forgiving.
- Aim with the mouse. Hold left mouse: fire a hook, attach to the first solid ledge hit, then pull. Release: retract and keep momentum. The hook does not bend around terrain or automatically mantle a ledge.
- R or **Return to first ledge**: restart position. A fall returns automatically after half a second. Switching focus releases controls.
- Workshop: change speed, jump impulse, gravity, air control, pull acceleration or range. Apply restarts the exercise and changes its input scope. Invalid numbers are refused.

Start by walking to the side of the low overhead ledge, jumping around its edge and steering back onto it. Then aim for the central platforms. An underside attachment pulls against the underside; it does not teleport the keeper onto the top. Use **Show collision shapes** to see the solid slab (ornamental supports are not collision surfaces).

## Architecture and tradeoffs

`engine/` imports only itself. Position and velocity use integer subunits (1024 per world unit); movement uses a fixed 60 Hz step, swept axis-aligned collision and deterministic platform-order contact ties. Hook travel uses the same slab sweep. Its states are ready, flying, attached and retracting. No Phaser physics or animation timing controls outcomes.

`online/` adapts the engine to `RollbackGame`. Each shared-log tick is 50 ms, so the adapter runs three physics steps per log tick. Held inputs carry across steps. A press/release within one log tick produces a first-step pulse instead of disappearing. Inputs name match and exercise scope, follow the seat's stream generation, and become neutral when that seat disconnects. This first phase coalesces multiple very rapid taps inside one log tick into one pulse.

Checkpoints include all motion, hook, input, timer and tuning state. Decoding validates bounded values, exact input/settings shapes, hook phases/anchors, clock agreement and terrain overlap, and rebuilds a new room atomically. The deterministic traversal regression restores a checkpoint mid-run and compares continuation hashes.

`RoomRuntime` now allows an explicit minimum player count, default two. Hook Havok selects one, with capacity one and no watchers or bots. It uses the real room API and `PeerTransport`; it does not use the runtime's in-memory solo shortcut. Service registration accepts room admission but rejects all game result reports. Production remains gated by `EXTRA_GAME_IDS`; this change does not enable deployment. A one-seat room is not authenticated-private admission.

Phaser still owns one presentation loop. It reads the view contract and interpolates successive runtime frames. Foot-anchored idle and source-sheet run frames follow the movement state; dedicated rise/fall/landing drawings and richer feedback belong to phase 4. The local clock advances in the shared runtime, independently of graphics. Pointer movement does not flood the input log: aim is recorded with control changes/firing. Debug aim shows the last logged aim.

## Verification

Focused tests cover ground stability, acceleration/braking, variable-height jumps, coyote/buffered jumps, swept landing/wall/ceiling contacts, corner normal, hook attachment/release/miss/obstruction, fall/reset, same-tick taps, stale scope/generation, disconnect cancellation, replay/checkpoint continuation and malformed checkpoints. Shared-runtime tests cover the default two-seat and explicit one-seat start/rematch gates. Service tests admit Hook Havok and refuse another game's join; result parsing rejects reports.

Run the actual browser checks against a freshly built local service:

```sh
node games/hook-havok/preview/movement-check.mjs http://localhost:PORT/
node games/hook-havok/preview/showcase-check.mjs http://localhost:PORT/
```

Use `BROWSER_CHANNEL=chrome` when bundled Chromium is unavailable. The movement check uses actual room creation and keyboard/pointer input, verifies reset, release, focus cancellation, fall/respawn, tuning and failed-service retry. The existing art check verifies stable idle, timeline, responsive sizing, asset retry and synthetic context-loss retry. Screenshot: [movement playground](evidence/movement-playground-desktop.png).

Desktop Chrome is the tested control surface. Phone/gamepad controls, multiplayer synchronization under impairment, audio and movement feel acceptance are later work. Typecheck, lint and production build are checked locally. The full Windows unit run retained eight existing main-branch failures in backend-paths, ci-manifest and new-game tests; a ninth failure from the newly expanded game-registration list was fixed and its service test rerun successfully. The existing large Phaser bundle warning remains.
