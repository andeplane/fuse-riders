# Start menu

`packages/fuseos/src/desktop/StartMenu.tsx` draws the Windows 98 Start menu; `useStartMenuViewModel.ts` builds its items. The shape is fixed:

- **Programs**
  - **Accessories**: the registered accessories, in order: Paint, Winamp, Notepad++ (disabled until its package lands), Change desktop background
  - **Games**: every Fuse game the portal lists, registered games, then the **Retro Games** submenu: the registered "Open Retro Games folder" line, then DOOM, Wolfenstein 3D, Commander Keen, Duke Nukem 3D, Minesweeper, Solitaire, SkiFree, Micropolis
  - registered programs: **Fusteam**, the game launcher (`docs/fuseos/launcher.md`)
- **My Computer** (filled by one registration; disabled until then)
- **Settings**: Control Panel, one item per Control Panel applet (`controlpanel/applets.tsx`), registered settings (Screen Saver, which opens Display Properties on that tab)
- **Help**: Help Topics, Office Assistant, registered help, About FuseOS
- **Shut Down...**: Shut down, Restart

## Registering a program

Programs that other packages add go through `packages/fuseos/src/desktop/startMenuRegistry.ts`:

```ts
export type StartMenuRegistration = {
  slot:
    | "accessories"
    | "programs"
    | "games"
    | "retro-games"
    | "my-computer"
    | "settings"
    | "help";
  id: string; // unique; the item's test id is `start-menu-item-<id>`
  label: string;
  icon: IconName;
  open?: (commands: WindowCommands, viewport: Size) => void; // absent: shown disabled
  order?: number; // lower first within a slot; unordered entries follow in list order
  separatorAfter?: boolean; // a menu separator under the item
};
export const START_MENU_REGISTRATIONS: readonly StartMenuRegistration[];
export const StartMenuRegistryContext: Context<
  readonly StartMenuRegistration[]
>;
```

Append an entry to `START_MENU_REGISTRATIONS` and the item appears; `open` receives the window commands (`windows/useWindowCommands.ts`) and the desktop's viewport, so a program opens its own window kind with `commands.open({ kind: "notepadpp", ... })`, maximized on a small display if it likes (Fusteam does, through `openLauncher`). Paint, Winamp, the wallpaper picker, Fusteam, the Retro Games folder and the Screen Saver are registered this way too, so the list is the one place to read the menu's programs. The list also holds placeholders for **Notepad++** (Accessories) and **My Computer** without `open`, so they are visible but disabled: replace the placeholder entry with one that has `open` when the program lands. `open` never has to check for an open window: the reducer (`state/appState.ts`, `sameInstance`) keeps single-instance programs (Winamp, the wallpaper picker, About, the Retro Games folder, Fusteam, one window per game and per Control Panel applet) to one window and focuses it, whether the Start menu, a desktop icon, Clippy or a `?open=` deep link asked. A test renders `<Desktop />` under `<StartMenuRegistryContext.Provider value={[...]}>` to try a registration without touching the list.

Control Panel applets need no registration here: Settings derives from `APPLETS`.

## Keyboard

The Desktop scope of `lib/shortcuts.ts` (listed in Control Panel > Keyboard):

| Key          | Does                                                                     |
| ------------ | ------------------------------------------------------------------------ |
| Ctrl+Esc     | Open or close the Start menu (the Windows key a browser lets a page see) |
| Up / Down    | Move the highlight                                                       |
| Right, Enter | Open the highlighted folder                                              |
| Left         | Close the open folder                                                    |
| Enter        | Choose the highlighted item                                              |
| Escape       | Close the menu, wherever the focus is                                    |

`useDesktopKeyboard.ts` listens on `document` for Ctrl+Esc and Escape; keys pressed inside a game iframe never reach it, so a game keeps its own controls.

## Phones and narrow screens

Below 900px (`windows/windowManager.ts`, `COMPACT_MAX_WIDTH`, the same cut-off that sends a Fuse game to a tab by default) every resizable window renders maximized and loses its Maximize button; fixed-size dialogs keep their size, clamped to the screen. The stored `maximized` flag is untouched, so a window floats again once there is room. `styles.css` grows the title bar buttons, menu rows and taskbar for a coarse pointer and lets a tall Start menu scroll.

## Run...

Start > Run... and Win+R (where the browser passes the Windows key on; never on an Apple device, where the chord is Cmd+R, Reload) open the one-line Run box (`src/run`, window kind `run`, one instance). `runCommand.ts` resolves a line purely: a Fuse game id (through the games launcher), a retro game, any `?open=` id (`state/deepLink.ts`), the names people remember (`RUN_ALIASES`: mspaint, sol, winmine, steam...), a drive or the Windows folders by address, an http(s) address (a browser tab) and `bsod`, which raises the desktop's Blue Screen of Death where the build has one and the SYSTEM32 gag's otherwise (`system32/desktopBsod.ts`). Aliases for programs from other Phase D batches answer "Cannot find" until their id is in `deepLink.ts`; the Open box only suggests names that run.
