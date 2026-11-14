import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  PHONE_DEVICE,
  renderWithProviders,
} from "../__mocks__/renderWithProviders";
import { Desktop } from "../desktop/Desktop";
import { MemoryFuseOsPrefsStore } from "../settings/fuseosPrefsStore";
import type { AppState } from "../state/appState";
import { DEFAULT_STATE } from "../state/appState";

import { GamesApplet } from "./GamesApplet";

const GAMES_OPEN: AppState = {
  ...DEFAULT_STATE,
  windows: [
    {
      id: "w1",
      minimized: false,
      maximized: false,
      kind: "controlpanel",
      applet: "games",
    },
  ],
};

describe(GamesApplet.name, () => {
  it("shows the device default checked, explains it, and lists the installed games", () => {
    renderWithProviders(<GamesApplet />, { launchDevice: PHONE_DEVICE });
    expect(
      screen.getByRole("radio", { name: "Always a new browser tab" }),
    ).toBeChecked();
    expect(
      screen.getByRole("radio", { name: "A window inside FuseOS" }),
    ).not.toBeChecked();
    expect(
      screen.getByText(/On this device that is a browser tab/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Use the device default" }),
    ).not.toBeInTheDocument();
    const list = within(screen.getByRole("list", { name: "Installed games" }));
    expect(
      list.getAllByRole("listitem").map((item) => item.textContent),
    ).toEqual([
      "Fuseball — Five-a-side with rockets",
      "Fuse Riders — Light cycles for five",
      "Fuse Birds — Flap, dodge, survive",
    ]);
  });

  it("says when nothing is installed", () => {
    renderWithProviders(<GamesApplet />, { games: [] });
    expect(
      screen.getByText("No Fuse games are installed on this desktop."),
    ).toBeInTheDocument();
  });

  it("persists a choice, offers the device default back, and the desktop launches accordingly", async () => {
    const user = userEvent.setup();
    const prefsStore = new MemoryFuseOsPrefsStore();
    const { desktopDeps, osAnalytics } = renderWithProviders(<Desktop />, {
      initialState: GAMES_OPEN,
      prefsStore,
    });
    const dialog = screen.getByRole("dialog", { name: "Control Panel" });
    const window = within(dialog).getByRole("radio", {
      name: "A window inside FuseOS",
    });
    const tab = within(dialog).getByRole("radio", {
      name: "Always a new browser tab",
    });
    expect(window).toBeChecked();
    expect(
      within(dialog).getByText(/On this device that is a window/),
    ).toBeInTheDocument();

    await user.click(tab);
    expect(tab).toBeChecked();
    expect(prefsStore.get()).toEqual({ gameLaunch: "tab" });

    // The desktop reads the choice at once: the next launch is a tab, and the icons show it.
    const icons = within(screen.getByRole("list", { name: "Desktop icons" }));
    expect(icons.getAllByTitle("Opens in a new browser tab")).toHaveLength(3);
    expect(
      within(icons.getByRole("button", { name: "Fuseball" })).getByTitle(
        "Opens in a new browser tab",
      ),
    ).toBeInTheDocument();
    await user.dblClick(icons.getByRole("button", { name: "Fuseball" }));
    expect(desktopDeps.openExternal).toHaveBeenCalledWith(
      "/fuse-riders/fuseball/",
    );
    expect(
      screen.queryByRole("dialog", { name: "Fuseball" }),
    ).not.toBeInTheDocument();
    expect(osAnalytics.launches).toEqual([{ game: "fuseball", launch: "tab" }]);

    await user.click(
      within(dialog).getByRole("button", { name: "Use the device default" }),
    );
    expect(prefsStore.get()).toEqual({});
    expect(window).toBeChecked();
    expect(
      within(dialog).queryByRole("button", { name: "Use the device default" }),
    ).not.toBeInTheDocument();
    expect(icons.queryAllByTitle("Opens in a new browser tab")).toHaveLength(0);
  });

  it("lets a phone choose windows after all", async () => {
    const user = userEvent.setup();
    const prefsStore = new MemoryFuseOsPrefsStore();
    renderWithProviders(<GamesApplet />, {
      launchDevice: PHONE_DEVICE,
      prefsStore,
    });
    await user.click(
      screen.getByRole("radio", { name: "A window inside FuseOS" }),
    );
    expect(prefsStore.get()).toEqual({ gameLaunch: "window" });
    expect(
      screen.getByRole("button", { name: "Use the device default" }),
    ).toBeInTheDocument();
  });
});
