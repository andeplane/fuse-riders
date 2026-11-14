import type { KeyboardEvent } from "react";
import { useEffect, useRef, useState } from "react";

import { matchShortcut } from "../lib/shortcuts";
import { Win98Icon } from "../ui/icons";

import type { StartMenuItem } from "./useStartMenuViewModel";
import { useStartMenuViewModel } from "./useStartMenuViewModel";

const ITEM_SELECTOR = ":scope > li > button:not(:disabled)";

/** The enabled items of one list, not those of its open submenu. */
function itemButtons(list: HTMLUListElement | null): HTMLButtonElement[] {
  return Array.from(
    list?.querySelectorAll<HTMLButtonElement>(ITEM_SELECTOR) ?? [],
  );
}

type MenuListProps = {
  items: StartMenuItem[];
  depth: number;
  /** Keyboard-opened lists highlight their first item straight away; hover-opened ones leave focus alone. */
  focusFirst: boolean;
  /** Left arrow in a submenu: close it and put the highlight back on the folder item. */
  onCloseSubmenu?: () => void;
};

function MenuList({ items, depth, focusFirst, onCloseSubmenu }: MenuListProps) {
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState<{ id: string; byKeyboard: boolean } | null>(
    null,
  );
  // Only leaf lists may scroll: an overflow container would clip nested submenus.
  const isLeaf = items.every((item) => !item.children);

  useEffect(() => {
    if (focusFirst) itemButtons(listRef.current)[0]?.focus();
  }, [focusFirst]);

  const moveFocus = (delta: 1 | -1) => {
    const buttons = itemButtons(listRef.current);
    if (buttons.length === 0) return;
    const index = buttons.findIndex(
      (button) => button === document.activeElement,
    );
    buttons[(index + delta + buttons.length) % buttons.length]?.focus();
  };

  const onKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    item: StartMenuItem,
  ) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      moveFocus(event.key === "ArrowDown" ? 1 : -1);
    } else if (
      item.children &&
      (matchShortcut(event, "desktop.openSubmenu") ||
        matchShortcut(event, "desktop.chooseMenuItem"))
    ) {
      event.preventDefault();
      event.stopPropagation();
      setOpen({ id: item.id, byKeyboard: true });
    } else if (matchShortcut(event, "desktop.closeSubmenu") && onCloseSubmenu) {
      event.preventDefault();
      event.stopPropagation();
      onCloseSubmenu();
    }
    // Enter on a leaf is the button's own click; Escape bubbles to the Start menu root.
  };

  return (
    <ul
      ref={listRef}
      role="menu"
      className={`raised min-w-44 bg-[silver] py-0.5 ${isLeaf ? "max-h-[calc(100vh-48px)] overflow-y-auto" : ""}`}
    >
      {items.map((item) => (
        <li
          key={item.id}
          role="none"
          className="relative"
          onMouseEnter={() =>
            setOpen(item.children ? { id: item.id, byKeyboard: false } : null)
          }
        >
          <button
            type="button"
            role="menuitem"
            data-testid={`start-menu-item-${item.id}`}
            aria-haspopup={item.children ? "menu" : undefined}
            aria-expanded={item.children ? open?.id === item.id : undefined}
            disabled={item.disabled}
            className={`menu-item flat flex w-full items-center gap-2 py-1 pl-2 pr-6 text-left disabled:text-[grey] ${open?.id === item.id ? "open" : ""}`}
            onClick={() =>
              item.children
                ? setOpen({ id: item.id, byKeyboard: false })
                : item.onSelect?.()
            }
            onKeyDown={(event) => onKeyDown(event, item)}
          >
            <Win98Icon name={item.icon} size={depth === 0 ? 32 : 16} />
            <span className="flex-1">{item.label}</span>
            {item.children ? <span aria-hidden>▸</span> : null}
          </button>
          {item.children && open?.id === item.id ? (
            <div className="absolute bottom-0 left-full z-10 -ml-1">
              <MenuList
                items={item.children}
                depth={depth + 1}
                focusFirst={open.byKeyboard}
                onCloseSubmenu={() => {
                  setOpen(null);
                  itemButtons(listRef.current)
                    .find(
                      (button) =>
                        button.dataset.testid === `start-menu-item-${item.id}`,
                    )
                    ?.focus();
                }}
              />
            </div>
          ) : null}
          {item.separatorAfter ? (
            <hr className="mx-1 my-0.5 border-t border-[grey] border-b-white" />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * Win98 Start menu with the vertical banner and hover submenus. Keyboard: Up/Down move the
 * highlight, Right or Enter opens a folder, Left closes it, Enter chooses, Escape closes the
 * menu (`lib/shortcuts.ts`, Desktop scope). The first item is highlighted when the menu opens.
 */
export function StartMenu() {
  const { items, close } = useStartMenuViewModel();
  return (
    <div
      className="absolute bottom-7 left-0 z-50 flex"
      role="menu"
      aria-label="Start menu"
      data-start-menu
      onKeyDown={(event) => {
        if (matchShortcut(event, "desktop.closeMenu")) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <div className="start-banner flex w-6 items-center justify-end px-0.5 py-2">
        <span>FuseOS</span>
      </div>
      <MenuList items={items} depth={0} focusFirst />
    </div>
  );
}
