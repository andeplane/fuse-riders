# Fuse Messenger: friends and presence in FuseOS

The ICQ/MSN-style buddy list on the desktop (`packages/fuseos/src/friends/`). This note records what the platform
already offers, what the desktop app needs on top of it, and the smallest backend addition that would close the gap.
Nothing under `service/` or `packages/fuse-platform` changes with the app; the proposal at the end waits for approval.

## What exists today

The friend graph, presence and room invites were built for the games themselves (`docs/design/friends.md`) and are
account-level, shared by every game and by the desktop:

| Piece                                                              | Where                                                                                      |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Google sign-in (Firebase, popup, SDK loaded on first use)          | `packages/fuse-ui/src/browser-account.ts`                                                  |
| ID-token verification, no Firebase credential on the server        | `packages/fuse-platform/src/identity.ts`                                                   |
| Public id per account (`sha256("public:" + uid)`, 20 hex)          | `packages/fuse-platform/src/friends.ts` (`publicIdOf`)                                     |
| `POST /api/friends/sync`: report presence, get the whole view      | `FriendsStore.sync`; wire types in `packages/fuse-platform/src/friends-api.ts`             |
| `POST /api/friends { publicId }`, `DELETE /api/friends/:publicId`  | ask, accept, unfriend, decline, withdraw                                                   |
| `POST /api/rooms/:code/invites`, `DELETE /api/friends/invites/:id` | invite friends into a room (room token as proof), dismiss                                  |
| Polling client (20 s, coalesced, invite de-duplication)            | `packages/fuse-ui/src/friends-client.ts`                                                   |
| Browser `Notification` wrapper for invites                         | `packages/fuse-ui/src/friends-notify.ts`                                                   |
| Firestore adapter and in-memory fake                               | `packages/fuse-platform/src/firestore.ts`, `MemoryFriendsDatabase`                         |
| Deployed composition                                               | `service/index.ts` (`createPlatformHttp`), `service/dev.ts` locally with in-memory storage |

What one poll answers (`FriendsView`): `me`, `friends[]` each with `online` (last sync younger than 120 s) and, when
online and in a room, `room: { code, gameId }`; `incoming[]` and `outgoing[]` requests; `invites[]`; and
`roomPlayers[]` for the room the caller itself reported. Presence is one document per account, rewritten at most
once a minute when nothing changed, so an idle poll costs reads alone (`docs/design/heartbeat-write-cost.md`).

Everything is bound to the AGENTS.md constraints already: no push path, no socket per account, no relay, no paid
service, Firestore reads only on an idle poll. The ID token travels in a header and nowhere else; public ids, not
uids, are what players see.

Sign-in is per origin. The desktop and the games it embeds share the same origin, so a sign-in from the desktop's
Fuse Messenger is the sign-in every embedded game sees (Firebase keeps it in IndexedDB; `fuse-riders-signed-in` in
localStorage says a browser remembers one).

## What the desktop app wants that is missing

1. **"Away"**: the view carries `online: boolean` and a room. There is no idle state, so a buddy who left the tab open
   for an hour looks the same as one who is actively waiting for a game. ICQ/MSN users expect Online / Away / Playing /
   Offline.
2. **Two reporters per account**: an embedded game page polls `sync` with its room claim, and the desktop, if it
   polled too, would send `sync` without a room. The service stores whatever the latest poll claims, so the two would
   overwrite each other's room every 20 seconds and friends would see the buddy flicker between "Playing" and
   "Online". A sync body cannot say "keep what you have".
3. **A status line** ("brb", "looking for a volley match") is part of the genre but nothing stores one.
4. **Last seen**: offline buddies show nothing; ICQ showed "last online 3 days ago". The presence record has `at`, but
   the view does not expose it for offline friends.

Nothing else is missing: adding by public id, accepting, declining, removing, invites to a room and "Join game" all
map one-to-one onto routes that exist.

## How the frontend handles it now (no backend change)

- `PresenceService` (`src/friends/presenceService.ts`) is the app's only dependency: a snapshot of the account state
  and the buddy list, a subscription, sign-in/out, add/remove/dismiss, `refresh` and `setSuspended`. The UI,
  the tray and the toasts are written against it.
- `createRealPresenceService` (`src/friends/realPresenceService.ts`) composes `fuse-ui/friends-client` with
  `fuse-ui/browser-account`. It reports no name or avatar (the desktop has none; the service keeps whatever a game
  last reported) and derives the four buddy states as: online + room = **Playing &lt;game&gt;**, online = **Online**,
  online + `away` = **Away**, otherwise **Offline**; an online friend's `status` shows under the name as plain text
  and an offline friend's `lastSeen` as "Last seen 5 hours ago". These fields came with #665 and are read only when
  present, so an older room service gives the list it always did. The desktop polls with `passive: true`: it keeps
  the account online and never touches the room claim a game's own page made (an older service ignores the flag).
- The desktop **suspends its own polling while a Fuse game window is open**: the embedded game polls for itself with
  its room claim, and the desktop's poll would clear it. While suspended the buddy list keeps its last snapshot and
  says "Updated by the game in the open window". When the last game window closes the desktop resumes.
- `DemoPresenceService` (`src/friends/demoPresenceService.ts`) is the typed fake: a scripted set of buddies that sign
  in, start playing, go away and invite the player, driven by an injected clock, so the app's every state renders in
  tests and in the preview without an account. File > Demo buddies switches to it; the real service is restored by
  switching back.
- Analytics: the app reports nothing beyond the OS's existing `App Opened`. If the integrator adds events later they
  must carry no names, public ids or room codes (`docs/ANALYTICS.md`).

## Proposed backend addition (needs approval before it is built)

Small, additive, and in the spirit of the existing design: three optional fields on the sync body and two on the view.

```ts
// friends-api.ts
export interface FriendsSyncBody {
  name?: string;
  avatarId?: string;
  room?: { code: string; memberId: string; gameId?: string };
  /** The poll comes from a page that is not the one in the room (the desktop): refresh "online", keep the stored room claim. */
  passive?: true;
  /** The player has not touched the page for a while (client rule: hidden or no input for 5 minutes). */
  away?: boolean;
  /** A short status line; validated like a username (max 40 chars, plain text). */
  status?: string;
}
export interface Friend extends FriendCard {
  online: boolean;
  away?: boolean;
  status?: string;
  room?: { code: string; gameId: string };
  /** For an offline friend: when it last synced, rounded to the hour so it is not a tracking signal. */
  lastSeen?: number;
}
```

Service side (`FriendsStore.sync`):

- `passive`: the stored `room` is kept as it is (re-proven on the usual once-a-minute rewrite exactly as a normal
  claim is, so a passive poll can never keep a dead room alive longer than an active one would). This is what lets
  the desktop and an embedded game share one account without fighting.
- `away` and `status` are stored on the presence record next to `name` and `avatarId` and copied onto `Friend`
  for online friends; `lastSeen` is `Math.floor(at / 3_600_000) * 3_600_000` for offline ones.
- No new route, no new collection, no new index: the presence document gains three optional fields. Write cost is
  unchanged because the once-a-minute rewrite rule applies to the new fields too (a change of `away` is a change
  of the record, so it writes once when the player goes idle and once when they come back).
- Firestore adapter: read the three fields if present; nothing to migrate.

Cost and policy check against AGENTS.md: no always-on process, no connection per account, no relay, no paid
service, no push; the only new traffic is the desktop's existing-shaped 20 s poll while the Friends window or the
tray is up, which the hidden-tab policy already throttles. Privacy: `status` is text a player chose to show
friends only; `lastSeen` is coarsened to the hour; nothing new reaches analytics.

Agent work to build it once approved: about 2 hours (types, `FriendsStore.sync`, the Firestore adapter, tests in
`packages/fuse-platform/tests/friends.test.ts`, the real `PresenceService` sending `passive`/`away` and reading the
new fields). Nothing gates it except the decision.

## Modules

| Where                                | What                                                                       |
| ------------------------------------ | -------------------------------------------------------------------------- |
| `src/friends/presenceService.ts`     | `PresenceService`, `PresenceSnapshot`, `Buddy`, `BuddyStatus`, the context |
| `src/friends/demoPresenceService.ts` | The scripted typed fake, used by tests and File > Demo buddies             |
| `src/friends/realPresenceService.ts` | Over `fuse-ui/friends-client` + `fuse-ui/browser-account`                  |
| `src/friends/presenceEvents.ts`      | Diff of two snapshots into the events the tray announces                   |
| `src/friends/useFriendsViewModel.ts` | Groups, actions, the demo switch and the game-window suspension            |
| `src/friends/FriendsWindow.tsx`      | The buddy list window (Start > Programs > Fuse Messenger, `?open=friends`) |
| `src/friends/FriendsTray.tsx`        | The taskbar tray icon and the "uh-oh" toasts                               |
| `src/friends/friendsDepsContext.ts`  | `FriendsDeps`: the service, the clock and the alert sound                  |
