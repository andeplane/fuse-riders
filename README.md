# Fuse Riders

Fuse Riders is a TypeScript party game for 2–5 players, inspired by Bomberman and Achtung die Kurve. Phones steer the riders while everyone watches the arena on the TV. Trails fade, launched bombs cut escape routes, and eight random powerups change the fight. Last rider alive wins the round; first to three round wins takes the match.

## Play tonight

Connect the host laptop to the TV over HDMI and put the phones on the same Wi-Fi. Requires Node.js 22.12 or newer.

```sh
npm install
npm run build
PORT=3030 npm start
```

Open the **printed host display URL** on the TV laptop. It includes a host token needed to start matches. Scan the display QR code on each phone, choose names, and press Start race once 2–5 players have joined. Use the printed LAN address, not `localhost`, on phones. Set `HOST_IP` if automatic network-interface selection chooses the wrong address.

Production does not refresh automatically. To install changes, stop the server between matches, rebuild, and start it again. Open the newly printed host URL, refresh the phones, and rejoin; restarting clears the session scores. Keep the process running during play. For development with browser updates use `PORT=3030 npm run dev` instead. The default port without `PORT` is 3000.

## Controls and powerups

Hold left or right to steer. Hold **Fire**, then release to launch ahead: a tap fires 100 world units; holding for 1.2 seconds reaches 400. The TV and phone show charge/release feedback. Flight takes 0.3 seconds, the fuse lasts 2 seconds from release, and the cooldown is 4 seconds. Only one active bomb volley per rider is allowed.

Drops begin about six seconds into each round and attempt to spawn every six seconds, with at most three on the field. They disappear after 15 seconds; crowded areas can delay safe placement.

| Drop | Effect |
| --- | --- |
| Blast | Increases circular explosion radius by 75 units, up to two upgrades. |
| Star | Protects against hazards for 5 seconds; walls bounce you back into play. |
| Beer Worms | Makes the other living riders swerve violently for four seconds. You can still steer. |
| Ink | One second of dark clouds around other living riders; your nearby area stays clear. |
| Triple Shot | Your next accepted release launches three bombs in a fan. |
| Five Shot | Your next accepted release launches five bombs in a wider fan. Three times rarer than Triple Shot; collecting Triple preserves an armed Five Shot. |
| Orbit Shield | Absorbs one lethal collision, then briefly protects your escape. |
| Portal | Creates two linked portal walls for ten seconds, each up to one-third of the field height. Enter either to exit at the corresponding height with your heading preserved, a short defensive grace, and a 0.75-second re-entry cooldown. Unsafe exits defer transport. |

Riders collide with walls, eight-second trails, other riders, and explosions. Bombs clear trail segments and chain nearby landed bombs. Upgrades reset each round. After 60 seconds the boundary shrinks and trims trails at its edge; at 90 seconds, remaining riders draw. Simultaneous final deaths also draw. The next round starts automatically after the three-second results pause when at least two players remain connected.

## Scores and stats

Each round awards placement points of **5 / 3 / 2 / 1 / 0**. Ties split the average points for their occupied places. The leaderboard adds points across matches for the lifetime of the server process. At match end, the stats screen shows survival, distance, bombs launched/exploded, eliminations, deaths by cause, pickups by type, portal trips, wall bounces, and more. A rematch resets match statistics while keeping session points.

If a phone briefly loses Wi-Fi or locks, reopen its controller: the saved player token reconnects to the same seat while that seat remains reserved. A disconnected rider continues straight until the round ends. The host token is shared authorization, not exclusive browser ownership.

## Themes

**Neon Pixel** follows the [chosen visual reference](docs/gameplay-concepts/06-neon-pixel-hybrid.png); **Clean Neon** is an alternate. Change the TV's Visual style selector at any time. Both share gameplay and player colors. Themes are registered in `src/client/themes.ts`; see [theme assets](docs/theme-assets.md) and [ADR-004](docs/adr/004-pluggable-visual-themes.md) for the extension contract.

## Verification

```sh
npm test
npm run test:coverage
npm run build
npm run test:browser
```

Browser smoke uses installed Google Chrome. For WebKit, run `npx playwright install webkit`, then `BROWSER=webkit npm run test:browser`. Tests run isolated servers on ephemeral ports and never join the live match. [Verification evidence](docs/verification.md) distinguishes automated checks, controlled FPS measurements, and physical-device feedback.

The server advances a deterministic simulation at 20 Hz. Type-safe injected clocks, schedulers, token generators, input transports, and seeded randomness make timing and network boundaries testable.
