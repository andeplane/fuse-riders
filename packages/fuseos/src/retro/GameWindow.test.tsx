import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../__mocks__/renderWithProviders";
import { Desktop } from "../desktop/Desktop";
import type { AppState } from "../state/appState";
import { DEFAULT_STATE } from "../state/appState";
import { GAME_IFRAME_ALLOW } from "../windows/IframeGame";

import { GAME_LIST } from "./games";

async function openGame(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
) {
  await user.click(screen.getByRole("button", { name: /Start/ }));
  const menu = screen.getByRole("menu", { name: "Start menu" });
  await user.click(within(menu).getByRole("menuitem", { name: "Programs" }));
  await user.click(within(menu).getByRole("menuitem", { name: "Games" }));
  await user.click(within(menu).getByRole("menuitem", { name: "Retro Games" }));
  await user.click(within(menu).getByRole("menuitem", { name }));
}

describe("Programs > Games", () => {
  it("lists the eight retro games in the Start menu under Games", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />);
    await user.click(screen.getByRole("button", { name: /Start/ }));
    const menu = screen.getByRole("menu", { name: "Start menu" });
    await user.click(within(menu).getByRole("menuitem", { name: "Programs" }));
    await user.click(within(menu).getByRole("menuitem", { name: "Games" }));
    await user.click(
      within(menu).getByRole("menuitem", { name: "Retro Games" }),
    );
    const lists = within(menu).getAllByRole("menu");
    const lastList = lists[lists.length - 1];
    expect(lastList).toBeDefined();
    if (lastList === undefined) return;
    const games = within(lastList)
      .getAllByRole("menuitem")
      .map((item) => item.textContent);
    expect(games).toEqual([
      "Open Retro Games folder",
      ...GAME_LIST.map((game) => game.name),
    ]);
  });

  it("brings an open game to the front instead of opening it twice", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />);
    await openGame(user, "DOOM");
    await openGame(user, "SkiFree");
    expect(screen.getByRole("dialog", { name: "DOOM" })).toHaveAttribute(
      "data-active",
      "false",
    );
    await openGame(user, "DOOM");
    expect(screen.getAllByRole("dialog", { name: "DOOM" })).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "DOOM" })).toHaveAttribute(
      "data-active",
      "true",
    );
  });

  it("opens DOOM in a resizable window that boots the self-hosted DOS player straight away", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />);
    await openGame(user, "DOOM");
    const dialog = await screen.findByRole("dialog", { name: "DOOM" });
    const frame = within(dialog).getByTitle("DOOM");
    expect(frame).toHaveAttribute(
      "src",
      "https://fuseos.test/fuse-riders/fuseos/jsdos/player.html?bundle=doom",
    );
    expect(frame).toHaveAttribute("allow", GAME_IFRAME_ALLOW);
    expect(frame).toHaveAttribute("allowfullscreen");
    expect(within(dialog).getByLabelText("Maximize")).toBeInTheDocument();
    expect(
      within(screen.getByRole("toolbar", { name: "Taskbar" })).getByRole(
        "button",
        { name: /DOOM/ },
      ),
    ).toBeInTheDocument();
  });

  it("opens SkiFree and Micropolis from their vendored pages on our own origin", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />);
    await openGame(user, "SkiFree");
    expect(
      within(await screen.findByRole("dialog", { name: "SkiFree" })).getByTitle(
        "SkiFree",
      ),
    ).toHaveAttribute(
      "src",
      "https://fuseos.test/fuse-riders/fuseos/retro/skifree/index.html",
    );
    await openGame(user, "Micropolis");
    const micropolis = await screen.findByRole("dialog", {
      name: "Micropolis",
    });
    expect(within(micropolis).getByTitle("Micropolis")).toHaveAttribute(
      "src",
      "https://fuseos.test/fuse-riders/fuseos/retro/micropolis/index.html",
    );
    // micropolisJS shows a "screen too small" page under 583px, so its window opens taller than the default.
    expect(micropolis.closest("[data-window-id]")).toHaveStyle({
      width: "1120px",
      height: "720px",
    });
  });

  it("opens Minesweeper natively and plays it", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />);
    await openGame(user, "Minesweeper");
    const dialog = await screen.findByRole("dialog", { name: "Minesweeper" });
    expect(
      within(dialog).getByRole("grid", { name: "Minefield" }),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Mines left")).toHaveTextContent(
      "010",
    );
  });

  it("opens Solitaire natively with a dealt table and its score", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />);
    await openGame(user, "Solitaire");
    const dialog = await screen.findByRole("dialog", { name: "Solitaire" });
    expect(
      within(dialog).getByRole("group", { name: "Table" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Stock, 24 cards" }),
    ).toBeInTheDocument();
    expect(
      within(
        within(dialog).getByRole("group", { name: "Column 7" }),
      ).getAllByRole("img"),
    ).toHaveLength(7);
    expect(within(dialog).getByLabelText("Score")).toHaveTextContent("0");
    expect(dialog.closest("[data-window-id]")).toHaveStyle({
      width: "640px",
      height: "480px",
    });
  });

  it("shields an inactive game so the first click brings its window to the front", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />);
    await openGame(user, "DOOM");
    await openGame(user, "SkiFree");
    const doom = screen.getByRole("dialog", { name: "DOOM" });
    expect(doom).toHaveAttribute("data-active", "false");
    const shield = within(doom).getByRole("button", { name: "Activate DOOM" });
    await user.pointer({ keys: "[MouseLeft>]", target: shield });
    expect(screen.getByRole("dialog", { name: "DOOM" })).toHaveAttribute(
      "data-active",
      "true",
    );
    expect(
      within(screen.getByRole("dialog", { name: "DOOM" })).queryByRole(
        "button",
        { name: "Activate DOOM" },
      ),
    ).toBeNull();
  });

  it("restores game windows from a shared link", async () => {
    const state: AppState = {
      ...DEFAULT_STATE,
      windows: [
        {
          id: "w1",
          minimized: false,
          maximized: false,
          kind: "retro",
          game: "wolf3d",
        },
      ],
    };
    renderWithProviders(<Desktop />, { initialState: state });
    const dialog = await screen.findByRole("dialog", {
      name: "Wolfenstein 3D",
    });
    expect(within(dialog).getByTitle("Wolfenstein 3D")).toHaveAttribute(
      "src",
      "https://fuseos.test/fuse-riders/fuseos/jsdos/player.html?bundle=wolf3d",
    );
  });
});

it("fits Minesweeper to its board and grows for Expert without a giant empty beginner window", async () => {
  const user = userEvent.setup();
  renderWithProviders(<Desktop />);
  await openGame(user, "Minesweeper");
  const dialog = await screen.findByRole("dialog", { name: "Minesweeper" });
  const frame = dialog.closest("[data-window-id]");
  expect(frame).toHaveStyle({ width: "240px", height: "280px" });
  await user.click(within(dialog).getByRole("menuitem", { name: "Game" }));
  await user.click(
    within(dialog).getByRole("menuitemradio", { name: /Expert/ }),
  );
  expect(frame).toHaveStyle({ width: "524px", height: "392px" });
});
