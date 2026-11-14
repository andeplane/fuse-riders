# fuse-ui

`fuse-ui/modal-input` provides `createModalInputGate({ isOpen, observe, cancel })` for game input boundaries.
Supply native dialog observation and the game's cancellation callback; cancel held controls when a dialog opens,
and check `blocked()` before dispatching gameplay keys or pointer inputs. Dispose the observer with the game.

Shared menus, social controls and neon/pixel styles for the room games in this repo. DOM components import no game or network code. The separate browser adapters use shared contracts; sign-in downloads Firebase lazily, and first-party analytics sends bounded batches only when enabled.

## Shared accounts and friends

Import `createGameSocial` from `fuse-ui/social` and `fuse-ui/social.css`. Supply the game ID, site base,
API origin, browser/document, fetch and analytics callback. Put `social.element()` in each header; it survives
page redraws. Wrap the online transport factory with `social.transport(code, token, events, create)` so presence
is announced after admission and cleared on closure or revocation. Pass `social.reportFetch` to existing result
reporters so the account identity accompanies their room capability. `social.playerName(fallback)` supplies
the shared username for seating. The dice template shows the complete setup.

Riders keeps its rich statistics adapter while importing the same `browser-account`, friends client,
notifications and `social-friends` composition. Existing sign-in and alert storage keys remain in place for
current players. Games never import another game's client for these features.

## Product metrics

Each game starts one client with `startGameAnalytics(gameId)` from `fuse-ui/play-metrics`, which reports `fuse.App Opened`.
Pass its `track` and an injected clock to `createPlayMetrics` and feed it actual rendered match state for seat/start/end events.
Supply explicit `roundActive` and `roundEnded` boundaries for actual participation, excluding countdowns and spectators.
The shared `fuse-ui/analytics` client attaches `gameId` on every event and owns consent, anonymous browser/session identity, bounded retry delivery and text scrubbing.
Fuse Riders uses its more detailed funnel with that same client. See [the event contract](../../docs/ANALYTICS.md).

## Styles

The [shared arcade UI guidance](../../docs/design/shared-arcade-ui.md) records the
gallery, launcher and game-menu hierarchy and responsive constraints.

```ts
import "@fontsource/press-start-2p/latin.css"; // the pixel font the tokens name
import "fuse-ui/tokens.css"; // --fui-* custom properties only, no element styles
import "fuse-ui/components.css"; // styles for the components' default fui-* classes
```

Put the `fui-app` class on the page root to get the base page, button and field styles. The tokens are colours (`--fui-cyan`, `--fui-pink`, `--fui-yellow`, `--fui-navy`, …), `--fui-font-pixel`, `--fui-space-1…6`, `--fui-border`, radii and glows, and a z-index scale (`--fui-z-scene` up to `--fui-z-status`, including `--fui-z-dialog`). See `src/tokens.css`. The values are the ones Fuse Riders draws, so a token keeps a game in the same look.

Fuse Riders loads both files, without `fui-app` (its page has its own base styles). Its dialogs and join form carry the default `fui-*` classes beside its own, so their shell comes from `components.css`; for the other components it passes its own class names and styles them in `games/fuse-riders/src/online/`.

## DOM helpers

- `el(tag, text?, className?, document?)`: the one element factory. Text is always set as `textContent`, so a player's name never becomes markup. `elementsFor(document)` binds it to one document.
- `button(text, className?, document?)`: a `type="button"` button.
- `copyText(text)`: clipboard write with the `execCommand` fallback. It returns whether the copy worked.
- `closeOnBackdrop(dialog)`: a click on a modal dialog's backdrop closes it.

## Menu patterns

Every menu, dialog, room and page in every game follows one set of patterns. Use these before adding a button style, a close control or a header of a game's own; a game's CSS arranges its screens and does not restyle them.

- **Back** is the one way out of a page or a dialog: `createBackButton` or `createBackLink` (`.fui-back`), a chevron and the word, the first control at the top left. There is no CLOSE, no ✕ and no "Main menu" button. A view nested inside a dialog names where its Back returns to (`label: "Matches"`), because the dialog around it already has a plain Back.
- **Escape presses Back** (`backOnEscape`), except while a dialog is open (Escape is that dialog's) or the page says Escape is busy (a song playing, a key being bound). Escape never leaves a room.
- **A header reads Back, title, actions** (`createPageHeader`, `createSubPage`, and `createDialog`'s bar): secondary actions first, the primary action last, at the right. A page's main action is in its header, never under the content it acts on.
- **Buttons** have one shape, two heights and three roles: `.fui-button` (secondary), `.fui-button-primary`, `.fui-button-danger`, at `--fui-control-height`; a menu column's buttons are `--fui-menu-height`. A column has its primary action first, a row has it last. The primary differs by colour, never by size, so a button does not jump when one page replaces another.
- **Type**: the pixel face for titles only, the sans face for buttons, names and text, the monospace face for readouts.
- **Focus** is one ring (`--fui-focus-ring`). **Arrow keys** walk a menu's buttons (`menuKeys`), Home and End jump to its ends, and Enter presses the focused one; the main menu, the game menu and the top bar's menu have it built in.
- **A room** (`createRoomLayout`) has Back at its top left. With `actionsInHeader` or `headerActions`, Settings and the main action sit across its top and follow the page down. Seats show their number on a chip in the seat's colour and say "Open seat" until somebody sits there; `slotLabel` is for a seat that is more than a number (a role, a team). With `slotLabelOpenOnly` the label describes the open seats and a taken one shows the player alone, for a game whose player rows already name the team. `extras` holds the host's own choices for the room under the invitation (a shared TV), `status` puts the connection's state at the room's foot, and `compact` makes a room on one device one column with no invitation, its seats a strip of who is here and the next open one (`compactShowsEverySeat` keeps every open seat, for a game whose seats are roles to choose). The room's code is on the invitation and nowhere else. A game that showed the connection's state during a match keeps a line for it on the match's screen: the room's foot is hidden then.

## Components

Each component is a function that returns its elements. Options take callbacks, and none of them use `innerHTML`. Every component accepts `document` (the tests pass a `linkedom` one). Most also accept `classes`, which renames the class of any part; `""` leaves a part without a class.

| Function              | Builds                                                                                                                              |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `createLandingCard`   | Title, tagline, CREATE ROOM (async; a rejection shows on the card), join by code, PLAY SOLO                                         |
| `createJoinByCode`    | Room-code field and JOIN; trims and upper-cases, validates with your rule, Enter presses JOIN; optional REJOIN for the last room    |
| `createRadioGroup`    | A fieldset of labelled radios, e.g. where the game is played                                                                        |
| `createLobby`         | Invite card, roster, a note and START; `update({ members, canStart, showStart?, note? })`                                           |
| `createLobbyShell`    | A game's own lobby parts laid out: intro, invitation, roster and footer                                                             |
| `createInviteCard`    | QR (pass `qr: QRCode.toDataURL` from the `qrcode` package), SCAN TO JOIN, the code, the link and COPY LINK                          |
| `createRoster`        | Rows of avatar, name, status and HOST, diffed in place by id, under an optional title; `row(id)` lets a game hang controls on a row |
| `createNameEntry`     | Name field and JOIN; your `normalize` decides the seated name; a second way in, a lockable account name and a slot (an avatar)      |
| `createPicker`        | One choice of a few as pressed buttons (avatars), optionally folded behind a summary with CHANGE                                    |
| `createNotice`        | A status line, or a toast with `holdMs`; `show(text, tone)` is safe every frame, `flash(text, tone)` is one event                   |
| `createDialog`        | `<dialog>` with a bar (Back, the title, an actions slot) and a body; `show({ title, content })` lets one shell serve every menu     |
| `createBackButton`    | Back, as a button; `createBackLink` is the same control as a link, for a page left by going to another address                      |
| `createPageHeader`    | A page's bar: Back, the title, then actions with the primary last; `createSubPage` is a whole page under it                         |
| `backOnEscape`        | Escape presses a Back, unless a dialog is open or the page says Escape is busy; returns what removes the listener                   |
| `menuKeys`            | Arrow keys, Home and End walk a menu's buttons from wherever the focus is; returns what removes the listener                        |
| `createRoomLayout`    | A waiting room: Back, the invitation, numbered seats with Join and Add AI, a game's own choices, Game settings and the main action  |
| `createConfirm`       | A yes/no question for a dialog body (LEAVE ROOM / STAY)                                                                             |
| `createKeyList`       | Keyboard shortcuts as headed definition lists                                                                                       |
| `createAccountDialog` | Account and leaderboard buttons and their dialog: sign-in, history pages, username; auth, fetch and renderers are the game's        |
| `createControllerRow` | Big touch buttons for a phone controller; `onPress` fires on pointer down, `onRelease` once when the press ends                     |
| `createPhoneLayout`   | Full-screen phone play: the MENU tools toggle, control hints, and what a new screen or rotation does to held input                  |

A minimal room screen:

```ts
import QRCode from "qrcode";
import { createLobby, createControllerRow } from "fuse-ui";

const lobby = createLobby({
  code,
  link,
  qr: (text) => QRCode.toDataURL(text),
  startText: "START GAME",
  onStart: () => room.command({ type: "start" }),
});
document.body.append(lobby.element);
// every frame:
lobby.update({
  members: view.players.map((p) => ({
    id: p.id,
    name: p.name,
    status: p.connected ? "READY" : "OFFLINE",
    host: p.id === view.hostId,
  })),
  canStart: isHost && view.players.length >= 2,
  showStart: isHost,
  note: view.players.length < 2 ? "Waiting for at least 2 players" : "",
});

const pad = createControllerRow({
  buttons: [
    { label: "ROLL", keys: "Space", onPress: () => send("roll") },
    { label: "HOLD", keys: "H", onPress: () => send("hold") },
  ],
});
```

## Music

`fuse-music` supplies `ALL_SONGS` and `MusicPlayer` independently of any game's
effects. Every game currently uses the full catalogue, including the Fuseball
and Volley songs. `createTopBar` supplies radio controls by default; pass
`music: chosenSongs` for a game's selection, or `music: false` for a custom radio
UI backed by the same player. See [Fuse Music](../fuse-music/README.md).

## Tests

`packages/fuse-ui/tests/` runs in `pnpm test` on `linkedom`: structure, hostile names rendered as text, and callbacks. Its boundary check permits only explicit shared browser capabilities, including `fuse-music`.
