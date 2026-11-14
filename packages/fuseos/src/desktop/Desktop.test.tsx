import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../__mocks__/renderWithProviders";
import {
  DEFAULT_ICON_SPACING_X,
  DEFAULT_ICON_SPACING_Y,
} from "./displayPrefsStore";

import { Desktop } from "./Desktop";

describe(Desktop.name, () => {
  it("boots to a desktop with one icon per Fuse game, then Paint, Winamp and Control Panel, a taskbar and the clock", () => {
    renderWithProviders(<Desktop />);
    const icons = within(screen.getByRole("list", { name: "Desktop icons" }));
    expect(
      icons
        .getAllByRole("button")
        .map((item) => item.lastElementChild?.textContent),
    ).toEqual([
      "Fuseball",
      "Fuse Riders",
      "Fuse Birds",
      "Paint",
      "Winamp",
      "Control Panel",
    ]);
    expect(screen.getByRole("toolbar", { name: "Taskbar" })).toHaveTextContent(
      /2:34 PM/,
    );
    expect(
      screen.getByRole("complementary", { name: "Office Assistant" }),
    ).toBeInTheDocument();
  });

  it("draws a game icon as its accent tile with the mark, and app icons from the icon set", () => {
    renderWithProviders(<Desktop />);
    const fuseball = screen.getByRole("button", { name: "Fuseball" });
    const tile = fuseball.querySelector("svg[data-icon='tile']");
    expect(tile).not.toBeNull();
    expect(tile?.querySelector("rect")?.getAttribute("fill")).toBe("#ff5533");
    expect(tile?.querySelector("text")?.textContent).toBe("FB");
    expect(
      screen
        .getByRole("button", { name: "Paint" })
        .querySelector("svg[data-icon='paint']"),
    ).not.toBeNull();
  });

  it("sizes each desktop icon cell to the Windows 98 spacing rather than padding around it", () => {
    renderWithProviders(<Desktop />);
    const cell = screen.getAllByRole("listitem")[0];
    expect(cell).toHaveStyle({
      width: `${DEFAULT_ICON_SPACING_X}px`,
      minHeight: `${DEFAULT_ICON_SPACING_Y}px`,
    });
  });

  it("selects an icon on click and opens it on double click, Enter or the context menu", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />);
    const paint = screen.getByRole("button", { name: "Paint" });
    await user.click(paint);
    expect(paint).toHaveAttribute("aria-pressed", "true");
    await user.dblClick(paint);
    expect(
      await screen.findByRole("dialog", { name: "untitled - Paint" }),
    ).toBeInTheDocument();

    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByRole("button", { name: "Winamp" }),
    });
    const menu = await screen.findByRole("menu", { name: "Context menu" });
    await user.click(within(menu).getByRole("menuitem", { name: "Open" }));
    expect(
      await screen.findByRole("dialog", { name: "Winamp" }),
    ).toBeInTheDocument();

    screen.getByRole("button", { name: "Control Panel" }).focus();
    await user.keyboard("{Enter}");
    expect(
      await screen.findByRole("dialog", { name: "Control Panel" }),
    ).toBeInTheDocument();
  });

  it("minimizes from the taskbar and restores again", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />);
    await user.dblClick(screen.getByRole("button", { name: "Paint" }));
    const taskbar = within(screen.getByRole("toolbar", { name: "Taskbar" }));
    const button = taskbar.getByRole("button", { name: /untitled - Paint/ });
    expect(button).toHaveAttribute("aria-pressed", "true");
    await user.click(button);
    expect(
      screen.queryByRole("dialog", { name: "untitled - Paint" }),
    ).not.toBeInTheDocument();
    await user.click(button);
    expect(
      screen.getByRole("dialog", { name: "untitled - Paint" }),
    ).toBeInTheDocument();
  });

  it("closes, maximizes and minimizes through the title bar", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />);
    await user.dblClick(screen.getByRole("button", { name: "Paint" }));
    const dialog = screen.getByRole("dialog", { name: "untitled - Paint" });
    await user.click(within(dialog).getByRole("button", { name: "Maximize" }));
    expect(
      within(dialog).getByRole("button", { name: "Restore" }),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Minimize" }));
    expect(
      screen.queryByRole("dialog", { name: "untitled - Paint" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /untitled - Paint/ }));
    await user.click(
      within(
        screen.getByRole("dialog", { name: "untitled - Paint" }),
      ).getByRole("button", {
        name: "Close",
      }),
    );
    expect(
      screen.queryByRole("dialog", { name: "untitled - Paint" }),
    ).not.toBeInTheDocument();
  });

  it("restores windows from the stored state and persists what changes", async () => {
    const user = userEvent.setup();
    const { store } = renderWithProviders(<Desktop />, {
      initialState: {
        version: 1,
        windows: [
          {
            id: "w1",
            kind: "retro",
            game: "minesweeper",
            minimized: false,
            maximized: false,
          },
          {
            id: "w2",
            kind: "paint",
            fileName: "cat.png",
            minimized: true,
            maximized: false,
          },
        ],
      },
    });
    expect(
      screen.getByRole("dialog", { name: "Minesweeper" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "cat.png - Paint" }),
    ).not.toBeInTheDocument();
    await user.click(
      within(screen.getByRole("dialog", { name: "Minesweeper" })).getByRole(
        "button",
        {
          name: "Close",
        },
      ),
    );
    expect(store.load().windows.map((window) => window.id)).toEqual(["w2"]);
  });

  it("opens the deep link's windows on top of the stored ones", () => {
    renderWithProviders(<Desktop />, {
      initialOpen: [
        { kind: "fusegame", gameId: "fuseball" },
        { kind: "about" },
      ],
    });
    expect(
      screen.getByRole("dialog", { name: "Fuseball" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: "About FuseOS" }),
    ).toBeInTheDocument();
  });

  it("closes the Start menu on a click elsewhere and clears the icon selection on the wallpaper", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />);
    await user.click(screen.getByRole("button", { name: /Start/ }));
    expect(
      screen.getByRole("menu", { name: "Start menu" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Paint" }));
    expect(
      screen.queryByRole("menu", { name: "Start menu" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Paint" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(
      screen.getByTestId("display-surface").firstElementChild as HTMLElement,
    );
    expect(screen.getByRole("button", { name: "Paint" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});
