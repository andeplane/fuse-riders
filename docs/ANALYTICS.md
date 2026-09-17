# Product analytics

[`src/online/analytics.ts`](../src/online/analytics.ts) reports eleven product events to Mixpanel. It answers two
questions — do riders get from the landing page into a match and what happened when they did, and which powerups
kill and how often they miss — and nothing else.
It is unrelated to [`src/online/telemetry.ts`](../src/online/telemetry.ts), which posts raw runtime diagnostics
(inputs, packets, repairs, rewinds) to `/telemetry` on whatever origin served the page — normally a dev server,
since it too is on only for a ported address or `?telemetry=1`.

## When it is on

| Address                                             | Analytics                 |
| --------------------------------------------------- | ------------------------- |
| Deployed site, no port                              | on                        |
| `localhost:5173`, LAN play, any address with a port | off                       |
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
it on purpose. The Mixpanel bundle is imported only once analytics is on, so a LAN game never downloads it.

The project token is a write-only public identifier. Every browser bundle that reports to a Mixpanel project
ships one; it is not a credential and grants no read access, so it is checked in rather than plumbed through the
build environment.

## The events

Every name is prefixed `FlowRiders.`. `role` (`landing` / `solo` / `display` / `host` / `joiner` / `boot`) is a
super property on every event. `mode` and `solo` are registered only on the room path, so the landing page's
`App Opened` and `Room Created` and the boot path's `Boot Failed` carry `role` alone.

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
| `Boot Failed`      | the boot-failure card is shown                                                                    | `message`                                                                                                                                                                                                                                                                                                                                                      |

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

| Property                                   | On     | Meaning                                                                                                        |
| ------------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------- |
| `weapon`                                   | both   | what the pull fired                                                                                            |
| `bombs`                                    | both   | bombs the pull put in the air — 1 for Target, more for a volley or with Extra Bomb (Gun and Shell fan out too) |
| `power`, `extraBombs`, `fuseLevel`, `grip` | both   | the shooter's round-long upgrades at the moment of the pull, not at the round's end                            |
| `round`, `secondsIntoRound`                | both   | when the trigger was pulled, to a tenth of a second                                                            |
| `riders`, `bots`                           | both   | the room when the round was reported                                                                           |
| `victimBot`                                | `Kill` | whether the rider killed was an AI                                                                             |
| `secondsToKill`                            | `Kill` | from the pull to the death, to a tenth — long for a bouncing shell, zero for Target and Gun                    |
| `shotKills`, `firstKillOfShot`             | `Kill` | how many riders the pull killed, and one `true` per pull                                                       |

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

Gun shots resolve on press: a visible tracer is already a hit or miss.

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
round-long upgrades are never a `weapon`: Power, Extra Bomb, Shorter Fuse and GRIP sharpen every pull rather than
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
