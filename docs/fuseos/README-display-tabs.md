# Display Properties tabs

Control Panel > Display (`packages/fuseos/src/controlpanel/DisplayApplet.tsx`) is the Windows 98 "Display Properties" dialog: a tab strip over one panel, with OK, Cancel and Apply underneath. Every change applies the moment it is made, as the applet always did; OK and Cancel close the Control Panel window and Apply is disabled, there for the look of it.

The tabs are data, not code in the applet. `packages/fuseos/src/controlpanel/displayTabs.ts` exports

```ts
export type DisplayTabProps = { windowId: string };
export type DisplayTab = {
  id: string; // stable, unique; the id of a built-in tab replaces it
  label: string; // the caption, e.g. "Screen Saver"
  component: ComponentType<DisplayTabProps>;
};
export const DISPLAY_TABS: readonly DisplayTab[];
export const DisplayTabsContext: Context<readonly DisplayTab[]>;
```

`DisplayApplet` renders whatever `DisplayTabsContext` holds, which defaults to `DISPLAY_TABS`. Nothing in the applet names a tab.

## Adding a tab

1. Write the tab as a component taking `DisplayTabProps` in your own package directory (for example `src/display/effects/AppearanceTab.tsx` or `src/screensaver/ScreenSaverTab.tsx`). `windowId` is the Control Panel window the dialog lives in; `useControlPanelViewModel(windowId)` gives the existing display preferences and `close`, and your own stores come through your own contexts as usual.
2. Insert `{ id, label, component }` into `DISPLAY_TABS` at the right place. Windows 98 order is Background, Screen Saver, Appearance, Effects, Web, Settings; keep Background first and Settings last. That one-line insert is the whole registration: the Start menu, the Control Panel and the dialog all pick it up.
3. Test your tab in isolation by rendering `<Desktop />` under `<DisplayTabsContext.Provider value={[yourTab]}>` with `renderWithProviders` (see `DisplayApplet.test.tsx` for the pattern). The dialog shows `No display settings are registered.` for an empty list and labels each panel with the tab's label, so `getByRole("tabpanel", { name: "Screen Saver" })` finds yours.

Ids are resolved by `resolveDisplayTabs`: when two entries share an id, the later one wins in the position of the first. That is how a package replaces a built-in tab (say, a richer Settings tab that also emulates resolutions) without deleting the original line: append its entry with the same id.

## Built-in tabs

| Tab           | Component                                  | What it holds                                                                                                                                                                                                                             |
| ------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `background`  | `DisplayBackgroundTab`                     | The wallpaper picture (Browse..., Camera..., None) and the solid Windows 98 palette colour. Picking one clears the other. Shared with Change desktop background.                                                                          |
| `screensaver` | `ScreenSaverTab` (`ScreenSaverApplet.tsx`) | (None) or 3D Pipes, the idle wait, Preview and the pipes' options ([screensaver.md](screensaver.md)).                                                                                                                                     |
| `appearance`  | `AppearanceTab` (`display/effects/`)       | The colour scheme (Windows Standard, Rainy Day, Rose, Slate, High Contrast, Hot Dog Stand, Fuse Neon) with a preview.                                                                                                                     |
| `effects`     | `EffectsTab` (`display/effects/`)          | The CRT monitor overlay (Off, Scanlines, Full) and its curved tube.                                                                                                                                                                       |
| `settings`    | `DisplaySettingsTab`                       | Colour palette (True Color, 256 colours, 16 colours, monochrome, applied to the games too), desktop area (Native, 640x480, 800x600, 1024x768, with the 15-second "Keep these settings?" box), desktop icon spacing and Small/Large fonts. |

`controlpanel/displayTabs.ts` mounts them in that order: the Screen Saver tab from `ScreenSaverApplet.tsx` (`SCREEN_SAVER_DISPLAY_TAB`) and the Appearance and Effects tabs from `display/effects/displayTabs.tsx` (`DISPLAY_EFFECT_TABS`). Each control lives on one tab only. Background and Settings read and write through `useControlPanelViewModel` and `DesktopUiProvider`, persisted per browser in `fuseos.display` (`desktop/displayPrefsStore.ts`) and `fuseos.wallpaper` (`desktop/wallpaperStore.ts`); the others have stores of their own. A window opened with `{ kind: "controlpanel", applet: "display", tab: "screensaver" }` (Start > Settings > Screen Saver) starts on that tab.

## Keeping the applet reachable

The applet itself is still registered in `controlpanel/applets.tsx` (`APPLETS`), which is what the Control Panel's Home grid, its tab strip and Start > Settings derive from. Adding a Display tab never needs a new applet; adding an applet never needs a Display tab.
