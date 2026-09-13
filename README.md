# Fuse Riders

Fuse Riders is a five-player neon arena game inspired by Bomberman and Achtung die Kurve. Each rider steers continuously, leaves a trail that fades after 8 seconds, and can drop a bomb with a 2-second fuse. Bombs blast in a cross, clear trail segments, and chain into nearby bombs. The last rider alive wins the round; first to five round wins takes the match.

## Play tonight

The host laptop runs the server and connects to the TV over HDMI. Everyone joins the same Wi-Fi.

Requires Node.js 22.12 or newer.

```sh
npm install
npm run build
PORT=3030 npm start
```

Open the printed display URL on the laptop/TV. The server detects the host's LAN address and prints a controller URL and host display URL; the display shows the QR code for phones. Set `HOST_IP` when automatic interface selection needs overriding. Players should scan the QR code, choose a name, and wait in the lobby until the host starts.

This runs a stable production server without automatic browser refresh. Keep the process running throughout the evening. For development with live browser updates, use `npm run dev` instead. The default port is 3000; `PORT` selects another port, and the printed URLs always include the actual port. Avoid using localhost on phones.

The host starts a round once 2–5 players are connected. Use the phone controls to steer left/right and tap Bomb. The game runs for up to 60 seconds before overtime begins shrinking the boundary; at 90 seconds, multiple surviving riders draw. After the three-second round-over presentation, the server automatically starts the next round when at least two players remain connected. A match ends at five round wins, and the host can trigger an instant rematch.

If a phone locks or briefly loses Wi-Fi, reopen the controller URL: its player token reconnects to the same seat. A disconnected rider continues straight until the round ends. The display and controllers recover from stale snapshots and input watchdog timeouts automatically.

## Themes

Neon Pixel is the default visual theme, with Clean Neon available as an alternate. Use the Visual style selector on the TV to switch at any time; both styles use the same gameplay and player colors. Theme assets and the renderer contract are documented in [`docs/theme-assets.md`](docs/theme-assets.md), and the decision record is [`ADR-004`](docs/adr/004-pluggable-visual-themes.md). New styles are registered in `src/client/themes.ts`, with matching assets in `public/themes/`.

## Controls and rules

- Steer left/right: hold the corresponding phone control.
- Bomb: tap once; bombs have a 2-second fuse and a 4-second cooldown.
- Trails last 8 seconds and can be cut by explosions.
- Riders collide with walls, trails, other riders, and explosions.
- Simultaneous final deaths produce a draw with no round win.

The server is authoritative and advances the deterministic simulation at 20 Hz. Phones send input intents; the TV renders server snapshots. This keeps every screen in the room on the same result over the local network.

## Verification

```sh
npm test
npm run test:coverage
npm run build
npm run test:browser
```

See [`docs/verification.md`](docs/verification.md) for the current evidence. Physical phones and the HDMI-connected TV have not been verified yet.

Browser smoke tests use locally installed Google Chrome. To run the same test in WebKit: `npx playwright install webkit`, then `BROWSER=webkit npm run test:browser`. Tests start isolated servers on ephemeral ports and never connect to your live match.
