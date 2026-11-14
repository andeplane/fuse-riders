# Shared game menus and rooms

Every game uses `fuse-ui`'s main menu: Play creates a room; How to play and About open focused dialogs; Settings appears when a game has preferences. A secondary action retains joining by code and existing solo/local modes. Credits are shared across games.

The room layout places its public invitation and game-settings action on the left, with occupied and open slots, admission, AI and start controls on the right. On phones these stack. The component moves existing controls rather than owning room commands. Game adapters retain capacity, permission checks, names, teams, selection and settings validation. Roster updates explicitly notify the layout; there is no DOM polling.

Gameplay engines and room protocols are unchanged. Every main menu runs a real, silent local gameplay demo through the shared attract lifecycle. Bot-capable games use their public game ticker with seeded bot-only matches; Birds submits scripted ordinary shots, and Craft uses its existing AI. There is no room connection, account, stored player state or product play metric in the demos. Fixed demo ticks are separate from rendering, drawing is capped at 30 FPS, hidden pages stop advancing, reduced motion starts paused, and leaving disposes the renderer. Demo state resets on match end or a bounded loop interval so logs and history cannot grow indefinitely.

Games without multiplayer AI must describe that limitation instead of offering a control that cannot work. Native dialogs provide modal focus and Escape behavior. Late admission forms return outside a hidden lobby so an ongoing game remains joinable. The browser gate requires a real renderer and advancing demo ticks on every game route, so future games cannot substitute a still image for this behavior.
