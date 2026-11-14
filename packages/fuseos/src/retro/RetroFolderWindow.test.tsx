import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../__mocks__/renderWithProviders";
import { Desktop } from "../desktop/Desktop";
import type { AppState } from "../state/appState";
import { DEFAULT_STATE } from "../state/appState";

import { GAME_LIST, GAMES } from "./games";
import { RUNTIME_LABELS } from "./RetroFolderWindow";

async function openFolder(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /Start/ }));
  const menu = screen.getByRole("menu", { name: "Start menu" });
  await user.click(within(menu).getByRole("menuitem", { name: "Programs" }));
  await user.click(within(menu).getByRole("menuitem", { name: "Games" }));
  await user.click(within(menu).getByRole("menuitem", { name: "Retro Games" }));
  await user.click(
    within(menu).getByRole("menuitem", { name: "Open DOS Games folder" }),
  );
  return screen.findByRole("dialog", { name: "DOS Games" });
}

describe("DOS Games folder", () => {
  it("opens from the Start menu as a resizable folder with the DOS games first and the Windows games under them", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />);
    const folder = await openFolder(user);
    expect(within(folder).getByLabelText("Maximize")).toBeInTheDocument();
    expect(folder.closest("[data-window-id]")).toHaveStyle({
      width: "640px",
      height: "420px",
    });
    const names = (label: string) =>
      within(within(folder).getByRole("listbox", { name: label }))
        .getAllByRole("option")
        .map((option) => option.textContent);
    expect(names("DOS games")).toEqual([
      "DOOM",
      "Wolfenstein 3D",
      "Commander Keen 1: Marooned on Mars",
      "Duke Nukem 3D",
    ]);
    expect(names("Windows games")).toEqual([
      "Minesweeper",
      "SkiFree",
      "Micropolis",
      "Solitaire",
    ]);
    expect([...names("DOS games"), ...names("Windows games")]).toEqual(
      GAME_LIST.map((game) => game.name),
    );
    expect(folder.querySelector("svg[data-icon='folder']")).not.toBeNull();
    expect(within(folder).getByLabelText("Status")).toHaveTextContent(
      "8 object(s)",
    );
    expect(
      within(screen.getByRole("toolbar", { name: "Taskbar" })).getByRole(
        "button",
        { name: /DOS Games/ },
      ),
    ).toBeInTheDocument();
  });

  it("selects a game on click, showing its controls and type in the status bar", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />);
    const folder = await openFolder(user);
    const doom = within(folder).getByRole("option", { name: "DOOM" });
    await user.click(doom);
    expect(doom).toHaveAttribute("aria-selected", "true");
    expect(within(folder).getByLabelText("Status")).toHaveTextContent(
      `DOOM: ${GAMES.doom.controls}`,
    );
    expect(within(folder).getByLabelText("Type")).toHaveTextContent(
      RUNTIME_LABELS.jsdos,
    );
    await user.click(within(folder).getByRole("option", { name: "SkiFree" }));
    expect(doom).toHaveAttribute("aria-selected", "false");
    expect(within(folder).getByLabelText("Type")).toHaveTextContent(
      RUNTIME_LABELS.iframe,
    );
    expect(screen.queryByRole("dialog", { name: "DOOM" })).toBeNull();
  });

  it("opens a game on double click and brings it to the front when it is already open", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />);
    const folder = await openFolder(user);
    await user.dblClick(
      within(folder).getByRole("option", { name: "Wolfenstein 3D" }),
    );
    const wolf = await screen.findByRole("dialog", { name: "Wolfenstein 3D" });
    expect(within(wolf).getByTitle("Wolfenstein 3D")).toHaveAttribute(
      "src",
      "https://fuseos.test/fuse-riders/fuseos/jsdos/player.html?bundle=wolf3d",
    );
    expect(wolf).toHaveAttribute("data-active", "true");
    await user.click(
      within(screen.getByRole("toolbar", { name: "Taskbar" })).getByRole(
        "button",
        { name: /DOS Games/ },
      ),
    );
    expect(screen.getByRole("dialog", { name: "DOS Games" })).toHaveAttribute(
      "data-active",
      "true",
    );
    await user.dblClick(
      within(screen.getByRole("dialog", { name: "DOS Games" })).getByRole(
        "option",
        { name: "Wolfenstein 3D" },
      ),
    );
    expect(
      screen.getAllByRole("dialog", { name: "Wolfenstein 3D" }),
    ).toHaveLength(1);
    expect(
      screen.getByRole("dialog", { name: "Wolfenstein 3D" }),
    ).toHaveAttribute("data-active", "true");
  });

  it("opens the selected game with Enter and from File > Open", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />);
    const folder = await openFolder(user);
    const minesweeper = within(folder).getByRole("option", {
      name: "Minesweeper",
    });
    minesweeper.focus();
    await user.keyboard("{Enter}");
    expect(
      await screen.findByRole("dialog", { name: "Minesweeper" }),
    ).toBeInTheDocument();

    const retro = screen.getByRole("dialog", { name: "DOS Games" });
    await user.click(within(retro).getByRole("option", { name: "Solitaire" }));
    await user.click(within(retro).getByRole("menuitem", { name: "File" }));
    await user.click(
      within(retro).getByRole("menuitemcheckbox", { name: "Open" }),
    );
    expect(
      await screen.findByRole("dialog", { name: "Solitaire" }),
    ).toBeInTheDocument();
  });

  it("lists every game's type, controls and licence in the Details view", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />);
    const folder = await openFolder(user);
    await user.click(within(folder).getByRole("menuitem", { name: "View" }));
    await user.click(
      within(folder).getByRole("menuitemcheckbox", { name: "Details" }),
    );
    const table = within(folder).getByRole("table", { name: "Licences" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(GAME_LIST.length);
    GAME_LIST.forEach((game, index) => {
      const row = rows[index];
      expect(row).toBeDefined();
      if (!row) return;
      expect(row).toHaveTextContent(game.name);
      expect(row).toHaveTextContent(RUNTIME_LABELS[game.runtime]);
      expect(row).toHaveTextContent(game.controls);
      expect(row).toHaveTextContent(game.licence);
    });
    const keen = rows[2];
    expect(keen).toBeDefined();
    if (!keen) return;
    await user.click(keen);
    expect(keen).toHaveAttribute("aria-selected", "true");
    expect(within(folder).getByLabelText("Status")).toHaveTextContent(
      "Commander Keen 1: Marooned on Mars:",
    );
    await user.dblClick(keen);
    expect(
      await screen.findByRole("dialog", {
        name: "Commander Keen 1: Marooned on Mars",
      }),
    ).toBeInTheDocument();
    await user.click(within(folder).getByRole("menuitem", { name: "View" }));
    await user.click(
      within(folder).getByRole("menuitemcheckbox", { name: "Large Icons" }),
    );
    expect(
      within(folder).getByRole("listbox", { name: "DOS games" }),
    ).toBeInTheDocument();
  });

  it("clears the selection when the empty folder background is clicked and closes from File > Close", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />);
    const folder = await openFolder(user);
    const duke = within(folder).getByRole("option", { name: "Duke Nukem 3D" });
    await user.click(duke);
    expect(duke).toHaveAttribute("aria-selected", "true");
    const list = within(folder).getByRole("listbox", { name: "DOS games" });
    const background = list.parentElement;
    expect(background).not.toBeNull();
    if (!background) return;
    await user.click(background);
    expect(duke).toHaveAttribute("aria-selected", "false");
    expect(within(folder).getByLabelText("Status")).toHaveTextContent(
      "8 object(s)",
    );
    await user.click(within(folder).getByRole("menuitem", { name: "File" }));
    expect(
      within(folder).getByRole("menuitemcheckbox", { name: "Open" }),
    ).toBeDisabled();
    await user.click(
      within(folder).getByRole("menuitemcheckbox", { name: "Close" }),
    );
    expect(screen.queryByRole("dialog", { name: "DOS Games" })).toBeNull();
  });

  it("is reused rather than duplicated and restores from saved state", async () => {
    const user = userEvent.setup();
    const state: AppState = {
      ...DEFAULT_STATE,
      windows: [
        { id: "w1", minimized: false, maximized: false, kind: "retroFolder" },
        { id: "w2", minimized: false, maximized: false, kind: "about" },
      ],
    };
    renderWithProviders(<Desktop />, { initialState: state });
    const folder = await screen.findByRole("dialog", { name: "DOS Games" });
    expect(folder).toHaveAttribute("data-active", "false");
    await openFolder(user);
    expect(screen.getAllByRole("dialog", { name: "DOS Games" })).toHaveLength(
      1,
    );
    expect(screen.getByRole("dialog", { name: "DOS Games" })).toHaveAttribute(
      "data-active",
      "true",
    );
  });
});
