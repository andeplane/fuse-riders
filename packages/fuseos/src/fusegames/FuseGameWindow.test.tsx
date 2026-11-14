import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../__mocks__/renderWithProviders";
import { Desktop } from "../desktop/Desktop";
import type { AppState } from "../state/appState";
import { DEFAULT_STATE } from "../state/appState";
import { GAME_IFRAME_ALLOW } from "../windows/IframeGame";

import { FuseGameWindow, POP_OUT_HINT, POP_OUT_LABEL } from "./FuseGameWindow";

const FUSEBALL_OPEN: AppState = {
  ...DEFAULT_STATE,
  windows: [
    {
      id: "w1",
      kind: "fusegame",
      gameId: "fuseball",
      minimized: false,
      maximized: false,
    },
  ],
};

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
    // The game has the whole window: no toolbar strip in the body.
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
  });

  it("passes ?mute through to the game when the OS was opened muted", () => {
    renderWithProviders(
      <FuseGameWindow
        gameId="fuse-riders"
        active
        onActivate={() => undefined}
      />,
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
      <FuseGameWindow
        gameId="fuseball"
        active={false}
        onActivate={onActivate}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Activate Fuseball" }));
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("explains a game that is not installed, ", () => {
    renderWithProviders(
      <FuseGameWindow gameId="pong" active onActivate={() => undefined} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      'The game "pong" is not installed',
    );
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
  });

  it("opens from the desktop icon, once, restores from the stored state and reports the launch", async () => {
    const user = userEvent.setup();
    const { store, osAnalytics } = renderWithProviders(<Desktop />, {
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
    expect(
      screen.getByRole("dialog", { name: "Fuse Birds" }),
    ).toBeInTheDocument();
    const icons = within(screen.getByRole("list", { name: "Desktop icons" }));
    await user.dblClick(icons.getByRole("button", { name: "Fuseball" }));
    await user.dblClick(icons.getByRole("button", { name: "Fuseball" }));
    expect(screen.getAllByRole("dialog", { name: "Fuseball" })).toHaveLength(1);
    expect(store.load().windows.map((window) => window.kind)).toEqual([
      "fusegame",
      "fusegame",
    ]);
    expect(osAnalytics.launches).toEqual([
      { game: "fuseball", launch: "window" },
    ]);
  });

  it("puts Pop out in the title bar next to the window controls, and only on game windows", () => {
    renderWithProviders(<Desktop />, { initialState: FUSEBALL_OPEN });
    const button = within(
      screen.getByRole("dialog", { name: "Fuseball" }),
    ).getByRole("button", { name: POP_OUT_LABEL });
    expect(button).toHaveAttribute("title", POP_OUT_HINT);
    expect(button.closest(".title-bar-controls")).not.toBeNull();
    expect(
      [...(button.parentElement?.children ?? [])].map((child) =>
        child.getAttribute("aria-label"),
      ),
    ).toEqual([POP_OUT_LABEL, "Minimize", "Maximize", "Close"]);
  });

  it("pops the game out into a tab at the frame's live address and closes the window", async () => {
    const user = userEvent.setup();
    const { store, desktopDeps, osAnalytics } = renderWithProviders(
      <Desktop />,
      { initialState: FUSEBALL_OPEN },
    );
    const dialog = screen.getByRole("dialog", { name: "Fuseball" });
    // happy-dom never loads the page, so the frame has no address of its own; the embed address stands in.
    await user.click(
      within(dialog).getByRole("button", { name: POP_OUT_LABEL }),
    );
    expect(desktopDeps.openExternal).toHaveBeenCalledWith(
      "/fuse-riders/fuseball/",
    );
    expect(
      screen.queryByRole("dialog", { name: "Fuseball" }),
    ).not.toBeInTheDocument();
    expect(store.load().windows).toEqual([]);
    expect(osAnalytics.launches).toEqual([
      { game: "fuseball", launch: "popout" },
    ]);
  });
});
