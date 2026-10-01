# Camera interaction correction — 2026-09-26

The old zoom floor allowed a small battlefield to sit inside an expanse of decorative ground. The minimum now covers both viewport axes and retains at least 1.1 CSS pixels per world unit; resize also reapplies that bound. The unused model-level fit operation was removed. The minimap remains the overview.

Secondary-button and Control-click gestures pan without selecting or placing. Context menus are prevented only over the battlefield. Primary drag and touch pinch/pan remain available, and the camera removes its event listeners on disposal.

- Four focused camera tests and all 1,684 repository tests passed; typecheck, build and focused lint passed.
- `scripts/neural-defence-camera-ux-smoke.ts` passed Chromium and WebKit: repeated zoom-out at desktop, portrait and short-landscape sizes, secondary and Control drag during armed placement, unchanged selection/queue, and prevented context menus.
- Existing UI smoke passed both browsers, including Chromium trusted pinch/pan. This is browser evidence, not physical Mac trackpad or phone qualification.
- Independent review found no production-code issue. Floating-point boundary assertions were corrected with a small numerical tolerance.

Real-flow maximum zoom-out captures: [desktop](premium/camera-limit-desktop.png), [phone](premium/camera-limit-phone.png).
