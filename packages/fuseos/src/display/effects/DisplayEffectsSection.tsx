import { useState } from "react";

import { DISPLAY_EFFECT_TABS } from "./displayTabs";

/**
 * The Appearance and Effects tabs as one self-contained tabbed panel, for a Display applet that
 * has no tab registration of its own yet. Once the applet is a tabbed Display Properties dialog,
 * mount `DISPLAY_EFFECT_TABS` there instead and drop this.
 */
export function DisplayEffectsSection({ windowId }: { windowId: string }) {
  const [activeId, setActiveId] = useState(DISPLAY_EFFECT_TABS[0]?.id);
  const active = DISPLAY_EFFECT_TABS.find((tab) => tab.id === activeId);
  return (
    <div className="flex flex-col" data-testid="display-effects-section">
      <menu role="tablist" aria-label="Display effects">
        {DISPLAY_EFFECT_TABS.map((tab) => (
          <li
            key={tab.id}
            role="presentation"
            aria-selected={tab.id === activeId}
          >
            <a
              href="#"
              role="tab"
              aria-selected={tab.id === activeId}
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
      <div className="window p-3" role="tabpanel">
        {active ? <active.component windowId={windowId} /> : null}
      </div>
    </div>
  );
}
