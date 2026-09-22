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

`POST /api/friends/sync` carries where the device is (`name`, `avatarId`, `room: { code, memberId, gameId }`) and
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

A room claim is proven when it changes, not on every poll: the service reads the room once and requires the claimed
seat to be a live member (403 "Join the room first" otherwise). A seat id is only known inside its room, so a stranger
cannot name a room code and read who is in it; the room's own members are trusted with each other's seats, as they are
with the shared log. `roomPlayers` is how the lobby knows which seat belongs to which account: the room socket
carries seat ids only, and nothing about accounts crosses the mesh. The client matches a roster row to a public id by the `memberId` the seat's
own device reported, so ADD FRIEND on a lobby row, a scoreboard row or the recap needs no protocol change and no
`RULES` bump.

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
- Pig (`games/dice`) has no sign-in and so no friends; the fuse-ui dialog is optional for a game without accounts.

## Modules

| Where                                            | What                                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------------------- |
| `packages/fuse-platform/src/friends-api.ts`      | Wire types and constants, browser-safe (`fuse-platform/friends-api`)            |
| `packages/fuse-platform/src/friends.ts`          | `FriendsStore`, `FriendsDatabase`, `MemoryFriendsDatabase`, `publicIdOf`        |
| `packages/fuse-platform/src/firestore.ts`        | `FirestoreFriendsDatabase`                                                      |
| `packages/fuse-platform/src/http.ts`             | `createFriendsHttp`, `composeHttp`, `createPlatformHttp` (history then friends) |
| `packages/fuse-ui/src/friends.ts`                | The dialog, the invite banner and `friendButton`, over a state the game renders |
| `games/fuse-riders/src/online/friends-client.ts` | The poll, its coalescing and the actions                                        |
| `games/fuse-riders/src/online/friends-notify.ts` | Invite notifications over an injected `Notification` API                        |
| `games/fuse-riders/src/online/friends-panel.ts`  | The game's composition: endpoints, sign-in, avatars, tracking                   |
