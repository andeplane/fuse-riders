import { OfficeAssistant } from "../assistant/OfficeAssistant";
import { FriendsTray } from "../friends/FriendsTray";
import { ContextMenu } from "../windows/ContextMenu";

import { DesktopIcon } from "./DesktopIcon";
import { DisplaySurface } from "./DisplaySurface";
import { ShutdownScreen } from "./ShutdownScreen";
import { StartMenu } from "./StartMenu";
import { Taskbar } from "./Taskbar";
import { useDesktopKeyboard } from "./useDesktopKeyboard";
import { useDesktopViewModel } from "./useDesktopViewModel";
import { WindowHost } from "./WindowHost";

export function Desktop() {
  const vm = useDesktopViewModel();
  useDesktopKeyboard();

  const desktop = (
    <div
      className="win98 desktop relative h-full w-full overflow-hidden"
      // The wallpaper and the solid colour are alternatives (Control Panel, Display): an image
      // covers the colour entirely, so only one of the two is ever needed here.
      style={
        vm.wallpaper
          ? {
              backgroundImage: `url(${vm.wallpaper})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }
          : { backgroundColor: vm.backgroundColor }
      }
      data-wallpaper={vm.wallpaper ? "custom" : "default"}
      onMouseDownCapture={(event) => {
        const inStartMenu =
          event.target instanceof Element &&
          event.target.closest("[data-start-menu]") !== null;
        if (!inStartMenu) vm.setStartMenuOpen(false);
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) vm.selectIcon(null);
      }}
    >
      <div
        className="absolute bottom-7 left-2 top-2 flex flex-col flex-wrap content-start"
        role="list"
        aria-label="Desktop icons"
      >
        {/*
         * Icon spacing (Control Panel, Display) is the size of each grid cell, exactly as Windows 98
         * means it. A cell is sized rather than gapped because `flex-direction: column` swaps what
         * `row-gap` and `column-gap` mean. `minHeight` rather than a fixed height so a label that
         * wraps to three lines still fits instead of being clipped.
         */}
        {vm.icons.map((icon) => (
          <div
            key={icon.id}
            role="listitem"
            className="flex justify-center"
            style={{ width: vm.iconSpacingX, minHeight: vm.iconSpacingY }}
          >
            <DesktopIcon
              label={icon.label}
              icon={icon.icon}
              shortcut={icon.shortcut}
              selected={vm.selectedIcon === icon.id}
              onSelect={() => vm.selectIcon(icon.id)}
              onOpen={icon.open}
              onContextMenu={(position) => vm.openIconMenu(icon.id, position)}
            />
          </div>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-0 bottom-7">
        <WindowHost windows={vm.windows} activeId={vm.activeId} />
      </div>
      <OfficeAssistant />
      {vm.startMenuOpen ? <StartMenu /> : null}
      <Taskbar
        windows={vm.windows}
        activeId={vm.activeId}
        startMenuOpen={vm.startMenuOpen}
        onStart={() => vm.setStartMenuOpen(!vm.startMenuOpen)}
        startButtonProps={{ "data-start-menu": true }}
        onWindowButton={vm.onTaskbarButton}
        tray={<FriendsTray />}
      />
      {vm.iconMenu ? (
        <ContextMenu
          label="Context menu"
          position={vm.iconMenu.position}
          items={[
            {
              label: "Open",
              bold: true,
              onSelect: vm.icons.find((icon) => icon.id === vm.iconMenu?.iconId)
                ?.open,
            },
          ]}
          onClose={vm.closeIconMenu}
        />
      ) : null}
      {vm.shutdownScreen ? <ShutdownScreen onWakeUp={vm.wakeUp} /> : null}
    </div>
  );
  return <DisplaySurface>{desktop}</DisplaySurface>;
}
