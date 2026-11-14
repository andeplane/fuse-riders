import { useWallpaperWindowViewModel } from "./useWallpaperWindowViewModel";
import { WallpaperPicker } from "./WallpaperPicker";

/**
 * Start > Programs > Accessories > Change desktop background, and the matching
 * desktop icon. Every pick applies straight away, exactly like Control Panel,
 * Display; Apply, OK and Cancel all leave it applied, only OK and Cancel close
 * the window, matching that applet since there is nothing pending to discard.
 */
export function WallpaperWindow({ windowId }: { windowId: string }) {
  const vm = useWallpaperWindowViewModel(windowId);
  return (
    <div className="window-body flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden">
      <div
        className="min-h-0 min-w-0 flex-1 overflow-auto"
        role="region"
        aria-label="Background settings"
        tabIndex={0}
      >
        <WallpaperPicker
          wallpaper={vm.wallpaper}
          onChangeWallpaper={vm.setWallpaper}
          backgroundColor={vm.backgroundColor}
          onChangeColor={vm.setBackgroundColor}
        />
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-2">
        <button type="button" className="default" onClick={vm.close}>
          OK
        </button>
        <button type="button" onClick={vm.close}>
          Cancel
        </button>
        <button type="button" onClick={() => undefined}>
          Apply
        </button>
      </div>
    </div>
  );
}
