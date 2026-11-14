# Product analytics

Every game, Pig (the scaffold template), and FuseOS report first-party product metrics
through [fuse-ui/analytics](../packages/fuse-ui/src/analytics.ts). The browser posts
bounded event batches to the existing service's `POST /api/telemetry/events`.
No third-party analytics SDK or analytics provider receives new events.
Existing Mixpanel history is neither migrated nor deleted.

## Identity and sessions

A user is one anonymous browser installation, identified by a random UUID saved on
this origin. It is not a verified person or an account, and contains no fingerprint,
email or Firebase UID. Different devices count separately. With storage refused,
the safe-storage adapter keeps an in-memory identity for that page.

One session spans same-origin games, tabs and FuseOS windows until 30 minutes of
inactivity. Real pointer/key interaction refreshes activity. An accepted local event
also refreshes it. A game session is a distinct session/game pair. Sessions and
users are counted distinctly for each UTC day, ISO week and calendar month; weekly
and monthly uniques must never be computed by adding daily uniques.

The envelope contains `v:1`, random event `id`, stable `gameId`, anonymous
`userId`, `sessionId`, `name`, `occurredAt`, and primitive `properties`.
Names keep the shared `fuse.` prefix. A game name belongs in `gameId`, not the
event namespace. The service validates the envelope and adds receipt/expiry metadata.

## Delivery and privacy

The client retains at most 200 unsent events for seven days, sends at most ten per
request, and removes only explicitly acknowledged event IDs. Retries retain the
same IDs, so service-side idempotency prevents double counting. Retry delay backs
off to one minute. The next visit, online event, visibility change or page hide
also attempts delivery. Browser keepalive is best effort: an unacknowledged event
remains queued. This is product telemetry, not guaranteed match history.

Same-origin Web Locks serialize persisted mutations across tabs when available.
Browsers without Web Locks still work, but simultaneous storage writes can race;
the bounded outbox is best effort rather than a gameplay dependency.

Analytics stays off on ported development/test addresses unless `?analytics=1`
explicitly enables it. Exact `?analytics=0` or `1` overrides persist across
navigation. The settings opt-out and browser Do Not Track always win over enabling
the address. DNT/opt-out creates no new identity and queues no new events. Opt-out
clears pending events; enabling again does not replay activity from while it was off.
Other tabs recheck privacy before sending and react to the storage event.
A request already in flight cannot be recalled.

Properties are scrubbed centrally, not by each caller. Strings are single-line and
bounded to 160 characters. URLs, query strings, room codes known to the page,
email addresses, bearer/token-shaped text and long credential runs are removed.
There are at most 24 properties, with bounded identifier keys and finite primitive
values. Object/array payloads are not serialized as arbitrary data. Reserved identity,
room, match, player-name and credential keys are dropped. No event carries page URLs,
invitations, room capabilities, names, account tokens, audio, report text or screenshots.
The API never derives stored location from the request IP. Network infrastructure
still receives requests normally.

Screenshots, reports and recordings are intentionally private playtest content on
separate APIs, governed by [developer insights](design/developer-insights.md).

## Match observations and round participation

`App Opened` occurs once per page boot; `embedded` distinguishes FuseOS windows
from standalone pages. Page `role` is solo, display, joiner or landing (desktop
for FuseOS). `Seat Taken`, `Match Started` and `Match Ended` retain the existing
browser-observation contract. Match observations include displays/spectators with
`played:false`; counting these is not counting unique multiplayer rooms.
A mid-match arrival after round one does not invent a match start or duration.

**Round plays** count `fuse.Round Started`: a participating browser's first actual
active frame in a game-defined round. Four participating browsers may count four
plays. Countdown, lobby, attract/demo, spectator and display frames do not count.
Joining an already active round counts participation when the device actually has a
seat. Local pass-and-play still counts one participating browser, not each person.

**Rounds completed** count `fuse.Round Ended`, separately from starts.
A completion requires that browser session's prior recorded participation in the
same semantic round. Open-ended play and abandoned rounds have no fabricated end.
A bounded local ledger (512 recent start/end marks) prevents repeated frames,
rollback publication, reload or popout from recounting the same participation.
Its raw match/round keys never leave the browser. Very long sessions exceeding that
ledger capacity can forget their oldest marks; these metrics are not billing records.

| Game              | Round unit and active boundary                                                   |
| ----------------- | -------------------------------------------------------------------------------- |
| Fuse Riders       | Engine round; playing, completion after the decision tick is confirmed           |
| Pig               | Pig game, not a turn or die roll                                                 |
| Bombers           | Engine round after its countdown; local and online paths                         |
| Choppers, Freight | Engine round; world play phase                                                   |
| Elasto Fuse       | Each level/race in a tour; racing phase                                          |
| Killer Fuse       | Each game within a set, after its countdown                                      |
| Fuse Axe          | Combat stage; exclude camp and continue retries                                  |
| Fuse Drivers      | Race; racing until finished                                                      |
| Ball Bros         | Survival game; playing until over                                                |
| Fuseball          | Whole first-to-three match; first active play, not each point                    |
| Fuse Volley       | Whole match; first actual rally, not each serve/point                            |
| Fuse Front        | Battle, once its start tick is reached                                           |
| Graveyard Shift   | One shift                                                                        |
| Fuse Craft        | One scenario/match; sandbox has no invented end                                  |
| Fuse Birds        | One artillery battle/map; preparing/fault excluded, practice has no invented end |
| Fusemania         | One song after lead-in; playlists contain several song matches                   |
| Fusetown          | Whole race to four goals; weeks remain turns                                     |
| Hook Havok        | Contest; open-ended free arena has no invented end                               |

Fuseball's existing `playRound` helper is only a match-start guard (first countdown
versus the rest of the match); round participation uses an explicit constant key.

## Other product events

Existing game-specific events use the same namespace and privacy boundary:
Riders' funnel/settings/graphics events and confirmed human-owned `Kill`/`Miss`,
Killer Fuse's decided `Game Ended`, Fuseball's `Goal Scored`, Volley's
`Point Scored` and Elasto's `Race Finished`. No per-tick stream is added.
Riders weapon credit follows the authoritative decided shot log, not speculative
rendered explosions; the shooter reports its own shots and bots have no user identity.

FuseOS uses `gameId:fuseos` for its own `App Opened` and `Game Launched`.
The launched game's portal id travels in `game`, preserving the event's owning
`gameId`. Refocusing an already open window is not another launch.

Graphics readiness registers the renderer and emits `Graphics Ready`; failure
reports its bounded stage. `Boot Failed` contains a scrubbed message, stable code
and error class, with event-only role `boot` so later room events retain their role.

## Verification and operation

[analytics.test.ts](../packages/fuse-ui/tests/analytics.test.ts) exercises identity,
idle sessions, persisted retry IDs, acknowledgements, privacy gates, queue bounds,
round deduplication and diagnostics with typed injected storage/clocks/transports.
Per-game adapter tests cover their observation boundaries.

`scripts/analytics-smoke.ts` plays a real Riders match and checks lifecycle,
weapon properties and cross-tab opt-out. `scripts/all-games-analytics-smoke.ts`
opens each shipped page. Both intercept the first-party endpoint and acknowledge
its actual envelope; they never write smoke events into production storage.
Backend tests separately verify durable idempotency and period membership/rollups.
Browser request evidence is not proof that a production event was durably stored.

The private `/dev/` metrics interface shows exact per-period aggregates and sortable
games. Production setup, retention, access control and rollout status are recorded
in [developer insights](design/developer-insights.md); implementing this client
does not claim deployment or production provisioning.
