# Browser-hosted online play

The creator's browser runs the authoritative 20 Hz game; the creator can also play on a phone. WebRTC data channels carry gameplay directly between the host and each player/display. This is a star topology, not an all-to-all mesh.

The backend never simulates or relays gameplay. A `relay` frame is answered with an error (`src/service/gateway.ts`), so a direct link that cannot be established shows an explicit failure/retry state instead of degrading to a server path. No TURN service is provisioned. See [ADR 035](../adr/035-direct-gameplay-only.md) for that decision and [ADR 034](../adr/034-gcp-pages-deployment.md) for the deployment target; architectural limits and release gates stay in ADRs 028–034 and [ROADMAP.md](ROADMAP.md). This is not a qualified production deployment.

## Run locally

`npm run dev:online` builds the assets and starts the local room service on http://localhost:8787: the same `src/service` gateway and room store as production, over in-memory room metadata and a single-process bus (`src/service/dev.ts`). Rooms disappear when it stops. Create a room, then open its link in another browser/profile. Test WebRTC on localhost or HTTPS: ordinary remote HTTP addresses are not secure browser contexts.

Legacy LAN hosting is still available through `npm start`, `/display` and `/controller`. The online home page requires a room API, so use `dev:online` for the room flow.

## Deploy

Production is GitHub Pages for the static frontend plus a Cloud Run gateway with Firestore room metadata and Pub/Sub signalling — see [GCP-DEPLOY.md](GCP-DEPLOY.md) for the guarded release flow (`scripts/deploy-cloud.sh`, `.github/workflows/backend.yml`, `.github/workflows/pages.yml`) and [GCP-INVENTORY.md](GCP-INVENTORY.md) for the verified resources and the deployed revisions. Cloud Run/Firestore/Pub/Sub usage is billable; GCP-DEPLOY.md records the configured instance and concurrency limits.
