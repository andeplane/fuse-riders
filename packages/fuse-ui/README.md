# fuse-ui

Shared menus and neon/pixel styles for the room games in this repo. It holds CSS tokens, one element factory and small DOM components for the screens every room game has. It imports nothing outside itself: no game code, no network code, no npm dependencies.

## Styles

```ts
import "@fontsource/press-start-2p/latin.css"; // the pixel font the tokens name
import "fuse-ui/tokens.css"; // --fui-* custom properties only, no element styles
import "fuse-ui/components.css"; // styles for the components' default fui-* classes
```

Put the `fui-app` class on the page root to get the base page, button and field styles. The tokens are colours (`--fui-cyan`, `--fui-pink`, `--fui-yellow`, `--fui-navy`, …), `--fui-font-pixel`, `--fui-space-1…6`, `--fui-border`, radii and glows, and a z-index scale (`--fui-z-scene` up to `--fui-z-status`, including `--fui-z-dialog`). See `src/tokens.css`. The values are the ones Fuse Riders draws, so a token keeps a game in the same look.

Fuse Riders loads `tokens.css` but not `components.css` yet. It passes its own class names to the components and styles them in `src/online/online.css`.

## DOM helpers

- `el(tag, text?, className?, document?)`: the one element factory. Text is always set as `textContent`, so a player's name never becomes markup. `elementsFor(document)` binds it to one document.
- `button(text, className?, document?)`: a `type="button"` button.
- `copyText(text)`: clipboard write with the `execCommand` fallback. It returns whether the copy worked.
- `closeOnBackdrop(dialog)`: a click on a modal dialog's backdrop closes it.

## Components

Each component is a function that returns its elements. Options take callbacks, and none of them use `innerHTML`. Every component accepts `document` (the tests pass a `linkedom` one). Most also accept `classes`, which renames the class of any part; `""` leaves a part without a class.

| Function              | Builds                                                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `createLandingCard`   | Title, tagline, CREATE ROOM (async; a rejection shows on the card), join by code, PLAY SOLO                            |
| `createJoinByCode`    | Room-code field and JOIN; trims and upper-cases, validates with your rule, Enter presses JOIN                          |
| `createLobby`         | Invite card, roster, a note and START; `update({ members, canStart, showStart?, note? })`                              |
| `createInviteCard`    | QR (pass `qr: QRCode.toDataURL` from the `qrcode` package), SCAN TO JOIN, the code, the link and COPY LINK             |
| `createRoster`        | Rows of avatar, name, status and HOST, diffed in place by id; `row(id)` lets a game hang its own controls on a row     |
| `createNameEntry`     | Name field and JOIN; your `normalize` decides the seated name, and an empty name shows a hint instead of doing nothing |
| `createNotice`        | A status line, or a toast with `holdMs`; `show(text, tone)` is safe to call every frame                                |
| `createDialog`        | `<dialog>` with a title bar, an actions slot with CLOSE, and a body; the game fills the body and calls `showModal()`   |
| `createControllerRow` | Big touch buttons for a phone controller; `onPress` fires on pointer down, `onRelease` once when the press ends        |

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

`packages/fuse-ui/tests/` runs in `npm test` on `linkedom`: structure, hostile names rendered as text, and callbacks. It also checks that the package imports nothing outside itself.
