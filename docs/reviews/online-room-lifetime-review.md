# Short room codes and room lifetime review

Date: 2026-09-14. Independent review of ADR 039 and its implementation, before deployment.

## Decision

Approved for release verification. The reviewed design uses public AB42-style codes, bounded transactional allocation, a 90-second host reconnect grace, and an explicit host-authenticated end operation. A code is an invitation identifier, not a secret or host capability. Legacy ten-character codes remain accepted.

Reviewed surfaces: `src/shared/room-code.ts`, service room store/gateway/HTTP routes, `worker/index.ts`, terminal socket handling and runtime cleanup, and the online UI join/menu changes. This is a source and deterministic boundary review; it does not certify the deployed provider, physical phones, or arbitrary network conditions.

## Findings resolved during review

- Delayed heartbeat and metadata-read results could roll a reused code back to its previous incarnation. Gateway continuations now check the current client identity and incarnation before observing results or sending messages.
- A delayed admission could overwrite a newly observed incarnation. Admission now rejects that obsolete result.
- Cancelled metadata callbacks needed View-owner identity checks. Incarnation changes also rotate the View and watch owner, so queued callbacks from a still-active old watch cannot overwrite a directly admitted new room.
- A timer based only on cached metadata could terminate a room whose host had renewed it while watch delivery lagged. The expiry deadline performs an authoritative recheck; provider failure closes transiently, while confirmed expiration closes terminally.
- Expired rooms must not automatically reconnect to a later room using the same public code. Close code 4004 stops transport retries and clears runtime state. Connection replacement remains a separate terminal condition.

## Preserved invariants

Allocation retries at most twelve conflicts without altering a live room. Creation after expiry assigns a fresh incarnation and authority state. Only the current host renews room lifetime; guest traffic cannot keep an abandoned room alive. Old connection close operations use connection identity checks, and an old host capability cannot end a replacement room. Logical expiry is enforced without waiting for asynchronous storage TTL cleanup.

END ROOM is sent only from the explicit host menu action. Refresh and page lifecycle events do not end the room. The request is bounded to 2.5 seconds; failure leaves the host grace as the cleanup path. Solo navigation never sends an end-room request.

## Verification

Independently executed against the reviewed working tree:

```sh
npx tsx --test tests/room-code.test.ts tests/room-socket-close.test.ts tests/service-room.test.ts tests/worker-authority.test.ts tests/cloud-public-smoke.test.ts
```

Result: 41 tests passed, zero failures, skips or cancellations. These include delayed old heartbeat/read/admission, cancelled-watch delivery, direct new admission before queued old-watch delivery, host-only expiry renewal, explicit end authorization, code reuse, and terminal retry behavior. The public-smoke tests here use local test boundaries; they are not a claim of a completed public deployment check.

Full typechecks, coverage, build, CI and actual GCP/Pages verification remain release gates owned by the main task. Existing connected old bundles should be refreshed to obtain the terminal-expiry client behavior. Short codes reduce invitation friction but do not provide private-room access control or eliminate the documented browser-host availability limitation.
