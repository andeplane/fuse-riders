import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../__mocks__/renderWithProviders";

import { Desktop } from "./Desktop";
import { HELP_URL } from "./useStartMenuViewModel";

type User = ReturnType<typeof userEvent.setup>;

async function openStartMenu(user: User) {
  await user.click(screen.getByRole("button", { name: /Start/ }));
  return screen.getByRole("menu", { name: "Start menu" });
}

async function choose(user: User, ...labels: string[]) {
  const menu = await openStartMenu(user);
  for (const label of labels)
    await user.click(within(menu).getByRole("menuitem", { name: label }));
}

describe("StartMenu", () => {
  it("lists Programs with Accessories and Games, Settings, Help and Shut Down under the FuseOS banner", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />);
    const menu = await openStartMenu(user);
    expect(menu).toHaveTextContent("FuseOS");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent?.replace("▸", "")),
    ).toEqual(["Programs", "Settings", "Help", "Shut Down..."]);
    await user.click(within(menu).getByRole("menuitem", { name: "Programs" }));
    await user.click(within(menu).getByRole("menuitem", { name: "Games" }));
    const games = within(menu).getAllByRole("menu").at(-1);
    expect(games).toBeDefined();
    if (!games) return;
    expect(
      within(games)
        .getAllByRole("menuitem")
        .map((item) => item.textContent?.replace("▸", "")),
    ).toEqual(["Fuseball", "Fuse Riders", "Fuse Birds", "Retro Games"]);
  });

  it("opens the accessories, a Fuse game, a retro game and the control panel applets", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />);

    await choose(user, "Programs", "Accessories", "Paint");
    expect(
      await screen.findByRole("dialog", { name: "untitled - Paint" }),
    ).toBeInTheDocument();

    await choose(user, "Programs", "Accessories", "Winamp");
    expect(await screen.findByRole("dialog", { name: "Winamp" })).toBeInTheDocument();
    await choose(user, "Programs", "Accessories", "Winamp");
    expect(screen.getAllByRole("dialog", { name: "Winamp" })).toHaveLength(1);

    await choose(user, "Programs", "Accessories", "Change desktop background");
    expect(
      await screen.findByRole("dialog", { name: "Change desktop background" }),
    ).toBeInTheDocument();

    await choose(user, "Programs", "Games", "Fuse Riders");
    expect(screen.getByTitle("Fuse Riders")).toHaveAttribute(
      "src",
      "/fuse-riders/fuse-riders/",
    );

    await choose(user, "Programs", "Games", "Retro Games", "Minesweeper");
    expect(await screen.findByRole("dialog", { name: "Minesweeper" })).toBeInTheDocument();

    await choose(user, "Settings", "Display");
    const controlPanel = await screen.findByRole("dialog", { name: "Control Panel" });
    expect(within(controlPanel).getByRole("tab", { name: "Display" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await choose(user, "Settings", "Keyboard");
    expect(
      within(screen.getAllByRole("dialog", { name: "Control Panel" })[1] ?? controlPanel)
        .getByRole("tab", { name: "Keyboard" }),
    ).toHaveAttribute("aria-selected", "true");
  });

  it("opens help in a new tab, toggles the Office Assistant and shows About", async () => {
    const user = userEvent.setup();
    const { desktopDeps, store } = renderWithProviders(<Desktop />);
    await choose(user, "Help", "Help Topics");
    expect(desktopDeps.openExternal).toHaveBeenCalledWith(HELP_URL);

    expect(screen.getByRole("complementary", { name: "Office Assistant" })).toBeInTheDocument();
    await choose(user, "Help", "Office Assistant");
    expect(
      screen.queryByRole("complementary", { name: "Office Assistant" }),
    ).not.toBeInTheDocument();
    expect(store.load().assistantHidden).toBe(true);
    await choose(user, "Help", "Office Assistant");
    expect(screen.getByRole("complementary", { name: "Office Assistant" })).toBeInTheDocument();

    await choose(user, "Help", "About FuseOS");
    expect(await screen.findByRole("dialog", { name: "About FuseOS" })).toHaveTextContent(
      "A Windows 95 desktop for the Fuse games",
    );
  });

  it("shuts down, wakes up and restarts through the injected reload", async () => {
    const user = userEvent.setup();
    const { desktopDeps } = renderWithProviders(<Desktop />);
    await choose(user, "Shut Down...", "Shut down");
    const off = screen.getByText("It's now safe to turn off your computer.");
    await user.click(off);
    expect(
      screen.queryByText("It's now safe to turn off your computer."),
    ).not.toBeInTheDocument();
    await choose(user, "Shut Down...", "Restart");
    expect(desktopDeps.reload).toHaveBeenCalledTimes(1);
  });

  it("says when no Fuse games are installed", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />, { games: [] });
    await choose(user, "Programs", "Games");
    expect(
      screen.getByRole("menuitem", { name: "(No Fuse games installed)" }),
    ).toBeDisabled();
  });
});
