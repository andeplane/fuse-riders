# Browser-hosted online play

The prototype uses the topology below. The proposed ADRs 028–032 and ROADMAP.md govern hardening; the independent reviews identify release blockers. This is not a qualified production deployment.

- Static game assets plus a Cloudflare Worker and hibernating SQLite Durable Objects for room discovery, signalling and fallback relay.
- The creator's browser runs the authoritative 20 Hz game. The creator can also play on a phone.
- WebRTC data channels normally carry gameplay directly between the host and each player/display. This is a star topology, not an all-to-all mesh.
- A secure WebSocket relay can carry messages when direct channels are unavailable. Liveness-based stall detection and reliable switching are not yet implemented. It does not run the simulation. It handles traffic only while people play; no rented server runs 24/7.
- TURN is optional: configure Cloudflare Realtime credentials to relay WebRTC on restrictive networks, otherwise the built-in WSS fallback still works.

## Run locally

`npm run dev:online` builds the assets and starts Wrangler on http://localhost:8787. Create a room, then open its link in another browser/profile. Test WebRTC on localhost or HTTPS: ordinary remote HTTP addresses are not secure browser contexts.

Legacy LAN hosting is still available through `npm start`, `/display` and `/controller`. The online home page requires the Worker API, so use `dev:online` for the new room flow.

## Deploy at low cost

1. Install dependencies: `npm ci`.
2. Authenticate: `npx wrangler login`.
3. Run `npm run deploy`. This uploads static assets and applies the Durable Object migration from `wrangler.jsonc`.
4. Use the printed HTTPS workers.dev URL. No separate VPS, Redis or database service is required.
5. Optional TURN: create a Cloudflare Realtime TURN key, then set `npx wrangler secret put TURN_KEY_ID` and `npx wrangler secret put TURN_API_TOKEN`. Secrets stay in the Worker; browsers receive short-lived ICE credentials only.

For a preview without an account, Wrangler also supports `npx wrangler deploy --temporary`; the temporary account must be claimed before it expires. Treat the claim URL as private. Never commit temporary credentials or claim URLs. Claiming/authentication is a user account operation; do not assume a preview is permanent.

## Cost expectations

For occasional direct-peer games, start with Workers Free and SQLite Durable Objects. Static assets are served by the platform; signalling is low volume, and hibernation avoids paying for idle room connections. Free quotas still apply. The relay fallback consumes more request/compute quota than direct links, so monitor its usage rather than promising free service at any scale.

Cloudflare Realtime's published TURN/SFU egress price is $0.05/GB. At an indicative 0.19 Mbps per receiver, an hour is about 85 MB before protocol overhead: approximately $0.004 per receiver-hour if all of that traffic goes through billable TURN. Four remote players would be about $0.017/hour in that example, excluding signalling and bursts. Direct peer traffic does not incur TURN egress. A paid Workers plan can be added later if free quotas are exceeded; verify current prices before enabling paid services.

Sources checked 2026-09-14:
- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://developers.cloudflare.com/durable-objects/best-practices/websockets/
- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/realtime/sfu/pricing/
- https://developers.cloudflare.com/workers/platform/claim-deployments/

## Recovery and practical limits

The host must keep the game tab awake. The prototype attempts to pause when the host is hidden and resume when visible, but abrupt suspension and back-forward restoration are not yet qualified. Local checkpoints attempt refresh recovery; validation and atomicity currently have review blockers. Periodic saving does not guarantee a one-second rollback bound. It is saved on membership/settings/actions as well as periodically. Closing the host permanently does not elect a replacement host in this version. Players reconnect with room-scoped browser identities; opening a display uses a separate identity and cannot replace the host.

Client steering has a local prediction prototype, but shared fixed-tick replay and applied-input acknowledgements are still required before its reconciliation is accepted. Prediction freezes after 200 ms without an authoritative update. It cannot make a disconnected network playable or remove disagreements about newly created obstacles. Severe latency can visibly correct position. The host is trusted, appropriate for friend rooms; this is not an anti-cheat architecture for ranked public competition.

Preferences are versioned in the host's localStorage, including shared-screen/device layout, first-to-N wins or fixed rounds, and powerup weights (zero disables). Active room state comes from the host, not another player's local defaults. Format changes apply next match; pickup weights apply next round. An all-zero table means no random drops.

Rooms accept at most 12 connections and five player seats. There is a per-IP creation limit and per-socket message/size limits. Empty signalling rooms expire after their scheduled cleanup; active rooms reschedule cleanup. Do not put host identity tokens in invite URLs.

## Verification

- `npm test`: deterministic game, room permissions/settings, snapshot reconstruction, recovery and prediction tests.
- `npm run typecheck` and `npm run typecheck:worker`.
- With Wrangler running: `npx tsx scripts/online-smoke.ts` and `BROWSER=webkit npx tsx scripts/online-smoke.ts` cover five players, host controls, preferences, refresh recovery and shared-screen display roles.
- `npx tsx scripts/benchmark-actions.ts`: reports committed-action bytes per second per full-view recipient; compare against `docs/online/delta-benchmark.json` for the retired world-delta codec.
- `npx tsx scripts/online-network-benchmark.ts`: real browser peers with verified RTC delay injection and a forced WSS fallback profile; writes browser-network.json.

The network benchmark uses injected delay/jitter/head-of-line stalls, not real IP packet loss. Figures are desktop browser measurements, not physical phone touch-to-photon measurements. Browser metrics distinguish frame duration, local input-to-frame, input acknowledgement and correction magnitude. The short run is an exploratory baseline, not a mobile-network guarantee or a fleet capacity certification.
