import type { DisplayTabProps } from "./displayTabs";
import { useControlPanelViewModel } from "./useControlPanelViewModel";
import { WallpaperPicker } from "./WallpaperPicker";

/** Display Properties > Background: the wallpaper picture (file or camera) or a solid palette colour. */
export function DisplayBackgroundTab({ windowId }: DisplayTabProps) {
  const vm = useControlPanelViewModel(windowId);
  return (
    <WallpaperPicker
      wallpaper={vm.wallpaper}
      onChangeWallpaper={vm.setWallpaper}
      backgroundColor={vm.backgroundColor}
      onChangeColor={vm.setBackgroundColor}
    />
  );
}
