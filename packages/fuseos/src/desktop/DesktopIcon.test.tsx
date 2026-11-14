import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DesktopIcon, GameTileIcon, SHORTCUT_HINT } from "./DesktopIcon";
import { ShutdownScreen } from "./ShutdownScreen";

describe(DesktopIcon.name, () => {
  it("selects on click and opens on double click or Enter", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onOpen = vi.fn();
    render(
      <DesktopIcon
        label="My Computer"
        icon="computer"
        selected={false}
        onSelect={onSelect}
        onOpen={onOpen}
      />,
    );
    const button = screen.getByRole("button", { name: "My Computer" });
    await user.click(button);
    expect(onSelect).toHaveBeenCalled();
    await user.dblClick(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
    button.focus();
    await user.keyboard("{Enter}");
    expect(onOpen).toHaveBeenCalledTimes(2);
  });
});

describe(GameTileIcon.name, () => {
  it("draws the game's mark on its accent, hidden from assistive tech", () => {
    const { container } = render(<GameTileIcon mark="FB" accent="#ff5533" />);
    const svg = container.querySelector("svg[data-icon='tile']");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveTextContent("FB");
    expect(container.querySelector("[data-icon='shortcut']")).toBeNull();
    expect(screen.queryByTitle(SHORTCUT_HINT)).not.toBeInTheDocument();
  });

  it("adds the shortcut arrow, and says why, when the game opens in a tab", () => {
    render(
      <DesktopIcon
        label="Fuseball"
        icon={{ kind: "tile", mark: "FB", accent: "#ff5533", shortcut: true }}
        selected={false}
        onSelect={() => undefined}
        onOpen={() => undefined}
      />,
    );
    const hint = screen.getByTitle(SHORTCUT_HINT);
    const art = hint.closest("svg[data-icon='tile']");
    expect(art).toHaveAttribute("aria-hidden", "true");
    expect(art?.querySelector("[data-icon='shortcut']")).not.toBeNull();
    // The hint never reaches the button's name: it is still "Fuseball" to assistive tech.
    expect(screen.getByRole("button", { name: "Fuseball" })).toContainElement(
      hint,
    );
    // A long mark is drawn smaller so it fits the square.
    render(<GameTileIcon mark="FBi" accent="#ffcc00" />);
    expect(screen.getByText("FBi")).toHaveAttribute("font-size", "10");
  });
});

describe(ShutdownScreen.name, () => {
  it("wakes up on click and on keyboard", async () => {
    const user = userEvent.setup();
    const onWakeUp = vi.fn();
    render(<ShutdownScreen onWakeUp={onWakeUp} />);
    const screenOff = screen.getByRole("button");
    await user.click(screenOff);
    screenOff.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onWakeUp).toHaveBeenCalledTimes(3);
  });
});
