# Friends, presence and invites

Players can add each other as friends wherever another player is listed, see which friends are online and where, and
invite them to the room they are in. A signed-in page polls; the service pushes nothing, keeps no connection per
account and simulates no game, as before.

## Addressing a player

No route exposed another account until now, and usernames are neither unique nor reserved. Every listed player now
carries a **public id**: `sha256("public:" + uid)` truncated to 20 hex characters, computed by the service
(`publicIdOf` in `packages/fuse-platform/src/friends.ts`). It appears on leaderboard rows (`publicId`), on the seats an
account owns in a listed match (`accounts`, seat id to public id, on `/api/matches` and `/api/me/matches`) and on the
signed-in members of the room the caller reports. It identifies an account to other players without being the
account: it opens no route on its own, and it cannot be turned back into the uid. The service resolves a public id
through the presence document (`publicId` equality), so a player can be added once they have synced at least once,
which a signed-in client does on every page load.

## Presence and one poll

`POST /api/friends/sync` carries where the device is (`name`, `avatarId`, `room: { code, memberId, gameId }`, and
optionally `passive`, `away` and `status`, see [below](#away-status-last-seen-and-passive-pages)) and
answers with everything the panel shows: friends with `online` and their `room`, requests both ways, pending invites
and `roomPlayers` (the signed-in members of the reported room, each with its seat id, public id and relation to the
caller). One request every `FRIENDS_POLL_MS` (20 s) per signed-in page, brought forward on focus, on a room change and
after every action.

A friend is online while its last sync is younger than `ONLINE_WINDOW_MS` (120 s), and in a room while it last said so
and is online. The presence document is rewritten only when something in it changed or it is `PRESENCE_REFRESH_MS`
(60 s) old, the rule [heartbeat-write-cost.md](heartbeat-write-cost.md) sets for rooms: an idle poll costs reads alone
(one edges query, one invites query, in a room one presence query, then one batch of presence documents and one
batch of user documents for names, whatever the number of friends). A page that unloads sends one last keepalive sync without a room, so friends see it leave sooner
than the window would tell them. Presence documents are kept: they are what a public id resolves through.

A room claim is proven when it changes and again whenever the presence record is due its periodic rewrite, so at
most about once a minute rather than on every poll: the service reads the room and requires the claimed seat to be a
live member (403 "Join the room first" otherwise), and stores the room's incarnation with the claim. Room codes are
reissued once a room ends, so `roomPlayers` lists only seats of the same incarnation, and a device still claiming a
seat in an ended room is refused at its next proof; its client then drops the claim. A seat id is only known inside its room, so a stranger
cannot name a room code and read who is in it; the room's own members are trusted with each other's seats, as they are
with the shared log. `roomPlayers` is how the lobby knows which seat belongs to which account: the room socket
carries seat ids only, and nothing about accounts crosses the mesh. The client matches a roster row to a public id by the `memberId` the seat's
own device reported, so ADD FRIEND on a lobby row, a scoreboard row or the recap needs no protocol change and no
`RULES` bump.

## Away, status, last seen and passive pages

The FuseOS desktop shows a buddy list (Fuse Messenger) around the games it embeds, so one account can have two pages
polling at once: the game in its window, with a room claim, and the desktop, with none. Three optional fields on the
sync body and three on each friend cover that, all additive: a client that sends none of them and reads none of them
behaves exactly as before.

| Sync body | Meaning                                                                                                          |
| --------- | ---------------------------------------------------------------------------------------------------------------- |
| `passive` | The poll is from a page that is not the one in a room. It keeps the account online and leaves the room claim be. |
| `away`    | The player has not touched the page for a while (the client decides; the desktop uses hidden or 5 idle minutes). |
| `status`  | A short line for friends, at most `MAX_STATUS_LENGTH` (40) characters. `""` clears it; leaving it out keeps it.  |

| Friend     | Meaning                                                                                             |
| ---------- | --------------------------------------------------------------------------------------------------- |
| `away`     | `true` on an online friend that is away; absent otherwise.                                          |
| `status`   | The line an online friend chose; absent when there is none or the friend is offline.                |
| `lastSeen` | On an offline friend only: its last sync, rounded down to the hour (`lastSeenOf`), never any finer. |

**Validation**, all in `FriendsStore.parseSync` before anything is read or written, so a refused body changes
nothing: `passive` and `away` must be booleans; `status` must be a string of at most `MAX_STATUS_INPUT` (160) UTF-16
units that, once tidied by `cleanStatus`, is at most 40 characters; `passive: true` with a `room` is a contradiction.
Anything else is `400 Invalid presence`, as for the older fields. `cleanStatus` turns every run of whitespace into
one space, drops control, format (bidi overrides, zero-width), lone-surrogate, private-use and unassigned
characters and trims the ends. It does not escape markup: a status is plain text and a client must render it as text
(`textContent`), as it does names.

**Passive polls and the room claim.** A passive poll carries the stored room claim forward instead of clearing it, so
the desktop and an embedded game do not overwrite each other every 20 seconds. The carried claim is re-proven on the
same schedule as an active one (when the record is due its rewrite), against the same incarnation, so a passive
poll cannot keep a dead room alive any longer than an active one would; when the proof fails the claim is dropped
rather than refused, because the passive page is not the one that can act on a 403. A game page that leaves still
sends its unload sync without a room, which is an active poll and clears the claim at once. A passive poll is not
answered with `roomPlayers` (they are for the page in the room), which also saves it the room query.

**Away with two pages.** There is one record per account and no per-page state, so the rule is by kind of poll:

- An active poll that leaves `away` out means "not away". That is every client from before the field, and it heals
  an `away` left behind by a page that closed.
- A passive poll that leaves it out keeps what is stored, and while the account holds a room claim a passive
  poll's `away` is ignored: the page in the room speaks for the player, and an idle desktop behind a running game
  must not make the player look away.
- Coming back (`away: false`) is recorded at once. Going away is recorded with the record's next periodic rewrite,
  so up to a minute late, which costs nothing against a five-minute idle rule and means two pages that disagree
  cannot cost a write per poll.

**Cost.** No new route, collection or index: the presence document gains two optional fields (`away`, stored only
while true, and `status`). The rewrite rule is unchanged, and with two pages on one account it is still one
write a minute, whichever page's poll it falls to. Going away adds no write, coming back adds one, a status change
adds one, all under the existing 400 syncs an hour. Documents written before the fields existed read as "not away,
no status" (`storedPresence`, shared by the Firestore adapter and tested against what the in-memory database
holds); nothing is migrated.

**Privacy.** `status` is text a player chose to show friends, and only friends get it. `lastSeen` is coarsened to the
hour so the list is not a tracking signal, and is absent for an account that has never synced. None of the three
reaches analytics, and neither do names, public ids or room codes (`docs/ANALYTICS.md`).

**Client.** `createFriendsClient` takes `passive: true` and `presence: () => ({ away, status })`. A passive client
never sends a room, even if handed one; a client given neither sends the body it always sent.

## Requests

A friendship is one document per pair (`${prefix}-friends/{uidA|uidB}`, sorted): `uids`, `requestedBy`, `status`
`pending` or `accepted`. `POST /api/friends { publicId }` asks, or accepts when the other side already asked; asking
twice is one request. `DELETE /api/friends/:publicId` removes whatever the pair's record is: unfriend, decline or
withdraw. Both sides are held to `MAX_FRIENDS` (100), so nobody can be handed more friends than they can hold, and to
`MAX_PENDING` (50) open requests sent or received, so many accounts cannot bury one under requests. The friend count
is checked before the pair's transaction rather than inside it, so concurrent requests to different players can
exceed the cap by a few: a soft bound, accepted. The request budget is 30 per account per hour.

## Invites and notifications

`POST /api/rooms/:code/invites { to: [publicId…] }` is proven like a result report: the room token as bearer, so a
stranger cannot make the service read a body, and the ID token in `X-Fuse-Identity`. Only accepted friends are
invited; anyone else in the list is skipped rather than refused. An invite is one document per inviter, invitee and
room, refreshed on a repeat, and lives `INVITE_TTL_MS` (10 minutes) with a `cleanupAt` TTL policy. The invited client
finds it on its next poll: up to 20 seconds late, which is the cost of no push path. Dismissing is
`DELETE /api/friends/invites/:id`, by the addressee only.

On the client an invite becomes a banner with JOIN wherever the page is, and, when the player has turned INVITE
ALERTS on, a system notification (`Notification` API) for a page that is hidden or unfocused. Permission is asked
only inside that tap, never on load. Clicking the notification focuses the page and opens the room: on the landing
page in the same document, inside another room by navigation. There is no service worker and no push service: a
closed tab hears nothing, which is the honest limit; a background tab with the game open does. INVITE EVERYONE
ONLINE invites every online friend who is not already in this room, which is what "tell my friends a game is on"
means here.

## What did not change

- The engine, the input log and the mesh: friends never cross the WebRTC channel and `RULES` is untouched.
- The account: the ID token still goes in a request header and nowhere else.
- The trust model: every member is trusted with the shared log; a public id in a room is what its own device claimed
  for its own seat, which is as trustworthy as the seat's name.
- Every game, including Pig and generated games, uses the same sign-in and friend graph.
  The shared browser composition is described in [shared-social.md](shared-social.md).

## Modules

| Where                                           | What                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------- |
| `packages/fuse-platform/src/friends-api.ts`     | Wire types and constants, browser-safe (`fuse-platform/friends-api`)            |
| `packages/fuse-platform/src/friends.ts`         | `FriendsStore`, `FriendsDatabase`, `MemoryFriendsDatabase`, `publicIdOf`        |
| `packages/fuse-platform/src/firestore.ts`       | `FirestoreFriendsDatabase`                                                      |
| `packages/fuse-platform/src/http.ts`            | `createFriendsHttp`, `composeHttp`, `createPlatformHttp` (history then friends) |
| `packages/fuse-ui/src/friends.ts`               | The dialog, the invite banner and `friendButton`, over a state the game renders |
| `packages/fuse-ui/src/friends-client.ts`        | The poll, its coalescing and the actions                                        |
| `packages/fuse-ui/src/friends-notify.ts`        | Invite notifications over an injected `Notification` API                        |
| `games/fuse-riders/src/online/friends-panel.ts` | The game's composition: endpoints, sign-in, avatars, tracking                   |
