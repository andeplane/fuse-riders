import {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { DesktopUiContext } from "../desktop/desktopUiContext";
import { displayColorFilter } from "../desktop/displayModes";
import { matchShortcut } from "../lib/shortcuts";

import type { MenuPosition } from "./menuPosition";

export type ContextMenuItem =
  | { separator: true }
  | {
      label: string;
      onSelect?: () => void;
      bold?: boolean;
      checked?: boolean;
      disabled?: boolean;
      separator?: false;
    };

export type ContextMenuProps = {
  /** Accessible name of the menu. */
  label: string;
  /** Viewport coordinates of the top left corner; the menu shifts to stay on screen. */
  position: MenuPosition;
  items: ContextMenuItem[];
  onClose: () => void;
};

/**
 * Windows 98 context menu: a raised grey panel at the pointer, the default item
 * in bold. Escape, an outside click or choosing an item closes it. Rendered in a
 * portal so window transforms do not move it.
 */
export function ContextMenu({
  label,
  position,
  items,
  onClose,
}: ContextMenuProps) {
  const { colorMode } = useContext(DesktopUiContext);
  const menuRef = useRef<HTMLUListElement>(null);
  const [placement, setPlacement] = useState<MenuPosition>(position);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const { width, height } = menu.getBoundingClientRect();
    const x = Math.max(0, Math.min(position.x, window.innerWidth - width));
    const y = Math.max(0, Math.min(position.y, window.innerHeight - height));
    setPlacement({ x, y });
    const first = menu.querySelector<HTMLButtonElement>(
      "button:not(:disabled)",
    );
    first?.focus();
  }, [position]);

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (
        event.target instanceof Node &&
        !menuRef.current?.contains(event.target)
      )
        onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (matchShortcut(event, "desktop.closeMenu")) onClose();
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  const moveFocus = (delta: 1 | -1) => {
    const buttons = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      ) ?? [],
    );
    if (buttons.length === 0) return;
    const index = buttons.findIndex(
      (button) => button === document.activeElement,
    );
    const next = buttons[(index + delta + buttons.length) % buttons.length];
    next?.focus();
  };

  return createPortal(
    <ul
      ref={menuRef}
      role="menu"
      aria-label={label}
      className="win98 raised fixed z-[90] min-w-40 select-none bg-[silver] py-1"
      style={{
        left: placement.x,
        top: placement.y,
        filter: displayColorFilter(colorMode),
      }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          moveFocus(1);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          moveFocus(-1);
        }
      }}
    >
      {items.map((item, index) =>
        item.separator ? (
          <li
            key={`sep-${index}`}
            role="separator"
            className="mx-1 my-1 border-t border-[grey] border-b-white"
          />
        ) : (
          <li key={item.label} role="none">
            <button
              type="button"
              role={
                item.checked === undefined ? "menuitem" : "menuitemcheckbox"
              }
              aria-checked={
                item.checked === undefined ? undefined : item.checked
              }
              disabled={item.disabled}
              className={`menu-item flat flex w-full items-center gap-2 px-4 py-0.5 text-left disabled:text-[grey] ${item.bold ? "font-bold" : ""}`}
              onClick={() => {
                onClose();
                item.onSelect?.();
              }}
            >
              <span className="w-3 text-center" aria-hidden>
                {item.checked ? "●" : ""}
              </span>
              <span>{item.label}</span>
            </button>
          </li>
        ),
      )}
    </ul>,
    document.body,
  );
}
