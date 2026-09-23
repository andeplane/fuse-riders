# Phase 6B: phone controls trial

This increment runs the solo sandbox on the phone itself. A phone controlling a separate TV and multiple keepers belong to the multiplayer phase. The same room connection, input records, movement rules and combat experiments remain in use; no simulation or wire contract changes.

## Controls

Touch controls appear automatically for a coarse pointer, or enable **Touch controls** above the arena (`?touch=1` also opens the trial). Pads sit below the canvas in portrait and beside it in short landscape layouts; neither covers platforms. Keyboard and mouse remain available. Switching input devices releases the previous device's held actions.

- Left thumb: start on the move pad, slide left/right to move. Slide upward to jump; hold up for height and lower/release to shorten the jump. Sliding diagonally combines movement and jumping.
- Right thumb: start near the center of the hook pad, drag toward the intended target. Crossing its dead zone fires immediately and captures that direction. Keep holding to pull; lift to release. Each new shot needs a new press.
- Compare **8 directions** (default) with **Free aim**. Switching aim mode releases controls. It does not change the simulation or restart the trial.
- Restart uses the existing button. Experiment changes restart the trial as before.

Each pad owns one pointer ID. Extra fingers cannot steal an active pad. Pointer up, cancellation and lost capture release that pad; blur, hidden page, resize/orientation change, mode change, restart and room stop clear both. Pointer capture failure safely declines the press. No aim-move traffic is sent once a hook's direction is captured; unchanged inputs are deduplicated by the existing runtime.

## Physical-phone trial

Build in this worktree, then run:

```powershell
node node_modules/tsx/dist/cli.mjs service/dev.ts --host 0.0.0.0 --port 0
```

On the same network, open `http://<computer-LAN-IPv4>:<printed-port>/hook-havok/?mute` on the phone. `localhost` on the phone means the phone itself. The server serves the existing room API and built game from the same origin. No separate LAN simulation server or relay is introduced. Allow the Node listener on the private network if Windows prompts; this task does not change firewall settings.

Try portrait and landscape, jump while holding a grapple, release the right thumb while continuing to move, switch tabs while holding both pads, and compare the two aiming modes against the dummy and orbs. Record accidental jumps, missed directions, thumb reach and whether the canvas is large enough. Mouse dragging can inspect the controls on desktop, but browser touch emulation cannot establish physical-phone comfort or responsiveness.

The current orb containment field is intentionally separate from the platform route. The user's observation that reaching it requires grappling is recorded for the next arena/rules pass; this controls trial preserves the map.

## Verification

`tests/touch-input.test.ts` covers independent owners, ignored extra/stale fingers, dead zones, direction capture, snapping/free aim, cancellation and bounded aim endpoints. Existing movement, combat and checkpoint tests continue to pass.

`node games/hook-havok/preview/touch-check.mjs http://localhost:PORT/` uses Chrome's native CDP touch dispatch on the real solo room: simultaneous move/jump/hook, independent release, cancellation, dummy impact, rotation, control toggle, mute and viewport layout. It does not inject simulation state. [Portrait](evidence/touch-portrait.png) and [landscape](evidence/touch-landscape.png) captures are from that flow. Desktop movement smoke is also run. These checks are browser emulation, not physical-phone evidence or Safari qualification.
