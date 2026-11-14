import { ContextMenu } from "../windows/ContextMenu";
import {
  isContextMenuKey,
  menuPositionAt,
  menuPositionFor,
} from "../windows/menuPosition";

import { AssistantBalloon } from "./AssistantBalloon";
import { ClippySprite } from "./ClippySprite";
import { useOfficeAssistantViewModel } from "./useOfficeAssistantViewModel";

/**
 * The Office Assistant on the desktop: Clippy bottom right above the taskbar, above the windows and below
 * the Start menu and dialogs, with his balloon. Click opens the balloon, right click the menu.
 */
export function OfficeAssistant() {
  const vm = useOfficeAssistantViewModel();
  if (!vm.visible) return null;
  return (
    <div
      className="absolute bottom-9 right-3 flex flex-col items-end gap-1"
      style={{ zIndex: vm.zIndex }}
      role="complementary"
      aria-label="Office Assistant"
    >
      {vm.balloonOpen ? <AssistantBalloon vm={vm} /> : null}
      <button
        type="button"
        className="flat"
        style={{ minWidth: 0, minHeight: 0, padding: 0 }}
        aria-label="Clippy"
        aria-expanded={vm.balloonOpen}
        title="Ask Clippy"
        onClick={vm.toggleBalloon}
        onMouseEnter={vm.wave}
        onContextMenu={(event) => {
          event.preventDefault();
          vm.openMenu(menuPositionAt(event));
        }}
        onKeyDown={(event) => {
          if (isContextMenuKey(event)) {
            event.preventDefault();
            vm.openMenu(menuPositionFor(event.currentTarget));
          }
        }}
      >
        <ClippySprite
          agent={vm.agent}
          sounds={vm.sounds}
          request={vm.request}
          busy={vm.busy}
          animate={vm.animate}
          playSounds={vm.playSounds}
          label="Clippy, the Office Assistant"
        />
      </button>
      {vm.menu ? (
        <ContextMenu
          label="Office Assistant menu"
          position={vm.menu}
          items={[
            { label: "Ask Clippy", bold: true, onSelect: vm.openBalloon },
            { label: "Options...", onSelect: vm.openOptions },
            { separator: true },
            { label: "Hide", onSelect: vm.hide },
          ]}
          onClose={vm.closeMenu}
        />
      ) : null}
    </div>
  );
}
