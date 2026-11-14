import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../__mocks__/renderWithProviders";

import { DisplayEffectsSection } from "./DisplayEffectsSection";
import { DISPLAY_EFFECT_TABS } from "./displayTabs";

describe("Display Properties tabs", () => {
  it("registers Appearance and Effects, in that order", () => {
    expect(DISPLAY_EFFECT_TABS.map((tab) => [tab.id, tab.label])).toEqual([
      ["appearance", "Appearance"],
      ["effects", "Effects"],
    ]);
  });

  it("shows Appearance first and switches to Effects on its tab", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DisplayEffectsSection windowId="w1" />);
    const tabs = screen.getByRole("tablist", { name: "Display effects" });
    expect(
      within(tabs).getByRole("tab", { name: "Appearance" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Scheme")).toBeInTheDocument();
    expect(screen.queryByLabelText("CRT monitor")).not.toBeInTheDocument();
    await user.click(within(tabs).getByRole("tab", { name: "Effects" }));
    expect(within(tabs).getByRole("tab", { name: "Effects" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByLabelText("CRT monitor")).toBeInTheDocument();
    expect(screen.getByLabelText("Palette")).toBeInTheDocument();
    expect(screen.getByLabelText("Screen resolution")).toBeInTheDocument();
    expect(screen.queryByLabelText("Scheme")).not.toBeInTheDocument();
  });
});
