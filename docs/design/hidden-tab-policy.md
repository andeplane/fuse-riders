# Hidden-member policy: a hidden page steps away

Status: implemented in `fuse-p2p-47` (#258 N4, part of #259). ADR-047 §12 is the normative text; this note records the
decision, the evidence and the trade-offs.

## The problem

The tick loop is a member's only sender, and browsers throttle a hidden page's timers: about once a second in a
background tab (Chrome, Firefox), about once a minute after five minutes hidden (Chrome's intensive throttling, which
Chrome documents as not applying while an `RTCDataChannel` is open, but which nothing here relies on), and not at all
once a phone freezes the page. Before this change a hidden member kept its seat as an ordinary present rider, so the
room judged it like one:

- **Presence flapped.** At one pass a second its packets sit on `DISCONNECT_MS` = 1000 ms. The manager logged it absent,
  heard the next packet, logged it present, and so on — 14 flips in 30 s, and 104–120 in six minutes with once-a-minute timers after the fifth, on the tests below.
  A `PRESENCE false` that happened to be in force when a `roundOver` ended removed the rider from the game
  (`driveGameTick`), so a player who glanced at another tab lost the seat at random.
- **A sole hidden world holder wedged recovery.** A hidden page's world does not advance, and its reliable sends lapse
  about 600 ms after it hides (`PeerTransport.checkLinks` stops probing). A page reloading into a room whose only other
  member was hidden got no world; when the holder returned, both pages were more than `BEHIND_STEPS` behind and asked
  each other for snapshots forever (on the old branch, without the link lapse modelled, the new page installed the
  frozen world instead).
- **A snapshot retry never reached a third holder.** `requestSnapshot` preferred the time authority on every retry whose
  previous target was not the authority, so it alternated between the authority and the member after it. With both of
  those hidden, a joiner never asked the third member, which could have served it.

The old "slow 3× catch-up" no longer reproduces: since `fuse-p2p-38` (#349) the clock has one rate and the fast phase is
extra steps per log tick, and #352's `CATCHUP_STEPS` budget paces a return. The three existing hidden-guest tests in
`tests/room-runtime.test.ts` pass with the 1 Hz seam turned on.

## Options considered

**(a) Present but idle, announced in the packet.** The hidden page flags its packets; peers keep it present, fold
neutral controls and do not wait on it. Deterministic folding needs the idle mark in the log, not in a packet: a flag
only some replicas saw would fold differently. And "do not wait" must end somewhere every replica agrees on — an idle
member's own return entry arrives on a stream nobody waited for.

**(b) Absent at once, seat kept.** Log the hidden member absent immediately. The existing absence already gives neutral
controls, no stall (`World.pendingDisconnect`) and a hand-over of management (`actingCreator`). But absence is also what
removes a rider at the end of `roundOver`, excludes it from the next round (`prepareRound`) and from the round rating
(`resolve-round`), and a manager that hears the hidden page's 1 Hz packets logs it present again: the flapping, moved.

**(c) Chosen: the member steps away by its own entry.** It combines the two. The mechanism is (b)'s — an absence in the
log, which already stops the waiting — but logged by the member itself, and folded as a mark on a present seat rather
than an absence, which is (a)'s semantics:

- On `visibilitychange` to hidden, a member with a seat or a place in the watching list — present, or already logged
  absent — appends `STEER 0`/`CANCEL` as before, then its own `PRESENCE false`, and sends a packet at once while the
  page still runs (`RoomRuntime.stepAway`). It re-sends its hello with `hidden: true`, and repeats the entry every
  `AWAY_REPEAT_MS` = 5 s while hidden: a manager that logged it absent a moment before the away entry folded would
  otherwise keep flapping the seat on its throttled packets, which is the bug this note is about.
- Every replica folds a member's own `PRESENCE false` as **away** (`Fold.away` / `Spectator.away`): the game still has
  the rider (`player.connected` stays true), so it keeps its seat through round and match boundaries and a return to the
  lobby, is placed in the next round, and counts in the rating like anyone present. Its controls are neutral and its
  entries unread (`applyTick`). To the netcode it is not connected (`Seat.connected` false, `Seat.away` true): the stall
  rule and `completeTick` do not wait on it, it leaves the succession order (so the **log duties** pass to the acting
  creator), and no manager judges its silence or logs it present from its throttled packets (`creatorDuties`). Nothing
  else an away member logs applies — the creator's entries included, so an away creator does not write management
  entries beside the delegate that now carries them.
- **The crown does not move with them.** Who the screens name as HOST, and whose page may issue room commands, is
  `roomManager`, and it keeps a creator that is merely away (`Seat.away`). The two are deliberately different
  questions: the log duties are about a _page_ — a hidden one's world is frozen, so it cannot seat a joiner or log a
  departure and something else must — while the crown is about a _person_, and looking at another window says nothing
  about whose room this is. Before this split, alt-tabbing for a second moved the HOST badge to the next rider and
  gave that rider's page ROOM SETTINGS, ADD AI and START RACE while the host still had them: two devices both running
  one room, and the badge flicking back the moment the host returned. A creator that is genuinely gone still hands the
  crown on, because `away` is the member's own mark and the departure below clears it.
- On return the member re-greets with `hidden: false`, and the **manager** logs `PRESENCE true` for it as soon as it
  hears the member's packets, and again on every loop pass until the seat is present, so a lost entry costs a pass
  rather than the rider's controls. The member logs its own return only when the room has nobody present to log it —
  every other member away or gone (`RoomRuntime.ownReturn`); `permitted` accepts that entry only while it is away. The
  member's own return would otherwise travel on a stream nobody waits for: lost, or refused as outside the window, it
  would leave that replica the only one that thinks the rider is back, and the hash would then chase the divergence.
- A service offline event for an away member is still a departure: the manager logs `PRESENCE false` about it (or
  `LEAVE` in the lobby), which clears the mark, and the seat goes as any absent seat does.
- A hidden page never serves a world (it answers `noWorld`), is never chosen as a snapshot source by a peer that knows
  (its hello, or its away seat), is not elected time authority when the creator is gone, runs no creator or
  acting-creator duties, seats nobody and takes no room commands: its world is frozen where it hid, and anything it
  logged from it would be judged on stale seats.

The log-visible part is one rule: a member may log its own presence. It needs no new entry kind or field, and a room
nobody stepped away from folds to the same canonical state as before (the golden hashes did not change; `RULES` moved to
`fuse-p2p-47` (44 was held for it while 45 and 46 landed) because a self `PRESENCE false` now applies where earlier rules ignored it).

Two runtime fixes came with it, neither log-visible: snapshot retries now go round every holder in order (the authority
first), and a member whose resync brought nothing newer, or who has no source that could serve one, catches its backlog
up at the step budget instead of fetching again.

## Why this and not the others

- **No cheat.** Hiding gains nothing: the rider keeps riding straight with neutral controls, dies like an idle rider,
  takes part in the next round, and is rated. Nothing a member logs while away is read, so "away" cannot be used as a lag
  switch that sends inputs late without stalling others. A member can only mark itself away; marking anyone else still
  follows the absence rules of §9 (and presence forgery remains the open N7/N5 item it was).
- **No timer to tune.** The policy does not depend on how throttled the page is: 1 Hz, once a minute and a frozen page
  are the same case. There is no hidden-grace constant to add to the C6 ladder.
- **One entry each way.** No new kind, no packet format change; the hello field is additive.

## Trade-offs and limits

- **The away entry must leave before the page freezes.** It is sent from the `visibilitychange` handler. A phone that
  freezes the page before the data channel sends it, or a lost packet with the page then frozen, leaves the member
  present and silent: after `DISCONNECT_MS` the manager logs it absent as before, which is the pre-policy outcome (the
  seat goes at the next round boundary). A lost packet with the page merely throttled is repaired: the entry recurs in
  later packets and NACKs are answered from the receive path. Not verified on a physical phone.
- **A returning member's own entry is on a stream nobody waited on.** Its `PRESENCE true` is stamped at its clock plus
  one and arrives one network hop late, as the creator's own return always did: a rollback of that hop, within
  `ROLLBACK_TICKS`, and before `HASH_LAG`.
- **Two members away with nobody present.** When every member is away, no manager is present to log anything; each logs
  its own return, which needs no manager. A non-creator returning while the creator is still away is managed by the
  acting creator as soon as its return folds.
- **Joining and hiding at once.** A page that hides before its `JOIN` has folded has no seat to step away from, and is
  judged by silence once seated, as before.
- **The service lease.** A page throttled to once a minute renews its connection lease (`CONNECTION_TTL_MS` = 30 s,
  heartbeat every 2 s) too rarely; a frozen page not at all. When the service drops it, peers get the offline event and
  the away member is logged absent. That is the intended outcome for a page that is gone; for intensive throttling it is
  a service-side limit this change does not address.
- **The screen does not say "away".** The game view shows an away rider as connected; a label is a presentation change
  for later.
- **The seat's bound is demand, not time.** An away seat is kept until the room needs it: outside a running round —
  `lobby`, `roundOver` and `matchOver` count — a joiner that finds the room full takes an away seat once no truly
  absent one is left (`claimSlot`). There is no maximum away time: a tab hidden for two seconds can lose its seat the
  moment someone asks for a place, and one hidden for an hour keeps it while nobody does.
- **An away member still records a death ahead of it.** Nothing else it logs applies, but the §9 escape — any ranked
  member may record the absence of someone ahead of it — stays open to it, ranked as if it were present. Without that
  a member whose last peer's page closed while it was away could neither log that peer gone nor return (it is not the
  manager, and its own return is refused while anyone else is present), and its room stood still.
- **Interleaving.** A `PRESENCE true` the manager logged from packets heard just before the away entry folded undoes
  the step away; the hidden page repeats its away entry every `AWAY_REPEAT_MS`, so it heals within five seconds, and
  every replica resolves the tick the same way (management applies in succession order, away members after it).
- **A hidden page is no authority.** With the creator hidden, the time and hash authority falls to the next member the
  usual way (`RoomRuntime.authority`), because a page whose timers fire once a second is a poor clock to follow. The
  creator takes it back when it returns.
- **A resync that brings nothing newer** holds off further fetches for `CATCH_UP_HOLD_MS` = 10 s, or until a peer's
  hello announces a world — the replica catches up at the step budget instead of asking again. Bounding it matters:
  without the hold a room behind everywhere fetched in a loop; without the bound a replica would never fetch again.

## Evidence

`tests/hidden-tabs.test.ts`, on `FakeNetwork` with `hiddenTickMs: 1000`, `intensiveAfterMs: 60_000`,
`intensiveTickMs: 60_000` and the hidden side's link health lapsing after 600 ms (`LINK_LAPSE_MS`), 1 % loss, 20–60 ms
one way. The 150 s case runs a minute at 1 Hz, then the once-a-minute cadence (brought forward from Chrome's five minutes to keep
the test cheap in CI; an earlier six-minute run with the five-minute onset gave 104–120 flips before and 0 after). "Before" is `origin/main` `428fe12` with only the seam; "after" is this change.

| Scenario                                                                 | Before (main 428fe12)                                                     | After                                   |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------- | --------------------------------------- |
| Rider hidden 3 s / 30 s / 150 s in the lobby                             | presence flips 2 / 14 / 25                                                | 0 flips, seat kept, converges, one hash |
| Rider hidden 3 s / 30 s / 150 s from the countdown                       | flips 2 / 15 / 29                                                         | 0, kept, converges                      |
| Rider hidden 3 s / 30 s / 150 s in play                                  | 0 (by chance) / 14 / 31                                                   | 0, kept, converges                      |
| Riders hidden 3 s and 150 s at once from the bots-only fast phase        | flips 2 and 23 (an earlier one-rider run: 4 / 12 / 27 for 3 / 30 / 150 s) | 0 and 0, kept, converges                |
| Creator hides, then the acting creator (joiner admitted meanwhile)       | passed                                                                    | passes                                  |
| Two riders hidden at once for 30 s                                       | flips 16 and 12                                                           | 0 and 0, both back in their seats       |
| Sole hidden world holder, the other rider reloads, holder returns        | no world while hidden; after return wedged at 113 vs 129                  | no frozen world; recovers on return     |
| Hidden rider rides on, dies, and is placed in the next round             | passed                                                                    | passes                                  |
| Existing hidden-guest tests in `room-runtime.test.ts` with the 1 Hz seam | pass (the old 3× catch-up no longer reproduces)                           | pass                                    |

Desktop fake timing is not physical-phone evidence. The browser check in the pull request covers headless Chromium's
`visibilitychange` and page lifecycle freeze on one machine.
