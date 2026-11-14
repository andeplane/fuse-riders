# Fuse Volley

Fuse Volley is a multiplayer blob volleyball game, served at `/fuse-volley/` (locally
**http://localhost:8787/fuse-volley/?mute**).

This is the empty scaffold from `scripts/new-game.ts fuse-volley`: the rules, page and tests are still the template's
(Pig, `games/dice`), wired to the shared stack (`fuse-netcode`, `fuse-network-fe`, `fuse-platform`, `fuse-ui`) and
registered in `service/history.ts`. Gameplay replaces the template in follow-up work. Production serves its rooms only
once `fuse-volley` is in `EXTRA_GAME_IDS` ([GCP deploy](../../docs/online/GCP-DEPLOY.md)).

Checks: `pnpm exec tsx --test games/fuse-volley/tests/*.test.ts tests/dice-service.test.ts`.
