# Shared game menus and rooms

Every game uses `fuse-ui`'s main menu: Play creates a room; How to play and About open focused dialogs; Settings appears when a game has preferences. A secondary action retains joining by code and existing solo/local modes. Credits are shared across games.

The room layout places its public invitation and game-settings action on the left, with occupied and open slots, admission, AI and start controls on the right. On phones these stack. The component moves existing controls rather than owning room commands. Game adapters retain capacity, permission checks, names, teams, selection and settings validation. Roster updates explicitly notify the layout; there is no DOM polling.

Gameplay engines and room protocols are unchanged. Attract scenes remain game-owned and muted by preview flags. Games without multiplayer AI must describe that limitation instead of offering a control that cannot work. Native dialogs provide modal focus and Escape behavior. Late admission forms return outside a hidden lobby so an ongoing game remains joinable.
