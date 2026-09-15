# Product analytics

[`src/online/analytics.ts`](../src/online/analytics.ts) reports nine product events to Mixpanel. It answers one
question — do riders get from the landing page into a match, and what happened when they did — and nothing else.
It is unrelated to [`src/online/telemetry.ts`](../src/online/telemetry.ts), which posts raw runtime diagnostics
(inputs, packets, repairs, rewinds) to the dev server and never leaves the machine.

## When it is on

| Address | Analytics |
| --- | --- |
| Deployed site, no port | on |
| `localhost:5173`, LAN play, any address with a port | off |
| `?analytics=1` | on, whatever the address |
| `?analytics=0` | off, whatever the address |

Test rooms therefore never reach the production project, and `?analytics=1` is how a build gets verified against
it on purpose. The Mixpanel bundle is imported only once analytics is on, so a LAN game never downloads it.

The project token is a write-only public identifier. Every browser bundle that reports to a Mixpanel project
ships one; it is not a credential and grants no read access, so it is checked in rather than plumbed through the
build environment.

## The events

Every name is prefixed `FlowRiders.`. Super properties `role` (`landing` / `solo` / `display` / `host` /
`joiner` / `boot`), `mode` and `solo` ride on all of them.

| Event | Fires | Key properties |
| --- | --- | --- |
| `App Opened` | once per page load | `role` |
| `Room Created` | CREATE ROOM succeeded | `mode` |
| `Seat Taken` | first snapshot showing this device holding a rider | `avatarId`, `playerCount` |
| `Match Started` | the room leaves the lobby or a finished match | `matchNumber`, `playerCount`, `botCount`, `mode`, `match`, `length`, `powerupTypes`, `host` |
| `Match Ended` | the recap becomes available | `placement`, `won`, `roundWins`, `eliminations`, `pickups`, `bombsPlaced`, `bombsExploded`, `distance`, `survivalSeconds`, `deaths*`, `rounds`, `durationSeconds`, `played` |
| `Recap Reopened` | the RESULTS button | — |
| `Settings Changed` | a draft the runtime accepted | `mode`, `match`, `length`, `bombChargeTicks`, `powerupTypes` |
| `Connect Failed` | 20s with no link to the host | `status`, `secondsWaiting` |
| `Boot Failed` | the boot-failure card is shown | `message` |

`matchNumber` counts matches within a page load, so a rematch is the same signal a separate `Rematch` event
would carry, with one fewer event to reconcile. `played` is false on a shared-TV display or for a spectator,
which report the shape of the match they watched and no rider line of their own.

## What is deliberately not tracked

- **Per-tick, per-pickup, per-elimination and per-explosion events.** A match produces thousands of these. Its
  detail rides along on `Match Ended` instead, read from the authoritative `matchStats` the recap renders, so a
  busy arena still costs one event.
- **The LAN `/controller` and `/display` paths.** Those devices are frequently offline, and analytics is off on
  a ported address anyway.
- **Bots.** They are counted in `botCount` and never identified as users.
- **Identity beyond Mixpanel's own anonymous device id.** The `fuse-peer-*` and `fuse-room-*` values are room
  authentication tokens and never leave the browser.

## The bundle cost

Mixpanel's browser SDK is ~130 kB gzip, in its own lazily loaded chunk. It is paid only on the deployed site,
only after the page is interactive, and it buys correct `$device_id` semantics, batching that survives a
navigation, retry and unload flush. Posting to Mixpanel's `/track` HTTP endpoint directly would be roughly
twenty-five lines and no bundle at all, at the cost of hand-rolling those. If the chunk ever becomes a problem
on a phone joining over cellular, that is the trade to revisit.
