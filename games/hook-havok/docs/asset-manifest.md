# Asset manifest

This page records the initial six static source trials. The subsequent animation sheet, hook and lantern are recorded with exact prompts and measurements in [animation trial](animation-trial.md). Runtime asset optimization remains a later milestone.

## Inspected source metadata

Decoded with `System.Drawing.Bitmap` on 2026-09-23; all six PNGs opened successfully and were visually inspected. Alpha verified from decoded ARGB data and a fully transparent corner on both cutouts. No image was resized or edited after generation.

| Source filename                  | Actual dimensions |   Bytes | Transparency |
| -------------------------------- | ----------------- | ------: | ------------ |
| `01-lantern-belfry.png`          | 1672 × 941        | 2327217 | Opaque RGB   |
| `02-flooded-observatory.png`     | 1672 × 941        | 2556049 | Opaque RGB   |
| `03-overgrown-sanctuary.png`     | 1672 × 941        | 2455960 | Opaque RGB   |
| `belfry-background-source.png`   | 1672 × 941        | 1993919 | Opaque RGB   |
| `lantern-keeper-idle-source.png` | 1254 × 1254       |  699211 | Actual alpha |
| `belfry-ledge-source.png`        | 1983 × 793        |  548376 | Actual alpha |

These are unoptimized source masters (about 10.6 MB total), not the runtime download budget. Requested dimensions are prompt intent, not the output dimensions. The ledge has substantial transparent padding and is longer/thinner than the requested silhouette; crop and map its visible top explicitly during runtime preparation. No tileability or pixel-perfect collision fit has been verified.

## Source-asset trials

These explore whether the selected concept can become separate assets. They are not a completed animation kit. The reference input for every trial is `art-source/concepts/01-lantern-belfry.png` (style/identity reference, not an edit target).

- `character/lantern-keeper-idle-source.png`: genuine alpha verified. The result is a three-quarter-facing pose rather than strict side view, with more costume and weapon detail than desired. Retain as a character reference; simplify and align before runtime animation. The requested 512-square size was not followed.
- `backgrounds/belfry-background-source.png`: distant scenery without playable foreground objects. Still needs an in-scene contrast test and deliberate crop for the arena.
- `platforms/belfry-ledge-source.png`: one non-tiling source ledge. Runtime collision remains a separately authored rectangle. Modular end caps and repetition are future work.

### Character source: exact prompt

```text
Use case: stylized-concept. Asset: production sprite source trial for Hook Havok. Reference image is style and character identity reference only, not an edit target. Isolate and faithfully develop the tiny lantern keeper on the lower-left platform: ochre cloth hood with a simple dark visible face and two pale eyes, short turquoise scarf, compact brown coat, dark boots and gloves, brass handheld hook launcher. One character only, strict side view facing right, relaxed idle standing pose, entire body visible, feet on a common baseline, compact clear silhouette and bold irregular ink contours with very simple painterly shading, consistent upper-left light. No platform, no ground shadow, no scenery, no loose particles, no text, no sheet, no extra character, no white mask, horns or skull. Genuine transparent background with alpha, not a painted checkerboard. Square image ideally 512x512, generous clear padding. Keep detail simplified enough to read at 64 pixels tall. This is a reusable source asset, not a full illustration.
```

### Background source: exact prompt

```text
Use case: stylized-concept. Production BACKGROUND SOURCE for Hook Havok. Attached concept is a palette and painting-style reference only. Create a separate continuous background-only 16:9 painting of the moonlit lantern belfry world: distant narrow ruined towers and bridges in painterly blue-violet atmospheric mist, muted plum accents, tiny warm amber window lights, pale moon in the upper-left distance. Bold hand-inked illustration softened with distance, not photoreal or 3D. Central 60 percent quiet low-contrast broad shapes to allow readable platformer gameplay. NO playable platforms, NO character, NO foreground walls or overhangs, NO foreground bells or chains, NO large close lanterns, no text or UI. Full image must be distant scenery, pale fog toward the bottom suggesting a deep abyss rather than a walkable floor. Output opaque PNG ideally 2560x1440. Keep the scene artistically consistent with the reference but remove all playable and foreground objects.
```

### Platform source: exact prompt

```text
Use case: stylized-concept. Asset: ONE isolated horizontal platform source for Hook Havok side-view 2D game. Reference is material, outline and palette reference only. Draw a straight rectangular strip of weathered blue-violet masonry, slightly irregular bold black ink outlines, simplified painterly shading, sparse patinated brass support brackets underneath. A perfectly horizontal uninterrupted pale stone walking edge, no vegetation or protrusions above it. Strict side-on orthographic view with only a very thin suggestion of top surface. Entire object visible with generous transparent margins. Shape approximately 4:1 wide to tall. No lantern, no ground, no background scene, no character, no text or labels, no loose parts, no glow. Genuine transparent alpha background, not a painted checkerboard. Source ideally 1024x256; if larger canvas keep padding. This is one non-tiling ledge source trial; no promise of seamless repetition.
```

Generation: built-in `image_gen` tool, 2026-09-23. Source masters are retained unchanged. No CLI/API fallback was used. All current assets are provisional source artwork, not approved runtime sprites or real gameplay screenshots.

## Generated concepts

| File under `art-source/`              | Purpose     | Review                                                                                                              |
| ------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------- |
| `concepts/01-lantern-belfry.png`      | Direction A | Strong materials and atmosphere; platform layout differs from the specification. Recommended provisional direction. |
| `concepts/02-flooded-observatory.png` | Direction B | Open center and distinct water theme; bright distant waterfalls may compete with action.                            |
| `concepts/03-overgrown-sanctuary.png` | Direction C | Alternative foliage treatment; keep vegetation away from terrain edges.                                             |

## Exact concept prompts

### Direction A

```text
Use case: stylized-concept. Create one beautiful original 16:9 game concept painting for Hook Havok, a side-on 2D grappling platformer. Direction A: Moonlit Lantern Belfry. Bold irregular hand-inked line art, painterly blue-violet mist, dark ruined belfry walls, aged brass bells and small amber lanterns, muted plum cloth. Strong atmosphere and layered distant architecture, no 3D rendering or pixel art. A fixed-camera 1600x900 arena composition: safe terrace lower left, a few clean horizontal floating stone platforms staggered up toward center and right, high overhead anchor beam. Leave open readable traversal space between platforms and suppress background contrast in the central playing area. Show exactly one small original hooded lantern keeper on the lower-left terrace, only about 65 pixels high in a 1600-wide composition: warm ochre fabric hood, dark visible human face with simple pale eyes, turquoise short scarf, squat compact body, brass handheld hook launcher. No white mask, horns, skull, insect anatomy or recognizable existing game characters. Character silhouette crisp and light enough to read. Distant architecture is scenery, playable ledge tops have a subtle pale edge. Foreground frames only the outer edges. No UI, no text, no logos, no watermark, no title, no giant character portrait. This is a concept composition, not a production background. Wide landscape image.
```

### Direction B

```text
Use case: stylized-concept. Create one beautiful original 16:9 game concept painting for Hook Havok, a side-on 2D grappling platformer. Direction B: Flooded Observatory. Bold irregular hand-inked line art, painterly blue-violet mist, ruined observatory walls, distant waterfalls, large weathered copper astronomical rings restricted to the upper outer edges, small amber lanterns, muted plum cloth. Strong atmosphere and layered distant architecture, no 3D rendering or pixel art. A fixed-camera 1600x900 arena composition: safe terrace lower left, a few clean horizontal floating stone platforms staggered up toward center and right, high overhead anchor beam. Leave open readable traversal space between platforms and suppress background contrast in the central playing area. Show exactly one small original hooded lantern keeper on the lower-left terrace, only about 65 pixels high in a 1600-wide composition: warm ochre fabric hood, dark visible human face with simple pale eyes, turquoise short scarf, squat compact body, brass handheld hook launcher. No white mask, horns, skull, insect anatomy or recognizable existing game characters. Character silhouette crisp and light enough to read. Distant architecture is scenery, playable ledge tops have a subtle pale edge. Foreground frames only the outer edges. No UI, no text, no logos, no watermark, no title, no giant character portrait. This is a concept composition, not a production background. Wide landscape image.
```

### Direction C

```text
Use case: stylized-concept. Create one beautiful original 16:9 game concept painting for Hook Havok, a side-on 2D grappling platformer. Direction C: Overgrown Lantern Sanctuary. Bold irregular hand-inked line art, painterly blue-violet mist with muted cool green foliage, dark ruined sanctuary walls, ancient mossy stone arches, tangled inked ivy only at the outer edges, sparse broad leaves and small amber lanterns, muted plum cloth. Strong atmosphere and layered distant architecture, no 3D rendering or pixel art. A fixed-camera 1600x900 arena composition: safe terrace lower left, a few clean horizontal floating stone platforms staggered up toward center and right, high overhead anchor beam. Leave open readable traversal space between platforms and suppress background contrast in the central playing area. Show exactly one small original hooded lantern keeper on the lower-left terrace, only about 65 pixels high in a 1600-wide composition: warm ochre fabric hood, dark visible human face with simple pale eyes, turquoise short scarf, squat compact body, brass handheld hook launcher. No white mask, horns, skull, insect anatomy or recognizable existing game characters. Character silhouette crisp and light enough to read. Distant architecture is scenery, playable ledge tops have a subtle pale edge. Foreground frames only the outer edges. No UI, no text, no logos, no watermark, no title, no giant character portrait. This is a concept composition, not a production background. Wide landscape image.
```
