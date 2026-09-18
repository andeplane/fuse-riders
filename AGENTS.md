# Working on Fuse Riders

Fuse Riders is a small TypeScript game for 2–5 friends under active development, with LAN TV/phone play and online rooms supporting shared-screen or individual-device play. Prioritize responsive, fun gameplay, consistent outcomes and low hosting cost, avoiding an always-running simulation server where practical. Deliver working changes promptly; scale process to the change.

## Default workflow

- One agent owns implementation and verification end to end. Work directly; do not create planner/reviewer/approver chains by default.
- Inspect `git status`, relevant code and nearby tests before editing. Preserve unrelated work. Use `codex/` for new branches and stage only your own changes when committing.
- Read documentation that helps with the current change. There is no mandatory tour of historical ADRs, reviews or the roadmap.
- Routine fixes, UI changes and bounded refactors need no ADR or independent approval. For a substantial architecture change, write a short design note identifying the intended behavior and key tradeoffs, then implement. Mid-implementation review is not a gate for each correction; the review that matters happens on the pull request (see **Pull requests**).
- Follow the user's intended architecture. Do not preserve an obsolete online design or add compatibility modes unless needed by the task. Preserve LAN play.
- Use existing issues when useful. Creating issues, changing labels, posting progress comments and producing formal handoffs are not prerequisites for work. Update tracking at meaningful milestones, not every iteration.
- Make reasonable implementation decisions autonomously. Ask only when missing information materially affects scope or an action needs authorization.
- Finish the requested scope with relevant checks and a concise report. Do not expand every development task into a release, exhaustive audit or network qualification project.

These workflow rules replace older process requirements in ADRs, review notes and other repo documents. Those documents remain useful technical context; their historical approval and reporting requirements do not create new gates. Preserve relevant correctness requirements and explain material changes to technical contracts.

## Code and gameplay

- Keep the LAN `/display` and `/controller` paths and the neon/pixel aesthetic. Cosmetic changes must not alter simulation geometry, timing or player identity.
- `src/engine/` owns deterministic rules and simulation and must not import app, net or render code; its few remaining imports of `src/shared/` are pinned exactly in `tests/fixtures/layer-allowlist.json` and shrink in #254 (`src/shared/` keeps what is not simulation: wire types, avatars, ids, rider names, rating); `src/server/` owns LAN authority; `src/online/` owns online simulation coordination on top of the `fuse-network-fe` transport; `packages/` holds the game-agnostic networking libraries (`fuse-network-fe`: WebRTC mesh and room client, `fuse-network-be`: room signalling service, `fuse-network-protocol`: their shared wire contract) and must not import from `src/`; `src/service/` is the game's thin entry to `fuse-network-be` (Cloud Run in production, `src/service/dev.ts` in-memory locally and in CI); `src/render/` owns presentation and imports only the engine's view contract (`src/engine/view.ts` and `view-kit.ts`; rule values it needs travel as data in the `WorldView`, see `docs/design/render-boundary.md`); `src/client/` owns audio, controls and the rest of the app-side UI.
- `src/engine/rider-motion.ts` is the shared pure motion kernel. Preserve turn-then-move fixed-step behavior and atomic agreement between applied-tick records and snapshots. Bots in `src/engine/bot-controller.ts` emit ordinary inputs and get no privileged physics.
- Keep simulation ticks and clocks separate from rendering. Phaser may render fractional snapshot time but must not run authoritative physics, game timers or a competing render loop. Consult `docs/PHASER.md` when changing presentation timing.
- A change to engine behaviour must bump `RULES` in `src/engine/apply-tick.ts` and refresh the golden with `npx tsx scripts/update-golden-hashes.ts --record` (about a minute) in the same commit. `tests/golden-hash.test.ts` failing without an intended behaviour change is a regression to fix, not a golden to refresh. See "When the golden fails" in `docs/design/engine-safety-net.md`.
- Keep ownership and ordering of actions and outcomes explicit. Prediction or rollback must converge on consistent collisions, pickups, scores and results. When changing delivery, account for entry tick and sequence, member generation, gaps and repair, retries and cancellation. A queued send is not proof the receiver applied it.
- Validate data at room service, WebRTC, checkpoint and storage boundaries; TypeScript types are not runtime validation. Scope actions and events to the room, authority, match and round so old messages cannot affect new play. Restore validated state atomically, leaving healthy state unchanged on rejection. Bound queues, parsers, history and recovery attempts.
- The room service (Cloud Run in production, `src/service/dev.ts` locally) coordinates rooms; it does not simulate or relay gameplay. Direct WebRTC failure needs an explicit retry state. A room keeps running while any rider stays; a device that leaves recovers the world from a peer, and nothing is persisted locally. Every member is trusted with the shared log. Do not silently add a gameplay relay or a paid service.

## Verification

- During iteration, run focused tests for the behavior changed. Add regressions for bugs. Use explicit interfaces and typed fakes for clocks, scheduling, randomness, transport, storage and browser surfaces; avoid `as any`, private-field mutation, global monkeypatches or real sleeps to make unit tests pass. Browser impairment harnesses may instrument APIs with documented limits.
- Test observable behavior, not copies of implementation logic. For affected network/simulation paths, cover deterministic replay, dropped/duplicated/reordered messages, held/released/cancelled input, reconnects or corrupt state as relevant, including safe failure as well as recovery.
- For UI or transport changes, exercise the affected browser flow. Use README for smoke commands and `scripts/ci-local.sh` for the CI mirror. Documentation-only edits need a diff check, not game tests.
- CI's browser matrix runs on a push to main, not on every pull request, so a pull request passing CI is not evidence that a browser flow still works. That is deliberate: waiting on the full matrix in every pull request costs more time than a broken main does. A broken main is acceptable from time to time — notice it, fix it forward, move on. Run the affected smoke locally when that is cheap, and say in the pull request what you could not run; do not hold a pull request for browser coverage it can get on main.
- Run broader checks at integration milestones. Once relevant checks pass, move on unless new changes or failures justify repeating them. Do not lower coverage thresholds or hide failures to finish.
- Sustained impairment tests and physical-phone checks belong to tasks that change those behaviors or explicitly request qualification. Scope them to the risk; do not run the entire matrix for every fix. Never disrupt an occupied match.
- Report what was actually tested and any remaining limits. Browser emulation is not physical-phone evidence; application payload bytes are not wire bytes.
- Coverage applies only to modules named in `.c8rc.json`; do not infer browser or renderer coverage from the unit-test percentage. For performance claims, retain the command, source revision, workload/seed and results so the comparison can be reproduced.

Before production deployment, run the release suite plus browser checks relevant to the release:

```sh
npm run typecheck
npm test
npm run test:coverage
npm run build
```

## Pull requests

- Open a pull request whenever the work is finished and you believe it is ready. Pushing a branch is not delivery: finish the change, run the checks the change deserves, then open the pull request describing what changed and what was verified. Do not wait to be asked.
- Review every pull request with subagents before asking for a merge. Dispatch them on the diff — correctness and simulation/protocol risk, then tests and documentation as the change warrants — and act on what they find: fix it, or say in the pull request why it stands. A review that produced no pushed fix and no written answer did not happen.
- Stop by default at a reviewed pull request with a concise verification report. Do not merge, enable auto-merge or deploy unless the user explicitly authorizes that action for the current change. Requests to implement, try, test, commit, push or open a pull request are not merge or deployment authorization. Continue implementation, fixes and verification autonomously; do not ask for permission at every step.
- For gameplay, controls, sound, effects and visual changes, provide a runnable preview or clear playtesting instructions and leave the pull request open for the user to try. Automated checks and agent review establish technical readiness, not the user's acceptance of the feel or appearance. Requests such as "try this", "prototype" or "in stages" do not authorize shipping the experiment. The user may explicitly waive playtesting or authorize a merge.
- Once the user authorizes merging, resolve review findings and require the `verify` gate — typecheck, unit tests, coverage and build — to be green before merging or enabling auto-merge. Do not add the `full-ci` label on your own initiative; add it when the user asks, or when landing the change broken would be expensive to unwind, such as a protocol, deployment or release change.

## Documentation and deployment

- Update documentation directly affected by the change. Keep release history in release documents rather than duplicating it here. Consult `docs/online/PUBLIC-BETA-2026-09-14.md` and the deployment inventory when reporting release status, and verify current external state before claiming publication or CI success.
- Use README for onboarding, `docs/online/PROTOCOL.md` and relevant ADRs for protocol context, and the roadmap for planned work. Historical `docs/architecture.md` has old LAN/balance details; verify game constants from source and link to current rule definitions instead of copying balance tables. Proposed designs and review findings are not completed features.
- For production deployment, follow `docs/online/GCP-DEPLOY.md`. Preserve exact-source verification and distinguish local verification from CI. Check client compatibility and rollback implications for protocol releases.
- Never commit or expose bearer tokens, TURN secrets, credential files or unredacted logs. Public invites must not carry host capabilities; Origin checks are not authentication. Do not enable paid services without user authorization.
