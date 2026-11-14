import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import type { IconRef } from "../ui/icons";

import { TASKBAR_HEIGHT } from "./windowManager";
import { WindowChrome } from "./WindowChrome";

/** Title-bar colour changes when the user clicks away: odd counts draw it inactive, so the flash starts dark and ends active. */
export const FLASH_TOGGLES = 7;
export const FLASH_INTERVAL_MS = 70;

export type ModalDialogLayerProps = {
  title: string;
  icon: IconRef;
  zIndex: number;
  /** Whether this is the top-most message box, the one that owns the keyboard. */
  active: boolean;
  onClose: () => void;
  children: ReactNode;
};

/**
 * A modal message box: a transparent layer over the whole desktop (taskbar and Start menu included)
 * that swallows every click, with the box centred on the work area at the size of its content. A
 * click outside the box makes its title bar flash, as Windows 98 does, and keeps focus on the box.
 */
export function ModalDialogLayer({
  title,
  icon,
  zIndex,
  active,
  onClose,
  children,
}: ModalDialogLayerProps) {
  const [flashes, setFlashes] = useState(0);
  useEffect(() => {
    if (flashes === 0) return undefined;
    const timer = setTimeout(
      () => setFlashes((remaining) => remaining - 1),
      FLASH_INTERVAL_MS,
    );
    return () => clearTimeout(timer);
  }, [flashes]);
  return (
    <div
      data-modal-layer=""
      className="pointer-events-auto absolute inset-x-0 top-0 flex items-center justify-center"
      style={{ bottom: -TASKBAR_HEIGHT, paddingBottom: TASKBAR_HEIGHT, zIndex }}
      onMouseDown={(event) => {
        event.stopPropagation();
        if (event.target !== event.currentTarget) return;
        // Keep the keyboard focus on the box's OK button.
        event.preventDefault();
        setFlashes(FLASH_TOGGLES);
      }}
    >
      <div
        style={{
          width: "max-content",
          minWidth: 160,
          maxWidth: "min(420px, calc(100% - 16px))",
        }}
      >
        <WindowChrome
          title={title}
          icon={icon}
          active={active && flashes % 2 === 0}
          maximized={false}
          resizable={false}
          minimizable={false}
          onMinimize={onClose}
          onToggleMaximize={onClose}
          onClose={onClose}
          onActivate={() => undefined}
        >
          {children}
        </WindowChrome>
      </div>
    </div>
  );
}
