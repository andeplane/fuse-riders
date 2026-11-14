import type { DisplayTab } from "./displayTabs";
import { DISPLAY_TABS, resolveDisplayTabs } from "./displayTabs";

const Stub = () => null;

describe("DISPLAY_TABS", () => {
  it("starts with Background and ends with Settings, every id unique and labelled", () => {
    expect(DISPLAY_TABS[0]?.id).toBe("background");
    expect(DISPLAY_TABS.at(-1)?.id).toBe("settings");
    const ids = DISPLAY_TABS.map((tab) => tab.id);
    expect(new Set(ids).size).toBe(ids.length);
    DISPLAY_TABS.forEach((tab) => {
      expect(tab.label.length).toBeGreaterThan(0);
      expect(tab.component).toBeTypeOf("function");
    });
  });
});

describe(resolveDisplayTabs.name, () => {
  it("keeps the list order and lets a later registration of an id replace the earlier one in place", () => {
    const Replacement = () => null;
    const tabs: DisplayTab[] = [
      { id: "background", label: "Background", component: Stub },
      { id: "screensaver", label: "Screen Saver", component: Stub },
      { id: "settings", label: "Settings", component: Stub },
      { id: "background", label: "Background (B9)", component: Replacement },
    ];
    expect(
      resolveDisplayTabs(tabs).map((tab) => [tab.id, tab.label, tab.component]),
    ).toEqual([
      ["background", "Background (B9)", Replacement],
      ["screensaver", "Screen Saver", Stub],
      ["settings", "Settings", Stub],
    ]);
  });

  it("returns the built-in list unchanged", () => {
    expect(resolveDisplayTabs(DISPLAY_TABS)).toEqual(DISPLAY_TABS);
  });
});
