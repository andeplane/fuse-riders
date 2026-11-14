import {
  COLOR_MODES,
  DESKTOP_AREAS,
  isColorMode,
  isDesktopArea,
} from "../desktop/displayModes";
import {
  MAX_ICON_SPACING,
  MIN_ICON_SPACING,
} from "../desktop/displayPrefsStore";

import { useControlPanelViewModel } from "./useControlPanelViewModel";
import { WallpaperPicker } from "./WallpaperPicker";

/** Control Panel, Display: the background picker, desktop icon spacing, colours, desktop area and font size. */
export function DisplayApplet({ windowId }: { windowId: string }) {
  const vm = useControlPanelViewModel(windowId);
  return (
    <div className="flex flex-col gap-3">
      <WallpaperPicker
        wallpaper={vm.wallpaper}
        onChangeWallpaper={vm.setWallpaper}
        backgroundColor={vm.backgroundColor}
        onChangeColor={vm.setBackgroundColor}
      />
      <fieldset className="flex flex-col gap-2">
        <legend>Settings</legend>
        <div className="field-row-stacked">
          <label htmlFor={`color-palette-${windowId}`}>Color palette</label>
          <select
            id={`color-palette-${windowId}`}
            value={vm.colorMode}
            onChange={(event) => {
              if (isColorMode(event.target.value))
                vm.setColorMode(event.target.value);
            }}
          >
            {COLOR_MODES.map((mode) => (
              <option key={mode.value} value={mode.value}>
                {mode.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field-row-stacked">
          <label htmlFor={`desktop-area-${windowId}`}>Desktop area</label>
          <select
            id={`desktop-area-${windowId}`}
            value={vm.desktopArea}
            onChange={(event) => {
              if (isDesktopArea(event.target.value))
                vm.setDesktopArea(event.target.value);
            }}
          >
            {DESKTOP_AREAS.map((area) => (
              <option key={area.value} value={area.value}>
                {area.label}
              </option>
            ))}
          </select>
        </div>
        <p>
          Simulated display settings for Industrial OS. The desktop fits inside
          this window; your monitor settings stay the same.
        </p>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend>Icon spacing</legend>
        <div className="field-row-stacked" style={{ maxWidth: 160 }}>
          <label htmlFor="icon-spacing-x">Horizontal</label>
          <input
            id="icon-spacing-x"
            type="number"
            min={MIN_ICON_SPACING}
            max={MAX_ICON_SPACING}
            value={vm.iconSpacingX}
            onChange={(event) => {
              const next = event.target.valueAsNumber;
              if (Number.isFinite(next))
                vm.setIconSpacing({ x: next, y: vm.iconSpacingY });
            }}
          />
        </div>
        <div className="field-row-stacked" style={{ maxWidth: 160 }}>
          <label htmlFor="icon-spacing-y">Vertical</label>
          <input
            id="icon-spacing-y"
            type="number"
            min={MIN_ICON_SPACING}
            max={MAX_ICON_SPACING}
            value={vm.iconSpacingY}
            onChange={(event) => {
              const next = event.target.valueAsNumber;
              if (Number.isFinite(next))
                vm.setIconSpacing({ x: vm.iconSpacingX, y: next });
            }}
          />
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend>Font size</legend>
        <div className="field-row">
          <input
            id="font-size-small"
            type="radio"
            name="font-size"
            checked={!vm.largeFonts}
            onChange={() => vm.setLargeFonts(false)}
          />
          <label htmlFor="font-size-small">Small fonts</label>
        </div>
        <div className="field-row">
          <input
            id="font-size-large"
            type="radio"
            name="font-size"
            checked={vm.largeFonts}
            onChange={() => vm.setLargeFonts(true)}
          />
          <label htmlFor="font-size-large">Large fonts</label>
        </div>
      </fieldset>
    </div>
  );
}
