import { useContext, useState } from "react";

import type { DisplayTab } from "./displayTabs";
import { DisplayTabsContext, resolveDisplayTabs } from "./displayTabs";
import { useControlPanelViewModel } from "./useControlPanelViewModel";

/**
 * Control Panel, Display: the Windows 98 "Display Properties" dialog, a tab strip over one
 * panel. The tabs come from `displayTabs.ts` (`DISPLAY_TABS`, or the `DisplayTabsContext` a
 * test provides), so a package adds a tab there without touching this component. Every change
 * applies straight away, as it always has here; OK and Cancel close the window and Apply is
 * kept for the look of it.
 */
export function DisplayApplet({ windowId }: { windowId: string }) {
  const vm = useControlPanelViewModel(windowId);
  const tabs = resolveDisplayTabs(useContext(DisplayTabsContext));
  const [activeId, setActiveId] = useState<string | undefined>(tabs[0]?.id);
  const active: DisplayTab | undefined =
    tabs.find((tab) => tab.id === activeId) ?? tabs[0];
  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-2"
      role="group"
      aria-label="Display Properties"
    >
      <menu role="tablist" aria-label="Display Properties tabs">
        {tabs.map((tab) => (
          <li
            key={tab.id}
            role="presentation"
            aria-selected={tab.id === active?.id}
          >
            <a
              href="#"
              role="tab"
              aria-selected={tab.id === active?.id}
              aria-controls={`display-tab-${tab.id}-${windowId}`}
              onClick={(event) => {
                event.preventDefault();
                setActiveId(tab.id);
              }}
            >
              {tab.label}
            </a>
          </li>
        ))}
      </menu>
      <div
        className="window min-h-0 flex-1 overflow-auto p-3"
        role="tabpanel"
        id={active ? `display-tab-${active.id}-${windowId}` : undefined}
        aria-label={active?.label}
      >
        {active ? (
          <active.component key={active.id} windowId={windowId} />
        ) : (
          <p>No display settings are registered.</p>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-2">
        <button type="button" className="default" onClick={vm.close}>
          OK
        </button>
        <button type="button" onClick={vm.close}>
          Cancel
        </button>
        <button type="button" disabled>
          Apply
        </button>
      </div>
    </div>
  );
}
