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
- `src/shared/` owns deterministic rules and simulation; `src/server/` owns LAN authority; `src/online/` owns online simulation coordination and transports; `src/service/` owns GCP signalling; `worker/` is the legacy/local Cloudflare adapter; `src/client/` owns presentation and controls.
- `src/shared/rider-motion.ts` is the shared pure motion kernel. Preserve turn-then-move fixed-step behavior and atomic agreement between applied-tick records and snapshots. Bots in `src/shared/bot-controller.ts` emit ordinary inputs and get no privileged physics.
- Keep simulation ticks and clocks separate from rendering. Phaser may render fractional snapshot time but must not run authoritative physics, game timers or a competing render loop. Consult `docs/PHASER.md` when changing presentation timing.
- Keep ownership and ordering of actions and outcomes explicit. Prediction or rollback must converge on consistent collisions, pickups, scores and results. When changing delivery, account for action age, sequence, authority epoch, acknowledgements, retries and cancellation. A queued send is not proof the receiver applied it.
- Validate data at service/Worker, WebRTC, checkpoint and storage boundaries; TypeScript types are not runtime validation. Scope actions and events to the room, authority, match and round so old messages cannot affect new play. Restore validated state atomically, leaving healthy state unchanged on rejection. Bound queues, parsers, history and recovery attempts.
- The GCP and legacy Worker backends coordinate rooms; they do not simulate or relay gameplay. Direct WebRTC failure needs an explicit retry state. Browser-host suspension and host trust remain product limitations; local checkpoints are not durable failover. Do not silently add a gameplay relay or a paid service.

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
npm run typecheck:worker
npm test
npm run test:coverage
npm run build
```

## Pull requests

- Open a pull request whenever the work is finished and you believe it is ready. Pushing a branch is not delivery: finish the change, run the checks the change deserves, then open the pull request describing what changed and what was verified. Do not wait to be asked.
- Review every pull request with subagents before asking for a merge. Dispatch them on the diff — correctness and simulation/protocol risk, then tests and documentation as the change warrants — and act on what they find: fix it, or say in the pull request why it stands. A review that produced no pushed fix and no written answer did not happen.
- Turn on auto-merge once the review is answered and you are happy with the change. The pull request gate is `verify` — typecheck, unit tests, coverage and build — and it must be green first: auto-merge is never a way to land red checks. Do not add the `full-ci` label on your own initiative; add it when the user asks, or when landing the change broken would be expensive to unwind, such as a protocol, deployment or release change.
- Leave merging to the user when the change is theirs to weigh: an architecture change, a protocol or deployment release, or anything you flagged a concern about.

## Documentation and deployment

- Update documentation directly affected by the change. Keep release history in release documents rather than duplicating it here. Consult `docs/online/PUBLIC-BETA-2026-09-14.md` and the deployment inventory when reporting release status, and verify current external state before claiming publication or CI success.
- Use README for onboarding, `docs/online/PROTOCOL.md` and relevant ADRs for protocol context, and the roadmap for planned work. Historical `docs/architecture.md` has old LAN/balance details; verify game constants from source and link to current rule definitions instead of copying balance tables. Proposed designs and review findings are not completed features.
- For production deployment, follow `docs/online/GCP-DEPLOY.md`. `npm run deploy` targets legacy Cloudflare, not the GCP/Pages production path. Preserve exact-source verification and distinguish local verification from CI. Check client compatibility and rollback implications for protocol releases.
- Never commit or expose bearer tokens, TURN secrets, credential files or unredacted logs. Public invites must not carry host capabilities; Origin checks are not authentication. Do not enable paid services without user authorization.
