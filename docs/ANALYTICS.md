# Product analytics

[`src/online/analytics.ts`](../src/online/analytics.ts) reports nine product events to Mixpanel. It answers one
question — do riders get from the landing page into a match, and what happened when they did — and nothing else.
It is unrelated to [`src/online/telemetry.ts`](../src/online/telemetry.ts), which posts raw runtime diagnostics
(inputs, packets, repairs, rewinds) to `/telemetry` on whatever origin served the page — normally a dev server,
since it too is on only for a ported address or `?telemetry=1`.

## When it is on

| Address | Analytics |
| --- | --- |
| Deployed site, no port | on |
| `localhost:5173`, LAN play, any address with a port | off |
| `?analytics=1` | on, whatever the address |
| `?analytics=0` | off, whatever the address |

Only exactly `1` and `0` override; any other value (`?analytics=off`, `?analytics=false`, bare `?analytics=`)
falls through to the address rule rather than being read as "on", so a plausible-looking opt-out cannot report a
dev session into the production project.

The override sticks for the browser under `fuse-analytics`, rather than riding the URL. `appUrl` replaces the
query string on every navigation out of the landing page — deliberately, so an invite can never inherit a
capability — so a flag read only from `location.search` would last exactly one page: `?analytics=0` would come
back on at CREATE ROOM, and `?analytics=1` could never reach the room half of the funnel it exists to verify.
Set it once on any page; clear it with the opposite flag.

Test rooms therefore never reach the production project, and `?analytics=1` is how a build gets verified against
it on purpose. The Mixpanel bundle is imported only once analytics is on, so a LAN game never downloads it.

The project token is a write-only public identifier. Every browser bundle that reports to a Mixpanel project
ships one; it is not a credential and grants no read access, so it is checked in rather than plumbed through the
build environment.

## The events

Every name is prefixed `FlowRiders.`. `role` (`landing` / `solo` / `display` / `host` / `joiner` / `boot`) is a
super property on every event. `mode` and `solo` are registered only on the room path, so the landing page's
`App Opened` and `Room Created` and the boot path's `Boot Failed` carry `role` alone.

| Event | Fires | Key properties |
| --- | --- | --- |
| `App Opened` | once per page load | `role` |
| `Room Created` | CREATE ROOM succeeded | `mode` |
| `Seat Taken` | first snapshot showing this device holding a rider | `avatarId`, `playerCount` |
| `Match Started` | the first round of a match id reaches its countdown | `matchNumber`, `playerCount`, `botCount`, `match`, `matchLength`, `powerupTypes`, `host` |
| `Match Ended` | the recap becomes available | always `playerCount`, `botCount`, `humanCount`, `rounds`, `played`; plus `placement`, `won`, `roundWins`, `eliminations`, `pickups`, `bombsPlaced`, `bombsExploded`, `distance`, `survivalSeconds` and `deathsWall` / `deathsTrail` / `deathsExplosion` / `deathsRider` when this device held a rider; plus `durationSeconds` when it also saw the match start |
| `Recap Reopened` | the RESULTS button | — |
| `Settings Changed` | a draft the runtime accepted | `mode`, `match`, `matchLength`, `bombChargeTicks`, `powerupTypes` |
| `Connect Failed` | 20s with no link to the host | `status` (the status line, `null` if none yet), `secondsWaiting` |
| `Boot Failed` | the boot-failure card is shown | `message` |

`matchNumber` counts matches within a page load, so a rematch is the same signal a separate `Rematch` event
would carry, with one fewer event to reconcile. `played` is false on a shared-TV display or for a spectator,
which report the shape of the match they watched and no rider line of their own.

A match start is keyed on the first round of a match id, not on a phase transition: every round opens with its
own countdown, and solo never passes through the lobby at all — `LocalRuntime.start` seats four bots and starts
the match before the first snapshot reaches the UI. Two consequences worth knowing when reading the funnel: a
device that loads into a match already past round 1 reports `Match Ended` but no `Match Started` and no
`durationSeconds`, so ended can exceed started; and a reload mid-match restarts `matchNumber`.

**Never name a property `length`.** Mixpanel's bundled Underscore-style `each` treats any object whose `length`
is a number as an array, so one such key makes it iterate indices instead of keys and drop the whole property
bag — super properties included — while the API still answers `200`. The room setting called `length` is
reported as `matchLength` for exactly this reason.

## What is deliberately not tracked

- **Per-tick, per-pickup, per-elimination and per-explosion events.** A match produces thousands of these. Its
  detail rides along on `Match Ended` instead, read from the authoritative `matchStats` the recap renders, so a
  busy arena still costs one event.
- **The LAN `/controller` and `/display` paths.** Those devices are frequently offline, and analytics is off on
  a ported address anyway.
- **Bots.** They are counted in `botCount` and never identified as users.
- **Identity beyond Mixpanel's own anonymous device id.** The `fuse-peer-*` and `fuse-room-*` values are room
  authentication tokens and never leave the browser.
- **The page URL.** A room page is `?room=AB42` and that code is the whole join credential, so `$current_url`,
  `$referrer` and `$initial_referrer` — which Mixpanel would otherwise attach to every event — are blacklisted at
  `init`. Sending them would hand a live, joinable invite to a third party on every seat, match and setting
  change. `$referring_domain` and `$initial_referring_domain` survive: they answer where players come from and
  carry no room code.

## Cost

The Mixpanel project is the repository owner's, and this change enables no paid service. Event volume is bounded
by design — one event per match rather than per pickup or per tick — so a busy arena cannot run the project's
plan up; check the plan's own ceiling before reading that as a guarantee.

## The bundle cost

Mixpanel's browser SDK is ~130 kB gzip, in its own lazily loaded chunk. It is paid only on the deployed site,
only after the page is interactive, and it buys correct `$device_id` semantics, batching that survives a
navigation, retry and unload flush. Posting to Mixpanel's `/track` HTTP endpoint directly would be roughly
twenty-five lines and no bundle at all, at the cost of hand-rolling those. If the chunk ever becomes a problem
on a phone joining over cellular, that is the trade to revisit.
