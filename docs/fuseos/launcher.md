# Fusteam

Fusteam is FuseOS's game launcher: a window in the olive "green skin" of the 2003–2006 Steam client that lists every Fuse game with its screenshot, so games are told apart by more than a desktop icon. It opens focused on every boot, lives under `packages/fuseos/src/launcher/`, and is reached again from the desktop icon **Fusteam**, Start > Programs > Fusteam, or `?open=fusteam`.

## What it shows

- **Tabs** across the top: My Games, Friends, Servers, News. Only My Games is real; the other three are placeholders in the same skin (`PlaceholderPage` in `LauncherWindow.tsx`), and FRIENDS & CHAT in the bottom bar opens Friends.
- **MY GAMES**: every game the portal lists (`FuseGamesContext`, from `games/*/portal.json`), in portal order, each with its 16px icon (`public/fuseos/game-icons/<id>-16.png`, or an accent tile without one) and name. The first game is selected at open. Click selects, double click plays; with the list focused (it is, when the window is active), Up and Down move the selection and Enter plays.
- **Details** for the selected game: the gallery capture (`public/gallery/<id>.jpg`, the mark on black when a game has none), name, tagline, the **PLAY** button, "Status: Ready to play", a fake "Disk usage" (a stable hash of the id, `fakeDiskUsage`) and "Last played" (local to the browser, `lastPlayedStore.ts`, key `fuseos.launcher.lastPlayed`; "Never", "Today, 14:02", "Yesterday", "3 days ago", then the date in UTC). The LINKS column opens the game's own page in a new tab; Leaderboard and Friends link to the same page, where the lobby holds both.
- **Bottom bar**: the embossed FUSTEAM wordmark where the old client had its publisher logo, **ADD A GAME...** (a Windows 98 message box explaining that games arrive through pull requests) and **FRIENDS & CHAT**.

PLAY goes through the desktop's own launch path, `useFuseGameLauncher` (`fusegames/useFuseGameLauncher.ts`), like a desktop icon or the Start menu: the game opens in a window on the desktop, or is focused if its window is already open. When the launch preference (`settings/fuseosPrefsStore.ts`, the Games applet) is "tab", or it is unset on a touch or narrow device (`effectiveGameLaunch` over `LaunchDeviceContext`), the game opens in a browser tab instead through `DesktopDeps.openExternal`. The launch is reported to analytics there, so the launcher adds nothing of its own beyond the last-played record.

## Opening

The launcher is a single-instance window: `sameInstance` in `state/appState.ts` treats every `launcher` as the same window, so `open` focuses the one already open whatever asked, including a `?open=fusteam` deep link over a booted desktop. `openLauncher(commands, viewport)` (`useOpenLauncher.ts`) is the one way in: `commands.open({ kind: "launcher" }, { id: "launcher", maximized })`, maximized when the display is narrower than 960px or shorter than 700px (`shouldMaximizeLauncher`). The desktop icon calls it through `useOpenLauncher`; the Start menu through its registration (`startMenuRegistry.ts`, slot `programs`, so Fusteam sits under Programs after Accessories and Games); `useDesktopViewModel().openLauncher` serves the assistant and the rest.

## Boot

`withLauncherOnBoot` (`launcherBoot.ts`) wraps the desktop's `StateStore` in `main.tsx`: every `load()` returns the stored state with the one launcher window (`id: "launcher"`, kind `launcher`) on top and restored, by the same reducer `open`. A stored launcher (whatever its id) is focused rather than duplicated and keeps its maximized state; a new one opens maximized on a small display. `?open=` windows are reduced on top of what the store loads, so a deep link still lands above the launcher, and `?open=fusteam` just focuses it. `withLauncherOnTop` is the pure function behind it.

The window is 900x600 (`LAUNCHER_WINDOW_SIZE`) and places itself centred on the desktop the first time it mounts (`centeredLauncherRect`); once moved, it stays where it was put for the session. Below 640px of window width (a phone, or a narrow window) the list stacks above the details (`@container` rules in `launcher.css`).

## Skin

`launcher.css` carries the look: the window background is the original client's GreenBG (#4c5844), inset panes DarkGreenBG (#3e4637), text DullGreen (#d8ded3), headings and hover Maize (#c4b550), the selected row MaizeBG (#91863c), bevels #7f8c75 over #282e22, Tahoma 11px with Arial for the game name. The launcher's title bar is restyled through `.window:has(.fst-root)` so `WindowChrome` is untouched: olive like the body, the title in plain weight, and only the minimize and close boxes (a double click on the title still maximizes). The icon is `FusteamLogo.tsx`, registered as `fusteam` in `ui/icons.tsx`.

## Dependencies

`LauncherDepsContext` supplies the last-played store; `DesktopDepsContext` supplies the clock and `openExternal`, and `LaunchDeviceContext` with `FuseOsPrefsStoreContext` decide window or tab. Tests get `createTestLauncherDeps` from `__mocks__/renderWithProviders.tsx` (an in-memory store), choose the device with `launchDevice: PHONE_DEVICE`, and can pass their own `store` to boot through the decorator.
