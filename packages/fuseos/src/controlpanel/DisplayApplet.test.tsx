import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../__mocks__/renderWithProviders";
import { Desktop } from "../desktop/Desktop";
import type { AppState } from "../state/appState";
import { DEFAULT_STATE } from "../state/appState";

import type { DisplayTab, DisplayTabProps } from "./displayTabs";
import { DISPLAY_TABS, DisplayTabsContext } from "./displayTabs";

const DISPLAY_OPEN: AppState = {
  ...DEFAULT_STATE,
  windows: [
    {
      id: "w1",
      minimized: false,
      maximized: false,
      kind: "controlpanel",
      applet: "display",
    },
  ],
};

async function findDisplayProperties() {
  const dialog = await screen.findByRole("dialog", { name: "Control Panel" });
  return within(dialog).getByRole("group", { name: "Display Properties" });
}

describe("DisplayApplet", () => {
  it("is a Display Properties dialog: Background first with the wallpaper and colour pickers, Settings last, OK and Cancel", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />, { initialState: DISPLAY_OPEN });
    const properties = await findDisplayProperties();
    const tabs = within(properties).getByRole("tablist", {
      name: "Display Properties tabs",
    });
    expect(
      within(tabs)
        .getAllByRole("tab")
        .map((tab) => tab.textContent),
    ).toEqual(["Background", "Settings"]);
    expect(
      within(tabs).getByRole("tab", { name: "Background" }),
    ).toHaveAttribute("aria-selected", "true");
    const panel = within(properties).getByRole("tabpanel", {
      name: "Background",
    });
    expect(within(panel).getByLabelText("Browse...")).toBeInTheDocument();
    expect(
      within(panel).getByRole("button", { name: "Teal" }),
    ).toBeInTheDocument();
    expect(within(panel).queryByLabelText("Color palette")).toBeNull();

    await user.click(within(tabs).getByRole("tab", { name: "Settings" }));
    expect(within(tabs).getByRole("tab", { name: "Settings" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const settings = within(properties).getByRole("tabpanel", {
      name: "Settings",
    });
    expect(
      within(settings).getByLabelText("Color palette"),
    ).toBeInTheDocument();
    expect(within(settings).getByLabelText("Desktop area")).toBeInTheDocument();
    expect(within(settings).getByLabelText("Large fonts")).toBeInTheDocument();
    expect(within(settings).getByLabelText("Horizontal")).toBeInTheDocument();
    expect(
      within(properties).getByRole("button", { name: "Apply" }),
    ).toBeDisabled();

    await user.click(within(properties).getByRole("button", { name: "OK" }));
    expect(screen.queryByRole("dialog", { name: "Control Panel" })).toBeNull();
  });

  it("renders the tabs a package registers, in list order, each with the window id", async () => {
    const user = userEvent.setup();
    const seen: string[] = [];
    function ScreenSaverTab({ windowId }: DisplayTabProps) {
      seen.push(windowId);
      return <p>3D Pipes goes here</p>;
    }
    const tabs: DisplayTab[] = [
      ...DISPLAY_TABS.slice(0, 1),
      { id: "screensaver", label: "Screen Saver", component: ScreenSaverTab },
      ...DISPLAY_TABS.slice(1),
    ];
    renderWithProviders(
      <DisplayTabsContext.Provider value={tabs}>
        <Desktop />
      </DisplayTabsContext.Provider>,
      { initialState: DISPLAY_OPEN },
    );
    const properties = await findDisplayProperties();
    expect(
      within(properties)
        .getAllByRole("tab")
        .map((tab) => tab.textContent),
    ).toEqual(["Background", "Screen Saver", "Settings"]);
    await user.click(
      within(properties).getByRole("tab", { name: "Screen Saver" }),
    );
    expect(
      within(properties).getByRole("tabpanel", { name: "Screen Saver" }),
    ).toHaveTextContent("3D Pipes goes here");
    expect(seen).toContain("w1");
  });

  it("says so when no tab is registered at all", async () => {
    renderWithProviders(
      <DisplayTabsContext.Provider value={[]}>
        <Desktop />
      </DisplayTabsContext.Provider>,
      { initialState: DISPLAY_OPEN },
    );
    const properties = await findDisplayProperties();
    expect(properties).toHaveTextContent("No display settings are registered.");
    expect(within(properties).queryAllByRole("tab")).toHaveLength(0);
  });

  it("cancels back to the desktop", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />, { initialState: DISPLAY_OPEN });
    const properties = await findDisplayProperties();
    await user.click(
      within(properties).getByRole("button", { name: "Cancel" }),
    );
    expect(screen.queryByRole("dialog", { name: "Control Panel" })).toBeNull();
  });
});
