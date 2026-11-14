# Developer insights and playtest reporting

Status: implementation in progress on `codex/developer-insights`, building on
PR #687. This document is the implementation contract and task ledger, not a
claim of deployment. No merge or production provisioning is authorized yet.

## Intended behavior

Every game, including Pig and newly scaffolded games, exposes Report in its
shared UI and with Ctrl+X. Opening it captures the current game before the
dialog appears, previews the screenshot, and accepts category (bug, feature,
idea, other) and text. Submission is acknowledged only after durable storage.
Native cut remains available in editable controls. Opening the dialog cancels
held gameplay input; closing it must not restore a held control.

`?record` and `?report` are aliases for a visible microphone-recording prompt.
Recording requires a developer to sign in, explicitly start, and grant browser
microphone permission. Only the device that starts recording captures audio;
this does not tap remote players' microphones or room voice streams. The
recording indicator includes stop, pending uploads, saved-through time, and
retryable failures. A report records the recording offset at dialog opening,
not at submission. Without recording it remains a normal standalone report.

Local recording intent survives the reporter's own page navigation; it must
never be added to invitations. FuseOS must have one microphone owner across
its game windows. Uploaded chunks survive page closure; locally queued chunks
retry on return. The active unfinished chunk cannot be guaranteed on crash or
forced browser closure, and the UI must say so instead of claiming zero loss.

## Architecture and schema

Use the existing Cloud Run service and named Firestore database for metadata;
add `packages/fuse-telemetry` for game-independent contracts, validation,
stores, adapters and HTTP handlers. Compose it beside `fuse-platform`, never
inside gameplay/rollback. Screenshots and audio go in a private GCS bucket.
The browser has no database credentials or OpenAI key.

Collection names use the deployment's existing namespace prefix. All IDs,
strings, sizes, enum values and timestamps are validated at the API boundary.

| Collection              | Key and fields                                                                                                                                                        | Purpose                                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| telemetry-events        | event UUID; v, gameId, anonymous userId, sessionId, name, occurredAt, receivedAt, primitive scrubbed properties, expiresAt                                            | Generic bounded append-only events with idempotent delivery                                  |
| telemetry-rollups       | UTC period kind/start + gameId + shard; event, session, user, round-start/end counts                                                                                  | Daily, ISO-weekly and monthly charts without repeated whole-history scans                    |
| telemetry-memberships   | period + game + dimension + opaque ID                                                                                                                                 | Transactional first-seen membership; never sum daily uniques to claim weekly/monthly uniques |
| telemetry-reports       | client UUID, gameId, category, text, createdAt, receivedAt, screenshot object key, optional recordingId/offsetMs, status                                              | Private review entries; retry-safe submission                                                |
| telemetry-recordings    | UUID, owner UID, gameId, startedAt, lastUploadAt, status, duration/bytes, expiresAt                                                                                   | Progressively saved sessions; close is optional                                              |
| recording segments      | recording ID + sequence; startMs/endMs, MIME, bytes, checksum/object generation, transcript/status, attempt/lease                                                     | Independently playable audio and ordered full transcript                                     |
| telemetry-limits        | HMAC identity + bounded time window; used, expiresAt                                                                                                                  | Shared per-IP, user/session and upload quotas across instances                               |
| telemetry-actions       | recording + action ID; title, description, type, evidence quotes/segment offsets/report IDs, proposed/claimed/done/dismissed/retracted, updatedAt, claim owner/expiry | Live proposed work grounded in explicit instructions                                         |
| telemetry-action-tokens | token digest; issuer UID, game/recording scope, expiry, revokedAt                                                                                                     | Action-only agent access, never recording permission                                         |

Exclude report text, transcript text, properties and storage references from
unneeded indexes. Never place raw audio, base64 screenshots, bearer tokens,
room codes, invitations or user names in analytics documents. Audio/reports
are intentionally private user content, never copied into product metrics.

### API contract

All routes are JSON except explicit binary uploads/downloads. Existing Origin
checks remain, but Origin is not authentication. Private reads use Firebase
Bearer tokens with verified Google provider, verified email and a code-owned
email allowlist. An empty allowlist denies all. Public submissions get their
own quotas and no read capability.

- `POST /api/telemetry/events`: `{events:[{v:1,id,gameId,userId,sessionId,name,occurredAt,properties}]}`.
  `name` keeps the `fuse.` namespace. Return acknowledged event IDs, including
  already accepted IDs. Batch <= 50; body <= 64 KiB; bounded properties.
- `GET /api/dev/metrics?period=day|week|month&from=YYYY-MM-DD&to=YYYY-MM-DD&gameId=...`:
  period-aligned rows and per-game comparison. Exact uniques for each declared
  period; any range limit/partial result is explicit, never silently truncated.
- `POST /api/telemetry/reports`: idempotent report and previewed screenshot;
  standalone reporting remains available without recording or sign-in.
- `POST /api/telemetry/recordings`: developer-only session creation.
- `PUT /api/telemetry/recordings/:id/segments/:sequence`: owner-only immutable
  audio upload with validated offsets; acknowledge only durable storage.
- `POST /api/telemetry/recordings/:id/finish`: best-effort explicit stop, not a
  prerequisite for retention or transcription.
- `GET /api/dev/reports`, `/recordings`, `/recordings/:id`: bounded paginated
  private lists/detail; authorized attachment/audio routes, no public bucket.
- Internal transcription delivery: authenticated durable queue push. Never
  detach a promise after acknowledging an HTTP upload on request-based CPU.

Exact route request/response types live in `fuse-telemetry/contracts` and are
shared with clients. Tests exercise auth failures, size bounds, retries,
duplicates, concurrency, out-of-order chunks and rejected writes.

## Metric semantics

A user is an anonymous browser installation ID, not a verified unique person.
Do not fingerprint or use an email as an analytics identity. One session is
browser activity with a 30-minute inactivity boundary, shared across games on
the origin; game sessions mean distinct session/game pairs. Events have stable
UUIDs across retries. Browser opt-out, Do Not Track, local-development guard,
property scrubbing and the `fuse.` namespace survive Mixpanel removal.

Round plays count a participating device's first actual active frame in a
game-defined round; four participating browsers can contribute four plays.
Round completions are separate. Countdown, attract/demo, spectator and
rollback re-publication must not inflate them. Local match/round identifiers
serve only deduplication and are never analytics properties. Weekly/monthly
unique users and sessions use their own membership sets, not summed days.

| Game                       | Round unit                                                |
| -------------------------- | --------------------------------------------------------- |
| Fuse Riders                | Engine round                                              |
| Pig                        | Pig game                                                  |
| Bombers, Choppers, Freight | Engine round                                              |
| Elasto Fuse                | Level/race, including each tour level                     |
| Killer Fuse                | Game within a set                                         |
| Fuse Axe                   | Combat stage, excluding camp/continue retries             |
| Fuse Drivers               | Race                                                      |
| Ball Bros                  | Arena survival game                                       |
| Fuseball                   | Whole first-to-three match                                |
| Fuse Volley                | Volleyball match, not each point                          |
| Fuse Front                 | Battle, excluding pre-start countdown                     |
| Graveyard Shift            | Shift                                                     |
| Fuse Craft                 | Scenario/match; sandbox has no invented completion        |
| Fuse Birds                 | Artillery battle/map; practice has no invented completion |
| Fusemania                  | Song                                                      |
| Fusetown                   | Race-to-four-goals match; weeks are turns                 |
| Hook Havok                 | Contest; open-ended arena has no invented completion      |

## Recording and transcription

Choose OpenAI `gpt-transcribe`, configurable on the server. Official model
documentation recommends it for new transcription integrations and lists
$0.0045/minute (~$0.27/hour), excluding hosting/storage. It supports multilingual
input and multiple language hints. Use Norwegian/English hints (`no`, `en`)
and preserve spoken language. Norwegian dialect/code-switch quality and account
access still require a real evaluation sample before production acceptance.

Sources checked 2026-11-14:
[model](https://developers.openai.com/api/docs/models/gpt-transcribe),
[file transcription](https://developers.openai.com/api/docs/guides/speech-to-text).
The older Whisper/4o transcription models are documented as deprecated with a
2027-02-26 shutdown, so they are not the default for this new system.

Use independently complete short audio files, not arbitrary MediaRecorder
timeslices (those are not guaranteed playable). Prefer continuous PCM capture
with independently encoded WAV chunks, preserving actual sample rate and
sample-based offsets; this also permits exact server duration validation.
Commit each chunk to IndexedDB before upload, then remove it only after a
durable acknowledgement. Bound local bytes, total duration and retry backoff.
Report offsets use that same recording timeline. Transcript timestamps are
chunk offsets; do not claim word-level alignment the chosen API does not give.

GCS OBJECT_FINALIZE -> dedicated Pub/Sub push -> authenticated transcription
worker request is the durable production path. Metadata must be reserved
before object creation. The worker validates object ownership/generation,
uses a fenced lease to handle concurrent redelivery, persists text before
acknowledging, retries transient errors and exposes permanent errors in /dev.
Browser lifetime is irrelevant after acknowledgement. Keep this separate from
the signalling topic. Local adapters provide durable filesystem data and fake
transcription for tests; no paid call is needed to develop the flow.

## /dev interface

Extend the existing Fuse UI tokens and neon/pixel identity. This is an Operate
surface: readable tables and charts, compact filters, familiar controls and
clear auth/loading/empty/error/retry states. Metrics and Playtest sessions are
separate tabs. Metrics shows sortable games and daily/weekly/monthly event,
user, session, round-start and completion series, with individual-game detail.
Every chart has an accessible tabular equivalent and labeled units/timezone.
Session detail combines ordered transcript, playable chunks, timestamped
reports and screenshot previews. Standalone reports remain findable. Never
render private report/transcript text as HTML.

### Live proposed work

As each transcript chunk is saved, run a bounded structured extraction over
it and nearby context using configurable OpenAI `gpt-6.1-sol`. Await this work
inside durable queue delivery; transcript persistence alone must not discard
an extraction retry. Reconcile again as later text arrives and at session end.
Require a clear action directive in Norwegian or English, not a possible idea,
question, joke, hypothetical, negated request or later-retracted instruction.
Store the exact supporting quote and segment timestamp. Validate that evidence
exists in the source; transcript contents cannot change extraction rules.

Deduplicate overlapping context/retries. Keep corrections and retractions
visible, especially if an item is already claimed. A private authenticated API
exposes incremental queue reads and atomic claim/renew/release/complete changes
so an agent can work while play continues. Claims expire and cannot be stolen
by a competing worker. A signed-in admin can mint/revoke an action-only bearer
token, scoped to a game or recording and expiring within 24 hours (default one
hour). The token is shown once and stored hashed; it cannot create recordings,
upload audio or read unrelated private media. Model extraction proposes work;
it never launches an agent or grants merge/deployment permission.

## Epics and individual tasks

Each implementation lane uses GPT-6.1 Sol high; bounded follow-up/tests may use
medium. The parent integrates, verifies and opens one reviewed follow-up PR
based on #687; it does not merge or deploy without explicit authorization.

1. **Metrics foundation** (one agent session)
   - Define shared wire contracts, validators and injectable stores.
   - Implement anonymous bounded ingestion, idempotency and transactional quotas.
   - Implement Firestore/memory adapters, period rollups and private reads.
   - Add verified-email developer authorization and adversarial tests.
2. **Recording/report backend** (one–two agent sessions)
   - Implement private recording metadata and report/screenshot submission.
   - Implement immutable audio chunks, storage adapters and durable queue worker.
   - Add OpenAI adapter, retry/lease behavior and ordered transcript reads.
   - Verify missing secrets, duplicate uploads, bad WAVs and closed-browser flow.
3. **Shared browser reporting** (one–two agent sessions)
   - Add Ctrl+X, report menu, screenshot preview/category/text/send states.
   - Integrate real renderer capture and input cancellation in all game families.
   - Add explicit mic permission, PCM chunks, IndexedDB retry outbox and status.
   - Cover iframe/navigation ownership and future game scaffolding.
4. **Replace Mixpanel and define rounds** (one agent session)
   - Keep current analytics API/privacy gates; replace transport and dependencies.
   - Add identity/session lifecycle and retry-safe bounded delivery.
   - Wire actual round start/end semantics for every game and template.
   - Test repeated frames, replay, late join, opt-out and reload deduplication.
5. **Developer workspace** (one agent session)
   - Add `/dev/` route, verified sign-in and metrics comparison/detail/charts.
   - Add recording/report lists, transcript/audio timeline and screenshot detail.
   - Verify desktop/mobile, keyboard, empty, denied and failed-request states.
6. **Integration and operations** (parent, one–two agent sessions)
   - Compose service adapters; update deployment manifests and configuration.
   - Document TTL/indexes, IAM, private bucket/queue setup and secrets.
   - Update AGENTS.md with developer data access and metric contract.
   - Run focused tests then cloud-ci VM typecheck/full tests/coverage/build once.
   - Run affected real-browser flows, capture PR screenshots with agent-browser.
   - Review diff with subagents, fix findings, push and leave a reviewable PR.
7. **Live explicit-action queue** (one agent session)
   - Define grounded action schema and Norwegian/English extraction fixtures.
   - Extract/reconcile incrementally with duplicate/retraction handling.
   - Persist proposed tasks with quote, timestamp and report linkage.
   - Add scoped agent tokens and atomic expiring work claims.
   - Show queue/evidence/status in /dev and document the agent polling workflow.

## User setup and release boundary

Developer emails are supplied and will live in server-owned code:
andersullnass@gmail.com, andreas@bonito.no, andreassolbra@gmail.com,
aasmund.eldhuset@gmail.com, richard.rormark@gmail.com, sindre@scrimba.com.
Authorization must check signed token claims, never a browser-provided email.

`OPENAI_API_KEY` already exists as a GitHub repository secret. The guarded
deployment step passes it to the bootstrap helper, which creates a missing
managed Secret Manager version and generates the server HMAC key. Existing
enabled versions are reused; keys never enter the client or a `VITE` variable.

Before production: authorize provisioning the private bucket and durable queue/worker IAM; run a
short Norwegian/English/dialect sample; choose/confirm retention and spend caps.
Proposed retention is 90 days raw events, 30 days audio/screenshots and 365 days
aggregates/report text/transcripts, with explicit expiry in reads and lifecycle
cleanup. No existing Mixpanel history is migrated or deleted by this change.

No production claim is valid until exact-source deployment, allowlist sign-in,
real microphone playback and Norwegian/English transcription are verified.
