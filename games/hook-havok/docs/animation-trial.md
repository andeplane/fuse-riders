# Animation and asset-production trial

This document describes the original six-pose source study. The live playground and Phaser showcase now use the [Phase 7B nine-pose atlas](art-production.md); the original source and standalone inspector remain available for comparison.

## Direction and scope

Continue A's belfry palette and lantern-keeper identity with B's greater platform density. The user expressed a preference for A's character and B's platforms; they did not choose an exclusive background. All eight planned map rectangles are shown. This is a standalone art-review page, not the future Phaser scene and not an offline game mode. No gameplay, networking or audio runs here.

## Delivered sources

| File under `art-source/`                       | Actual dimensions |   Bytes | Format             |
| ---------------------------------------------- | ----------------- | ------: | ------------------ |
| `character/lantern-keeper-six-pose-source.png` | 1536 × 1024       | 1767438 | PNG, genuine alpha |
| `props/brass-hook-source.png`                  | 1254 × 1254       |  530174 | PNG, genuine alpha |
| `props/brass-lantern-source.png`               | 1254 × 1254       |  875700 | PNG, genuine alpha |

Generated with built-in `image_gen` on 2026-09-23. Dimensions and transparent corner pixels were decoded with System.Drawing.Bitmap. Source pixels are retained unchanged. Requested dimensions are not guaranteed by the generator.

## Animation contract

Update after user feedback: live idle playback now uses source frame 0 only, with a three-second 0.9% vertical breath anchored at the foot baseline. It no longer alternates the differently registered idle drawings. The original six source cells remain unchanged for inspection; the run retains four frames. The run-FPS slider is disabled during idle because breathing is continuous, not frame switching. The following describes the original sheet layout and preparation.

Six equal 512 × 512 cells: idle A, idle B, run contact A, run passing A, run contact B, run passing B (row-major 3 × 2). The preview inspects alpha > 32 inside each cell, rejects empty cells and boundary-crossing poses, and obtains source rectangles without rewriting the image. The horizontal pivot is the cell center. Each frame's lowest visible pixel defines its foot baseline. All frames share one scale based on the tallest silhouette; no per-frame stretching. Idle starts at 2 fps, run at 8 fps, and the speed slider controls actual playback for both.

This baseline rule is suitable for the stationary art study, not a final contact/airborne animation policy. The eventual engine will own motion and animation will attach to the engine view. Hood/body registration and foot contacts need authored pivots before final locomotion; alpha bounds alone do not establish anatomical consistency.

The first generation retained a three-quarter face and insufficiently distinct run poses. A targeted image edit changed the face to a one-eye profile and added close-legged passing poses. The discarded first sheet is not included as a final asset. The final result was composited in the browser to inspect transparency rather than judging the tool's black preview alone.

Known limits: two idle frames are very similar; the four-frame run remains stylized and abrupt; limb overlap still needs artistic review. No claims of a final side-view rig, smooth eight-frame run, jump/land/fire/pull animation, mobile performance, or physical-phone verification. Platform texture is stretched as a source-art composition test, not a final modular terrain solution. Hook and lantern are displayed separately and are not yet attached or animated in-world.

## Browser verification

Run the preview server and check commands in the README. The check covers asset loading, six frames, reduced-motion startup, stepping, autoplay advancement, pause stability, desktop/narrow viewport layout, failed sheet loading and successful retry without duplicate frame tiles. Screenshots are from the real browser page. No game control or physics claims are made.

Verified on Windows with Node 24.14.0, locked worktree dependencies and installed Chrome (`BROWSER_CHANNEL=chrome`), desktop 1440 × 1100 and narrow viewport 390 × 844. Both screenshots were visually inspected; narrow viewport emulation is not physical-phone testing. [Retained desktop screenshot](evidence/animation-study-desktop.png).

Additional checks: Prettier, `tsc --noEmit` and `vite build` pass (existing large-chunk warning). Full unit suite: 1611 tests, 1603 pass, 8 fail. All eight failures reproduce in a separate clean `origin/main` checkout at `0386f4af`, across `tests/backend-paths.test.ts`, `tests/ci-manifest.test.ts`, and `tests/new-game.test.ts` (37 baseline tests: 29 pass, 8 fail). No assertions were removed or changed. These are baseline failures in this Windows environment; no claim that the full local suite is green.

The first test attempt inherited another checkout's workspace package links; it was discarded. Verification above used `pnpm install --offline --frozen-lockfile --ignore-scripts` inside the isolated worktree. Logs remain under ignored `artifacts/hook-havok-{unit,main-baseline,typecheck,build}.log`.

## Exact generation prompts

### Initial sheet

Reference: `character/lantern-keeper-idle-source.png` as identity reference.

```text
Create a production sprite animation sheet for Hook Havok. Attached image is CHARACTER IDENTITY REFERENCE, not layout. Preserve ochre fabric hood, dark face with pale eyes, turquoise short scarf, brown coat and dark boots, but simplify tiny straps, buckles and painted detail to strong hand-inked shapes readable at 64 pixels tall. Strict SIDE VIEW facing RIGHT, NOT three-quarter. No weapon or hook in hands (equipment will be separate). Exactly SIX full-body character poses in an exact uniform 3 columns by 2 rows grid. Equal cell sizes, generous transparent separation. Every character same head/body proportions and same scale. Feet at consistent baseline within each cell, body root at horizontal center. Order reading left to right: top row neutral idle, slight breathing idle, run right-leg-forward contact; bottom row run passing pose, run left-leg-forward contact, run opposite passing pose. Clearly distinct leg silhouettes in running frames, consistent outfit in ALL six cells. Scarf short behind head, not huge. No extra sprites, labels, numbers, grid lines, shadows, floor, checkerboard or scenery. Genuine transparent alpha canvas. Landscape sheet ideally 1536x1024, six 512x512 cells. Crisp irregular bold ink outlines, simple painterly ochre and teal shading. Keep ALL poses entirely inside their own cells. This sheet is for real frame animation, consistency matters more than detail.
```

### Final sheet edit

Reference: The initial generated six-pose sheet as edit target. Initial prompt is retained above; the rejected intermediate is not a deliverable.

```text
Edit this exact six-cell sprite sheet. REQUIRED: remove ALL background colors, black backdrop, colored halo, glow and shadows. The entire space outside the inked character silhouettes must be genuinely transparent alpha. Keep the same six-cell 3-column 2-row layout, character colors, design and scale. Simplify the face to a strict right-facing profile with one visible pale eye in all frames. Top left idle standing; top middle SAME idle with a very slight breathing change. Top right run contact with near leg FORWARD and far leg BACK. Bottom left run PASSING pose with legs CLOSE UNDER torso, near knee lifted. Bottom middle run OPPOSITE CONTACT with near leg BACK and far leg FORWARD (change overlap/shading accordingly). Bottom right run OPPOSITE PASSING with legs CLOSE UNDER torso and far knee lifted. Distinct contact versus passing is essential. No glow and no floor shadows. Thick clean ink edge, simple flat painterly colors. All characters must stay fully within their equal grid cell with transparent gutters and same baseline. Do not add text or borders. Output transparent PNG.
```

### Hook

Reference: `character/lantern-keeper-idle-source.png` as style reference.

```text
Use case: stylized-concept. One reusable projectile sprite for Hook Havok: a compact brass and dark iron grappling hook, side view, pointed tip facing RIGHT and small attachment eye at LEFT. Original hand-inked illustrated design matching the supplied hooded keeper reference, simplified strong silhouette with 2 curved prongs and a short shaft. Warm aged brass with muted blue-gray iron, bold dark outline and modest upper-left highlight. NO hand or character, no chain or rope, no background, no halo or glow, no particles or text. Genuine transparent PNG alpha, square canvas with generous padding. Full object only, ideally 512x512.
```

### Lantern

Reference: No image reference; text direction only.

```text
Use case: stylized-concept. Single isolated hanging lantern sprite for Hook Havok, matching a hand-inked painterly 2D ruined belfry world. A small weathered brass lantern with dark iron frame, simple amber glass and a pale warm flame inside. Front view, symmetrical compact silhouette, short top hanging ring. Bold clean irregular ink outlines, simple blue-violet shadows and restrained warm brass. Entire lantern inside square canvas with clear padding. Genuine transparent PNG background outside lantern; NO external glow, halo, mist, wall, hanging chain, ground shadow, text or labels. Light only inside the glass so a game renderer can add glow separately. Ideally 512x512 source. Readable when scaled to 32 pixels tall.
```
