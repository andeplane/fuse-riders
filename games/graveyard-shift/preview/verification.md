# POC verification

Tested on Windows with Node 24.14.0 and Chromium, against a local in-memory room service. Base revision: `472aa7497fe0d097b7d62e85451b478a0e5e96ce`.

- `pnpm build`: pass, including TypeScript. Existing Vite large-chunk warnings remain.
- Affected source/test ESLint: pass.
- `pnpm config:check`: pass.
- Focused game tests: 21 pass. Capture contention, pulse release/protection, capacity, interrupted deposits, global ghost limit, deterministic full-round bots, atomic corrupt-checkpoint rejection, readiness, scope/generation fences, pulse tap/cancel, dropped/duplicated/reordered transport, recovery, rematch, renderer, session and mute preferences. Review regressions cover every spawn and six loaded-bot wall-edge positions.
- `pnpm test` after review fixes: 1,858 pass / 8 fail out of 1,866. All eight failures reproduce on a clean checkout of the base revision: three `backend-paths.test.ts`, four `ci-manifest.test.ts`, and one `new-game.test.ts` assertion. These tests assume Unix paths or LF line endings on this Windows checkout. No assertions were removed or thresholds changed.
- `pnpm test:coverage` on the initial POC commit: the same eight baseline failures make the command exit nonzero. Coverage meets all unchanged thresholds: lines/statements 95.97%, functions 98.49%, branches 95.28%. No coverage exemptions were added.
- `node games/graveyard-shift/preview/smoke.mjs http://localhost:8797/`: Chromium exercises splash, tutorial, keyboard solo, online humans plus bot, reload from peer checkpoint, TV and phone controllers, individual phone play, agreeing results and unanimous rematch. Screenshots show real application flows.

Phone tests use touch emulation, not physical devices. This run does not qualify WAN impairment or production hosting. Audio is synthesized and follows portfolio preferences; browser verification is muted. The PR remains open for playtesting; no merge or deployment was performed.

## Independent review

Gameplay/protocol review found an obstructed spawn and a bot route that could stick on a wall. Both are fixed, including a second check of navigation versus collision padding. The renderer/UI review found landscape phone controls below the viewport and keyboard movement lost while a header button had focus. Both are fixed. Re-review found no remaining actionable findings. The smoke now asserts arena and button bounds before interacting, verifies held phone movement, and checks keyboard movement with a focused header button. Rules are `graveyard-shift-2` after the navigation/spawn changes.
