# Theme assets

The baseline follows the [neon/pixel gameplay reference](gameplay-concepts/06-neon-pixel-hybrid.png): a dark navy arena, crisp silhouettes, cyan/magenta/orange accents, and bright blast sparks. Assets live in `public/themes/`; both `neon-pixel` and `clean-neon` currently provide all fifteen SVG files below.

The runtime registry is `src/client/themes.ts`. Each typed `ThemeDefinition` supplies palette, rendering settings, and core sprite paths. [The manifest](../public/themes/manifest.json) records the asset inventory and source geometry; it does not discover themes automatically. Pickup artwork loads by theme ID and pickup type in `src/client/pickup-renderer.ts`.

| Files | Purpose |
| --- | --- |
| `rider.svg`, `bomb.svg`, `flame.svg` | Rider, launched bomb, and blast art. |
| `pickup-blast.svg`, `pickup-star.svg` | Larger explosions and invincibility. |
| `pickup-beer.svg` | Opponent wobble. |
| `pickup-ink.svg` | One-second rival ink clouds, with clear zones around unaffected riders. |
| `pickup-target.svg` | Target Bomb reticle; phone Fire becomes a trackpad for one release. |
| `pickup-five.svg` | Rare five-bomb fan; gold frame distinguishes it from Triple. |
| `pickup-triple.svg` | Triple Shot. |
| `pickup-orbitShield.svg`, `pickup-portal.svg` | Orbit Shield and Portal. |
| `pickup-shell.svg` | Shell Shot; the next bomb bounces until it hits a rider. |
| `pickup-gun.svg` | Gun; shots punch holes in walls and home slightly. |
| `pickup-stopwatch.svg` | FUSE; shortens your own bomb fuse per pickup. |

All sprites have transparent 32×32 SVG viewboxes. The rider points right at angle zero, centered at `[16,16]`. Recoloring preserves white highlights and dark interiors. Bombs keep a dark body with a procedural fuse ring. Pickup icons use `[16,16]` anchors; flame source art uses `[16,27]`. Charge indicators, bomb flight/release effects, shield orbits, and linked portal walls are rendered procedurally using the active palette. Art never changes server hitboxes.

To add a style, extend `ThemeId` and the `themes` registry, supply all fifteen files in a matching `public/themes/<id>/` directory, and update the manifest. The TV selector comes from the registry. `applyThemeProperties` supplies CSS custom properties while Canvas reads the same definition. Images are cached and have geometric fallbacks. Shared simulation and server code never import visual assets.
