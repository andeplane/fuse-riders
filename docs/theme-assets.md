# Theme assets

The baseline visual direction follows `docs/gameplay-concepts/06-neon-pixel-hybrid.png`: dark navy arena, crisp pixel-like silhouettes, electric cyan/magenta/orange accents, and bright blast sparks. The asset set is intentionally small and engine-agnostic so Canvas can draw it with `Image` or replace it with procedural fallback shapes.

Assets live under `public/themes/` and are selected through [`manifest.json`](../public/themes/manifest.json). `neon-pixel` is the default; `clean-neon` is an optional smoother outline style with the same filenames and metadata. A theme loader should resolve `themes/<theme>/<sprite.file>` and never hard-code per-style dimensions.

The rider arrow points right at its base orientation (`baseAngle: 0`) and is centered at `[16,16]`; rotate by the simulation angle around that anchor. Its white/cyan fill is deliberately bright so the player color can be applied with Canvas tint/composite or a colorized fallback. Bomb is centered at `[16,16]`; flame is anchored at `[16,27]` so its base sits on the explosion cell. SVG viewboxes are 32×32 and have transparent backgrounds; render at integer multiples where possible for clean pixel edges.

Frontend coordination: `src/client/main.ts` owns theme selection and asset loading; it should use the manifest's anchor/orientation fields, cache images by theme and sprite key, and fall back to the existing geometric primitive if an asset fails. `src/client/style.css` may style theme chrome, but sprite tinting and rotation belong to Canvas rendering. No server or shared engine code should import public assets.
