# Architecture review — 2026-09-17

Reviewed at `174233a` (main). Every file under `src/` was read in full by five parallel reviewers (simulation core, netcode, client rendering/input, online UI/audio/analytics, backend/tooling/tests/docs); `scripts/`, `tests/`, `.github/`, and `docs/` were surveyed. The load-bearing claims below were re-checked against the code by hand. Nothing was executed — runtime claims (notably N3, N4, S1) are reasoned from code, not reproduced.

This is an **architecture** review: structure, shortcuts, hacks. For line-level bugs see `full-codebase-bug-review.md`.

## Verdict

The **foundations are genuinely strong**: a pure, seeded, plain-data simulation; a clean input-log + rollback model; hostile-input decoding that is better than most commercial indie netcode; dependency injection nearly everywhere; ~740 unit tests. None of that needs rethinking.

The **debt is a velocity artifact**. The repo is 4 days old with 694 commits. The pattern that repeats in every layer is:

1. **Concentration** — five files (`game.ts`, `room-runtime.ts`, `ui.ts`, `main.ts`, `gateway.ts`) hold most of the behaviour as giant functions/closures, several written in a hand-minified style (62 KB in 445 lines; lines up to 1,121 chars).
2. **Two of everything** — LAN and online are two complete products sharing only `step()`. Tick driver, bomb-input folding, recap DOM, keyboard bindings, static serving, rate limiting, and interpolation all exist twice and have already drifted (LAN and online currently ship *different default rules*).
3. **Conventions without enforcement** — deterministic math, the `RULES` version bump, the layering rule in `AGENTS.md`, and "coverage 95%" are all honoured by discipline, not by tooling. There is no linter or formatter at all.
4. **Implicit state machines** — world-sync lifecycle, join, room screen, connection/seat state are all encoded as flag combinations, sentinel values, CSS classes, and in three places regex-matching English status strings.

If only three things get done: **(A)** enforce determinism + rules versioning mechanically, **(B)** take game-speed out of the shared clock, **(C)** add Prettier/ESLint and split the five god-files. Details and ordering in the roadmap at the end.

## Numbers

| | |
|---|---|
| Age / commits | 4 days / 694 |
| `src` | 12.6k lines, 865 KB; tests 11.9k lines, 109 files, ~740 cases |
| Hottest files (commits) | `online/ui.ts` 99 · `client/main.ts` 84 · `shared/game.ts` 78 · `online/room-runtime.ts` 46+ |
| Lines > 160 chars | `ui.ts` 109 of 445 (max 1,121) · `room-runtime.ts` 43 (max 685) · `main.ts` 32 |
| Lint / format config | none |
| TODO/HACK/FIXME, `as any`, `@ts-ignore` | 0 / 0 / 0 (3 `as unknown as`, 7 empty `catch{}`) |
| `RULES` version | `fuse-p2p-23` — 23 manual bumps; `docs/architecture.md` still says `-5` |
| Repo weight | `docs/` 66 MB vs `src/` 1.1 MB |
| Cross-layer imports | `online→client` 21 · `client→online` 1 · `service→online` 2 |

---

## 1. Simulation core (`src/shared`)

**C1 — `step()` is one 400-line function (High).** `game.ts:492-889` does countdown, trail ageing, overtime, portals, pickups, movement, shells, explosions, all collision classes, shields, transits, commit, bomb actions, gun raycasts, a *second* explosion pass, a *second* death-commit path, dodge detection, moments, and round resolution. Phases communicate through ~15 shared local maps (`causes`, `causeOwners`, `shotSources`, `trailContactTimes`, `landingHits`, `shellHits`, …). The two death paths (`:792-819` swept, `:853-871` instant) each re-implement shield absorb / elimination credit / shot log with slightly different credit logic. Stats, shot-log and moments are threaded inline through physics.
→ Phase functions over an explicit `TickContext`; one `commitDeath()`; stats/moments as consumers of a per-tick fact list.

**C2 — The tick *driver* exists twice and has diverged (High).** Only `step()` is shared. `applyTick` (P2P: management fold, input fold, bots, round progression) is re-implemented by hand in `server/index.ts:349-370`:
- LAN never sets `game.settings`, so it runs the `??` fallbacks in `game.ts` — `aimBounce ?? false` (`:895`, `:1307`) while `defaultRoomSettings()` has `aimBounce: true`. **LAN and online ship different rules today.**
- Leaving mid-round: LAN eliminates the rider; P2P lets it coast until it crashes.
- Bomb input: `BombInputBuffer` class (LAN) vs `foldPlayerEntries` "reproduces the LAN semantics" by hand (P2P).
→ Drive LAN through `applyTick`; make `GameState.settings` mandatory and delete the fallbacks.

**C3 — Determinism is convention, not enforcement (Medium, high leverage).** The discipline is good (stdlib `sin/cos/atan2`, no `Date`, seeded RNG in state, zero `Math.*` transcendentals in `src/shared`). But nothing stops the next `Math.sin`: no lint, no source scan, and unit tests run on V8 only. Two bypasses already exist — `** 2` in `portal.ts:113` and `blast-geometry.ts:9` (`**` is `pow`, which the spec does not require to be correctly rounded; everywhere else uses `square()`).
→ A source-scan test banning `Math.(sin|cos|tan|atan2?|hypot|pow|exp|log)` and `**` in `src/shared`; a golden state-hash fixture (bots + pickups + portals, few hundred ticks) run in Node, Chromium and WebKit on every PR, not main-only.

**C4 — `RULES` is a hand-bumped string (Medium).** `apply-tick.ts:8`; the only guard is a test asserting the literal, which forces a double edit but cannot detect a *missed* bump. A missed bump = unexplained desync for anyone with a cached tab. Replay clips carry no version. A rules-mismatched peer only gets a notice; its packets are still folded into the world (`room-runtime.ts:168`, `:206`).
→ The golden hash from C3 makes "hash changed but `RULES` didn't" a CI failure. Refuse streams from mismatched members.

**C5 — Adding a pickup is ~10 hand edits, half unchecked (Medium-High).** No registry: `PICKUP_TYPES`, `PlayerState` field, `addPlayer` defaults, a *second copy* of defaults in `prepareRound`, an 18-arm `else if` in `collectPickups`, `toSnapshot`, `GameSnapshot` type, checkpoint guards, weights, `RULES`. Only the checkpoint guard is compiler-enforced. Forgetting `prepareRound` silently carries an effect into the next round. Already inconsistent: `recordPickup` counts 9 of 18 types; `gunArmed?`/`shellArmed?` are optional while siblings are required. The Nitro/Snail commit touched 30 files.
→ One `freshRoundPlayerState()`; a `Record<PickupType, {weight, onCollect, statKey?}>` table; derive the snapshot player type from `PlayerState`.

**C6 — The desync hash sorts away orderings the sim reads (Medium).** `canonicalRoomState` sorts Map entries/object keys, but the sim depends on insertion order in places: `roomPickup` walks `Object.entries(weights)`; first-wins `trailHits`/`shellHits` over `players.values()`/`bombs.values()`; bot tie-breaks. Two states can hash equal and evolve differently. Also `localeCompare` as a tiebreak (`game.ts:1657`) is ICU-dependent.
→ Iterate `sortedPlayers` / id-sorted bombs / `PICKUP_TYPES` everywhere; plain `<` comparisons.

**C7 — Rollback cost (Medium).** `step()` always returns a full `toSnapshot()` deep copy that `applyTick` discards — a 40-tick rewind builds ~40 throwaway snapshots. Trails are arrays of up to 2,048 objects re-allocated every tick; the whole room is `structuredClone`d every 4 ticks. Bots replan (15 plans × 32 ticks) on every re-simulated tick on every replica. Measured 387–500 rollbacks/min under mild impairment — this is a phone risk.
→ `step` returns events only; longer term, typed-array trail ring buffers.

**C8 — A throw inside `step` leaves state half-mutated (Medium).** `state.tick += 1` is the first statement; stats helpers throw on invariant breaks; neither `applyTick` nor the LAN tick wraps `step`. On LAN it kills the process; in P2P it becomes an exception loop on one replica rather than a clean desync signal.

**C9 — Shortcuts in state (Low).** Gun tracers are modelled as `BombState` with `blastRange: 0`, forcing `bomb.shell?.gun` exclusions in 8 places. Bot difficulty is encoded in the display-name suffix and parsed back with `endsWith`. `PickupState.expiresAtTick` is always `MAX_SAFE_INTEGER`; `BombState.placedTick`, `InputIntent.bomb`, and `PortalTransit.heading` are written and never read. Issue-number archaeology (#166 ×5, #186, #240…) is the main form of rule documentation. `game.ts` also owns RNG, geometry, scoring, snapshot projection, and `PICKUP_TYPES`, so helpers import *back* into it.

---

## 2. Netcode (`src/online`)

**What it actually is:** deterministic input-log lockstep with rollback over a full WebRTC mesh. Every member simulates; the creator is only clock authority, management-entry author, and hash reference. Snapshots are for join/resync only. This is a good model for this game. It has **no ADR** — 028–032, 035, 041 are all "superseded by `P2P-INPUT-LOG-BRIEF.md`", and that brief has already drifted (future-tick bound 14 vs code 400; packet 512 vs 1100 bytes; resync 60 vs 400 ticks). The 3× AI pacing and hidden-tab handling are documented nowhere.

**N1 — `RoomRuntime` is a god-object (High).** 591 lines, one class, ~20 fields + a 7-field `pace` struct + 13 fields per `Member`. It owns handshake, member table/RTT, snapshot request/rotate/assemble/install, divergence detection, seat allocation, presence debounce, succession, input edge-filtering, visibility, clock pacing, tick loop, NACKs, packet assembly, prediction, status copy, metrics. The world lifecycle is *derived* each tick from `id===''`, `world`, `snapshotRequest`, `assembler`, `noWorld`, `welcomeAt`, `outOfSync`; dirty flags are sentinels (`-1`, `-Infinity`). `outOfSync` is set once, never cleared, and the runtime then keeps simulating a diverged world (`:294`).
→ `Membership`, `WorldSync` (explicit enum: NoWorld/Requesting/Live/Resyncing/Diverged), `RoomManager`, `InputRecorder`, `Pacer`; `RoomRuntime` becomes wiring.

**N2 — Game speed is implemented by changing the shared wall clock (High).** `clock.rate = simulationTimeScale(world.state…)` (`:481-485`) — derived from *speculative* state, so a rollback can flip the rate retroactively and members flip at different moments. A hidden member can't compute it, hence `observeRate`/`paceClock` with a threshold, a streak ≥2, and a 1.5 s deference rule. The feature needed two same-day fix commits (`be7a09e`, `61128c3`). A hidden follower learns of the switch ~40 ticks late — exactly `STALL_TICKS`.
→ Keep the clock fixed; run N `step`s per tick inside `applyTick` when only bots survive. Pure function of the log; deletes the `pace` struct and all the heuristics.

**N3 — A partially connected mesh deadlocks (High).** Packets carry only the sender's own entries; no forwarding, no TURN. If A↔B can't link but the creator hears both, B stays "connected" in shared state and A stalls on B forever (`rollback.ts:60-71`). Nothing recovers it — there's no gap to NACK.
→ Authority re-broadcasts entries for unlinked pairs, or a logged "X unreachable from Y" deterministically drops one.

**N4 — Hidden tabs aren't modelled in tests (High, unverified on devices).** `FakeNetwork` ticks hidden runtimes every 10 ms; real hidden tabs throttle to ~1 Hz, and the tick loop is the only packet sender. Against `DISCONNECT_MS = 1000` that likely flaps presence; at 3× one packet/second spans ~60 ticks > `STALL_TICKS`. Separately, a hidden peer can't serve snapshots (`peer-transport.ts:255` → health false → reliable send refused), so if the only world holder is a backgrounded phone, a reloading peer fails.

**N5 — "Host migration" is a 90-second bridge (High, decision needed).** Room lifetime is tied to the creator's service presence (`ROOM_TTL_MS = 90_000`); expiry halts every runtime. The substantial succession machinery (`successionOrder`, `permitted`, retired generations) only covers those 90 s. There are also two elections with different inputs (`authority()` by packet recency incl. TVs; `actingCreator` by log), which can disagree in a partition.
→ Either real migration (service re-homes `hostId`) or delete most of succession and "pause until creator returns".

**N6 — Desync is undiagnosable in the field (Medium).** Whole-state hash every 20 ticks lagged 40; snapshot retention is ~48 ticks, so above ~400 ms latency (130 ms at 3×) the check *silently skips* (`mine === undefined`). On mismatch: full reinstall; after 3, "reload". Only two hashes go to `console.warn`; telemetry is off in prod. `World.install` clears `emitted`, so a resync re-fires sounds/analytics/moments.
→ Per-subsystem hashes or a state diff to prod-safe telemetry; decouple `HASH_LAG` from retention.

**N7 — Cheap hardening gaps (Medium).** `StreamLog.receive` never checks `tick <= through`, so a peer can declare completeness then insert 40 ticks back (a 2 s lookahead cheat that also falsifies `completeTick()` → replays/analytics). An inflated `lastSeq` creates a permanent gap that disables hash checks for everyone. Any rider can log `PRESENCE false` for those ranked ahead and become acting creator. Cheat resistance is a stated non-goal, but the first two are one-line rejections.

**N8 — Vestiges and hygiene (Low-Medium).** `authority.ts` lease system survives only to fence duplicate creator tabs; `?relay` flag now only breaks the game; `receive(..., direct=false)` branches are dead; `checkpoint.ts` is named for localStorage checkpoints it no longer does; unused `freeSlot` import, `TickClock.freeRunning/paused`, `void newMatchIdTick`. ~25 magic constants in three comma lines with undocumented couplings (`HASH_LAG`↔retention, `DISCONNECT_MS`↔1 Hz timers). `room-runtime.ts:302` contains **raw NUL/0x1F/0x7F bytes** in a regex — `file` reports the source as `data` and `grep` treats it as binary. `PeerTransport` (320 lines of WebKit/libwebrtc race workarounds, 4 empty catches, one at `:160` swallowing every datachannel handler error) uses globals directly and has **no unit tests**.

---

## 3. Client presentation (`src/client`, `src/online/ui.ts`)

**P1 — Two god-closures, unformatted, untested (High).** `startOnline()` is `ui.ts:68-445`: landing, routing, tokens, boot card, themes, announcer, QR lobby, roster diffing, one `<dialog>` reused for six screens (identity inferred via `dialogBody.contains(audio.controls)`), recap, layout re-parenting, analytics funnel, telemetry, benchmark harness, input pipeline, net stats, replay, rAF loop — ~25 closure `let`s. `main.ts` is the same shape for LAN (`startDisplay` `:92-499`, `startController` `:501-741`). Neither has a unit test; both are outside the coverage allowlist; both are the #1 and #2 most-churned files. `ui.ts:240` has a comment citing "line 116" that's already wrong.

**P2 — LAN and online duplicate the presentation, and it has drifted (High).** Replay glue (`main.ts:478-488` ≈ `ui.ts:431-441`), match recap DOM (`main.ts:263-315` ≈ `ui.ts:282-293`), standings, announcements (`arena-announcer.ts:8` admits "the LAN TV keeps its own copy"), control-safety listeners, QR, fullscreen, vibration. Element factory exists **four** times with different argument orders. Two keyboard implementations with identical key tables but different semantics. LAN HUD uses magic `/20`, `90`, `1_200`, `<5`, `/60` where online uses `TICK_HZ`, `OVERTIME_START_TICK`, `MAX_PLAYERS`.

**P3 — State as CSS classes, DOM text, and English regexes (Medium).** `mobile-play`, `controller-only`, `joining`, `room-over`… are read back as logic. `main.ts:344` branches on `connection.textContent === 'HOST LINK EXPIRED'`. The runtime emits English sentences that the UI re-parses with regexes in three places (`status-copy.ts`, `connect-hint.ts`, `ui.ts:303` — `/replaced/i` drives host takeover); the lists already disagree. Visibility is one eight-term boolean (`ui.ts:334`).
→ An explicit `RoomScreen` union derived once per snapshot; runtime emits `{code, tone, retry}`.

**P4 — Error swallowing at the two hottest seams (High, tiny fix).**
- `socket-client.ts:64-70`: one `try` wraps `JSON.parse` **and** `this.onMessage(message)`. Every exception in LAN UI/replay/audio is silently discarded at 20 Hz.
- `room-runtime.ts:575`: `callbacks.state(...)` has no guard, and `lastFrameTick` is set first — a UI throw (DOM, analytics, storage all run in that callback) propagates into the netcode tick loop.

**P5 — Layering is inverted (Medium).** `AGENTS.md` says `src/online` = coordination/transports and `src/client` = presentation. In reality `src/online` holds the biggest presentation file plus CSS, join form, mobile layout, and an attract mode that mounts Phaser; netcode (`rollback.ts`, `prediction.ts`) imports its view type from the LAN client's `snapshot-stream.ts`; `client/replay.ts` imports `interpolateWorld` back from `online/`; the Cloud Run service imports `online/ice-config` and `online/authority` (which is why the Docker image copies all of `src`).

**P6 — Renderer: good boundary, no view-model (Medium).** `PhaserArena.render(snapshot, now, theme, scope)` is the only input, Phaser's loop is externally stepped, and `presentation.ts` is an exemplary explicit lifecycle state machine. But `ArenaScene.paint` is one 165-line method reading raw snapshot fields and game rules; `trails.ts:73` recomputes a max-speed bound from sim constants and will silently clip trail tips when a new speed effect lands; `render-snapshot.ts` runs sim code (`advanceShell`) in the view. The trail "cache" reports `changed` every tick during play, so all trails are re-stroked in 3 passes at 20 Hz; `renderedSnapshot` spreads every player and copies all trails per shell per frame. Two interpolation models coexist (LAN extrapolation, online interpolation). Phaser internals are monkey-patched via `as unknown as` (`arena.ts:40-54`, `:140-148`) with no version assertion.

**P7 — Audio (Medium).** `game-audio.ts` is engine + iOS session adapters + radio panel DOM + global shortcuts + persistence in one module, with **no disposer** — which is the root cause of the module-level `pageAudio` singleton hack in `ui.ts:61-67`. Every tap fires 5 gesture events each running `unlock()` → `resume()` → full re-render, during touch gameplay. `AudioDirector` fuses cue dedupe with the radio state machine and consumes the LAN wire type, so the online UI *fabricates LAN-shaped messages* to feed it (`ui.ts:308`, `:323`).

**P8 — Diagnostics in the prod path (Medium).** `runtime.metrics()` is JSON-stringified into `app.dataset.metrics` once a second for all users and parsed back by the stats panel — the DOM as IPC for Playwright. The benchmark per-snapshot player dump at `ui.ts:322` is built every tick regardless of the flag (args evaluated before the check).

**P9 — CSS (Medium-Low).** `style.css` (LAN) contains online-only rules and `online.css` patches LAN recap classes; 26 class names defined in both, including unscoped `.active`, `.out`, `.kicker`. `mobile-play-layout.css` has 20 `!important` in 58 lines, overriding the same selector `none → flex → grid`. 23 distinct magic z-index values; six breakpoints plus a separate JS definition of "phone". CSS lines up to 2,109 chars.

**P10 — Analytics (Medium).** Isolation and privacy reasoning are good (lazy bundle, URL blacklist because the room code is the credential, rollback-aware exactly-once shot reports). Gaps: Mixpanel `ip: false` not set, no consent/notice/DNT, opt-out is an undiscoverable `?analytics=0`, `Boot Failed` sends unbounded `error.message`, raw `localStorage` evaluated outside `try` at `ui.ts:88,123,137` (throws on Safari "block all cookies" — `main.ts:34` documents this exact hazard). Event prefix is `FlowRiders.`. Funnel bookkeeping (7 closure vars) lives inside the render callback.

---

## 4. Backend, tooling, tests, docs

**S1 — One room can take down every room on a gateway instance (High).** `gateway.ts:95`: `if(this.seen.size>=4096){this.fail('bus-overflow',…)}` and `fail()` closes every client. Every delivered signal is recorded for 10 s, including same-gateway ones; caps are 100 msg/s guest, 400/s host. A host plus one guest sending valid ICE-shaped frames reach 4,096 in ~10 s. Repeatable. No test covers it.
→ Dedupe only bus-origin frames; on overflow drop the frame or the offending room; cap signalling at a realistic rate.

**S2 — Admission is unthrottled and globally serialized (High).** Only room creation is rate-limited. WS upgrade → `store.admit` is a Firestore transaction even for nonexistent codes, and all connects/disconnects run through one promise chain (`gateway.ts:20-22`). The code space is 67,600 and enumerable by design; every member is a *trusted* mesh peer; ICE exposes player IPs. Scanning → join → grief/harvest is cheap.
→ Per-IP admission-failure limit; serialize per room; consider a fragment-carried invite secret with the 4-char code as lookup only.

**S3 — Tokens in query strings (Medium, previously flagged, unfixed).** `/ice?token=…` and the WS URL. Cloud Run request logs record full URLs; the host token authorizes `/end`.

**S4 — Heartbeats are Firestore transactions on the room doc (Medium).** Every member every 2 s, each bumping `revision` and fanning an `onSnapshot` to every gateway: ~3 writes/s on one document at six members, ~10k writes per room-hour. Guests could renew every 10–15 s against the 30 s TTL.

**S5 — LAN server (Medium/Low).** `/telemetry` disk-append route is commented "in development" but has no `dev` gate — unauthenticated 2 MB POSTs appended forever. No try/catch around the tick (see C8). No Origin check on `/ws`. MIME table lacks `.woff2`/`.webp` that the service copy has.

**T1 — Two backends, status undecided (High, decision needed).** `AGENTS.md` says "Preserve LAN play"; `DEPLOYMENT.md` calls it "Legacy LAN hosting". LAN has 42 recent commits, its own protocol, snapshot stream, extrapolation, socket client, 524-line server test, and half of `main.ts`. Every feature is paid for twice (the 3× AI change landed in both). The cheapest unification: LAN runs the P2P runtime against the in-process dev room service that `npm run dev` already starts — deleting the authoritative WS protocol, `snapshot-stream`, `render-snapshot`, `socket-client`, and ~half of `main.ts`. Cost: phones become P2P members and WebRTC must work on plain-HTTP LAN origins.

**T2 — The coverage gate is an allowlist that omits the riskiest files (High).** `.c8rc.json` `include` lists neither `peer-transport.ts`, `ui.ts`, `main.ts`, `phaser/arena.ts`, `firestore-store.ts`, nor `pubsub-bus.ts`. "95% coverage" is true of the list, not the system. `room-runtime.test.ts` reaches into privates 7× via `as unknown as` — a missing test seam. Missing categories: randomized drop/dup/reorder convergence (the fake network makes this cheap), parser fuzzing, gateway abuse, multi-gateway routing (`LocalRoomBus.publish` throws).

**T3 — No linter, no formatter (Medium, prerequisite for everything else).** Two dialects in one directory: `service/http.ts` is conventional; `gateway.ts`, `room-store.ts`, `pubsub-bus.ts`, `peer-transport.ts`, `ui.ts`, `room-settings-menu.ts`, `bot-controller.ts` are dense one-liners (`gateway.ts:85` is ~500 chars with four nested conditions). This is the most security-sensitive code and the hardest to review; blame and diffs are per-1,000-char line; merge conflicts are near-certain with parallel agents. `noUncheckedIndexedAccess` is off while the code is full of `[x]!`. `esbuild` is imported by CI scripts but undeclared. The prod Docker image includes Playwright/Vite and runs via `tsx`.

**T4 — CI and scripts (Medium).** PR gate is typecheck + unit + build; ~20 browser smokes run sequentially in one 40-min job on main or `full-ci` only, each auto-retried with 3× timeouts — institutionalised flakiness, honestly reported. `ci-local.sh` is a hand mirror of `ci.yml` and has drifted. `scripts/` has 49 entries, 33 launch Playwright, ~19 run nowhere; browser selection is re-implemented 8 ways; no `@playwright/test` (no traces, sharding, filtering). Backend redeploys on every main push with no path filter and nothing orders a protocol change across Pages and Cloud Run.

**T5 — Repo weight (Medium).** `docs/` is 66 MB — an 18.7 MB evidence JSON, several 3–8 MB files — nearly all for the superseded host-star protocol. 74 MB pack after 4 days.

**T6 — Docs drift (High for onboarding, incl. agents).** `docs/architecture.md` describes only the LAN server: no `src/online`, `src/service`, P2P, rollback, or Cloud Run; rules version `-5` vs `-23`; rate limit 40 vs 100; "three wins" vs five rounds; 7 of 18 pickups. `AGENTS.md` calls it "Historical" yet it keeps the canonical name. ADR 040 is missing; ADR 002 still "Accepted" though superseded; ADR 039 mentions a Worker that no longer exists; ADR 020 is an append-only changelog contradicting itself; README has Cloudflare/Worker archaeology; `verification.md` claims 152 tests. Since agents write most of this code and read these docs first, stale docs actively steer work wrong.

---

## 5. What is genuinely good (keep it)

- **Pure plain-data simulation**, single `step(state, inputs)`, seeded RNG in state, no I/O or clock in `src/shared`; simultaneity handled deliberately (compute-all-then-commit, cause priority table, id-sorted chain queue).
- **Hostile-input decoding**: bounded msgpack preflight, whole-packet rejection, DTLS-bound sender id; `checkpoint.ts` guard tables with `satisfies Record<keyof T, Guard>`, node/depth budgets, prototype-key rejection, ~70 lines of semantic invariants. Copy this pattern to `protocol.ts`.
- **Bot controller** is external, stateless, hash-seeded, reuses real motion kernels, survives rollback by construction.
- **`RoomRuntime` has zero DOM access**; solo/attract/online share one `World`. `presentation.ts` is a model explicit state machine. Renderer is a pure function of `(snapshot, now, theme, scope)` — which is why replay was nearly free.
- **DI everywhere it counts**; deterministic lossy/reordering `FakeNetwork`; six-replica convergence tests; a three-engine determinism replay script.
- **XSS surface ≈ nil**: two `innerHTML` uses in all of `src`, both static; names via `textContent`, validated in the log.
- **Service**: stateless gateways, clean `RoomDatabase` abstraction, incarnation/revision fencing, closed signalling relay, exact-origin CORS, keyless WIF deploys, no secrets in repo, no TURN creds to leak.
- **Zero TODO/HACK/`as any`**, comments explain *why*, superseded ADRs are mostly labelled, flake reporting is honest.

---

## 6. Roadmap

Ordered so each step makes the next one safer. Sizes are rough.

### Phase 0 — one-liners and guards (hours)
1. `socket-client.ts`: narrow the `try` to `JSON.parse` (P4).
2. `room-runtime.ts`: guard `callbacks.state/event`; replace raw control bytes at `:302` with `\x00-\x1f\x7f` (P4, N8).
3. `gateway.ts`: stop failing the gateway on `seen` overflow; dedupe bus-origin frames only (S1).
4. `stream.ts`: reject entries at or before declared `through`; bound `lastSeq` jumps (N7).
5. Gate `/telemetry` on `dev` (S5). Set Mixpanel `ip: false`; route all storage through `safeStorage` (P10).
6. Replace the two `** 2` sites and `localeCompare` tiebreaks (C3, C6).

### Phase 1 — turn conventions into checks (1–2 days)
7. **Prettier + typescript-eslint (`no-floating-promises`, no empty catch) in one mechanical commit.** Do this while few branches are open. Everything after depends on it.
8. Source-scan test banning non-deterministic math in `src/shared`; golden state-hash fixture in Node + Chromium + WebKit on every PR; CI fails if the hash changes and `RULES` doesn't (C3, C4).
9. An import-boundary lint rule: `shared` ← nothing; `netcode` ← shared; `presentation` ← shared + netcode types; `service` ← shared (P5).
10. Replace the c8 allowlist with `src/**` plus an explicit, justified exclude list (T2).

### Phase 2 — the decisions only you can make
11. **LAN: unify onto the P2P runtime, or freeze it** (T1, C2, P2). This one decision removes roughly a third of the duplication in this report. My recommendation: unify — the in-process room service already exists, and "two complete products" is not sustainable at this commit rate. Interim regardless: run LAN through `applyTick` and make `settings` mandatory so the two modes stop shipping different rules.
12. **Creator loss: real migration or pause-until-return** (N5). Recommendation: pause-until-return and delete most of succession, unless long sessions surviving a host leaving is a product goal.
13. **Room admission model** given enumerable codes + trusted mesh + IP exposure (S2).

### Phase 3 — structural work (a week or two, parallelisable after Phase 1)
14. **Game speed as N steps per tick** inside `applyTick`; delete `pace`/`observeRate`/`paceClock` (N2). Model 1 Hz throttling in `FakeNetwork` and pick an explicit hidden-member policy (N4).
15. Decompose `RoomRuntime` around an explicit `WorldSync` state machine; typed status codes instead of English (N1, P3). Give `PeerTransport` an injectable RTC/timer seam and unit tests (N8).
16. Decompose `step()` into phases over a `TickContext`, one death path, events-only return (C1, C7). Pickup registry + `freshRoundPlayerState()` (C5).
17. Split `ui.ts`/`main.ts` into view builders + pure presenters + an explicit `RoomScreen` union; extract shared `recap-view`, `standings-view`, `dom.ts`, `installControlSafety`, `mountReplay`, one keyboard binding; move online presentation under `src/client` (P1, P2, P5). Give `createGameAudio` a disposer and split engine/panel/shortcuts (P7).
18. Partial-mesh recovery (N3); production-safe desync diagnostics (N6).

### Phase 4 — hygiene
19. Rewrite `docs/architecture.md` as the current four-runtime system map; write the P2P ADR; tombstone 040; fix README/ADR 039/020 (T6).
20. Move ~60 MB of evidence out of git; migrate the Playwright scripts to `@playwright/test` with shared fixtures and sharded CI; delete the ~19 unreferenced ones; single manifest for local + CI steps (T4, T5).
21. Tokens out of URLs; cut the Firestore heartbeat rate; slim the Docker image; declare `esbuild` (S3, S4, T3).
