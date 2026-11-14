import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../__mocks__/renderWithProviders";
import { FakeSoundService } from "../__mocks__/soundService";
import { Desktop } from "../desktop/Desktop";
import type { AppState } from "../state/appState";
import { DEFAULT_STATE } from "../state/appState";

async function choose(
  user: ReturnType<typeof userEvent.setup>,
  ...labels: string[]
) {
  await user.click(screen.getByRole("button", { name: /Start/ }));
  const menu = screen.getByRole("menu", { name: "Start menu" });
  for (const label of labels)
    await user.click(within(menu).getByRole("menuitem", { name: label }));
}

describe("SystemSoundTriggers", () => {
  it("plays the start-up chime once when the desktop mounts", () => {
    const sounds = new FakeSoundService();
    const { rerender } = renderWithProviders(<Desktop />, { sounds });
    expect(sounds.events).toEqual(["startup"]);
    rerender(<Desktop />);
    expect(sounds.events).toEqual(["startup"]);
  });

  it("plays the shut-down chime on Shut Down and the start-up chime again on wake-up", async () => {
    const user = userEvent.setup();
    const sounds = new FakeSoundService();
    renderWithProviders(<Desktop />, { sounds });
    await choose(user, "Shut Down...", "Shut down");
    expect(sounds.events).toEqual(["startup", "shutdown"]);
    await user.click(
      screen.getByText("It's now safe to turn off your computer."),
    );
    expect(sounds.events).toEqual(["startup", "shutdown", "startup"]);
  });
});

describe("MessageBox sounds", () => {
  it("plays the critical stop chord for errors and the ding for information", async () => {
    const sounds = new FakeSoundService();
    const state: AppState = {
      ...DEFAULT_STATE,
      windows: [
        {
          id: "e",
          minimized: false,
          maximized: false,
          kind: "dialog",
          title: "Error",
          message: "Disk in drive A: may be a coaster.",
          icon: "warning",
        },
        {
          id: "i",
          minimized: false,
          maximized: false,
          kind: "dialog",
          title: "Information",
          message: "Nice try.",
          icon: "info",
        },
      ],
    };
    renderWithProviders(<Desktop />, { sounds, initialState: state });
    expect(await screen.findByText("Nice try.")).toBeInTheDocument();
    expect(sounds.events.sort()).toEqual(["ding", "error", "startup"]);
  });
});
