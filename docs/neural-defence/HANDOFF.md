# Phase 0 implementation handoff

Status: **work in progress, explicitly handed off to a cloud agent by the user**. Continue on `codex/neural-defence-design`, draft PR #409. Do not merge or deploy. User authorized implementation and sprites, requested frequent commits and agent review. Earlier planning-only statements are superseded by that authorization.

## Latest user decisions

- Menu: New game and Settings. Offline solo without AI, plus a separate scripted combat lab.
- Builder particle delivers queued construction; one attack particle type. No guard/shield particle or composition refit in Phase 0.
- One experimental tower type, with one test tower in the lab; no tower roster/tree.
- Biomass and Insight deposits. Four-player ownership must work in the core now.
- Repeatable ground variants and varied rocks. Four team-specific neuron designs, rather than white-only tinting. Selection is a shared overlay.
- `?debug` draws clear tile boundaries; instant research/construction options retain particle travel and resource costs.
- Headless TypeScript core, existing network runtime, injected side effects and strongly typed test fakes. Preserve statistics for future graphs.

## Implemented so far

`games/neural-defence/src/engine/`: maps, state/types, pure ticking, builder lifecycle, mining, research, finite attack inventory and transport, minimal combat, codecs/hash, focused tests. Money is integer milli-units.

`src/online/`: full initial RollbackGame adapter, offline RoomRuntime session, scripted combat lab. Shared netcode now offers optional `seating.minimumParticipants`, default two; this game uses one. No second authoritative timer and no transport created for solo. Runtime tests cover solo/reset/disposal and basic wire/checkpoint handling.

`src/app/`, `src/render/`, `index.html`, `maps/`: menus, setup, injected map loading/preferences, HUD, SVG board/animation, two JSON maps. Root landing links to the game. The renderer currently uses procedural shapes; generated sprite assets are **not wired into rendering yet**.

`src/assets/` contains available individual sprite candidates. `docs/neural-defence/art/` preserves previous candidates/prompts and a contact-sheet utility. Old guard/Insulation exploration is superseded, not current gameplay. Finish and inspect the new roster before claiming sprite completion.

## Verified at handoff

- `pnpm typecheck`: passed.
- `pnpm exec tsx --test games/neural-defence/tests/*.test.ts`: 15 passed (12 engine, 3 runtime/adapter).
- `pnpm exec tsx --test packages/fuse-netcode/tests/room-runtime.test.ts`: 9 passed.
- `git diff --check`: passed before handoff documentation.
- No browser smoke, screenshot, full suite, coverage, performance benchmark or real-network verification yet. See PR for build result.

## Required continuation

1. Review engine and adapter independently. Harden checkpoint cross-field consistency, settings/map identity, command scope/generation/replay behavior, and bounded state. Add late-input replay convergence, rejection-atomicity and four-player transport/combat tests. Current tests are a starting point, not complete acceptance.
2. Audit mechanics against latest user decisions and reconcile PHASE_0, CORE_TYPES, ARCHITECTURE and ENGINE_PLAN: they still contain obsolete guard/refit and deferred-tower sections. Do not restore those obsolete mechanics to match stale documents.
3. Close known gaps: tower support-loss test currently does not actually cut support; LOS is two-hop open-intermediate rather than geometric supercover; builder travel currently uses a separate channel from attack capacity; strict map deposit/fairness validation needs review. Review cell-array bounds, transient capacity reservations, tie ordering and simultaneous deaths.
4. Test combat-lab setup for every selectable spawn/map. Its initial fixture is programmatic; check exactly one supported test tower and useful fighting positions. The scripted opponent uses ordinary priority actions. This is not AI.
5. Finish individual sprites/team variants/terrain and wire them into renderer. Preserve genuine alpha and hex registration, assemble an inspected contact sheet. Ensure selection, damage, queued builds and active travel read clearly on all objects.
6. Run real browser flows: landing → menu → New game, Settings, map errors/retry, sandbox build → mine → research, builder dispatch/return, particle priority/latency, lab combat, reset/back, debug grid, keyboard and narrow screen. Save actual screenshots. Avoid audio (`?mute`).
7. Run typecheck, focused tests, full tests once at integration, build and applicable coverage. Measure a four-player congested headless workload with seed/rules/revision. Update docs/PR with exact evidence and remaining limitations.

Use `pnpm install --frozen-lockfile`, then `pnpm dev` (builds all games and starts the existing service). Game route is `/neural-defence/?mute`; debug is `/neural-defence/?mute&debug`. No development server was left running at handoff.
