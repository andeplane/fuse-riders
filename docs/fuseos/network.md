# Network Neighborhood

`packages/fuseos/src/network/` is the desktop's window onto online rooms: an Explorer-style
browser with the Fuse games as workgroups, the rooms this browser played recently, and a
"Join room..." dialog that opens a game straight into a room by its code.

## What a user sees

- Desktop icon and Start > Programs > Network Neighborhood open the one window (`NETWORK_WINDOW_ID`).
- Root: "Entire Network" plus every recent room as a neighbour ("Fuseball room AB42").
- Entire Network: one workgroup per installed Fuse game (`FuseGamesContext`).
- A workgroup: "Join room...", that game's recent rooms, then any rooms the directory lists.
- Join room: game picker and a four-character code (`ROOM_CODE_PATTERN`, `AA00`–`ZZ99`, as
  `packages/fuse-network-protocol/src/room-code.ts` issues them). The game opens in a window
  (`roomgame` window kind, `RoomGameWindow`: the game's page with `?room=CODE`) or in a tab,
  by the Control Panel's launch preference (`settings/fuseosPrefsStore.ts`).
- Details view adds "Type" and "Last played" columns; Delete forgets a recent room; File >
  Forget all recent rooms clears the list.

## Rooms the OS can know about

The room service (`packages/fuse-network-be`) has no endpoint that lists rooms: its store
reads one code at a time, `/api/ready` reports socket counts only, and games learn a code from
whoever created the room. So the window never fetches anything in production; its
`RoomDirectory` is `UNSUPPORTED_ROOM_DIRECTORY`, and a workgroup's status bar says so. The
interface stays (`roomDirectory.ts`, `MemoryRoomDirectory` for tests) so a later service that
publishes open rooms can plug in through `RoomDirectoryContext` without touching the window.
No backend route, relay or paid service was added, and none should be for this feature.

Recent rooms are the only room data the OS keeps. `RecentRoomsStore` (`recentRooms.ts`) holds
up to 20 `{gameId, code, lastSeen}` entries in `localStorage` under `fuseos.network.recentRooms`
(`MemoryRecentRoomsStore` in tests). They are never sent anywhere: not to the service and not to
analytics (`docs/ANALYTICS.md` forbids room codes in events; the network module reports nothing).

## Recording rooms from game windows (integration)

A game records a room by putting `?room=CODE` in its own address when it creates or joins one
(`history.pushState`/`replaceState` or a navigation). Game frames are same origin, so the OS can
read that address. `roomObserver.ts` exposes:

- `useRecordRoomFromFrame(frameRef, gameId)`: polls the frame's `contentWindow.location.search`
  every `ROOM_POLL_INTERVAL_MS` (through `NetworkDeps.every`, so tests tick it by hand) and
  records each new code it sees. Cross-origin frames and frames without a page read as "no room".
- `useRecordRoom(gameId, code)`: records a room the OS opened itself (`RoomGameWindow` uses it).

`FuseGameWindow` calls `useRecordRoomFromFrame(frame, gameId)` on the frame it already tracks for
Pop out (`IframeGame`'s `onFrame`), so a room a game creates or joins shows up under recent rooms
without the game saying anything. The window opens a room through B2's launcher when one is
injected through `RoomLauncherContext` (`roomLauncher.ts`: `RoomLauncher.join({gameId, code})`);
without one, `useRoomLauncher` builds the built-in launcher over the OS's own preference store.

Opened by hand (the desktop icon under My Computer, Start > Programs, Fusteam's Servers tab, Run),
the window sits behind Dial-Up Networking the first time in a page session
([README-sounds.md](README-sounds.md)).

## Dependencies

`NetworkDeps` (`networkDeps.ts`): `now`, `finePointer` (the launch default's device check) and
`every` (interval scheduling). Tests use `createTestNetworkDeps()` from
`__mocks__/renderWithProviders.tsx`, whose `tick()` runs every scheduled callback once.
