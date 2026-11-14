import type { ComponentType } from "react";
import { createContext } from "react";

import { DisplayBackgroundTab } from "./DisplayBackgroundTab";
import { DisplaySettingsTab } from "./DisplaySettingsTab";

/** What every Display Properties tab receives: the Control Panel window it lives in, for its view model. */
export type DisplayTabProps = { windowId: string };

/** One tab of the Display Properties dialog (`DisplayApplet.tsx`). */
export type DisplayTab = {
  /** Stable, unique; a registration with the id of a built-in tab replaces it. */
  id: string;
  /** The tab's caption, e.g. "Screen Saver". */
  label: string;
  component: ComponentType<DisplayTabProps>;
};

/**
 * The Display Properties tabs, in tab-strip order. Adding a tab is one entry here (Windows 98
 * order: Background, Screen Saver, Appearance, Effects, Web, Settings); `DisplayApplet` renders
 * from this list, so nothing there needs editing. A package that owns a tab's content exports
 * its component and inserts `{ id, label, component }` at the right place. See
 * `docs/fuseos/README-display-tabs.md`.
 */
export const DISPLAY_TABS: readonly DisplayTab[] = [
  { id: "background", label: "Background", component: DisplayBackgroundTab },
  { id: "settings", label: "Settings", component: DisplaySettingsTab },
];

/** The tabs in force; tests (and a package trying its tab in isolation) hand in their own list. */
export const DisplayTabsContext =
  createContext<readonly DisplayTab[]>(DISPLAY_TABS);

/** The tabs with duplicate ids collapsed: the last registration of an id wins, in the position of the first. */
export function resolveDisplayTabs(
  tabs: readonly DisplayTab[],
): readonly DisplayTab[] {
  const byId = new Map<string, DisplayTab>();
  tabs.forEach((tab) => byId.set(tab.id, tab));
  const seen = new Set<string>();
  return tabs.flatMap((tab) => {
    if (seen.has(tab.id)) return [];
    seen.add(tab.id);
    const winner = byId.get(tab.id);
    return winner ? [winner] : [];
  });
}
