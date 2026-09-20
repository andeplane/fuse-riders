# fuse-ui

Shared menus and neon/pixel styles for the room games in this repo. It holds CSS tokens, one element factory and small DOM components for the screens every room game has. It imports nothing outside itself: no game code, no network code, no npm dependencies.

## Styles

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
| `createDialog`        | `<dialog>` with a title bar, an actions slot with CLOSE, and a body; `show({ title, content })` lets one shell serve every menu     |
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

## Tests

`packages/fuse-ui/tests/` runs in `pnpm test` on `linkedom`: structure, hostile names rendered as text, and callbacks. It also checks that the package imports nothing outside itself.
