# Fuse Craft name and queued placement — 2026-09-27

Shift-click or Shift-Enter submits a construction plan and keeps the chosen type active. Ordinary placement submits one final plan and exits. Invalid/duplicate locations add nothing and retain placement; Escape cancels only placement, not earlier plans. The existing authoritative construction queue, resources and support rules are unchanged.

The visible name is now Fuse Craft in the browser title/description, game menus, Fuse Riders launcher and current documentation. The existing route, preference key, game ID and rules ID remain stable.

Verification: 1,685 repository tests, build/typecheck and focused lint passed. Independent review found no actionable issue. Chromium and WebKit passed the actual multi-plan flow, invalid/duplicate sites, ordinary-click exit and visible title/menu checks. The existing desktop/phone UI smoke passed both browsers, including trusted Chromium pinch/pan. The queue smoke uses real mouse input at checked tile coordinates because animated queue SVG elements are replaced each tick.

Real-flow captures: [Fuse Craft menu](premium/fuse-craft-menu.png), [queued plans](premium/shift-build-queue.png).
