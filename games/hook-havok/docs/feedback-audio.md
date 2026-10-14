# Phase 4 — Feedback and audio

This phase improves what movement communicates without changing engine rules, collision shapes or tuning. The user likes the early direction but wants to discuss the jump mechanics separately.

## Presentation

The renderer derives idle/run/rise/fall/land/fire/pull states from the engine view. Landing briefly compresses the keeper around the foot pivot and emits dust. Hook attachment flashes at the actual anchor; the attached tether becomes brighter and thicker. Release and respawn add a short ring. Airborne states reuse selected source-sheet poses with restrained stretch/lean; these are not new hand-drawn jump clips or a skeletal rig.

`render/feedback.ts` owns only cosmetic history. It accepts advancing ticks, ignores repeated or rolled-back frames, expires bursts after 400 ms and retains at most twelve. Room replacement and explicit exercise resets clear that history. Reduced motion disables pose distortion and replaces traveling bursts with small fading markers. The authored showcase remains separate and unchanged in behavior.

## Audio and reuse

Six short oscillator effects cover jump, landing, firing, attachment, release and respawn. The audio context is lazy and gesture-unlocked. There are at most six simultaneous voices; ended nodes disconnect, focus loss silences voices, and page disposal closes the context. Effects default to 30% and have their own slider.

The shared catalog/export and Fuse Riders import/reexport adopt the existing Ball Bros change from commit `06b5fc2d` (PR #401), using the same `fuse-ui/assets` API and identical catalog, rather than creating a competing extraction. No unrelated Ball Bros code is merged. `fuse-ui/radio` adapts that branch's small opt-in radio controller into a shared module with volume control. Existing recordings remain under `public/music`; nothing is copied or generated. Fuse Riders retains its richer radio UI and persistence.

The playground radio starts only through **Play radio**, supports **Next track**, follows track-end progression and reports failed playback with retry/next controls. Music defaults to 18%. Both channels pause on window blur or hidden-page transition. Music requires another click to resume; effects unlock on the next gesture. `?mute` disables both, never creates an effects context, and avoids selecting/fetching a music track. These controls do not write persistent preferences.

## Checks and limits

- Typecheck, lint and production build pass; the existing large Phaser bundle warning remains.
- Full Windows suite: 1,630 tests, 1,622 passed, the same eight previously reproduced main failures in backend-paths, ci-manifest and new-game. Feedback/audio and shared/Fuse Riders radio tests pass.
- Desktop Chrome browser flows pass for gameplay, muted audio controls/no music requests, graphics retry/new-room feedback, service retry and the prior authored showcase.
- [Actual hook feedback and controls screenshot](evidence/feedback-audio-desktop.png).
- Audio lifecycle is tested with injected media/tone fakes. Automated browser runs remain muted; subjective sound balance and physical-device playback need user listening. New jump drawings, richer sound assets and movement retuning remain future iterations.

Run the game at `/hook-havok/` without `?mute` to listen, then click **Enter the belfry** and optionally **Play radio**.
