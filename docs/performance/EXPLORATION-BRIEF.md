# Performance exploration brief

Date: 2026-09-14. Status: **proposed experiments; no optimization results or architecture approval implied**.

Source inspected: `a1b5f5c6334460cfb178bd7c71ea6b771eeb909f`. The working tree was clean before this documentation change. See [current public beta status](../online/PUBLIC-BETA-2026-09-14.md) for tested runtime and release identities; this brief does not reverify deployment.

## Objective and recommendation

Improve perceived smoothness, control response and sustained performance on real phones and shared displays while retaining browser delivery, the neon/pixel aesthetic, LAN play and deterministic game outcomes. Establish which costs matter before selecting an implementation.

Start with profiling, trail caching, resolution scaling and host serialization. Explore effects and ink separately. Investigate AI only if host profiles justify it. Treat motion-buffer tuning as a separate latency/continuity experiment. A Three.js comparison is a later, bounded prototype, not the default migration plan: Phaser already selects WebGL when available.

Success can mean less CPU/GPU work, fewer long frames, better sustained phone performance or lower control delay. A renderer already synchronized to a 60 Hz screen may remain at 60 FPS after a useful optimization. Conversely, 60 FPS does not mean remote riders advance smoothly or respond promptly.

This document supplies independently assignable work, ownership boundaries, measurements and handoff criteria. No agents, implementation work or benchmark runs were started as part of writing it.

## Required context and invariants

Read [AGENTS.md](../../AGENTS.md), [README](../../README.md), [roadmap](../online/ROADMAP.md), [Phaser notes](../PHASER.md) and the current beta status before starting. For architectural work, read online ADRs 028 onward in [the ADR directory](../adr/), [protocol](../online/PROTOCOL.md) and the [review reports](../reviews/), especially the netcode and security/operations reviews. Historical findings and superseded proposals are not automatically current defects.

- Simulation remains a fixed 20 Hz authority using the shared motion kernel. Presentation changes must not change hitboxes, trail lifetime, collisions, scores, input application or random streams.
- Preserve one caller-owned presentation loop, supplied fractional visual time, renderer disposal, context restoration and operational Canvas fallback.
- Preserve authority/match/round/connection scope, atomic validation, bounded queues and caches, exact acknowledgements and explicit direct-connect failure. Do not remove validation to win a benchmark.
- Keep LAN `/display` and `/controller`, both themes, player identity, pointer cancellation and powerup readability intact.
- New worker boundaries, transport semantics, renderer replacement or buffering policies require an ADR and independent design review before implementation. Obtain implementation review before online release. Small internal optimizations still need relevant regression evidence.
- Use isolated local fixtures and owned processes. Never automate participants in an occupied match, restart a user's server, enable paid services or deploy as part of an exploration.

## What is established, and what is only a hypothesis

| Observation | Evidence | Interpretation and limitation |
| --- | --- | --- |
| Phaser 3.90 already selects WebGL, with Canvas fallback | [arena.ts](../../src/client/phaser/arena.ts), [presentation.ts](../../src/client/phaser/presentation.ts) | Three.js is not needed to obtain GPU acceleration. Verify the actual backend on an affected device. |
| Original Canvas render CPU p95 was 0.6–1 ms; Phaser was about 4–5 ms | [Recorded renderer measurements](../PHASER.md) | Different visual implementations on an M4 Max. This is not an equal-quality engine comparison or a phone measurement. |
| The mobile-sized board retained a 1600×900 backing while displayed at about 390×219 CSS pixels | [Mobile-sized evidence](../PHASER.md#mobile-sized-viewport-evidence) | Resolution scaling could reduce pixel work. Its benefit and acceptable sharpness are unmeasured. |
| Trail cache includes `s.tick`, and interpolation supplies fractional ticks; local prediction can create a new trail array | [arena.ts](../../src/client/phaser/arena.ts), [prediction.ts](../../src/online/prediction.ts) | Cache invalidation can happen every rendered frame. Cost attributable to this needs profiling. |
| Ink redraws a Canvas texture and calls `refresh()` each active frame | [arena.ts](../../src/client/phaser/arena.ts) | Full-surface drawing/upload is a candidate cost, not a confirmed bottleneck. |
| Transport serializes an envelope for byte accounting and again for sending; encoding repeats per recipient | [peer-transport.ts](../../src/online/peer-transport.ts), [runtime.ts](../../src/online/runtime.ts), [world-codec.ts](../../src/online/world-codec.ts) | Avoidable work exists; impact on the host's frame/tick scheduling is unmeasured. |
| Fixed response batch: local p95 27.6 ms, TV p95 88.2 ms; longer capture had 3.41% repeated TV tick intervals and hold maximum 51.2 ms | [Response report](../online/RESPONSE-BENCHMARK.md) | Desktop submitted-heading measurements, not scanout or physical touch-to-photon. Motion holds can persist with fast rendering. |
| Four bot decisions measured p95 about 0.44 ms at 4,000 trails | [AI report](../online/AI-RIDERS.md) | Historical Node measurement of controller work only; evidence for lower initial priority, not a mobile guarantee. |

## Agent organization and execution order

The coordinator owns this brief, experiment registration, baseline selection, integration and the benchmark schedule. Assign each agent one workstream and a separate branch/worktree based on the same agreed baseline. Use `codex/perf-<track>` branch names when branches are created. Agents sharing a checkout must agree on exact files before editing; separate worktrees do not prevent CPU/GPU contention or port conflicts.

| Track | Suggested ownership | Dependencies and priority |
| --- | --- | --- |
| A — Measurement and reproducible workloads | Benchmark scripts and opt-in diagnostic interfaces; coordinate any runtime hooks | First. Shared foundation for all comparisons. |
| B — Retained trails | Trail rendering helpers and regression fixtures; integration in `arena.ts` | High. May research alongside C/D; serialize edits to shared renderer files. |
| C — Resolution and quality controls | Presentation sizing, quality configuration and UI wiring | High for physical phones. Share coordinate contract with B/D. |
| D — Effects and ink | Effect helpers, textures, ink path and visual fixtures | Medium. Split ink and decorative effects into separate candidates. |
| E — Host encoding and allocation | `peer-transport.ts`, `world-codec.ts`, publication/checkpoint profiling | High for phone-host scenarios. Preserve protocol. |
| F — AI and simulation cost | `bot-controller.ts`, AI benchmark; simulation profiling initially read-only | Conditional on profiles; no balance changes. |
| G — Motion continuity and response | `prediction.ts`, `prediction-clock.ts`, response diagnostics | Separate design review for policy changes; coordinate with B's predicted tip. |
| H — Alternative renderer prototype | Experimental adapter/fixture, isolated from default application entry | Last, if measured Phaser costs remain material. |

Suggested waves:

1. A establishes realistic workloads and archives the common baseline. B–H can inspect/design, but should not publish timing conclusions before this contract exists.
2. Run independent B/C/E prototypes, then D. With three available worker slots, queue work rather than overlap file ownership. Only one timing workload uses a physical machine at once; avoid builds and other heavy work during measurements.
3. Run F/G when diagnosis supports them. H has a separate go/no-go decision after cheaper paths are measured.
4. The coordinator integrates one winner at a time and reruns the combined workload. Do not add independent percentage gains together or assume separately passing changes compose.

## Shared measurement contract

### Register each experiment before collecting decision evidence

Record hypothesis, exact changed variable, target hardware/browser, baseline and candidate identities, workload/seed, warmup, duration, run count/order, primary metric, practical improvement threshold and regression tolerances. Separate exploratory profiling from the predeclared comparison. Archive failures and inconclusive results; do not repeat until a passing percentile appears.

Proposed initial comparison protocol: three paired baseline/candidate runs per workload, alternating order, each 60 seconds after 5 seconds of warmup. Use identical workload time/seed sequences. This is a new protocol requiring harness support, not a claim that existing scripts already implement it. Retain per-run distributions; do not pool away a bad run. An interval estimate should resample runs or time blocks, not pretend adjacent frames are independent observations.

For B–F/H, a suggested screening target is at least 15% reduction in the named CPU/GPU cost and an absolute improvement larger than observed baseline variability, without worse frame/response tails or correctness. Register any different threshold in advance with a reason. This is a proposed exploration rule, not an amendment to release gates. A small, simple allocation fix can still be worthwhile if its result is reported honestly as small or unresolved.

For G, register a continuity improvement target together with response limits; a latency win that increases visible holds is not sufficient. The existing 33 ms local and 100 ms nearby-TV first-departure criteria remain relevant. The response runner has its own sample-eligibility protocol: use a predeclared 180-second decision run with at least 50 eligible samples per view, retaining rejections, timeouts and prior trials. Do not replace that protocol with the generic 60-second screening runs.

### Workload matrix

| Workload | Required coverage |
| --- | --- |
| Renderer replay | Five riders; short and long trails; baseline 800-segment/24-projectile/five-burst fixture; calm and heavy effects; ink separately; both themes. Add stress cases within validated world limits. |
| Snapshot reuse | Identical snapshot repeated; fractional interpolation between 20 Hz arrivals; local predicted tip changing while old geometry stays stable; additions, removals and clipped segments. |
| Full online game | Five connected player roles plus separate TV, host and guest metrics, shared-TV and individual-screen modes; record alive-rider count over time. |
| AI host | One human plus four bots, separately from the five-human-plus-TV case. Bots are not RTC participants. |
| Lifecycle | Death, round/match reset, theme change, shrinking arena, portal transitions, resize/rotation, context loss/restore/fallback and repeated mount/destroy. |
| Network | Direct, regional and poor-asymmetric application profiles; delivery/encoding/timing candidates include recovery, stale-state and correction measurements. |
| Real devices | Named iPhone/Safari and Android/Chrome devices, browser/OS versions, screen refresh, power mode, orientation, CSS/backing size and thermal conditions. If unavailable, mark physical acceptance unverified. |

Distinguish desktop six-view contention from six separate devices. Keep the all-visible case and single-visible diagnostic separate. For finalists, include a 30-minute run on declared hardware to assess sustained frame times, allocation/resource growth and thermal degradation. A connected-player soak does not establish continuous five-alive simulation stress; retain a separate deterministic dense replay and the live activity trace.

### Metrics and evidence

- Frame intervals: p50/p95/p99/max, counts and ratios above 20/33/50/100 ms, declared refresh rate, and raw timestamped samples. Average FPS alone is insufficient.
- Rendering: CPU submission cost separately from GPU execution, draw/batch counts where measurable, trail rebuilds/segments processed, texture upload dimensions/frequency, live objects/particles and backing resolution. Label GPU timing unavailable when unsupported; do not call JavaScript duration GPU time.
- Host: per-tick simulation/bot/encode/checkpoint costs, scheduling lateness/catch-up count, per-recipient encode time, allocation/GC traces, heap/resource trend and long tasks. Use detailed profiling in diagnostic runs, then light instrumentation for comparisons.
- Delivery/response: actual accepted-world age, correction event p95/p99/max/frequency, input-to-changed-pose and host-applied latency where instrumented, repeated rendered ticks, hold duration/ratio, recovery downtime and queues. Latest sampled UI values are not event distributions.
- Traffic: attempted and successfully queued payload bytes distinguished, per-peer and aggregate host egress, average and p95 one-second windows. Neither is application acceptance or wire bandwidth; collect separate wire counters if making wire claims.
- Visual evidence: matched screenshots and short motion recordings at fixed scene times. Include narrow trails, player colors, blast/ink boundaries, charging/aim markers and all relevant powerups. Record any accepted cosmetic tradeoff explicitly.

Use `artifacts/performance/<track>/<experiment>/<run>/` for working evidence. Preserve reviewed, redacted reports under `docs/performance/evidence/` only when ready; these directories and configurable output support are proposed, not already implemented. Each report must include source commit plus dirty diff/source hashes, served bundle hash for integrated runs, dependencies, hardware/backend, full command/configuration, seed, timings, failures, exclusions and comparison method. Never include bearer tokens, room capability URLs or full signalling payloads.

## A — Establish reliable measurement

**Question:** Is the reported problem GPU fill, geometry submission, host CPU/GC, frame scheduling, remote snapshot starvation, or a combination?

1. Reproduce on the affected device and game mode if available. Capture actual renderer backend, a browser performance trace and separate host/guest observations. Record unknown device/user conditions instead of inventing them.
2. Add opt-in, bounded phase counters with typed interfaces. Keep instrumentation disabled by default, and quantify its overhead with instrumentation-on/off runs.
3. Extend the renderer fixture to model stable snapshot arrays and fractional presentation. The current `visualFixture()` is called afresh on every frame and recreates trail arrays, even when the integer simulation tick is unchanged. Keep this allocation-heavy case as a labeled stress variant, but do not use it as the only cache benchmark.
4. Support immutable per-run output paths, explicit warmup and replay sequence, source hashes, backend/resolution capture and failures written to reports. The current renderer runner serves Vite source modules; final integrated claims require the production artifact too.
5. Add phase traces for checkpoint spikes, prediction allocations and paint work before proposing workers or changing scheduling. Where GPU tooling is unavailable, use resolution/effects interventions to test causality without claiming a measured GPU duration.

**Deliverable:** baseline report, harness changes with measurement regressions, a reproducible matrix and a ranked cost breakdown. Baseline correctness and overhead checks must pass before other agents use it for selection.

## B — Retain established trail geometry

**Hypothesis:** Redrawing all riders' three-layer trail paths on fractional time or one predicted-tip change creates avoidable CPU work.

**Paths to compare:** (B1) explicit geometry invalidation with established trails separated from transient tips; (B2) per-rider or bounded chunk caching; (B3) retained mesh or render texture only if B1/B2 still leave measurable cost. Keep each candidate independently measurable.

Inspect `arena.ts`'s `trailKey`, `previousTrails` and three stroke passes, and `prediction.ts`'s interpolated tick and appended predicted segment. Define how geometry identity is supplied or detected without scanning/serializing the entire world each frame. Do not merely round the tick: snapshots can be replaced within a tick, and predicted tips, clipping, resets and theme/alive state can change independently.

**Correctness cases:** unchanged trail with moving rider; append/expiry; changed coordinates with the same count/endpoints sampled by the old key; clipped or split segments; death opacity; player reorder/removal; authority/match/round reset; theme change; context restoration. Keep speculative tips out of authority and avoid drawing stale geometry across portals or resets.

**Measure:** full path rebuild count, segments processed, CPU submission and frame tails, memory/upload growth, plus screenshots. Aim for no established-geometry rebuild during presentation-only changes. A texture strategy must erase expired/removed segments correctly and avoid unbounded history.

**Tests:** new observable cache/geometry regressions plus existing Phaser effects, trail clipping and prediction tests; browser lifecycle checks. Tests should establish output correctness and bounded reuse, not freeze one private cache implementation.

## C — Decouple render resolution from game coordinates

**Hypothesis:** A fixed 1600×900 backing wastes GPU bandwidth on small displays, especially with translucent layers and ink.

**Paths to compare:** fixed 1600×900, 1200×675 and 800×450 backings with the same logical arena and visual workload; then a capped display-size/DPR policy. First compare explicit settings; adaptive scaling should be a separate candidate with bounded steps and hysteresis if fixed settings show value.

`createPhaserArena.render()` currently resizes to snapshot dimensions. Resizing the canvas alone will be undone and can misalign rendering. Define logical world dimensions, camera/viewport mapping, backing pixels, CSS fit, texture/mask sizing and target-pointer mapping together. Preserve aspect ratio and game geometry. Low quality currently chiefly changes particle budget, so do not describe an existing full resolution/effects setting as already available.

**Correctness cases:** both orientations, desktop resize, DPR 1/2/3, fullscreen, shrinking mask, readable trails/reticles/text, pointer target coordinates, fallback/restoration and both LAN/online paths. Only rendering quality may change; players cannot become invisible or have different collision boundaries.

**Measure:** physical-device frame/GPU trends, sustained heat-related degradation, screenshot readability and memory. 800×450 is one quarter of the pixels, not a promise of four times the speed. Report reduced-resolution wins separately from equal-resolution implementation wins. The existing fixed-backing assertion must remain for the baseline profile, with distinct assertions for new explicit profiles.

## D — Cache decorative effects and reduce ink work

**Hypothesis:** Repeated vector construction, translucent overdraw and full-size ink uploads create avoidable frame cost.

**Paths to compare independently:** (D1) cached sprites/textures for rings and repeated decorations, retaining animation via transforms/alpha; (D2) optional reduced glow/particle layers while preserving gameplay cues; (D3) ink implemented using a GPU render texture/mask or a smaller correctly mapped Canvas texture. A shader or alternate compositing approach needs a precise visual-equivalence specification first.

Inspect `arena.ts`'s dynamic/front Graphics layers, additive sprites, world sorting and active ink refresh, together with [ink drawing](../../src/client/ink-renderer.ts). Measure batch changes and draw costs instead of assuming all Graphics calls are slow. Several textures and pools already exist; reuse them.

**Correctness cases:** ink clear-space semantics, overlapping clouds and visibility boundaries; explosions/deaths emitted once per scoped event; expiry, reset, context restore and bounded texture/object lifetime. Do not simplify authoritative blast size or conceal charge/target/portal cues. A lower ink refresh cadence can visibly stutter and must be a separate quality tradeoff, not silently called equivalent.

**Measure:** ink-off versus ink-on, texture upload bytes/frequency where measurable, CPU/GPU/frame tails, particle/object limits and matched visuals. Include Phaser Canvas and original Canvas fallback behavior or an explicit reviewed fallback design.

## E — Reduce host serialization and allocation

**Hypothesis:** Per-peer world encoding and synchronous checkpoint work compete with phone rendering/input, producing spikes or avoidable GC.

**Candidates in increasing scope:**

1. Serialize each envelope once and reuse the string for byte accounting and `send`. Preserve existing attempted-byte semantics or add distinctly named counters rather than quietly redefining them; reuse a TextEncoder where appropriate.
2. Profile field comparisons and trail content keys in `WorldEncoder`. Avoid repeated serialization or repeated immutable work within a publication while preserving optional-field deletion, equality, per-peer stream/generation/sequence and keyframe receipt behavior. Never share recipient acknowledgements or reuse a delta against a peer's different base.
3. Reduce allocation in snapshot/delta paths only with exact decode/replay regressions. Mutation of data retained by interpolation, checkpoints or recipient encoders can silently corrupt history.
4. Measure checkpoint serialization and synchronous `localStorage` writes around the current one-second cadence. Change neither recovery semantics nor cadence as an incidental optimization. Asynchronous persistence or worker ownership requires a reviewed architecture proposal covering copies, clock/input ordering, validation, suspension, failures and bounded queues.

**Measure:** full publication CPU, per-peer cost, GC/long tasks, host scheduling lateness, render/response tails, payload and heap trend across 0/1/4 peers plus display as applicable. Compare phone host to desktop host. A codec microbenchmark alone cannot establish product improvement.

**Tests:** codec reconstruction on every frame including removed fields/trails, loss/resync/keyframe retransmit, recipient acknowledgements, failed sends, replacement connections, rejected checkpoints and scope transitions. Use current online/core, keyframe, checkpoint, input-ledger and recipient-ack tests as starting points.

The existing `benchmark-deltas.ts` measures a historical 10 Hz workload and overwrites `docs/online/delta-benchmark.json`. Preserve that evidence. Create a separately identified 20 Hz candidate workload with raw samples and equivalent reconstruction assertions; do not silently reinterpret the historical report.

## F — Profile AI and simulation; optimize only material costs

**Hypothesis:** Dense trails may make per-bot candidate collection/sorting and repeated projectile iteration allocate enough to matter on a phone.

Start with the existing four-bot benchmark and full host phase profiles. Candidate selection currently maps/filter/sorts trail candidates for each bot; projectile arrays are also created during lookahead. Compare reusable per-tick read-only data or bounded candidate selection while preserving ordering/ties and the same chosen intents across fixed seeds/states. A spatial index is a later option if profiles show it worthwhile.

Do not reduce lookahead, decision frequency, collision work or trail caps merely to win timing. Such changes alter AI/game behavior and need separate product review. Simulation broad-phase changes must preserve exact outcomes, including grazing hits, simultaneous collisions, portals and expiring/clipped trails.

**Measure:** four-bot total and full-authority p95/p99/max CPU, allocations and frame impact at 0/800/4,000 trail workloads. **Keep condition:** meaningful host improvement and identical deterministic intents/replay for an implementation-equivalent change; otherwise report a negative/inconclusive result and stop.

## G — Separate snapshot holds from rendering hitches

**Question:** Does sluggishness follow frame gaps, input application, clock estimates, publication spacing, or repeated presentation at the newest received snapshot?

First produce a synchronized trace of actual input changes, authority application, publication/receipt, accepted snapshots, qualified delay, presented tick, changed heading and render intervals. Keep local and TV paths separate. The current policy uses a 0.5-tick nearby delay only with qualifying fresh RTT observations and otherwise two ticks; it clamps to available state and never extrapolates. Read ADR 037 and all retained failed tuning trials.

Compare the unchanged policy under direct/regional/poor profiles and after B–E improvements. Only then propose adaptive delay/hysteresis or publication scheduling changes in an ADR. A worker split, physics-rate change, speculative collision path or unreliable channel is outside a small tuning experiment and needs its own design.

**Required invariants:** monotonic scoped presentation; no future discrete deaths/pickups; no interpolation through portals; bounded prediction; fresh validated clock qualification; explicit failure/recovery; no stale or duplicate fire on reconnect. Do not lower buffering universally to trade visible jitter for a better latency number.

**Measure:** first numerical and one-degree heading departure, eligible/rejected/timeouts, hold duration/ratio, correction events, snapshot age, clock transitions, bandwidth and frame gaps. Use all eligible continuity frames, not only windows ending at first response. Passing nearby latency cannot waive regional stability or poor-network safe failure.

## H — Bounded alternative renderer comparison

**Entry condition:** profiling shows material remaining renderer overhead after simpler candidates, or a desired visual capability makes a different renderer worth evaluating.

Write and independently review an ADR before implementing an experimental Three.js adapter. Compare existing Phaser, optimized Phaser and a minimal alternative using the same snapshot replay, logical/backing size, theme, trails, particles, ink and effect density. Include original Canvas as a simpler reference, explicitly labeled as a different visual implementation. Do not compare five simple Three.js sprites to the full Phaser scene and call it an engine speedup.

Prototype only the arena presentation contract. Use batched/retained geometry where appropriate, with no Three.js-owned physics, input authority or second animation loop. Keep the default renderer and dependencies stable outside the experiment until a reviewed decision.

**Measure:** frame/CPU/GPU tails, memory, sustained physical-phone performance, download/startup cost, visual parity, context loss/disposal, engineering complexity and fallback effort. **Decision:** migrate only for a reproducible material gain that survives equal-quality comparison and justifies migration/maintenance. A negative result closing this path is useful.

## Existing commands and harness limitations

These are current entry points, not a complete new experiment implementation. Run timing commands sequentially. Archive each generated report before the next run overwrites it. Online commands assume an isolated, current-build local service whose origin and process ownership have been verified.

```sh
# Renderer microbenchmarks: source-served, fixed 1600×900 backing, 1s warmup.
DURATION_MS=30000 BENCH_TAG=baseline npx tsx scripts/phaser-benchmark.ts
BROWSER=webkit DURATION_MS=30000 BENCH_TAG=baseline npx tsx scripts/phaser-benchmark.ts
VIEWPORT_WIDTH=390 VIEWPORT_HEIGHT=844 DPR=2 QUALITY=low BENCH_TAG=mobile-baseline DURATION_MS=30000 npx tsx scripts/phaser-benchmark.ts

# Renderer lifecycle and correctness, separate from timing runs.
npx tsx scripts/phaser-browser.ts
BROWSER=webkit npx tsx scripts/phaser-browser.ts
npx tsx scripts/benchmark-bots.ts

# Peer-to-peer runtime (2026-09-16): wire bytes, rollbacks and input-to-state latencies, locally and under injected impairment.
ONLINE_URL=http://localhost:8787/ npx tsx scripts/p2p-measure.ts
# (benchmark-response.ts and online-network-benchmark.ts were removed with the host-star runtime.)
```

Response output is `artifacts/response-benchmark.json`; network output is `artifacts/online-network-benchmark.json`; bot output is `artifacts/bot-benchmark.json`. Renderer output includes the tag/browser in its name. The network runner's `BENCH_RENDER_SINGLE=1` is diagnostic isolation, not full-view acceptance. Neither response nor network runner gains WebKit support merely by setting `BROWSER=webkit`; implement and validate support separately if needed. Read [network harness scope](../online/NETWORK-HARNESS.md) before interpreting results.

## Handoff template and decision record

Each agent creates `docs/performance/<track>-report.md` with:

1. Hypothesis, experiment registration and assigned files; baseline/candidate commits and artifact hashes.
2. Proposed design and alternatives; ADR/review link when required; exact behavior and visual tradeoffs.
3. Commands/environment/workloads, instrumentation overhead, raw evidence links and excluded/unmeasured surfaces.
4. Per-run baseline/candidate p50/p95/p99/max, absolute/relative changes and noise; all failed runs, timeouts and correctness failures.
5. Regression tests and completed outputs for the candidate revision; visual evidence and resource bounds.
6. Recommendation: **keep**, **reject**, **inconclusive**, or **requires architectural decision**; explain why and state remaining work.
7. Integration patch/commits when authorized, conflict notes, rollback mechanism and compatibility implications. Do not edit the coordinator's release status or publish the experiment.

Reusable assignment prompt:

> Explore track <ID> from docs/performance/EXPLORATION-BRIEF.md on the agreed baseline. Own only <files/worktree>. First inspect current sources/tests and register one falsifiable experiment with the coordinator. Preserve the stated invariants and coordinate shared-file edits. Obtain independent review before implementing architectural changes. Use the agreed benchmark slot and retain every result, including failures. Deliver a bounded candidate where justified and a report using the handoff template. Do not deploy, change release gates, touch occupied games or claim physical-device evidence from browser emulation.

The coordinator keeps a decision table with track, candidate identity, reviewed evidence, decision, integration order and outstanding risks. Reject or defer candidates whose costs are already negligible, whose gains disappear in the full game, or whose complexity outweighs measured benefit.

## Integration and release boundary

After selecting candidates, test their combined implementation on the same baseline matrix and verify visual interactions: resolution with ink/masks, cached trails with prediction/reset, encoding with keyframe recovery, and reduced effects with player readability. Preserve a simple rollback path.

Run checks appropriate to every candidate. Before deployment, run the complete release suite and the relevant Chrome/WebKit LAN/online, AI, renderer lifecycle and Pages base-path checks described in README and the roadmap:

```sh
npm run typecheck
npm test
npm run test:coverage
npm run build
```

Keep [.c8rc.json](../../.c8rc.json) thresholds unchanged and identify excluded browser/renderer surfaces. Independent implementation review, exact-artifact preview, compatibility/rollback review and actual destination verification remain release requirements under [GCP deployment instructions](../online/GCP-DEPLOY.md). ADR 032's partially evidenced proposed budgets retain their documented status; this brief neither certifies them nor waives them.

## External technical references

- [Phaser Graphics documentation](https://docs.phaser.io/api-documentation/class/gameobjects-graphics): caching mostly static Graphics as textures can reduce repeated work; verify APIs against pinned Phaser 3.90.
- [Phaser render textures](https://docs.phaser.io/phaser/concepts/gameobjects/render-texture): candidate mechanism for GPU-resident composition, subject to visual and lifecycle checks.
- [Three.js responsive rendering](https://threejs.org/manual/en/responsive.html): drawing-buffer resolution and display size are separate, with a pixel-work tradeoff. The same principle applies to a Phaser sizing experiment.
