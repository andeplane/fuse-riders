# Phase 9A — Lift & Ward trial

Create a fresh room, then choose **Room & match → Power-ups → Lift & Ward**. The manager controls this shared setting; changing it restarts the trial. It defaults off. All clients must refresh for `hook-havok-9`.

Touch the green Lift rune to launch upward and release your hook. It preserves your existing double-jump reserve. Touch the blue Ward rune to block rival hook hits for five active seconds; falls still count. Ward ends on death, personal reset, disconnection or a new connection generation. Its bubble and countdown identify protected keepers.

Both maps have two shared pads. A collected pad recharges after ten seconds of active play; personal resets do not refill it. Waiting/countdown/results freeze pickup timers. New rounds and shared setting changes reset them. Pad positions and tick constants live in [power-ups.ts](../src/engine/power-ups.ts).

The deterministic engine owns collection, timers and effects. Contact resolves after movement and rival impacts, so collecting Ward does not undo a hit from that tick. Stable player-slot order breaks simultaneous claims. Eliminated players, late watchers and respawning/disconnected keepers cannot collect. Checkpoints validate and copy timers and bounded event history. The renderer only presents these facts; reduced motion removes rune bobbing and simplifies collection bursts.

This first trial deliberately uses fixed shared pickups to test movement opportunities and contestable protection before adding random drops or an inventory. No score bonus or new ball damage rules are introduced. Balance and appearance await user playtesting.

## Preview

From the repository root in PowerShell:

```powershell
.\games\hook-havok\preview\start.ps1
```

This builds and runs the local service. Keep the terminal open; Ctrl+C stops it. Use `-SkipBuild` only with a current build. The service chooses a free port if 8788 is occupied and prints its URL. Open `/hook-havok/?mute` on that port.

## Verification

- Typecheck and production build pass. Hook Havok tests: 80/80, covering pickup contention, expiry, actual falls, disconnect/generation changes, inactive/watchers, malformed checkpoints, replay/restore on both maps and feedback ownership/deduplication.
- Full repository suite: 1686/1694 pass; the eight known Windows baseline failures remain in backend paths, CI manifest and new-game scaffolding (see [baseline record](art-production.md#verification-record)). No assertions were weakened.
- `node games/hook-havok/preview/power-ups-check.mjs http://localhost:8788/` passed in real Chrome: two-player collection, Ward replication, Lift launch, manager-only setting, guest refresh, both maps, disabling pickups and a 390px viewport with no horizontal overflow. No page errors. This is desktop browser emulation, not physical-phone evidence.
- Source review found no blocking issue. Its requested fall/watcher/feedback regressions were added. Post-impact acquisition is explicit in engine ordering; same-tick hit/acquisition has not received a dedicated browser test.
- Actual browser screenshots: [Ward](evidence/powers-ward.png), [Lift](evidence/powers-lift.png), [narrow viewport](evidence/powers-phone.png).

The preview server previously had no listener; restarting it restored HTTP 200 for the game and health endpoint. The launcher documents its lifetime so stopping a session is not mistaken for a game failure.
