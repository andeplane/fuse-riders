import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../__mocks__/renderWithProviders";
import { Desktop } from "../desktop/Desktop";
import { GAME_IFRAME_ALLOW } from "../windows/IframeGame";

import { FuseGameWindow } from "./FuseGameWindow";

describe(FuseGameWindow.name, () => {
  it("embeds the game's page with the permissions a Fuse game needs and the capture behind it", () => {
    renderWithProviders(
      <FuseGameWindow gameId="fuseball" active onActivate={() => undefined} />,
    );
    const frame = screen.getByTitle("Fuseball");
    expect(frame).toHaveAttribute("src", "/fuse-riders/fuseball/");
    expect(frame).toHaveAttribute("allow", GAME_IFRAME_ALLOW);
    expect(frame).toHaveAttribute("allowfullscreen");
    expect(frame.parentElement).toHaveStyle({
      backgroundImage: "url(/fuse-riders/gallery/fuseball.jpg)",
    });
    expect(
      screen.queryByRole("button", { name: "Activate Fuseball" }),
    ).not.toBeInTheDocument();
  });

  it("passes ?mute through to the game when the OS was opened muted", () => {
    renderWithProviders(
      <FuseGameWindow gameId="fuse-riders" active onActivate={() => undefined} />,
      { muted: true },
    );
    expect(screen.getByTitle("Fuse Riders")).toHaveAttribute(
      "src",
      "/fuse-riders/fuse-riders/?mute",
    );
  });

  it("shields an inactive frame so the first click activates the window", async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    renderWithProviders(
      <FuseGameWindow gameId="fuseball" active={false} onActivate={onActivate} />,
    );
    await user.click(screen.getByRole("button", { name: "Activate Fuseball" }));
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("explains a game that is not installed", () => {
    renderWithProviders(
      <FuseGameWindow gameId="pong" active onActivate={() => undefined} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      'The game "pong" is not installed',
    );
  });

  it("opens from the desktop icon, once, and restores from the stored state", async () => {
    const user = userEvent.setup();
    const { store } = renderWithProviders(<Desktop />, {
      initialState: {
        version: 1,
        windows: [
          {
            id: "w1",
            kind: "fusegame",
            gameId: "fuse-birds",
            minimized: false,
            maximized: false,
          },
        ],
      },
    });
    expect(screen.getByRole("dialog", { name: "Fuse Birds" })).toBeInTheDocument();
    const icons = within(screen.getByRole("list", { name: "Desktop icons" }));
    await user.dblClick(icons.getByRole("button", { name: "Fuseball" }));
    await user.dblClick(icons.getByRole("button", { name: "Fuseball" }));
    expect(screen.getAllByRole("dialog", { name: "Fuseball" })).toHaveLength(1);
    expect(store.load().windows.map((window) => window.kind)).toEqual([
      "fusegame",
      "fusegame",
    ]);
  });
});
