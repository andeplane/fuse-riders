# ADR 044: instant replay of highlight moments

Status: accepted; implemented in the same change, on top of [ADR 043](043-highlight-moments.md).

## Intent

When a round ends on a play worth talking about, every screen shows it again the way a sports broadcast would: the live view holds for a second, letterbox bars slide in, a chyron names the play and the riders, the clip runs from two seconds before the hit, drops to quarter speed through it with a push-in on the protagonist and a flash at the impact, the bars slide out and a LIVE flag brings the arena back for the next countdown. The match recap offers each reel card again with a WATCH button.

## What the simulation does

Two small, deterministic additions in `src/shared`:

- **A `moment` event.** `step` emits `{ type: 'moment', moment }` for every moment it keeps, so the LAN display (which only sees snapshots and events) and every online view learn about a highlight at its tick with its full copy. The rollback core emits events once per (match, round, tick, index) like every other event, so a rewind that shifts a kill by a tick can announce the moment twice; the replay director deduplicates by `momentKey` (round, kind, protagonist, targets), and the same key makes the recorder hand back one clip for one play. A rewind that undoes the moment cannot retract the event, exactly as for any other event; the presentation may then hold a clip for a play that did not stand, which is the accepted cost of cosmetic events.
- **A longer pause.** A round whose moments include one from this round ends with `ROUND_OVER_TICKS + REPLAY_PAUSE_TICKS` (3 s + 4 s), and the final-round pause before the recap grows the same way. The pause is a pure function of state, so every replica agrees and the LAN server's automatic next round waits with it. The fold rules (`RULES` in `src/shared/apply-tick.ts`) move to `fuse-p2p-3` together with ADR 043.

Nothing else in the simulation changes: no snapshot grows, no geometry moves.

## What the presentation does

`src/client/replay.ts` is presentation only and shared by the LAN display and the online view:

- **Recorder.** Every screen already receives one authoritative `ViewSnapshot` per tick. The recorder keeps references to the last 120 ticks of the current round (no copying) and cuts a clip of 40 ticks before to 16 after a moment once the impact frame has arrived. Up to 16 clips are kept per match for the recap.
- **Timeline.** Wall-clock time maps to clip ticks through a speed ramp: full speed, down to ×0.25 from eight ticks before the impact, held to four after, back to full by ten after. Frames between ticks are interpolated with the same `interpolateWorld` the online view uses. The camera zoom eases to 1.35 on the protagonist's position at the impact and releases after it; an impact flash peaks at the moment's tick.
- **Director.** Moment events queue per round; when a screen sees the phase turn to `roundOver` or `matchOver`, it arms the heaviest moment of that round (the reel's own ranking). The kill that ends a round is on the very tick the pause begins, so the clip is cut only once the 16 aftermath frames have arrived, or with what there is when the one-second hold runs out; the hold is counted from the pause either way. A screen that joined late or missed frames shows nothing and the pause simply passes. Play that moves on under a replay (MAIN MENU, REMATCH, the next countdown, a room ending) cancels it, and the screen undresses through one final `done` frame. While a replay renders, the online view's benchmark samples for that pause are skipped. The director hands each animation frame a clip frame, the zoom and focus, the flash, and the cues (`in`, `impact`, `out`) the audio director turns into stings.
- **Rendering.** A clip renders through the ordinary `presentation.render` under a scope of its own (`<scope>:replay:<key>`), so the Phaser renderer replays bursts and trails from scratch and resets again for live play. The push-in is a CSS transform on the canvas with its origin at the protagonist's screen position (`zoomOrigin` accounts for `object-fit: contain` letterboxing). The dressing (`src/client/replay-overlay.ts`) is DOM over the arena: bars, chyron, slow-motion badge, flash, scanlines and vignette, LIVE flag. The chromatic fringe filter is applied only where `(hover: hover)`, so phones skip a per-frame filter. Shared-TV controller phones have no arena and record nothing.
- **Watch again.** Reel cards whose clip the screen holds get a WATCH button; the LAN recap hides while the clip plays and returns after, the online dialog closes and reopens.

## Limits

- Replays are local footage: two screens with different frame gaps may cut slightly different clips, and a screen with none shows none.
- A moment that a later rewind undoes may still have been announced and clipped.
- Effects are CSS and a canvas transform, not renderer post-processing; there is no motion blur or bloom.
- Browser evidence for the dressing is still owed: the unit tests cover the recorder, timeline, director and cues, not the look.

## Verification

- `tests/replay.test.ts`: recorder window, ordering, clip cutting and bounds; speed ramp and zoom; timeline and stages with interpolation, flash and focus; director selection, cues once each, watch-again, no-footage and match-over cases.
- `tests/moments.test.ts`: the moment event and the longer pauses, and no event for a dropped moment.
- `tests/game.test.ts` and `tests/moments.test.ts`: the moment event rides in the tick's events ahead of `roundEnded`.
- `tests/audio-director.test.ts`: stings after unlock only, silent while hidden.
