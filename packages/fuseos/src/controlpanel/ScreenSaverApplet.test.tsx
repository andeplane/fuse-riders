import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../__mocks__/renderWithProviders";
import { Desktop } from "../desktop/Desktop";
import type { PipesModule } from "../screensaver/screenSaverDepsContext";
import { MemoryScreenSaverStore } from "../screensaver/screenSaverStore";
import { DEFAULT_STATE } from "../state/appState";

import { DISPLAY_TABS } from "./displayTabs";
import {
  SCREEN_SAVER_DISPLAY_TAB,
  ScreenSaverApplet,
  ScreenSaverTab,
} from "./ScreenSaverApplet";

const initialState = {
  ...DEFAULT_STATE,
  windows: [
    {
      id: "w1",
      kind: "controlpanel" as const,
      applet: "display" as const,
      minimized: false,
      maximized: false,
    },
  ],
};

const idlePipes: PipesModule = {
  startPipes: () => ({
    stop: () => undefined,
    stats: () => ({
      scenes: 0,
      pipes: 0,
      meshes: 0,
      teapots: 0,
      dissolving: false,
      style: undefined,
    }),
  }),
};

async function openScreenSaverTab(user: ReturnType<typeof userEvent.setup>) {
  const dialog = await screen.findByRole("dialog", { name: "Control Panel" });
  await user.click(within(dialog).getByRole("tab", { name: "Screen Saver" }));
  return within(dialog);
}

describe("Screen Saver tab", () => {
  it("registers as the Display applet's Screen Saver tab and is the applet under its own name", () => {
    expect(SCREEN_SAVER_DISPLAY_TAB).toEqual({
      id: "screensaver",
      label: "Screen Saver",
      component: ScreenSaverTab,
    });
    expect(DISPLAY_TABS).toContain(SCREEN_SAVER_DISPLAY_TAB);
    expect(ScreenSaverApplet).toBe(ScreenSaverTab);
  });

  it("offers (None) and 3D Pipes", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />, { initialState });
    const panel = await openScreenSaverTab(user);
    expect(
      within(panel.getByLabelText("Screen saver"))
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["(None)", "3D Pipes"]);
  });

  it("shows 3D Pipes on the monitor, persists every setting, and disables the pipes options with None", async () => {
    const user = userEvent.setup();
    const store = new MemoryScreenSaverStore();
    renderWithProviders(<Desktop />, { initialState, screenSaverStore: store });
    const panel = await openScreenSaverTab(user);
    expect(panel.getByTestId("screensaver-monitor")).toHaveAttribute(
      "data-saver",
      "pipes",
    );
    expect(
      panel.getByLabelText("Screen saver preview").querySelector("svg"),
    ).not.toBeNull();
    expect(panel.getByRole("button", { name: "Preview" })).toBeEnabled();

    await user.selectOptions(panel.getByLabelText("Joint style"), "cycle");
    await user.click(panel.getByLabelText("Multiple pipes"));
    await user.click(panel.getByLabelText("Teapots now and then"));
    fireEvent.change(panel.getByLabelText("Screen saver wait minutes"), {
      target: { value: "2" },
    });
    expect(store.get()).toEqual({
      saver: "pipes",
      waitMinutes: 2,
      pipes: { joints: "cycle", teapots: false, multiple: false },
    });
    fireEvent.change(panel.getByLabelText("Screen saver wait minutes"), {
      target: { value: "" },
    });
    expect(store.get().waitMinutes).toBe(2);

    await user.selectOptions(panel.getByLabelText("Screen saver"), "none");
    expect(store.get().saver).toBe("none");
    expect(panel.getByTestId("screensaver-monitor")).toHaveAttribute(
      "data-saver",
      "none",
    );
    expect(
      panel.getByLabelText("Screen saver preview").querySelector("svg"),
    ).toBeNull();
    expect(panel.getByRole("button", { name: "Preview" })).toBeDisabled();
    expect(panel.getByLabelText("Screen saver wait minutes")).toBeDisabled();
    expect(panel.getByLabelText("Joint style")).toBeDisabled();
    expect(panel.getByLabelText("Multiple pipes")).toBeDisabled();
    await user.selectOptions(panel.getByLabelText("Screen saver"), "pipes");
    expect(panel.getByLabelText("Joint style")).toBeEnabled();
    expect(panel.getByText(/Isaiah Odhner/)).toBeInTheDocument();
  });

  it("previews the saver over the open windows and comes back to them unchanged", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />, {
      initialState,
      screenSaverDeps: { loadPipes: () => Promise.resolve(idlePipes) },
    });
    const panel = await openScreenSaverTab(user);
    await user.click(panel.getByRole("button", { name: "Preview" }));
    const overlay = await screen.findByRole("dialog", {
      name: "3D Pipes screen saver",
    });
    await waitFor(() =>
      expect(overlay).toHaveAttribute("data-status", "running"),
    );
    fireEvent.keyDown(overlay, { key: "Escape" });
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "3D Pipes screen saver" }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("dialog", { name: "Control Panel" }),
    ).toBeInTheDocument();
    expect(
      within(
        screen.getByRole("dialog", { name: "Control Panel" }),
      ).getByLabelText("Screen saver"),
    ).toHaveValue("pipes");
  });
});
