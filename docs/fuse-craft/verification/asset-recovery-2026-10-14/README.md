# Asset recovery and dismissible controls

The reported screenshot showed broken terrain images. A fresh published load
worked during investigation, so the original request failure remains unconfirmed.
The renderer previously supplied URLs without handling failed SVG image requests;
the browser test reproduces that failure by dropping actual PNG requests.

```sh
pnpm exec vite --host 127.0.0.1 --port 5190
FUSE_CRAFT_URL=http://127.0.0.1:5190/fuse-craft/?mute pnpm exec tsx scripts/fuse-craft-asset-recovery-smoke.ts
```

Chromium and WebKit passed both transient and permanent failure cases for biomass,
rock ridges, ground and cliff textures. Every displayed sprite decoded. Permanent
failures made only two recovery requests per resource/rock source, shared across
duplicate images. Real menu-to-sandbox flows also dismissed startup controls,
retained dismissal through a live income update and reopened help through MENU.
This is desktop browser evidence, with no physical-phone qualification.

Screenshots from those actual flows:

- [Recovered artwork](recovered.png)
- [Permanent-failure fallback artwork](fallback.png)

The full unit suite passed 3,442 tests. After review added ground/cliff recovery
markers, the affected focused tests and both browser flows passed again. Typecheck,
production build, targeted ESLint and diff checks passed. Independent review's
background-texture finding was fixed by routing those images through the same
recovery path; gameplay state, terrain footprints and timing are unchanged.
