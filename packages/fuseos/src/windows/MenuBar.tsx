import { useEffect, useRef, useState } from 'react';

import { matchShortcut } from '../lib/shortcuts';

export type MenuItemDef =
  | { separator: true }
  | { label: string; onSelect?: () => void; disabled?: boolean; checked?: boolean; separator?: false; /** Shown right-aligned, e.g. "Ctrl+A"; informational only, does not bind the key itself. */ shortcut?: string };

export type MenuDef = { label: string; items: MenuItemDef[] };

/** Win98 menu bar with click-to-open drop downs. Open state is transient UI state. */
export function MenuBar({ menus }: { menus: MenuDef[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (openIndex === null) return undefined;
    const close = (event: MouseEvent) => {
      if (event.target instanceof Node && !navRef.current?.contains(event.target)) setOpenIndex(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (matchShortcut(event, 'desktop.closeMenu')) setOpenIndex(null);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [openIndex]);

  return (
    <nav ref={navRef} className="relative flex shrink-0 select-none" role="menubar">
      {menus.map((menu, index) => (
        <div key={menu.label} className="relative">
          <button
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={openIndex === index}
            aria-label={menu.label}
            className={`flat px-2 py-0.5 ${openIndex === index ? 'sunken' : ''}`}
            onClick={() => setOpenIndex(openIndex === index ? null : index)}
            onMouseEnter={() => {
              if (openIndex !== null) setOpenIndex(index);
            }}
          >
            <u>{menu.label.charAt(0)}</u>
            {menu.label.slice(1)}
          </button>
          {openIndex === index ? (
            <ul role="menu" aria-label={menu.label} className="raised absolute left-0 top-full z-20 min-w-40 bg-[silver] py-1">
              {menu.items.map((item, itemIndex) =>
                item.separator ? (
                  <li key={`sep-${itemIndex}`} role="separator" className="mx-1 my-1 border-t border-[grey] border-b-white" />
                ) : (
                  <li key={item.label} role="none">
                    <button
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={item.checked ?? false}
                      aria-label={item.label}
                      disabled={item.disabled}
                      className="menu-item flat flex w-full items-center justify-between gap-6 px-4 py-0.5 text-left disabled:text-[grey]"
                      onClick={() => {
                        setOpenIndex(null);
                        item.onSelect?.();
                      }}
                    >
                      <span className="flex items-center gap-2">
                        <span className="w-3 text-center">{item.checked ? '●' : ''}</span>
                        <span>{item.label}</span>
                      </span>
                      {item.shortcut ? <span className="text-[grey]">{item.shortcut}</span> : null}
                    </button>
                  </li>
                )
              )}
            </ul>
          ) : null}
        </div>
      ))}
    </nav>
  );
}
