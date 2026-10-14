# POC verification

Verified on macOS with Chromium and a local in-memory room service on 2026-10-14, after merging `origin/main` (`01266922`). Original PR head `9559854f` remains an ancestor; this update preserves the existing PR history.

After Ball Bros and PeerTransport dependency injection landed, merge `b78c5f97` integrates main `bdd0c792`. The three shared adjacency conflicts retain both games in dependencies, registrations and service assertions. Graveyard source is unchanged from `6d4a25b8`; the generic coverage runner, collector, existing game manifests and PeerTransport match main exactly. Fresh independent review found no actionable issues. All 71 focused Graveyard, service/image, isolation, CI-manifest and peer transport tests pass, as do TypeScript, build and affected lint. The completed full-suite and native browser evidence below is retained; no full suite or browser run was repeated for this adjacency-only merge.

- `pnpm build`: pass, including TypeScript. Existing Vite large-chunk warnings remain.
- Affected source/test ESLint: pass.
- `pnpm config:check`: pass.
- Focused game tests: 23 pass. Capture contention, pulse release/protection, capacity, interrupted deposits, global ghost limit, deterministic full-round bots, atomic corrupt-checkpoint rejection, readiness, scope/generation fences, pulse tap/cancel, dropped/duplicated/reordered transport, recovery, rematch, renderer, session and mute preferences. Review regressions cover every spawn and six loaded-bot wall-edge positions. Fresh name edits wait for JOIN CREW; remembered names restore once.
- CI-manifest and service integration tests: 19 pass.
- Full unit discovery at `08d1fb6c`: 3,462 pass, zero failures. Command: `pnpm exec c8 --check-coverage=false tsx --test --test-concurrency=2 tests/*.test.ts packages/*/tests/*.test.ts games/*/tests/*.test.ts`. All seven earlier native browser recordings were rechecked against 70 mapped source files, copied into `coverage/tmp`, then combined with `pnpm exec c8 report --temp-directory coverage/tmp --exclude-after-remap`. Both commands exit zero. Combined coverage: 97.46% lines/statements, 97.96% functions, 95.59% branches. No exclusions or thresholds changed.
- `pnpm exec tsx games/graveyard-shift/preview/smoke.mjs http://localhost:8821/ /tmp/graveyard421-screens`: pass against the built application. Covers splash, tutorial, solo keyboard play, online humans plus bot, reload from a peer, shared TV and phone controllers, held touch movement, complete 90-second results and unanimous rematch. Host and guest results agree; the result screenshot shows 34 banked energy. No browser errors. Committed screenshots show these real flows.

The browser coverage manifest runs the same real flow against Vite source through `pnpm test:coverage`. Chromium's native execution ranges are remapped only after the source-map content matches current files. Coverage thresholds and exclusions remain unchanged.

Phone tests use touch emulation, not physical devices. This run does not qualify WAN impairment or production hosting. Audio is synthesized and follows portfolio preferences; browser verification is muted. Platform integration is admission-only; persistent career reports are deferred.

## Independent review

Fresh subagent review found a checkpoint stage coercion bug: an array containing `running` could be installed as the stage and freeze simulation after recovery. The decoder now accepts only exact stage strings; the regression corrupts a valid running checkpoint. Coverage cleanup also closes the browser and room service if collection or Vite shutdown fails. Re-review confirmed no remaining actionable findings in the reviewed scope.

Gameplay/protocol review found an obstructed spawn and a bot route that could stick on a wall. Both are fixed, including a second check of navigation versus collision padding. The renderer/UI review found landscape phone controls below the viewport and keyboard movement lost while a header button had focus. Both are fixed. Re-review found no remaining actionable findings. The smoke now asserts arena and button bounds before interacting, verifies held phone movement, and checks keyboard movement with a focused header button. Rules are `graveyard-shift-2` after the navigation/spawn changes.
