# Theme assets

The baseline follows the [neon/pixel gameplay reference](gameplay-concepts/06-neon-pixel-hybrid.png): a dark navy arena, crisp silhouettes, cyan/magenta/orange accents, and bright blast sparks. Assets live in `public/themes/`; both `neon-pixel` and `clean-neon` currently provide all ten SVG files below.

The runtime registry is `src/client/themes.ts`. Each typed `ThemeDefinition` supplies palette, rendering settings, and core sprite paths. [The manifest](../public/themes/manifest.json) records the asset inventory and source geometry; it does not discover themes automatically. Pickup artwork loads by theme ID and pickup type in `src/client/pickup-renderer.ts`.

| Files | Purpose |
| --- | --- |
| `rider.svg`, `bomb.svg`, `flame.svg` | Rider, launched bomb, and blast art. |
| `pickup-blast.svg`, `pickup-star.svg` | Larger explosions and invincibility. |
| `pickup-beer.svg` | Opponent wobble. |
| `pickup-triple.svg` | Triple Shot. |
| `pickup-orbitShield.svg`, `pickup-portal.svg` | Orbit Shield and Portal. |

All sprites have transparent 32×32 SVG viewboxes. The rider points right at angle zero, centered at `[16,16]`. Recoloring preserves white highlights and dark interiors. Bombs keep a dark body with a procedural fuse ring. Pickup icons use `[16,16]` anchors; flame source art uses `[16,27]`. Charge indicators, bomb flight/release effects, shield orbits, and linked portal rings are rendered procedurally using the active palette. Art never changes server hitboxes.

To add a style, extend `ThemeId` and the `themes` registry, supply all ten files in a matching `public/themes/<id>/` directory, and update the manifest. The TV selector comes from the registry. `applyThemeProperties` supplies CSS custom properties while Canvas reads the same definition. Images are cached and have geometric fallbacks. Shared simulation and server code never import visual assets.
