# Internet join recovery and operational reports

Internet rooms continue to use direct WebRTC gameplay. The gateway only handles membership, signalling and redacted diagnostics. No simulation server, gameplay relay or TURN service is added.

Each local negotiation queues at most 64 early trickle candidates until its SDP has been published. This matters on a replacement connection: sending the new candidates first lets the answerer buffer them on the old connection, then discard them when the new certificate replaces it. Repeated membership notifications retain an offer already in progress; explicit recovery can replace a drained connection. Work waiting for ICE configuration is fenced against both the room socket and the target connection's generation.

Every browser, including the host, sends `link-report` version 1 over its authenticated room socket. Reports contain peer/connection identifiers, the actual offerer role, candidate-type counts, signalling counts, ICE/connection/channel states, restart attempts, age and page visibility. They contain no addresses, SDP, names, room codes, invite URLs, tokens or freeform errors. Failed/connecting links report every ten seconds; healthy links every minute. Background browsers may throttle those intervals. The receiver reconstructs an allowlisted record, limits each member to an initial burst of two followed by one report per ten seconds, and removes links to obsolete peer connections. It performs no database reads, writes or Pub/Sub publishes for reports.

Cloud Run emits structured `room-link-report` entries. `roomKey` is SHA-256 of the room code; `incarnation` separates reused codes; `memberId` and `connectionId` correlate the reporting device with its peer's report. `role` identifies the creator or client, while each link's `offerer` identifies negotiation direction. The record is a client observation, not proof that the peer applied a frame.

Compute the room key locally and filter Cloud Logging:

```sh
node -e 'console.log(require("node:crypto").createHash("sha256").update("AB42").digest("hex"))'
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="fuse-riders-gateway" AND jsonPayload.kind="room-link-report" AND jsonPayload.roomKey="HASH_FROM_ABOVE"' --project andershaf-87 --limit 100 --format=json
```

Compare both ends. No offers/answers indicates signalling or admission trouble; no reflexive candidates indicates STUN trouble; exchanged candidates with failing ICE indicates a direct-path problem; connected ICE with unhealthy channels/probes indicates data-channel or lifecycle trouble. A delay alone cannot establish NAT type, and the UI no longer tells every stalled phone to join the host's Wi-Fi.

Reports are additive: older gateways ignore them, and older clients do not send them. Deploy the gateway before expecting production logs, then deploy the frontend. No protocol-version or simulation-rules bump is required. There is still no TURN fallback: some network pairs cannot establish a direct path. Desktop browser checks do not qualify a physical cellular phone.

After `pnpm build`, run `pnpm exec tsx scripts/internet-join-smoke.ts`, and again with `BROWSER=webkit`. The self-contained smoke uses a free local port, holds an ICE response, duplicates membership notifications, joins and refreshes a phone-sized browser, checks description-first trickle and real server reports, and saves screenshots and diagnostic evidence under `artifacts/`. It does not access an occupied public room.

The original author verified the full 3,462-test suite, integrated coverage and real Chromium/WebKit join/refresh flows before integration. Merge `470e522c` incorporates main `5568b7bc` while preserving the public `TransportDependencies` interfaces from #381. Report timing and visibility now use those injected capabilities, and socket checks use the transport's named open state. All 84 focused transport, signal, report-parser, room-service and connection-hint tests pass after integration, along with TypeScript, build, affected lint and formatting. A typed-harness regression validates real report frames using production member ids, injected time and visibility, hidden-page reporting, throttling and teardown. Fresh independent review and re-review found no remaining actionable concerns. Full CI is requested for this protocol and transport change; the original browser evidence is retained rather than repeating unchanged flows locally.
