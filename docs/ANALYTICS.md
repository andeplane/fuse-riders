# Product analytics

[`src/online/analytics.ts`](../src/online/analytics.ts) reports twelve product events to Mixpanel. It answers two
questions — do riders get from the landing page into a match and what happened when they did, and which powerups
kill and how often they miss — and nothing else.
It is unrelated to [`src/online/telemetry.ts`](../src/online/telemetry.ts), which posts raw runtime diagnostics
(inputs, packets, repairs, rewinds) to `/telemetry` on whatever origin served the page. It too is on only for a ported address or `?telemetry=1`,
but the receiver lived in the LAN server removed by #271, so nothing records those posts today.

## When it is on

| Address                                             | Analytics                 |
| --------------------------------------------------- | ------------------------- |
| Deployed site, no port                              | on                        |
| `localhost:5173`, a LAN IP, any address with a port | off                       |
| `?analytics=1`                                      | on, whatever the address  |
| `?analytics=0`                                      | off, whatever the address |

Only exactly `1` and `0` override; any other value (`?analytics=off`, `?analytics=false`, bare `?analytics=`)
falls through to the address rule rather than being read as "on", so a plausible-looking opt-out cannot report a
dev session into the production project.

The override sticks for the browser under `fuse-analytics`, rather than riding the URL. `appUrl` replaces the
query string on every navigation out of the landing page — deliberately, so an invite can never inherit a
capability — so a flag read only from `location.search` would last exactly one page: `?analytics=0` would come
back on at CREATE ROOM, and `?analytics=1` could never reach the room half of the funnel it exists to verify.
Set it once on any page; clear it with the opposite flag.

Test rooms therefore never reach the production project, and `?analytics=1` is how a build gets verified against
it on purpose. The Mixpanel bundle is imported only once analytics is on, so a local game never downloads it.

The project token is a write-only public identifier. Every browser bundle that reports to a Mixpanel project
ships one; it is not a credential and grants no read access, so it is checked in rather than plumbed through the
build environment.

### The switch in SETTINGS, and Do Not Track

The address rule above decides whether analytics _may_ run. Two things can still switch it off on a device. In
every "off" case nothing is sent, and a page that loads in one never downloads the Mixpanel bundle:

| Status       | When                                                                               | SETTINGS shows                             |
| ------------ | ---------------------------------------------------------------------------------- | ------------------------------------------ |
| `on`         | the address rule says on, and neither of the two below                             | `ANALYTICS ON`, a working switch           |
| `optedOut`   | this device switched it off in SETTINGS (`fuse-analytics-opt-out` = `1`)           | `ANALYTICS OFF`, a working switch          |
| `doNotTrack` | the browser sends Do Not Track (`navigator.doNotTrack` of `1` / `yes`, as the SDK) | `ANALYTICS OFF`, disabled, with the reason |
| `addressOff` | a ported address without `?analytics=1`                                            | `ANALYTICS OFF`, disabled, with the reason |
| `flagOff`    | `?analytics=0`, now or remembered                                                  | `ANALYTICS OFF`, disabled, with the reason |

The reasons win from the bottom up: the address and the flag first, then Do Not Track, then the device's own
choice. `?analytics=1` overrides the address and nothing else — it never overrides a rider who switched analytics
off, nor Do Not Track.

The switch is a PRIVACY row with a one-line notice — "Anonymous play stats (matches, powerups) go to Mixpanel to
help tune the game. No names, room codes or location." — in the two per-device SETTINGS dialogs: the room's
(beside MUSIC, SOUND and VISUAL STYLE) and the landing page's (a disclosure under the room-settings draft). It is
deliberately not in ROOM SETTINGS, which the whole room shares. Where the switch could do nothing it is shown
disabled with the reason rather than hidden, so the row never claims a choice that is not there.

Switching off takes effect at once, in every open tab, and nothing the SDK already holds is sent afterwards. That
takes four things, because the SDK batches: it sends on a five-second timer and again as the page hides, from a
queue it keeps in local storage.

1. `track` stops handing events to the SDK. The status is re-read from storage on every call, and once more when
   the SDK finishes downloading, so a switch flipped mid-download — or in another tab — still wins.
2. `opt_out_tracking()` stops the SDK's batch sender, empties the batch it had queued, disables its unload flush
   and deletes what it had stored, device id included. The tab that made the change calls it directly; every other
   tab calls it when the browser's `storage` event tells it `fuse-analytics-opt-out` changed, and re-renders its
   PRIVACY row from the same event.
3. A `before_send_events` hook re-reads the status as each batch is about to be sent and drops every event if it
   is not `on`. This is the one synchronous gate: it closes the gap between another tab's switch and the `storage`
   event arriving, and it holds in a browser that delivers no `storage` event at all.
4. The SDK's queue keys (`__mpq_<token>_ev`, `_pp`, `_gr`) are removed on opt-out, on every page load while opted
   out, and on switching back on. The SDK enqueues asynchronously behind a lock it polls every 100 ms, so an event
   accepted a moment before the switch can land in storage just after step 2 emptied it; nothing would send it
   while off, and this keeps it from being replayed later.

What this cannot do is recall a request already in flight at the moment of the switch. Where storage is refused
altogether (Safari "Block all cookies") the choice lives in memory, for that tab and that page load only: there is
nothing shared for another tab to read.

The choice is stored under `fuse-analytics-opt-out` on the device and survives a reload, where an opted-out page
never downloads the SDK at all. Switching back on clears the SDK's own opt-out flag
(`clear_opt_in_out_tracking()`, which — unlike `opt_in_tracking()` — sends no `$opt_in` event of its own) and
resumes: under a fresh device id if a page load came in between, under the one still in memory if not. Events
from the time in between are not replayed. The PRIVACY rows also re-read the status whenever SETTINGS opens, so a
label is never older than the dialog showing it. There is no consent
prompt: the default is unchanged — on for the deployed site — and that default is the project owner's to weigh.

Do Not Track is honoured because Mixpanel's SDK honours it by default (`ignore_dnt: false`, pinned in the init
options); the game applies the SDK's own test one step earlier so that such a browser does not download the SDK
just to be told to send nothing. Global Privacy Control (`navigator.globalPrivacyControl`) is **not** consulted,
by the SDK or by the game.

### What Mixpanel is initialised with

`MIXPANEL_CONFIG` in `analytics.ts`, checked by `tests/analytics.test.ts`:

| Option                   | Value                                            | Why                                                                                                                                                                                           |
| ------------------------ | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ip`                     | `false`                                          | Every request carries `ip=0`, which tells Mixpanel not to derive `$city`, `$region` or `mp_country_code` from the connection. The request still arrives from an address, as any request does. |
| `persistence`            | `"localStorage"`                                 | The game stores everything else there too, and a batch that outlives a navigation is what lets CREATE ROOM report before the page it triggers replaces this one.                              |
| `cross_subdomain_cookie` | `false`                                          | Where local storage is refused the SDK falls back to a cookie; this keeps that cookie on this host rather than the SDK's default of the parent domain.                                        |
| `ignore_dnt`             | `false`                                          | The SDK default, pinned (above).                                                                                                                                                              |
| `track_pageview`         | `false`                                          | A pageview event carries the page's URL, path and query.                                                                                                                                      |
| `autocapture`            | `false`                                          | No clicks, inputs or page content.                                                                                                                                                            |
| `property_blacklist`     | `$current_url`, `$referrer`, `$initial_referrer` | See "The page URL" below.                                                                                                                                                                     |

Everything else is the SDK default for the pinned `mixpanel-browser` 2.83: session recording off
(`record_sessions_percent: 0`), no feature flags, and UTM parameters and ad click ids in the landing URL kept as
`utm_*` properties (`track_marketing`) — none of which is a room code.

Storage is only ever reached through `safeStorage`, and Mixpanel's `init` runs inside the promise every caller
already ignores: Safari with "Block all cookies" throws on merely evaluating `localStorage`, and neither that nor
a Mixpanel that cannot start may break boot.

## The events

Every name is prefixed `FlowRiders.` — one constant, `EVENT_PREFIX`. It is the game's former name and it stays
until the project owner decides otherwise: renaming it would split the Mixpanel project's history in two. `role` (`landing` / `solo` / `display` / `host` / `joiner` / `boot`) is a
super property on every event. `mode` and `solo` are registered only on the room path, so the landing page's
`App Opened` and `Room Created` and the boot path's `Boot Failed` carry `role` alone.

`renderer` (`webgl`, or `canvas` for Phaser's fallback when WebGL is unavailable or `?renderer=phaser-canvas`
forces it) is registered as a super property once the arena first draws, together with a `Graphics Ready` event.
Events before that do not carry it: `App Opened`, and in solo usually `Seat Taken` and `Match Started` too, which
fire while Phaser is still downloading. Count renderers with `Graphics Ready`. The landing page's backdrop and a room's arena each report one, even when CREATE ROOM keeps the same page, and `role` (`landing` or the room role) tells them apart. A device that never draws an arena,
such as a shared-TV rider's phone, reports neither. This shows how many players still depend on the Canvas fallback.

| Event              | Fires                                                                                             | Key properties                                                                                                                                                                                                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `App Opened`       | once per page load                                                                                | `role`                                                                                                                                                                                                                                                                                                                                                         |
| `Room Created`     | CREATE ROOM succeeded                                                                             | `mode`                                                                                                                                                                                                                                                                                                                                                         |
| `Seat Taken`       | first snapshot showing this device holding a rider                                                | `avatarId`, `playerCount`                                                                                                                                                                                                                                                                                                                                      |
| `Match Started`    | the first round of a match id reaches its countdown                                               | `matchNumber`, `playerCount`, `botCount`, `match`, `matchLength`, `powerupTypes`, `host`                                                                                                                                                                                                                                                                       |
| `Match Ended`      | the recap becomes available                                                                       | always `playerCount`, `botCount`, `humanCount`, `rounds`, `played`; plus `placement`, `won`, `roundWins`, `eliminations`, `pickups`, `bombsPlaced`, `bombsExploded`, `distance`, `survivalSeconds` and `deathsWall` / `deathsTrail` / `deathsExplosion` / `deathsRider` when this device held a rider; plus `durationSeconds` when it also saw the match start |
| `Kill`             | once per rider this device's rider killed, once that round is decided and confirmed               | the pull's properties below, plus `victimBot`, `shotKills`, `firstKillOfShot`, `secondsToKill`                                                                                                                                                                                                                                                                 |
| `Miss`             | once per pull of this device's rider that killed nobody, once that round is decided and confirmed | the pull's properties below                                                                                                                                                                                                                                                                                                                                    |
| `Recap Reopened`   | the RESULTS button                                                                                | —                                                                                                                                                                                                                                                                                                                                                              |
| `Settings Changed` | a draft the runtime accepted                                                                      | `mode`, `match`, `matchLength`, `bombChargeTicks`, `chainReaction`, `aimBounce`, `map`, `powerupTypes`                                                                                                                                                                                                                                                         |
| `Connect Failed`   | 20s with no link to the host                                                                      | `status` (the status line, `null` if none yet), `secondsWaiting`                                                                                                                                                                                                                                                                                               |
| `Boot Failed`      | the boot-failure card is shown                                                                    | `name`, `code`, `message`                                                                                                                                                                                                                                                                                                                                      |
| `Graphics Ready`   | the arena first draws on this page, and again after a successful RETRY GRAPHICS                   | `renderer` (super property)                                                                                                                                                                                                                                                                                                                                    |
| `Graphics Failed`  | the RETRY GRAPHICS card is shown                                                                  | `stage`: `startup` (download, boot or its 10 s deadline), `context` (lost GPU context not restored in 2 s), `render` (a frame threw)                                                                                                                                                                                                                           |
| `Signed In`        | a Google sign-in from the landing page's account dialog succeeded                                 | —                                                                                                                                                                                                                                                                                                                                                              |

When `Match Started`, `Kill` / `Miss`, `Seat Taken` and `Match Ended` fire is
[`src/online/funnel.ts`](../src/online/funnel.ts): the room UI hands it every snapshot it renders and the funnel
does the once-only bookkeeping, outside the render callback and under test (`tests/funnel.test.ts`). A frame it
cannot process never throws into the render callback; the first such failure is reported once with
`console.warn` (there is no diagnostic event), and an event whose properties could not be built is not consumed —
it fires on the next frame that can build it.

`Boot Failed` reports the error's class (`name`, e.g. `TypeError`), a stable `code` to count by (`module-load`,
`storage`, `webgl`, `network` or `unknown`) and a `message` to read. The message is the one place an event carries
text the game did not write, so it is bounded and scrubbed — see "Free text" below.

`matchNumber` counts matches within a page load, so a rematch is the same signal a separate `Rematch` event
would carry, with one fewer event to reconcile. `played` is false on a shared-TV display or for a spectator,
which report the shape of the match they watched and no rider line of their own.

A match start is keyed on the first round of a match id, not on a phase transition: every round opens with its
own countdown, and solo never passes through the lobby at all — `LocalRuntime.start` seats four bots and starts
the match before the first snapshot reaches the UI. Two consequences worth knowing when reading the funnel: a
device that loads into a match already past round 1 reports `Match Ended` but no `Match Started` and no
`durationSeconds`, so ended can exceed started; and a reload mid-match restarts `matchNumber`.

### Which powerup kills, and how often it misses

`Kill` and `Miss` are the one place analytics reports per occurrence rather than per match: one `Kill` per rider
killed and one `Miss` per trigger pull that killed nobody. `weapon` is what the pull fired — `bomb` (the ordinary
lobbed bomb every rider has, the baseline), `triple`, `five`, `target`, `gun` or `shell`.

The point is histograms, so both events carry every dimension an outcome might be broken down by:

| Property                                                 | On     | Meaning                                                                                                        |
| -------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------- |
| `weapon`                                                 | both   | what the pull fired                                                                                            |
| `bombs`                                                  | both   | bombs the pull put in the air — 1 for Target, more for a volley or with Extra Bomb (Gun and Shell fan out too) |
| `power`, `extraBombs`, `fuseLevel`, `rangeLevel`, `grip` | both   | the shooter's round-long upgrades at the moment of the pull, not at the round's end                            |
| `round`, `secondsIntoRound`                              | both   | when the trigger was pulled, to a tenth of a second                                                            |
| `riders`, `bots`                                         | both   | the room when the round was reported                                                                           |
| `victimBot`                                              | `Kill` | whether the rider killed was an AI                                                                             |
| `secondsToKill`                                          | `Kill` | from the pull to the death, to a tenth — long for a bouncing shell, zero for Target and Gun                    |
| `shotKills`, `firstKillOfShot`                           | `Kill` | how many riders the pull killed, and one `true` per pull                                                       |

| Reading                       | Mixpanel                                                       |
| ----------------------------- | -------------------------------------------------------------- |
| Which powerup kills most      | `Kill`, broken down by `weapon`                                |
| How often a powerup misses    | `Miss` over `Miss` + `Kill where firstKillOfShot`, by `weapon` |
| Kills per pull                | `Kill` over `Miss` + `Kill where firstKillOfShot`, by `weapon` |
| Whether it beats a plain bomb | any of the above against `weapon = bomb`                       |

**Exactly one device sends each event**: the shooter's own. A kill is reported only by the killer's device and a
miss only by the device of the rider who pulled the trigger, so a room of four still sends one `Kill` per kill.
The victim, the other riders, a shared-TV display and a spectator send nothing about it, and nobody reports a
bot's pulls.

**They are sent after the round, once it is final — not live.** Every replica simulates ahead of confirmed input,
and a rollback cannot retract an event already sent, so a kill reported the moment it appeared on one screen could
be one a late packet undoes. Even the round-over screen a device shows is its own prediction. So the simulation
keeps a log of the round's pulls and kills in the state every replica agrees on, and when the round is decided it
keeps that log (with the tick it was decided at) until the next round is decided. The shooter's device reports
from it once every connected rider's input is confirmed through that tick — normally a fraction of a second into
the round-over pause.

The last reported round is remembered per rider in local storage, so a reload or a reopened tab does not send it
twice, while a second tab seated as a different rider still reports its own. Because the decided log lasts through
the whole next round, a device that catches up past the round-over pause in one jump (a backgrounded phone, a
resynchronised snapshot) still reports it. What is lost: a round whose shooter's device leaves before it is
confirmed, and a round a device skips entirely by catching up across two decisions at once.

Gun shots resolve the tick they are fired (on release): a visible tracer is already a hit or miss.

A pull whose bomb or shell is still in the air when the round ends — and has killed nobody — is **not** a
`Miss`: the round's end interrupted it. Without that rule, weapons that stay in flight longest (Shell, lobbed
bombs) would be charged misses they never had the chance to turn into kills.

A **pull** is one trigger press: a volley is one pull however many bombs it puts in the air, and every bomb of it
names the pull. A rider can hold several weapons at once and a pull spends only some of them, so it is labelled
with the first of these that it spent:

`gun` → `shell` → `target` → `five` → `triple` → `bomb`

Gun and Shell come first because they launch on a path of their own; a Triple or Five they fan out is spent
under their label, and a rider holding Target as well keeps it armed for the next pull. Below them Target wins because it is the only one the others cannot
combine with. Rules before `fuse-p2p-24` also reported `gravity`, for the Singularity bomb that Gravity used to arm. The
round-long upgrades are never a `weapon`: Power, Extra Bomb, Shorter Fuse, Range and GRIP sharpen every pull rather than
being spent by one.

A **kill** is exactly an elimination credited to an explosion, as the recap's `eliminations` counts it: a wall, a
trail or a rider collision has no weapon behind it, blowing yourself up credits nobody, and two riders whose blasts
reach the same victim share the blame so neither is credited. Where several of one rider's bombs reach the same
victim, the one with the lowest id names the pull, so every replica logs the same one. `shotKills` is how many
riders that pull killed, so a double kill is two `Kill` events that agree on it, and `firstKillOfShot` is true on
exactly one — which is what turns kills back into pulls for a miss rate.

Two consequences of chain reactions, both inherited from how eliminations have always been credited: a bomb set
off by someone else's blast still belongs to its owner, so a rider whose Five bomb a rival detonates is credited
the kill; and where a rider's own older plain bomb chains alongside its Target, the lowest-id rule credits `bomb`.
What cannot be seen at all: a black hole that bends a rider into a wall, or swallows one in its core, is a `wall` death with no owner. And a
pull whose only effect was uncredited — an own goal, a blast shared with another rider, or setting off someone
else's bomb — is a `Miss`, because no kill is credited to it.

**Never name a property `length`.** Mixpanel's bundled Underscore-style `each` treats any object whose `length`
is a number as an array, so one such key makes it iterate indices instead of keys and drop the whole property
bag — super properties included — while the API still answers `200`. The room setting called `length` is
reported as `matchLength` for exactly this reason.

## What is deliberately not tracked

- **Per-tick, per-pickup and per-explosion events, and eliminations other than weapon kills.** A match produces
  thousands of these. Its detail rides along on `Match Ended` instead, read from the authoritative `matchStats`
  the recap renders. `Kill` and `Miss` are the deliberate exception, bounded by pulls rather than ticks: a rider
  can pull the trigger at most once per reload, and only its own device reports.
- **Locally served games.** `npm run dev` serves on a ported loopback address, and analytics is off on any ported
  address unless `?analytics=1` forces it on. (The LAN `/controller` and `/display` server this item once named
  was removed in #271.)
- **Bots.** They are counted in `botCount` and never identified as users.
- **Identity beyond Mixpanel's own anonymous device id.** The `fuse-peer-*` and `fuse-room-*` values are room
  authentication tokens and never leave the browser.
- **Accounts.** `Signed In` says that a sign-in happened and nothing about whose: the Firebase `uid`, the Google
  name and the ID token are never event properties, and Mixpanel is never `identify`-ed with them. Match history
  lives in the game's own database (README, "Login and match history"), not here.
- **The page URL.** A room page is `?room=AB42` and that code is the whole join credential, so `$current_url`,
  `$referrer` and `$initial_referrer` — which Mixpanel would otherwise attach to every event — are blacklisted at
  `init`. Sending them would hand a live, joinable invite to a third party on every seat, match and setting
  change. `$referring_domain` and `$initial_referring_domain` survive: they answer where players come from and
  carry no room code.
- **Location.** `ip: false` at `init`: Mixpanel is told not to geolocate the request, so no event carries a city,
  region or country.
- **Free text.** Every string property of every event and super property passes through `sanitizeText`
  ([`analytics-text.ts`](../src/online/analytics-text.ts)) inside `track`, so a call site cannot forget to: one
  line, at most 200 characters, with URLs (`[url]`), query strings (`[query]`), `room=` / `token=` style pairs,
  e-mail addresses, JWTs, UUIDs and any long hex or base64 run (`[token]` — the `fuse-peer-*` and `fuse-room-*`
  tokens are 64 hex characters) removed, and this page's own room code removed wherever it appears. Today that
  matters for two properties, `Boot Failed`'s `message` and `Connect Failed`'s `status`; a browser's "Failed to
  fetch dynamically imported module: https://…?room=AB42" would otherwise name a live invite. Anything that is not
  a string, number, boolean, `null` or an array of those is reported as its type, never serialised. `Bearer` /
  `Basic` schemes, percent-encoded separators (`room%3DAB42`) and zero-width characters splitting a token are
  handled; an input over 4 096 characters is cut first and marked `[truncated]`. It is a scrubber for the shapes
  this game's credentials take, not a general PII filter: IPv4 addresses, file paths and short `key=value` pairs
  under other names pass through.
- **Rider names.** They are in no event. The one place one could have ridden along is `Connect Failed`'s `status`,
  the runtime's status line, two wordings of which name a rider ("Waiting for <name>", "Connected · <name>
  lagging"); `connectStatus` replaces the name with `[rider]` before the status is sent.

## Cost

The Mixpanel project is the repository owner's, and this change enables no paid service. Event volume is bounded
by design — one event per match rather than per pickup or per tick — so a busy arena cannot run the project's
plan up; check the plan's own ceiling before reading that as a guarantee. `Kill` and `Miss` are the largest
source: one per pull. A rider cannot pull again while its own lobbed bomb is still in the air, so an
ordinary bomb allows roughly one pull every three to four seconds; only spent pickups come faster. Only human
riders' own devices send them, and nothing is sent for bots.

## The bundle cost

Mixpanel's browser SDK is ~130 kB gzip, in its own lazily loaded chunk. It is paid only on the deployed site,
only after the page is interactive, and it buys correct `$device_id` semantics, batching that survives a
navigation, retry and unload flush. Posting to Mixpanel's `/track` HTTP endpoint directly would be roughly
twenty-five lines and no bundle at all, at the cost of hand-rolling those. If the chunk ever becomes a problem
on a phone joining over cellular, that is the trade to revisit.
