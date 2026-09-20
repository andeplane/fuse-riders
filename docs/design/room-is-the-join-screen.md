# The room is the join screen

> Design note for rules `fuse-p2p-49`. Follows Phase F (ten colours and unique identity, `fuse-p2p-48`) and O4
> (switching sides, no fold change). It removes the join card, which those two left with nothing to do.

## What changes

A device that opens a room link is seated **immediately**, as a player, not ready, wearing the colour and head it wore
last — or the nearest free ones when someone already has them. There is no screen between the front page and the room.

Everything the join card used to settle is settled **in the room instead**, on the device's own rider row, and stays
changeable until that rider presses READY:

| Choice           | How it is made now                                   |
| ---------------- | ---------------------------------------------------- |
| Name             | `NAME`, beside READY (see _Where they ended up_)     |
| Head             | `AVATAR`, as Phase F built it                        |
| Colour           | `COLOUR`, as Phase F built it                        |
| Player / watcher | `SWAP TO SPECTATOR` / `SWAP TO PLAYER`, beside READY |

READY is the line. After it the room is only waiting on everyone else, so a rider still editing itself is a rider not
yet ready; un-readying opens all four again.

## Why the card could go

It had four jobs and three of them moved out from under it. Phase F put the head and colour pickers in the room; O4 put
the side switch there. What was left was a name field that also gated three things the room now does better.

The card also cost a decision at the worst moment. A player arriving at a party holds a phone with a QR code on it and
wants to be in the game; asking them to confirm a name they set last week, in a form, before they can see who else is
there, is friction with nothing behind it.

## The one thing that needed the fold: renaming

A name was the only part of a rider's identity that could not be changed after joining. `applyManagement`'s `JOIN`
branch, for an id the room already seats, only marks the rider present and returns — it ignores the name it carries.
That is what made the card load-bearing: auto-joining a new browser would hand it a name it could never change.

Rules `fuse-p2p-49` makes that branch take the name too. Names are deliberately **not** kept unique, unlike colours and
heads: two friends called Sam could always both be Sam, nothing in the room breaks when they are, and the colour and
head are what tell riders apart on the board. Nothing else about `JOIN` changes: same shape, same kind, same arity, no snapshot or
checkpoint field. A reconnecting rider re-sends `JOIN` as it always did and now carries its own name back with it,
which is what it meant all along.

### Why not leave-then-join

O4 showed that a paired `LEAVE` + `JOIN` at one tick works in the lobby and needs no fold change, and a rename could
have been spelled that way. It is the wrong tool here: the pair frees the seat, so the rider is re-seated by
`claimSlot` and re-coloured by the fold, and a rename would silently change the seat and colour the player had already
chosen. Updating the name in place is one line and changes nothing else about the rider.

## A name for a browser that has never played

The remembered name (`fuse-riders-player-name`) and a signed-in account's username both still work and are what most
devices arrive with. A device with neither is seated as `Rider N` for the seat it takes, and NAME opens with that name
selected, so the first keystroke replaces it. Nobody is blocked, and nobody is stuck with it.

## What is refused, and where

Renaming is a room command like the others, so the runtime refuses it before the log sees it: an empty or unusable name
(`seatRiderName`), and any rename at all once the rider is ready or the round has started (`seating.renameable`). The
second of those is the runtime's alone: a rename that slipped past it would still fold identically on every replica,
so it is a rule about when a player may choose rather than one the fold has to enforce to stay consistent.

## The join card stays, as the exception screen

An arrival never sees it: it holds the boot card, with its connect hint, for the one round trip its seat takes
(`RoomScreenInput.seating`), and is in the lobby after that. Past `SEATING_GRACE_MS` without a seat the room is
refusing it — full, or a manager that never answered — and the card comes up with the reason and JOIN AS SPECTATOR on
it.

What keeps a removed device out is `everInRoom`, not the `kicked` message. The message is a courtesy and always loses
the race: the manager sends it only after folding the `LEAVE`, so it is a network hop behind a fold both replicas
apply at the same instant, and a guard keyed on it would let the auto-join reach the manager first and undo the kick.
`everInRoom` latches the moment the room lists this device, so an absence after that is a removal rather than an
arrival, whatever the network did. It also covers a watcher the room dropped (a phone asleep across a round boundary,
`dropAbsentSpectators`), which would otherwise come back as a rider it never asked to be. A page reload clears it and
seats the device again: reloading is asking to come back.

It is not deleted, because it still has a job. A device the room will not seat needs somewhere to be: one the host has
kicked (auto-joining would undo the kick the moment it landed), and one that arrived at a full room. Both land on the
card, which says why and offers the way back in. What changed is that it is no longer a gate everybody passes through
— an invited device now waits on the boot card and is seated the moment the room arrives, so a player who can be
seated never sees it at all.

## Where they ended up

> Follow-up. The choices above were reachable but not findable: `NAME`, `AVATAR` and `COLOUR` sat in the page header
> among the room's own controls (RADIO, SETTINGS, LEADERBOARD, ROOM), where they read as more page furniture, and the
> side switch was a small button at the end of a roster row, where it read as something done _to_ that rider — the
> row's other button kicks them.

All four now sit in the action bar with READY, which is the one place a rider looks at itself:

    READY   NAME  AVATAR  COLOUR   SWAP TO SPECTATOR   [the host's own actions]

READY is the bar's call to action and keeps the cyan fill; the rest take the quieter outline treatment, because they
are exactly the things that stay changeable until it is pressed. The three identity buttons are one group, so the
whole of it leaves on READY in a single write and comes back on un-READY.

The side switch is **one button about this device**, not one per row: the room lists a device exactly once, so only
one direction can ever apply, and it reads that direction from the room's own lists when pressed rather than from the
label it was last drawn with. A watcher gets the action bar for it — and nothing else in the bar, since READY belongs
to a rider. Coming back to a seat re-asks for the colour this device last wore, the same single refusable follow-up an
arrival makes; without it a rider that stepped out to watch for a round came back in whatever colour was free.

## The creator arrives the same way

> Follow-up. The creator's page was the last one that stopped at a form.

Creating a room seats the creator in it, with no screen in between. The form it used to stop on asked for nothing the
room cannot now change — a name, a head and a colour that all stay changeable until READY, and a choice of side that
is a button beside it. Almost everyone opening a room means to ride in it, and the few who do not are one tap from the
watching list once they are there.

One thing had to move with it. Taking a seat in a **shared-TV** room makes a device a controller (ADR 042): no arena,
because the TV draws it — and no QR, no room code and no COPY LINK either. On the page that just opened the room that
would mean nobody could be asked in at all, so the creator keeps the lobby card while the room is in the lobby, which
is exactly what that page showed before taking a seat was automatic. A rider that _joined_ a shared room from a laptop
still gets the bare controller: the TV in front of it is the one showing the lobby. Once the race starts the creator
is a controller like everyone else.

The join card keeps its job for the creator too, in the one shape it can take there: the `JOIN THE RACE` panel inside
its own lobby, for a creator the room will not seat — a page reloading into a room whose five seats filled while it
was away.

## Not in this change

- Renaming from the phone lobby uses the same button; there is no per-row name control yet.
- A `?display=1` TV is unchanged: it is an unlisted viewer, it takes no seat, and it never had the join card.
- Names are not unique across rooms or accounts; the rule is per-room, like colour and head.
