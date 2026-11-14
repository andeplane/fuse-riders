import { useState } from "react";

import { AppIcon } from "../ui/icons";

import type { StartMenuItem } from "./useStartMenuViewModel";
import { useStartMenuViewModel } from "./useStartMenuViewModel";

function MenuList({ items, depth }: { items: StartMenuItem[]; depth: number }) {
  const [openId, setOpenId] = useState<string | null>(null);
  // Only leaf lists may scroll: an overflow container would clip nested submenus.
  const isLeaf = items.every((item) => !item.children);
  return (
    <ul
      role="menu"
      className={`raised min-w-44 bg-[silver] py-0.5 ${isLeaf ? "max-h-[calc(100vh-48px)] overflow-y-auto" : ""}`}
    >
      {items.map((item) => (
        <li
          key={item.id}
          role="none"
          className="relative"
          onMouseEnter={() => setOpenId(item.children ? item.id : null)}
        >
          <button
            type="button"
            role="menuitem"
            aria-haspopup={item.children ? "menu" : undefined}
            aria-expanded={item.children ? openId === item.id : undefined}
            disabled={item.disabled}
            className={`menu-item flat flex w-full items-center gap-2 py-1 pl-2 pr-6 text-left disabled:text-[grey] ${openId === item.id ? "open" : ""}`}
            onClick={() =>
              item.children ? setOpenId(item.id) : item.onSelect?.()
            }
          >
            <AppIcon icon={item.icon} size={depth === 0 ? 32 : 16} />
            <span className="flex-1">{item.label}</span>
            {item.children ? <span aria-hidden>▸</span> : null}
          </button>
          {item.children && openId === item.id ? (
            <div className="absolute bottom-0 left-full z-10 -ml-1">
              <MenuList items={item.children} depth={depth + 1} />
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

/** Win98 Start menu with the vertical banner and hover submenus. */
export function StartMenu() {
  const { items } = useStartMenuViewModel();
  return (
    <div
      className="absolute bottom-7 left-0 z-50 flex"
      role="menu"
      aria-label="Start menu"
      data-start-menu
    >
      <div className="start-banner flex w-6 items-center justify-end px-0.5 py-2">
        <span>FuseOS</span>
      </div>
      <MenuList items={items} depth={0} />
    </div>
  );
}
