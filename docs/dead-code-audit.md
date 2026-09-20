# Dead code audit

A whole-repo sweep of every TypeScript file for code nothing ships: modules no entry point
reaches, exports nothing imports, production code only tests keep alive, and leftovers of
features already removed. Audit only — no code changed. Findings are grouped by how strong the
evidence is, strongest first, so the cheap removals are separable from the ones that need a
decision.

Snapshot: `5b974a0` (main), 532 TypeScript files.

## Summary

The module graph is healthy. **Every module is reachable from an entry point** — the only two
files no import reaches are ambient declarations (`stdlib-math.d.ts`, `vite-env.d.ts`), which are
supposed to be unreferenced. There is no orphaned directory and no second copy of a subsystem.

Dead code is concentrated in **exported surface** rather than whole files: 45 exported symbols
nothing anywhere references, 150 that only tests reference, and 169 whose `export` is redundant
because they are used only inside their own file.

| Reach of a file                                                     | Files |
| ------------------------------------------------------------------- | ----: |
| Production (from `index.html`, `games/dice/index.html`, `service/`) |   262 |
| Test files                                                          |   187 |
| Reachable only from `scripts/`                                      |    56 |
| Reachable from `scripts/` and tests                                 |    13 |
| Reachable only from tests                                           |    12 |
| Reachable from nothing (both ambient `.d.ts`)                       |     2 |

| Exported symbol                                       | Count |
| ----------------------------------------------------- | ----: |
| Used by production code                               |  1124 |
| Used only inside its own file — `export` is redundant |   169 |
| Used only by tests                                    |   150 |
| Referenced nowhere at all                             |    45 |

## Tier 1 — Verified removable

Trial-deleted together in a throwaway worktree: `tsc --noEmit` clean, `golden-hash.test.ts` green
(so no engine behaviour change and **no `RULES` bump needed**), and the full suite showed no new
failures. About **743 lines**.

| What                                                                                                                     |         Lines | Why it is dead                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------ | ------------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `games/fuse-riders/src/engine/bomb-input.ts` plus `tests/bomb-input.test.ts` and `tests/bomb-input-differential.test.ts` | 64 + 94 + 243 | The LAN server's per-connection bomb buffer. The LAN server went in [#271](https://github.com/andeplane/fuse-riders/pull/271); the module's own docstring says "Nothing in the app or in `scripts/` uses it now; only tests that script a rider by frames do." It and the log fold now run the same core (`bomb-gesture.ts`), so the differential test asserts that two wrappers over one implementation agree — a tautology. |
| `scripts/top-menu-smoke.ts`                                                                                              |           337 | Referenced by nothing: not in `scripts/ci-manifest.json`, `.github/workflows/`, `package.json`, `scripts/ci-local.sh`, or any doc. Nothing runs it.                                                                                                                                                                                                                                                                           |
| `FIVE_SHOT_ANGLES`, `TRIPLE_SHOT_ANGLES` in `engine/launch-modifiers.ts`                                                 |             2 | Superseded by `volleyAngles()`, which computes the same 3/5 fan from the `0.22` spacing. No lost feature.                                                                                                                                                                                                                                                                                                                     |
| `RECAP_KICKER`, `RECAP_TITLE` in `engine/match-recap.ts`                                                                 |             2 | Two display strings with no reference anywhere, tests included.                                                                                                                                                                                                                                                                                                                                                               |
| `EffectStacking` in `engine/effects.ts`                                                                                  |             1 | `EffectStackingRule` spells the three literals out inline instead of using the alias.                                                                                                                                                                                                                                                                                                                                         |

## Tier 2 — Legacy window with a documented removal checklist

`RoomHttpOptions.legacyQueryToken` — the deprecated `?token=` acceptance window from #256 S3.
Every site carries a `LEGACY-QUERY-TOKEN` tag; **27 tagged sites across 4 files**
(`fuse-network-be/src/http.ts` 13, `src/dev.ts` 4, `src/gcp/index.ts` 4,
`tests/socket-auth.test.ts` 6). `docs/online/TOKEN-TRANSPORT.md` step 3 already lists exactly what
to delete.

The gate is a production observation, not a code question: delete it once
`deprecated-query-token` has been absent from the service log for a week. **I cannot check the
production log from here**, so this is ready but unverified — confirm the log before removing.

## Tier 3 — Dead LAN wire remnant, needs a decision

`parseClientMessage` (`games/fuse-riders/src/shared/protocol.ts`, lines 104–190, ~87 lines) plus
`PlayerToken` and `ErrorCode`. Four test files call the parser; **no production file does**. It
validated the LAN controller→server wire, and #271 removed the receiver. `tests/parser-fuzz.test.ts`
and much of `games/fuse-riders/tests/protocol.test.ts` fuzz a parser nothing ships.

Not a blind delete, for two reasons:

- The `ClientMessage` **type** is still live — `client/controller-state.ts` types
  `ControllerInputMessage` from it and `online/ui.ts` constructs `ControllerInputState`. Only the
  runtime parser is unused, so the types stay.
- `AGENTS.md` is emphatic about validating at boundaries. The boundary this guarded no longer
  exists (the live ones are the WebRTC, packet, snapshot and checkpoint validators), but removing a
  validator deserves a deliberate call rather than a sweep.

## Tier 4 — Test-only export surface

150 symbols across 60 files are imported only by tests; 43 of those files are in `src/` or
`service/`. Two different things hide in here, and they want opposite fixes:

- **An internal helper exported so a test can reach it.** The code is live — it runs via the
  module's public entry. The cleanup is to narrow the export and test through that entry, which
  costs test granularity. A judgement call, not dead code.
- **A module whose production caller went away.** That is real dead code.

Largest offenders:

| File                                                  | Test-only exports |
| ----------------------------------------------------- | ----------------: |
| `games/fuse-riders/src/client/replay.ts`              |                14 |
| `games/fuse-riders/src/engine/match-recap.ts`         |                 9 |
| `games/fuse-riders/src/client/game-audio.ts`          |                 5 |
| `games/fuse-riders/src/client/radio-media-session.ts` |                 4 |
| `games/fuse-riders/src/engine/bomb-launch.ts`         |                 3 |
| `games/fuse-riders/src/engine/effects.ts`             |                 3 |
| `games/fuse-riders/src/engine/moments.ts`             |                 3 |
| `games/fuse-riders/src/engine/portal.ts`              |                 3 |
| `games/fuse-riders/src/online/funnel.ts`              |                 3 |
| `games/fuse-riders/src/online/net-stats.ts`           |                 3 |
| `games/fuse-riders/src/render/arena-maps.ts`          |                 3 |
| `games/fuse-riders/src/render/arena-wall.ts`          |                 3 |

`match-recap.ts` is the clearest case of the first kind: production uses only
`buildMatchRecap`, `describeMoment`, `rankMoments`, `COMPARISON_COLUMNS`, `COMPARISON_KEY`,
`HIGHLIGHTS_TITLE` and `RECAP_EMPTY_MESSAGE`, while nine more internals (`matchAwards`,
`comparisonRows`, `matchTotals`, `podiumOrder`, `matchHighlights`, `AWARD_DEFINITIONS`,
`clockText`, `distanceText`, `recapSignature`) are exported only to be unit-tested.

Worth checking individually for the second kind — single-function render helpers whose only
caller is a test, which is what a removed call site looks like: `resolveAssetUrl`
(`render/asset-url.ts`), `trailRibbon` (`render/phaser/trail-ribbon.ts`), `trailPaths`
(`render/phaser/trails.ts`), `PORTAL_PALETTES` (`render/portal-palettes.ts`), `speedEffectLabel`
(`render/power-indicator.ts`).

## Tier 5 — Redundant exports

169 symbols across 73 files are used only inside their own file; the `export` adds public surface
for nothing. Dropping the keyword is mechanical and `tsc` catches any mistake. Concentrations:
`engine/match-recap.ts` (15), `client/radio-media-session.ts` (9), `engine/portal.ts` (8),
`render/arena-wall.ts` (7), `online/room-presenter.ts` (6), `client/replay.ts` (5),
`engine/drunk.ts` (5), `render/arena-maps.ts` (5).

## Tier 6 — Dead barrel re-exports

Re-exports that no file imports from the barrel they sit in. All are type-level or constant
re-exports, so removal cannot change runtime behaviour. The two rows differ in evidence, and the
difference matters:

- The `fuse-ui` types are referenced **nowhere in the repo** — they are part of the 45 in the
  summary table, alongside the five Tier 1 symbols (40 + 5 = 45; the tiers do not double count).
- The `fuse-network-be` / `fuse-network-fe` constants are **live symbols in the wrong place**.
  Nothing imports them through these barrels, but every consumer imports them straight from
  `fuse-network-protocol`, where they are defined. Only the redundant re-export line goes.

| Barrel                                  | Dead re-exports | Note                                                                                                                                                                                                                                                          |
| --------------------------------------- | --------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/fuse-ui/src/index.ts`         |              40 | Type re-exports (`LobbyOptions`, `RosterMember`, `PickerChoice`, `AccountDialog`, …). Consumers import the component functions, never these types. `fuse-ui` is a private workspace package, so there is no external consumer to break.                       |
| `packages/fuse-network-be/src/index.ts` |              10 | Re-exports protocol constants (`ROOM_PROTOCOL_VERSION`, the `CLOSE_*` codes, `AUTH_FRAME_MAX_BYTES`, `generateRoomCode`, `validRoomCode`, `AuthorityGrant`, `GrantIdentity`, `IceServer`). Every consumer imports them from `fuse-network-protocol` directly. |
| `packages/fuse-network-fe/src/index.ts` |              10 | Same pattern, overlapping set, plus `AuthorityClock`, `isAuthorityGrant`, `validGameId` and `LEGACY_GAME_ID`.                                                                                                                                                 |

## Not dead — do not remove

Things this sweep flags that are deliberate. Listed so a later pass does not "clean" them.

| Item                                                  | Why it stays                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `games/fuse-riders/src/engine/index.ts`               | Only tests import the barrel today, but it is the engine's **intended** public API. Its docstring records that app and net code still deep-imports and that moving them is [#255](https://github.com/andeplane/fuse-riders/issues/255)'s work. Removing it would delete the target, not the debt. |
| `games/fuse-riders/tests/fixtures/legacy-snapshot.ts` | "Legacy" in the name, but it is a deliberate view-contract guard pinning `toSnapshot` as it stood before #254, with its own stated delete trigger: the next intentional change to the view's shape.                                                                                               |
| `LEGACY_GAME_ID`                                      | A live architectural concept — Fuse Riders' `gameId` on the shared backend — not a leftover. `platform.ts` throws if it stops being the legacy game.                                                                                                                                              |
| `engine/stdlib-math.d.ts`, `src/vite-env.d.ts`        | Ambient declarations. Being unimported is what they are for.                                                                                                                                                                                                                                      |
| `scripts/smoke-timeout.ts`                            | Named in no manifest, but imported by more than ten smoke scripts.                                                                                                                                                                                                                                |

## Stale comments, not dead code

Five files still describe the LAN server removed in #271 as if it were present: `shared/protocol.ts`
("the LAN wire only names them"), `engine/match-recap.ts` ("shared by the LAN TV and the online
UI"), `client/safe-storage.ts` ("across the LAN client"), `client/arena-announcer.ts` ("The LAN TV
keeps its own copy", "mirroring the LAN TV timer"), and `scripts/smoke-timeout.ts`. Documentation
debt to fix alongside whichever tier touches those files.

## Method

Two passes over `git ls-files '*.ts'`, both resolving relative imports, workspace `exports` maps,
`export *` re-export chains, and dynamic `import()`:

1. **Module reachability** — mark every file reachable from the production entry points
   (`index.html` → `client/main.ts`, `games/dice/index.html` → `app/main.ts`, `service/index.ts`,
   `service/dev.ts`), from each `scripts/*.ts`, and from each `*.test.ts`. A file only tests reach
   is production code tests keep alive.
2. **Per-symbol reachability** — for each exported name, collect the importing files and classify
   by what kind they are, expanding barrel hops so a re-export does not count as a use. Each
   candidate was then cross-checked with a whole-repo identifier grep to split three cases apart:
   referenced nowhere, used only inside its own file, and used only by tests.

Tier 1 was then confirmed by deleting all of it in a detached worktree and running `tsc --noEmit`,
`golden-hash.test.ts` and the full suite.

One caveat about that worktree: it shared `node_modules` by symlink, which made 23 platform and
service tests fail there. The same files pass in a normal checkout
(`tests/match-history.test.ts` 13/13, `tests/service-image-dependencies.test.ts` 1/1), so those
failures are an artifact of the audit's setup. **Main is not broken**, and the comparison still
holds: baseline and post-deletion runs failed identically, so the deletion caused none of them.

### Reproducing

The two analyzers were session scratch files, not committed. If this is worth repeating, `knip`
covers both passes as a maintained dependency and would run in CI; this audit found no tooling for
it in the repo today.
