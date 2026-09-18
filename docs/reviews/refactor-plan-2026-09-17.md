# Refactor plan: three clean layers — network · game engine · rendering

> Plan written 2026-09-17 against `174233a`, following `architecture-review-2026-09-17.md`. It is a proposal, not a record of completed work. Parts have since landed or been overtaken (for example, `src/server/` was removed and golden-hash and layer-boundary tests were added). Epic #259 tracks progress. Check current `main` before acting on any item.

## Context

The architecture review (`docs/reviews/architecture-review-2026-09-17.md`) found good foundations but blurred boundaries. Goal: a clear separation of concerns:

1. **Network** — being extracted into a library as separate work (as of 2026-09-17). Out of scope here.
2. **Game engine** — deterministic simulation. Today: `step()` is one 400-line function (`src/shared/game.ts:492-889`), every power-up is a bespoke field + bespoke `if`, the tick driver exists twice (LAN vs P2P) with different rules, determinism and `RULES` versioning are unenforced conventions (review C1–C9).
3. **Rendering** — today it reaches into engine rules (`phaser/arena.ts` imports `GRAVITY_FIELD_TICKS`, `volleyAngles`; `phaser/trails.ts` recomputes a max-speed bound from `RIDER_SPEED * riderSpeedMultiplier * SPEED_RAMP_MAX`; `render-snapshot.ts` runs `advanceShell`), its core type `ViewSnapshot` lives in the LAN client (`src/client/snapshot-stream.ts:6`) and is imported _by netcode_ (`online/rollback.ts`, `online/prediction.ts`), and `client/replay.ts` imports `interpolateWorld` back from `online/`.

Decisions: `apply-tick.ts`, `input-log.ts`, `online/checkpoint.ts` are engine-side; LAN gets the shared tick driver now. Engine design is **not a full ECS**: ordered phase functions over a `TickContext` + `Record<Kind, Def>` registries; entities stay plain typed records so rollback cloning and the `satisfies Record<keyof T, Guard>` checkpoint guards keep working.

## Target architecture

```
src/engine/   deterministic sim. Imports nothing outside engine. No DOM, clock, I/O.
  index.ts      public API: createGame, commands, driveGameTick/step, GameEvent, RULES
  view.ts       WorldView (= today's ViewSnapshot) + toView(state): THE contract rendering sees
  view-kit.ts   curated pure helpers presentation may call (pose kernel, bombLaunchDistance, shell advance)
  sim/          context.ts, pipeline.ts (PHASES), phases/*.ts
  effects.ts pickups.ts weapons.ts   registries
  codec/        checkpoint guards (from online/checkpoint.ts)
src/net/      (other agent) imports engine only. Output to the app: WorldView frames + GameEvents.
src/render/   imports ONLY engine/view (types) + engine/view-kit. Never engine rules, never net.
  phaser/ trails debris blast-animation arena-wall ink themes presentation
  time/         interpolateWorld + LAN extrapolation (one place for presentation time)
src/app/      composition + DOM UI shell (today's client/main.ts, online/ui.ts, audio, analytics).
              The only place that knows all three layers. Restructured in PR D.
src/shared/   leftovers that are none of the above: uuid, room-code, avatars, LAN wire protocol.
```

Rule of thumb enforced by test: **engine → nothing · net → engine · render → engine/view(+kit) · app → all.** Data the renderer needs from rules travels _in the view_ (e.g. per-rider `speed`, gravity field duration, next-volley angles, a `rules` block with `tickHz`, `blastVisibleTicks`, `trailWidth`) instead of being imported as constants and recomputed.

## PR sequence — one PR per concern

| PR    | Concern                                                               | Depends on                                              |
| ----- | --------------------------------------------------------------------- | ------------------------------------------------------- |
| **C** | Small fixes, tooling (formatter/linter), docs                         | — lands **first** so A/B/D move already-formatted files |
| **A** | Game engine (stages A1–A4 as ordered commit groups)                   | C                                                       |
| **B** | Rendering boundary                                                    | A2 (branches off PR A once the pipeline stage is in)    |
| **D** | App layer: `ui.ts` / `main.ts`, shared LAN/online presentation, audio | B, C                                                    |
| **E** | Service security + ops hygiene                                        | — independent                                           |

`full-ci` label on A, B, D. Land/rebase open PRs #248, #243, #210 (they touch `game.ts`) before PR A.

**Commit discipline inside PR A** (this is what keeps one big PR provable): every commit is tagged in its subject as either `[hash-identical]` — the golden literal is untouched and the test passes — or `[rules N→N+1]` — the commit changes behaviour on purpose, bumps `RULES`, and updates the golden in the same commit. Never both in one commit. Reviewers can then trust every `[hash-identical]` commit mechanically and read only the `[rules]` ones for behaviour. Expected bumps: at most one in A1, one in A3, one or two in A4.

### PR A · stage A1 — Safety net: determinism, versioning, layer boundaries (C3, C4, C6)

- **Golden state-hash test** `tests/golden-hash.test.ts`: reuse `makeRecording`/`replayHashes` from `scripts/fixtures/replay-log.ts` (seeded 2 humans + 3 bots through `applyTick`; already what `scripts/determinism-replay.ts` runs in Node/Chromium/WebKit). Move fixture to `tests/fixtures/`. Pin `{ rules: RULES, hashes }`; failure says "bump `RULES` and update the golden". Replaces the literal assert at `tests/input-log.test.ts:135`. Assert the recording exercises every `PICKUP_TYPES` entry, a portal transit and a shield absorb (extend ticks/seeds until true).
- **Source-scan test** banning `Math.(sin|cos|tan|atan2?|hypot|pow|exp|log\w*|random)`, `**`, `Date.`, `performance.`, `localeCompare` in the sim. Fix hits: `portal.ts:113`, `blast-geometry.ts:9` → `square()`; `game.ts:1657`, `match-stats.ts:198`, `leaderboard.ts:112` → `<`.
- **Order independence:** `roomPickup` (`room-settings.ts:50-55`) iterates `PICKUP_TYPES`; first-wins loops in `step` (`game.ts:629,665,695,715`) and `bot-controller.ts:61-63,140-141` iterate `sortedPlayers` / id-sorted bombs.
- **Layer-boundary test** `tests/layer-boundaries.test.ts`: scans imports, enforces the rule above, with an explicit allowlist of today's violations that later PRs shrink to empty. No ESLint dependency needed.
- One `RULES` bump if the hash moves.
- Folded partial (T2): a randomized drop/duplicate/reorder convergence test over the existing `FakeNetwork` fixture asserting all replicas reach the same hash.

### PR A · stage A2 — `step` as a pipeline (C1, C7, C8) — all commits `[hash-identical]`

- First commit, mechanical: `git mv` sim files `src/shared/* → src/engine/*` (game, apply-tick, input-log, portal, shell, gun, drunk, trail-_, blast-geometry, bomb-_, launch-modifiers, rider-motion, power-progression, pickup-weights, room-settings, bot-controller, match-stats, shot-log, moments, match-recap, leaderboard, deterministic-math) and `online/checkpoint.ts → engine/codec/`. Update imports. `src/shared/` keeps uuid, room-code, avatars, protocol, duration-text.
- `engine/sim/context.ts`: `TickContext` — the ~15 locals at `game.ts:598-627` become named fields, plus `deaths: DeathFact[]`.
- `engine/sim/phases/*.ts`: `expire`, `fitField`, `spawnPickups`, `moveRiders`, `collectPickups`, `moveShells`, `explode`, `detectHazards`, `resolveDefences`, `portalTransit`, `commit`, `launchWeapons`, `commitDeaths`, `recordFacts`, `resolveRound`. `pipeline.ts` exports `PHASES` — the single statement of tick order. `step` = early-out + loop.
- **One death path:** merges `game.ts:792-819` and `:853-871` into `commitDeaths` over `DeathFact { victim, cause, owners, shot? }` using `soleCreditedOwner`; if the golden shows the two credit rules really differ, keep it as an explicit flag on the fact.
- **Stats out of physics:** `recordFacts` is the only caller of `recordElimination/recordDeath/logShotKill`/moments.
- **Events-only return:** `step` returns `{ events }`; `server/index.ts:358` and tests reading `.snapshot` call `toSnapshot(state)`.
- **Throw safety:** `match-stats.ts` `requireEntry`/`recordSurvivalTick` tolerate instead of throwing mid-tick; drivers wrap `step`.
- Split out of `game.ts` (re-exported): `geometry.ts`, `rng.ts`, `pickup-types.ts`, `view.ts`.
- `engine/index.ts` = public API. Tests may still deep-import; app/net/render go through `index`/`view`/`view-kit`.

### PR A · stage A3 — One tick driver for LAN and P2P (C2)

- Extract `driveGameTick(game, inputs, roomSettings)` from `applyTick` (`apply-tick.ts:134-144`): `step` + round progression + settings-at-round-boundary + charge clearing. `applyTick` and `src/server/index.ts:349-370` both call it.
- `GameState.settings` required; delete `state.settings?.x ?? fallback` (`game.ts:893-895,1027,1307,1508`). **Visible LAN change:** `aimBounce` → true, pickups via `roomPickup`. LAN and online play identical rules.
- One bomb-input core shared by `BombInputBuffer` and `foldPlayerEntries` (`input-log.ts:66`).
- Explicit leave eliminates the rider in both modes (today P2P coasts, `apply-tick.ts:74`) → `RULES` bump + new golden. One exported name guard (18 cp / 20 UTF-16 / 20 today).
- New parity test: same input script via LAN server (`manualTicks`) and via `applyTick` → same game hash.

### PR A · stage A4 — Effect / pickup / weapon registries (C5, C9)

Two commit groups: effects + pickups, then weapons + tracers. If PR A gets too large to review, A4 is the natural piece to peel off into a follow-up PR.

- `freshRoundPlayerState()` — single source for `addPlayer` (`:399-411`) and `prepareRound` (`:995-1013`).
- `effects.ts`: `PlayerState.effects: ActiveEffect[]` (sorted, like `addSpeedEffect`) + `EFFECTS: Record<EffectKind, { stacking, speed?, immune?, wallBounce?, heading?, defensiveGrace? }>` replacing the eight `*UntilTick(s)` fields. Speed multiplied in fixed registry order. One expiry loop.
- `pickups.ts`: `PICKUPS: Record<PickupType, { weight, stat, collect }>` with `applyEffect('self'|'rivals', …)`, `arm(weapon)`, `bump(field, max)`; replaces the 18-arm chain (`:1092-1140`), absorbs `pickup-weights.ts`, makes `recordPickup` cover all 18 types.
- `weapons.ts`: `PlayerState.armed: WeaponKind[]` + `WEAPONS: Record<WeaponKind, { priority, launch }>` replacing six `*Armed` booleans and the ladder in `applyBombActions` (`:1260-1361`). Hooks `onFatal` / `onExplode` / `onCollect` in registry order.
- Gun tracers leave `state.bombs` → `state.tracers`; delete the eight `shell?.gun` exclusions and dead fields (`PickupState.expiresAtTick`, `BombState.placedTick`, `InputIntent.bomb`, `PortalTransit.heading`). Bot difficulty becomes a field, not a name suffix.
- `toView` keeps projecting the legacy per-player fields so render/app don't change here. Update `engine/codec` guards (compiler-forced), bot reads, golden.

### PR B — Rendering: a real boundary

- `WorldView` (today `ViewSnapshot`) defined in `engine/view.ts`; `snapshot-stream.ts`, `rollback.ts`, `prediction.ts` import it from there — netcode no longer imports the LAN client.
- `git mv` to `src/render/`: `client/phaser/*`, `trail-debris`, `blast-animation`, `arena-wall`, `ink-renderer`, `themes`, `portal-palettes`, `reload-ring`, `bomb-preview`, `render-snapshot`. `online/prediction.ts` `interpolateWorld` + LAN extrapolation → `render/time/`; `client/replay.ts` stops importing `online/`. `online/attract.ts` (mounts Phaser) → app.
- **Rules travel as data:** add to `WorldView` what the renderer currently recomputes — per-rider `speed` (kills `trails.ts:73`'s hand-built bound that silently clips trail tips on new speed effects), gravity field `durationTicks`, per-rider `nextVolleyAngles`, and a `rules` block (`tickHz`, `blastVisibleTicks`, `trailWidth`, `shellRadius`). Remove the direct `engine/game` value imports from `render/**`; the few pure kernels presentation legitimately needs come from `engine/view-kit`. Replace LAN HUD magic `/20`, `1_200`, `90`, `<5` with the same.
- Split `ArenaScene.paint` (`phaser/arena.ts:264-430`) into per-entity draw functions (`drawRiders`, `drawBombs`, `drawPortals`, `drawPickups`, `drawFields`) over the view — mirrors the engine's phase list. Delete dead code the review found (`EffectTransitions.explosions`, `flame` sprite, `ScoredSnapshot` casts, "both renderers" comments).
- Folded partials (P6): make `TrailHistoryCache` (`phaser/trails.ts:35-44`) append-only so trails aren't re-stroked in 3 passes every tick; stop copying trails per shell per frame in `render-snapshot.ts:46`; assert the Phaser version next to the `guardDefaultTextures` monkey-patch (`arena.ts:40-54`).
- Allowlist in `tests/layer-boundaries.test.ts` shrinks to: app-only entries.
- Not in PR B: breaking up `main.ts` / `online/ui.ts` (app layer), CSS, audio. `AudioDirector` consuming engine `GameEvent` instead of the LAN `ServerMessage` is noted as the first app-layer follow-up.

### PR C — Small independent fixes (can land first)

One commit each: narrow `try` in `client/socket-client.ts:64-70`; gate `/telemetry` on `dev` + missing MIME types (`server/index.ts:137,165`); `service/gateway.ts:95` drop frame on `seen` overflow instead of failing every room + abuse test; Mixpanel `ip: false` + bounded `Boot Failed` message + `safeStorage` everywhere; `.c8rc.json` → `src/**` with commented excludes; Prettier whole-repo + `typescript-eslint` (`no-floating-promises`, no empty catch) + declare `esbuild`; rewrite `docs/architecture.md` around the three layers with `PHASES` as the tick contract. Folded partials: `/ws` Origin check on the LAN server (S5); `noUncheckedIndexedAccess` on (T3); tombstone ADR 040, mark ADR 002/020/039 status, strip Worker/Cloudflare archaeology from README, fix `verification.md` counts (T6); move `service`'s imports of `online/ice-config` + `online/authority` into shared so `Dockerfile.cloud` stops copying all of `src` (P5). **Order inside PR C:** the whole-repo Prettier commit goes first and alone, so it can be merged ahead of the rest if review drags.

### PR D — App layer (P1, P2, P3, P7, P8, P9-lite, P10 rest)

The composition layer is the only one allowed to know engine + net + render. Today it is two god-closures (`online/ui.ts:68-445`, `client/main.ts:92-741`), the two most-churned files in the repo.

- `git mv` into `src/app/`: `client/main.ts`, `online/ui.ts` + its CSS, `join-form`, `room-settings-menu`, `mobile-play-*`, `status-*`, `connect-hint`, `keyboard-shortcuts`, `attract`, `analytics`, audio files, controller-* input.
- **Shared between LAN and online** (each exists 2–4× today): `app/dom.ts` (one element factory), `app/views/recap-view.ts` (from `main.ts:263-315` ≈ `ui.ts:282-293`; view-model already in `match-recap.ts`), `standings-view.ts`, `mountReplay(presentation, overlay, audio)` (from `main.ts:478-488` ≈ `ui.ts:431-441`), `installControlSafety(inputState)`, one keyboard binding (`ControllerKeyboardBindings`; delete `ControllerPointerBindings.bindKeyboard`), LAN TV consumes `announcementFor()` from `arena-announcer.ts`.
- **Explicit state instead of flags/CSS/DOM text (P3):** `RoomScreen` union (`boot | join | lobby | arena | controller | recap | ended`) derived once per frame; CSS classes follow from it, logic never reads classes or `textContent` back (`main.ts:344`, `ui.ts:257,334`, `mobile-play-layout.ts:30`). LAN gets `ConnectionState` / `SeatState` unions. Typed status codes `{ code, tone, retry }` replace the three regex parsers (`status-copy.ts`, `connect-hint.ts`, `ui.ts:303`) — the runtime-side emit is a small 🌐 coordination point; until then one adapter maps today's strings to codes in a single place.
- **Split `startOnline`** into `landing.ts`, `room-view.ts` (DOM build → typed refs), `room-presenter.ts` (pure `WorldView → view model`, unit-tested), `dialogs/*` (one module per dialog instead of one `<dialog>` whose identity is inferred from contents), `funnel.ts` (`createFunnel(track).onFrame(...)` — analytics out of the render callback), `diagnostics.ts`. Same shape for `startDisplay` / `startController`.
- **Audio (P7):** `createGameAudio` returns `dispose()` (removes the `pageAudio` singleton hack at `ui.ts:61-67`); `unlock()` short-circuits when already running; split engine / radio panel DOM / shortcuts; `AudioDirector` consumes engine `GameEvent`, so online stops fabricating LAN `ServerMessage`s (`ui.ts:308,323`).
- **Diagnostics (P8):** benchmark sample built lazily (`sample(() => detail)`); metrics exposed on a flag-gated debug object instead of JSON in `dataset.metrics` every second (update the two scripts that read it).
- **CSS, minimal (P9):** one global `[hidden]{display:none!important}`, z-index tokens, move online-only rules out of `style.css`. No restyle.
- P10 rest: one-line analytics notice + opt-out in SETTINGS; event prefix constant.
- Tests: presenters, funnel, recap/standings views under `node:test`; add `src/app/**` presenters to coverage.

### PR E — Service security + ops (S2, S3, S4, T4, T5)

Independent; one commit each.

- S2: per-IP limit on admission failures via the existing `allowance`; serialize connects per room instead of one global promise chain (`gateway.ts:20-22`); abuse tests. The invite-secret question stays a product decision — note it, don't build it.
- S3: `/ice` token via `Authorization` header (CORS already allows it, `http.ts:64`); WS token via first frame or `Sec-WebSocket-Protocol`.
- S4: guests renew every 10–15 s against the 30 s TTL and skip the write when more than half the lease remains.
- T4: single manifest generating both `ci.yml` smoke steps and `ci-local.sh`; shard the e2e job; delete the ~19 Playwright scripts referenced nowhere; shared `scripts/lib/` for browser selection + server boot. (`@playwright/test` migration noted, not done here.)
- T5: move `docs/online/evidence/**`, soak `.json.gz`, perf JSON to a release asset; keep summaries + hashes. History rewrite is **not** proposed.

## Review coverage

✅ addressed by plan · 🟡 partially addressed by plan · ❌ not covered · 🌐 netcode agent. Of 38 findings: 20 ✅ · 10 🟡 · 0 ❌ · 8 🌐. Every 🟡 remainder is either the netcode agent's, a product decision (T1, S2), or named explicitly below.

| #                                      | PR       |     | Not covered part                                                                  |
| -------------------------------------- | -------- | --- | --------------------------------------------------------------------------------- |
| C1 step god-function                   | A2       | ✅  |                                                                                   |
| C2 two tick drivers                    | A3       | ✅  |                                                                                   |
| C3 determinism unenforced              | A1       | ✅  | browser replay stays `full-ci`-gated                                              |
| C4 `RULES` hand-bumped                 | A1       | 🟡  | refuse mismatched peers 🌐; version replay clips                                  |
| C5 pickup shotgun surgery              | A4       | ✅  |                                                                                   |
| C6 order-dependent reads               | A1       | ✅  |                                                                                   |
| C7 rollback cost                       | A2       | 🟡  | typed-array trails, clone cadence, bot replans                                    |
| C8 throw mid-step                      | A2       | ✅  |                                                                                   |
| C9 state shortcuts                     | A2+A4    | ✅  | issue-number comments                                                             |
| N1–N8 netcode                          | —        | 🌐  | `checkpoint.ts` → `engine/codec` is ours                                          |
| P1 `ui.ts`/`main.ts` god-closures      | D        | ✅  |                                                                                   |
| P2 LAN/online presentation duplication | B+D      | ✅  |                                                                                   |
| P3 state as CSS/DOM text/regex         | D        | 🟡  | runtime-side typed status emit 🌐                                                 |
| P4 error swallowing                    | C        | 🟡  | `room-runtime` callback guard 🌐                                                  |
| P5 inverted layering                   | A1+B+C+D | ✅  |                                                                                   |
| P6 renderer                            | B        | ✅  | two time models remain (LAN extrapolate / online interpolate) until T1 is decided |
| P7 audio                               | D        | ✅  |                                                                                   |
| P8 diagnostics in prod path            | D        | ✅  |                                                                                   |
| P9 CSS                                 | D        | 🟡  | `!important` layout war in `mobile-play-layout.css`, breakpoint sprawl            |
| P10 analytics                          | C+D      | ✅  |                                                                                   |
| S1 gateway overflow                    | C        | ✅  |                                                                                   |
| S2 admission                           | E        | 🟡  | invite-secret model = product decision                                            |
| S3 tokens in URLs                      | E        | ✅  |                                                                                   |
| S4 Firestore heartbeats                | E        | ✅  |                                                                                   |
| S5 LAN server                          | A2+C     | ✅  |                                                                                   |
| T1 LAN status                          | A3       | 🟡  | unify-or-drop decision                                                            |
| T2 coverage/test gaps                  | A1+C+E   | 🟡  | parser fuzzing; `RoomRuntime`/`PeerTransport` seams 🌐                            |
| T3 lint/format                         | C        | ✅  |                                                                                   |
| T4 CI + scripts sprawl                 | E        | 🟡  | `@playwright/test` migration                                                      |
| T5 evidence in git                     | E        | ✅  | no history rewrite                                                                |
| T6 docs drift                          | C        | 🟡  | P2P ADR 🌐                                                                        |

## Verification

Fast iteration: targeted tests locally, push, CI is the gate.

- Every PR: `npm run typecheck`; `npx tsx --test tests/golden-hash.test.ts tests/deterministic-source.test.ts tests/layer-boundaries.test.ts`. Stage A2 and PR B must leave the golden literal untouched on every commit; A1/A3/A4 change it only in `[rules]` commits together with `RULES`.
- A2: `tests/game.test.ts rollback generation-replay weapon-stats moments`. A3: `server input-log bot-controller` + new parity test. A4: all per-pickup suites + `checkpoint`. PR B: `phaser-trails arena-wall replay client` + `npx tsx scripts/phaser-browser.ts`.
- `npx tsx scripts/determinism-replay.ts` after each stage of PR A before pushing; `full-ci` label.
- After A3, A4 and PR B: one LAN round and one solo online round in the muted preview (pickups, bombs, portals, replay, recap).
- `npx tsx scripts/benchmark-online.ts` before/after stage A2.

## Execution

**Suggested execution.** Subagents in isolated worktrees under `/private/tmp/fuse-<topic>`, max 5 at once, one branch per PR (`claude/<topic>`). One coordinator reviews each agent's diff and owns the golden-hash check. Targeted tests locally, push early, CI is the gate; loop on `gh pr checks` until green after each push. Preview tabs muted, preview servers stopped after use. Merging follows AGENTS.md: only with the user's explicit authorization.

**Order.**

1. **Wave 0 (serial, ~first hour):** PR C's Prettier commit alone → PR → merge. Everything after moves formatted files, and open feature PRs rebase once instead of repeatedly.
2. **Wave 1 (parallel):** agent 1 finishes PR C (remaining commits); agent 2 does A1 (safety net); agent 3 starts PR E. No file overlap between the three.
3. **Wave 2 (serial on one branch):** A2 → A3 → A4. One agent per stage, never two at once — they all rewrite the same files. After each stage run golden-hash + `scripts/determinism-replay.ts` before the next stage starts. A2 is done as ~15 small `[hash-identical]` commits (one phase extracted per commit) so a hash break bisects to one phase.
4. **Wave 3 (parallel, starts when A2 is pushed):** PR B on a branch off PR A, alongside A3/A4 — safe because A4 keeps the `WorldView` shape stable and B owns `src/render/**`.
5. **Wave 4 (after B and C merge):** PR D, split across up to 3 agents with disjoint files: (a) shared views + `dom.ts`, (b) `ui.ts` split + `RoomScreen`, (c) audio + diagnostics. `main.ts` split follows (b) reusing its pieces.

**Checkpoints that need the user's decision:** merge of the Prettier commit; the two visible behaviour changes in A3 (LAN gets `aimBounce: true`; explicit leave eliminates in P2P); if PR A exceeds a reviewable size → peel A4 into its own PR; anything in D that needs the netcode agent (typed status codes).
