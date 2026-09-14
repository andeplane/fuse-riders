# ADR 038: Local solo play and a live attract screen

Status: accepted after independent source review; browser acceptance recorded with the release.

The home screen should show the game before asking for a room code. Add a silent, local AI battle behind a readable menu and a first-class Play Solo action.

Solo uses the existing HostSession and normal bot/input/physics rules in the browser, with one human and four AI. It creates no backend room and uses no WebRTC. The existing game UI and Phaser presentation are reused through a small local runtime adapter; online transport and authority are unchanged. Room settings apply locally, with individual-device layout forced for solo. Reloading starts a fresh solo match.

Attract mode uses its own five-AI HostSession, with normal projectiles and effects. It has no audio, persistence or networking. Simulation remains fixed at 20 Hz and presentation is capped at 30 fps. Hidden tabs suspend without catch-up; reduced-motion users get a static rendered arena. A visible pause control lets anyone freeze the background. Navigation tears down its scheduler and renderer.

Validation: injected-clock/scheduler tests for solo admission, ordinary input, pause and stop; desktop/mobile browser checks for readable layout, an advancing AI scene, one-click offline solo scoring/controls, and unchanged create/join entry points. Respect reduced motion and retain keyboard focus/labels. Review implementation before publication.

Mobile menus use a fixed close toolbar and a separate scrolling body. Audio controls are expanded inline inside the dialog, removing the desktop absolute-positioned dropdown. Safe viewport bounds, 16px inputs and touch-sized actions apply to settings, audio, avatar, sharing and leave dialogs. Native Escape and outside-backdrop dismissal remain available.
