import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../__mocks__/renderWithProviders";

import { Desktop } from "./Desktop";
import type { StartMenuRegistration } from "./startMenuRegistry";
import { StartMenuRegistryContext } from "./startMenuRegistry";
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
    ).toEqual(["Programs", "My Computer", "Settings", "Help", "Shut Down..."]);
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
    // A game with a desktop icon shows its 16px bitmap; one without keeps the generic joystick.
    expect(
      within(games)
        .getByRole("menuitem", { name: "Fuseball" })
        .querySelector("img"),
    ).toHaveAttribute("src", "/fuse-riders/fuseos/game-icons/fuseball-16.png");
    expect(
      within(games)
        .getByRole("menuitem", { name: "Fuse Riders" })
        .querySelector("svg[data-icon='fusegame']"),
    ).not.toBeNull();
  });

  it("puts the game's icon in its window title bar and taskbar button", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />);
    await choose(user, "Programs", "Games", "Fuseball");
    const window = await screen.findByRole("dialog", { name: "Fuseball" });
    expect(window.querySelector("header img")).toHaveAttribute(
      "src",
      "/fuse-riders/fuseos/game-icons/fuseball-16.png",
    );
    const taskbar = screen.getByRole("toolbar", { name: "Taskbar" });
    expect(
      within(taskbar)
        .getByRole("button", { name: "Fuseball" })
        .querySelector("img"),
    ).toHaveAttribute("src", "/fuse-riders/fuseos/game-icons/fuseball-16.png");
  });

  it("lists the Control Panel applets under Settings and the accessories in registry order", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />);
    const menu = await openStartMenu(user);
    await user.click(within(menu).getByRole("menuitem", { name: "Settings" }));
    const settings = within(menu).getAllByRole("menu").at(-1);
    if (!settings) throw new Error("no Settings submenu");
    expect(
      within(settings)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual([
      "Control Panel",
      "Display",
      "Games",
      "System",
      "Assistant",
      "Keyboard",
      "Screen Saver",
    ]);

    await user.click(within(menu).getByRole("menuitem", { name: "Programs" }));
    await user.click(
      within(menu).getByRole("menuitem", { name: "Accessories" }),
    );
    const accessories = within(menu).getAllByRole("menu").at(-1);
    if (!accessories) throw new Error("no Accessories submenu");
    expect(
      within(accessories)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual([
      "Paint",
      "Winamp",
      "Notepad++",
      "Windows Explorer",
      "Change desktop background",
      "System Tools▸",
    ]);
    expect(
      within(accessories).getByRole("menuitem", { name: "Notepad++" }),
    ).toBeEnabled();
    expect(
      within(menu).getByRole("menuitem", { name: "My Computer" }),
    ).toBeEnabled();
  });

  it("opens a registered program and fills My Computer from the registry", async () => {
    const user = userEvent.setup();
    const registrations: StartMenuRegistration[] = [
      {
        slot: "accessories",
        id: "notepadpp",
        label: "Notepad++",
        icon: "file",
        order: 30,
        open: (commands) => commands.showInfo("Notepad++", "Hello from B11"),
      },
      {
        slot: "my-computer",
        id: "my-computer",
        label: "My Computer",
        icon: "computer",
        open: (commands) => commands.open({ kind: "about" }),
      },
      {
        slot: "help",
        id: "tour",
        label: "Take a tour",
        icon: "help",
        open: (commands) => commands.showInfo("Tour", "Welcome"),
      },
    ];
    renderWithProviders(
      <StartMenuRegistryContext.Provider value={registrations}>
        <Desktop />
      </StartMenuRegistryContext.Provider>,
    );
    await choose(user, "Programs", "Accessories", "Notepad++");
    expect(
      await screen.findByRole("dialog", { name: "Notepad++" }),
    ).toHaveTextContent("Hello from B11");
    await choose(user, "My Computer");
    expect(
      await screen.findByRole("dialog", { name: "About FuseOS" }),
    ).toBeInTheDocument();
    const menu = await openStartMenu(user);
    await user.click(within(menu).getByRole("menuitem", { name: "Help" }));
    const help = within(menu).getAllByRole("menu").at(-1);
    if (!help) throw new Error("no Help submenu");
    expect(
      within(help)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual([
      "Help Topics",
      "Office Assistant",
      "Take a tour",
      "About FuseOS",
    ]);
  });

  it("is driven by the keyboard: Ctrl+Esc opens it on the first item, arrows move, Right opens a folder, Left closes it, Enter chooses, Escape closes", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />);
    await user.keyboard("{Control>}{Escape}{/Control}");
    const menu = screen.getByRole("menu", { name: "Start menu" });
    expect(
      within(menu).getByRole("menuitem", { name: "Programs" }),
    ).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(
      within(menu).getByRole("menuitem", { name: "My Computer" }),
    ).toHaveFocus();
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(
      within(menu).getByRole("menuitem", { name: "Shut Down..." }),
    ).toHaveFocus();

    await user.keyboard("{ArrowDown}{ArrowRight}");
    expect(
      within(menu).getByRole("menuitem", { name: "Accessories" }),
    ).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(
      within(menu).getByRole("menuitem", { name: "Programs" }),
    ).toHaveFocus();
    expect(
      within(menu).queryByRole("menuitem", { name: "Accessories" }),
    ).toBeNull();

    await user.keyboard("{Enter}{Enter}{Enter}");
    expect(
      await screen.findByRole("dialog", { name: "untitled - Paint" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("menu", { name: "Start menu" })).toBeNull();

    await user.keyboard("{Control>}{Escape}{/Control}");
    expect(
      screen.getByRole("menu", { name: "Start menu" }),
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu", { name: "Start menu" })).toBeNull();
    await user.keyboard("{Control>}{Escape}{/Control}");
    await user.keyboard("{Control>}{Escape}{/Control}");
    expect(screen.queryByRole("menu", { name: "Start menu" })).toBeNull();
  });

  it("opens the accessories, a Fuse game, a retro game and the control panel applets", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />);

    await choose(user, "Programs", "Accessories", "Paint");
    expect(
      await screen.findByRole("dialog", { name: "untitled - Paint" }),
    ).toBeInTheDocument();

    await choose(user, "Programs", "Accessories", "Winamp");
    expect(
      await screen.findByRole("region", { name: "Winamp" }),
    ).toBeInTheDocument();
    await choose(user, "Programs", "Accessories", "Winamp");
    expect(screen.getAllByRole("region", { name: "Winamp" })).toHaveLength(1);

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
    expect(
      await screen.findByRole("dialog", { name: "Minesweeper" }),
    ).toBeInTheDocument();

    await choose(user, "Settings", "Display");
    const controlPanel = await screen.findByRole("dialog", {
      name: "Control Panel",
    });
    expect(
      within(controlPanel).getByRole("tab", { name: "Display" }),
    ).toHaveAttribute("aria-selected", "true");
    await choose(user, "Settings", "Screen Saver");
    const dialogs = screen.getAllByRole("dialog", { name: "Control Panel" });
    expect(dialogs).toHaveLength(1);
    expect(
      within(dialogs[0] ?? controlPanel).getByRole("tab", {
        name: "Screen Saver",
      }),
    ).toHaveAttribute("aria-selected", "true");
    await choose(user, "Settings", "Keyboard");
    expect(
      within(
        screen.getAllByRole("dialog", { name: "Control Panel" })[1] ??
          controlPanel,
      ).getByRole("tab", { name: "Keyboard" }),
    ).toHaveAttribute("aria-selected", "true");
  });

  it("opens help in a new tab, toggles the Office Assistant and shows About", async () => {
    const user = userEvent.setup();
    const { desktopDeps, store } = renderWithProviders(<Desktop />);
    await choose(user, "Help", "Help Topics");
    expect(desktopDeps.openExternal).toHaveBeenCalledWith(HELP_URL);

    expect(
      screen.getByRole("complementary", { name: "Office Assistant" }),
    ).toBeInTheDocument();
    await choose(user, "Help", "Office Assistant");
    expect(
      screen.queryByRole("complementary", { name: "Office Assistant" }),
    ).not.toBeInTheDocument();
    expect(store.load().assistantHidden).toBe(true);
    await choose(user, "Help", "Office Assistant");
    expect(
      screen.getByRole("complementary", { name: "Office Assistant" }),
    ).toBeInTheDocument();

    await choose(user, "Help", "About FuseOS");
    expect(
      await screen.findByRole("dialog", { name: "About FuseOS" }),
    ).toHaveTextContent("A Windows 98 desktop for the Fuse games");
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
