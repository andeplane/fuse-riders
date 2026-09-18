# Browser-hosted online play

Every device in a room runs the same 20 Hz simulation from one shared input log ([P2P-INPUT-LOG-BRIEF.md](P2P-INPUT-LOG-BRIEF.md)); the creator can also play on a phone. WebRTC data channels form a full mesh, one link per pair of members, and carry one small packet per tick each way plus snapshots for joiners. The room service only issues codes, tracks membership and relays signalling.

The backend never simulates or relays gameplay. A `relay` frame is answered with an error (`src/service/gateway.ts`), so a direct link that cannot be established shows an explicit failure/retry state instead of degrading to a server path. No TURN service is provisioned. See [ADR 035](../adr/035-direct-gameplay-only.md) for that decision and [ADR 034](../adr/034-gcp-pages-deployment.md) for the deployment target; architectural limits and release gates stay in ADRs 028–035 (superseded for gameplay by the P2P brief) and the brief itself and [ROADMAP.md](ROADMAP.md). This is not a qualified production deployment.

## Run locally

`pnpm dev:online` builds the assets and starts the local room service on http://localhost:8787: the same `src/service` gateway and room store as production, over in-memory room metadata and a single-process bus (`src/service/dev.ts`). Rooms disappear when it stops. Create a room, then open its link in another browser/profile. Test WebRTC on localhost or HTTPS: ordinary remote HTTP addresses are not secure browser contexts.

The app uses the online room flow in both development and production. `pnpm dev` runs the in-memory room service locally; production uses the deployed room service.

## Deploy

Production is GitHub Pages for the static frontend plus a Cloud Run gateway with Firestore room metadata and Pub/Sub signalling — see [GCP-DEPLOY.md](GCP-DEPLOY.md) for the guarded release flow (`scripts/deploy-cloud.sh`, `.github/workflows/backend.yml`, `.github/workflows/pages.yml`) and [GCP-INVENTORY.md](GCP-INVENTORY.md) for the verified resources and the deployed revisions. Cloud Run/Firestore/Pub/Sub usage is billable; GCP-DEPLOY.md records the configured instance and concurrency limits.
