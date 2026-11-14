import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../__mocks__/renderWithProviders";
import { Desktop } from "../desktop/Desktop";

import { NetworkWindow } from "./NetworkWindow";
import { NETWORK_WINDOW_ID } from "./openNetworkNeighborhood";
import { MemoryRecentRoomsStore } from "./recentRooms";
import { MemoryRoomDirectory, NO_ROOM_LISTING_REASON } from "./roomDirectory";
import type { RoomLauncher } from "./roomLauncher";
import { INVALID_CODE_MESSAGE } from "./useNetworkViewModel";

const NOW = Date.UTC(1998, 5, 25, 12, 34);

function recordingLauncher(): RoomLauncher & { joined: string[] } {
  const joined: string[] = [];
  return {
    joined,
    join: ({ gameId, code }) => {
      joined.push(`${gameId}:${code}`);
      return gameId === "pong"
        ? { ok: false, reason: "unknown-game" }
        : { ok: true, launch: "window" };
    },
  };
}

function items() {
  return within(screen.getByRole("listbox", { name: "Network items" }));
}

function address(): string {
  return screen.getByRole<HTMLInputElement>("textbox", { name: "Address" })
    .value;
}

describe(NetworkWindow.name, () => {
  it("starts at the neighborhood with Entire Network and the recent rooms as neighbours", () => {
    const recentRooms = new MemoryRecentRoomsStore();
    recentRooms.record({ gameId: "fuseball", code: "AB42" }, NOW - 60_000);
    recentRooms.record({ gameId: "fuse-riders", code: "CD07" }, NOW);
    renderWithProviders(<NetworkWindow windowId="w1" />, { recentRooms });
    expect(address()).toBe("Network Neighborhood");
    expect(
      items()
        .getAllByRole("option")
        .map((option) => option.getAttribute("aria-label")),
    ).toEqual([
      "Entire Network",
      "Fuse Riders room CD07",
      "Fuseball room AB42",
    ]);
    expect(screen.getByRole("status")).toHaveTextContent("3 object(s)");
    expect(screen.getByRole("button", { name: "Up one level" })).toBeDisabled();
  });

  it("browses Entire Network into a game's workgroup and back up, with the tree following", async () => {
    const user = userEvent.setup();
    renderWithProviders(<NetworkWindow windowId="w1" />);
    await user.dblClick(
      items().getByRole("option", { name: "Entire Network" }),
    );
    expect(address()).toBe("Network Neighborhood\\Entire Network");
    expect(
      items()
        .getAllByRole("option")
        .map((option) => option.getAttribute("aria-label")),
    ).toEqual(["Fuseball", "Fuse Riders", "Fuse Birds"]);
    await user.dblClick(items().getByRole("option", { name: "Fuseball" }));
    expect(address()).toBe("Network Neighborhood\\Entire Network\\Fuseball");
    const tree = within(screen.getByRole("list", { name: "Network tree" }));
    expect(tree.getByRole("link", { name: "Fuseball" })).toHaveAttribute(
      "aria-current",
      "location",
    );
    expect(items().getByRole("option", { name: "Join room..." })).toBeVisible();
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        NO_ROOM_LISTING_REASON,
      ),
    );
    await user.click(screen.getByRole("button", { name: "Up one level" }));
    expect(address()).toBe("Network Neighborhood\\Entire Network");
    await user.click(tree.getByRole("link", { name: "Network Neighborhood" }));
    expect(address()).toBe("Network Neighborhood");
  });

  it("joins a recent room on double click and the selected one on Enter", async () => {
    const user = userEvent.setup();
    const recentRooms = new MemoryRecentRoomsStore();
    recentRooms.record({ gameId: "fuseball", code: "AB42" }, NOW);
    const launcher = recordingLauncher();
    renderWithProviders(<NetworkWindow windowId="w1" />, {
      recentRooms,
      roomLauncher: launcher,
    });
    await user.dblClick(
      items().getByRole("option", { name: "Fuseball room AB42" }),
    );
    expect(launcher.joined).toEqual(["fuseball:AB42"]);
    await user.click(
      items().getByRole("option", { name: "Fuseball room AB42" }),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Recent room");
    await user.keyboard("{Enter}");
    expect(launcher.joined).toEqual(["fuseball:AB42", "fuseball:AB42"]);
  });

  it("opens, forgets and switches views from the menus", async () => {
    const user = userEvent.setup();
    const recentRooms = new MemoryRecentRoomsStore();
    recentRooms.record({ gameId: "fuseball", code: "AB42" }, NOW);
    const launcher = recordingLauncher();
    renderWithProviders(<NetworkWindow windowId="w1" />, {
      recentRooms,
      roomLauncher: launcher,
    });
    await user.click(screen.getByRole("menuitem", { name: "File" }));
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Open" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Forget room" }),
    ).toBeDisabled();
    await user.keyboard("{Escape}");
    await user.click(
      items().getByRole("option", { name: "Fuseball room AB42" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "File" }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Open" }));
    expect(launcher.joined).toEqual(["fuseball:AB42"]);
    await user.click(screen.getByRole("menuitem", { name: "File" }));
    await user.click(
      screen.getByRole("menuitemcheckbox", { name: "Join room..." }),
    );
    expect(screen.getByRole("dialog", { name: "Join room" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(
      items().getByRole("option", { name: "Fuseball room AB42" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "File" }));
    await user.click(
      screen.getByRole("menuitemcheckbox", { name: "Forget room" }),
    );
    expect(recentRooms.list()).toEqual([]);
    await user.click(screen.getByRole("menuitem", { name: "View" }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Details" }));
    await user.click(screen.getByRole("menuitem", { name: "View" }));
    await user.click(
      screen.getByRole("menuitemcheckbox", { name: "Large Icons" }),
    );
    expect(
      screen.getByRole("listbox", { name: "Network items" }),
    ).toBeVisible();
  });

  it("forgets a recent room with Delete and all of them from the File menu", async () => {
    const user = userEvent.setup();
    const recentRooms = new MemoryRecentRoomsStore();
    recentRooms.record({ gameId: "fuseball", code: "AB42" }, NOW);
    recentRooms.record({ gameId: "fuseball", code: "CD07" }, NOW);
    renderWithProviders(<NetworkWindow windowId="w1" />, { recentRooms });
    await user.click(
      items().getByRole("option", { name: "Fuseball room AB42" }),
    );
    await user.keyboard("{Delete}");
    expect(recentRooms.list().map((room) => room.code)).toEqual(["CD07"]);
    await user.click(screen.getByRole("menuitem", { name: "File" }));
    await user.click(
      screen.getByRole("menuitemcheckbox", { name: "Forget all recent rooms" }),
    );
    expect(recentRooms.list()).toEqual([]);
    expect(items().queryByRole("option", { name: /room/ })).toBeNull();
  });

  it("joins a room by code from the dialog, upper-casing the code and refusing a bad one", async () => {
    const user = userEvent.setup();
    const launcher = recordingLauncher();
    renderWithProviders(<NetworkWindow windowId="w1" />, {
      roomLauncher: launcher,
    });
    await user.click(screen.getByRole("button", { name: "Join room..." }));
    const dialog = within(screen.getByRole("dialog", { name: "Join room" }));
    await user.selectOptions(
      dialog.getByRole("combobox", { name: "Game" }),
      "Fuse Riders",
    );
    await user.type(dialog.getByRole("textbox", { name: "Room code" }), "ab4");
    await user.click(dialog.getByRole("button", { name: "Join" }));
    expect(dialog.getByRole("alert")).toHaveTextContent(INVALID_CODE_MESSAGE);
    expect(launcher.joined).toEqual([]);
    await user.type(dialog.getByRole("textbox", { name: "Room code" }), "2");
    expect(dialog.queryByRole("alert")).toBeNull();
    await user.keyboard("{Enter}");
    expect(launcher.joined).toEqual(["fuse-riders:AB42"]);
    expect(screen.queryByRole("dialog", { name: "Join room" })).toBeNull();
  });

  it("preselects the workgroup's game, caps the code at four characters and can be cancelled", async () => {
    const user = userEvent.setup();
    const launcher = recordingLauncher();
    renderWithProviders(<NetworkWindow windowId="w1" />, {
      roomLauncher: launcher,
    });
    await user.dblClick(
      items().getByRole("option", { name: "Entire Network" }),
    );
    await user.dblClick(items().getByRole("option", { name: "Fuse Birds" }));
    await user.dblClick(items().getByRole("option", { name: "Join room..." }));
    const dialog = within(screen.getByRole("dialog", { name: "Join room" }));
    expect(dialog.getByRole("combobox", { name: "Game" })).toHaveValue(
      "fuse-birds",
    );
    await user.type(
      dialog.getByRole("textbox", { name: "Room code" }),
      "xy99zz",
    );
    expect(dialog.getByRole("textbox", { name: "Room code" })).toHaveValue(
      "XY99",
    );
    await user.click(dialog.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Join room" })).toBeNull();
    expect(launcher.joined).toEqual([]);
  });

  it("keeps the dialog open with the launcher's reason when the game cannot be launched", async () => {
    const user = userEvent.setup();
    const launcher = recordingLauncher();
    renderWithProviders(<NetworkWindow windowId="w1" />, {
      roomLauncher: launcher,
      games: [
        {
          id: "pong",
          name: "Pong",
          tagline: "",
          mark: "P",
          accent: "#000000",
          order: 1,
          path: "pong/",
        },
      ],
    });
    await user.click(screen.getByRole("button", { name: "Join room..." }));
    const dialog = within(screen.getByRole("dialog", { name: "Join room" }));
    await user.type(dialog.getByRole("textbox", { name: "Room code" }), "AB42");
    await user.click(dialog.getByRole("button", { name: "Join" }));
    expect(dialog.getByRole("alert")).toHaveTextContent(
      'The game "pong" is not installed',
    );
  });

  it("lists the rooms a directory knows, after the recent ones, and refreshes on request", async () => {
    const user = userEvent.setup();
    const recentRooms = new MemoryRecentRoomsStore();
    recentRooms.record({ gameId: "fuseball", code: "AB42" }, NOW);
    const directory = new MemoryRoomDirectory({
      fuseball: {
        kind: "rooms",
        rooms: [
          { gameId: "fuseball", code: "AB42", members: 3 },
          { gameId: "fuseball", code: "EF11", members: 2 },
          { gameId: "fuseball", code: "GH22" },
        ],
      },
    });
    const launcher = recordingLauncher();
    renderWithProviders(<NetworkWindow windowId="w1" />, {
      recentRooms,
      roomDirectory: directory,
      roomLauncher: launcher,
    });
    await user.dblClick(
      items().getByRole("option", { name: "Entire Network" }),
    );
    await user.dblClick(items().getByRole("option", { name: "Fuseball" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("3 open room(s)"),
    );
    expect(
      items()
        .getAllByRole("option")
        .map((option) => option.getAttribute("aria-label")),
    ).toEqual(["Join room...", "Room AB42", "Room EF11", "Room GH22"]);
    expect(items().getByRole("option", { name: "Room EF11" })).toHaveAttribute(
      "title",
      "Open room, 2 playing",
    );
    expect(items().getByRole("option", { name: "Room GH22" })).toHaveAttribute(
      "title",
      "Open room",
    );
    await user.dblClick(items().getByRole("option", { name: "Room EF11" }));
    expect(launcher.joined).toEqual(["fuseball:EF11"]);
    await user.click(screen.getByRole("menuitem", { name: "View" }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Refresh" }));
    await waitFor(() =>
      expect(directory.calls).toEqual(["fuseball", "fuseball"]),
    );
  });

  it("shows a directory failure in the status bar and still offers Join room", async () => {
    const user = userEvent.setup();
    renderWithProviders(<NetworkWindow windowId="w1" />, {
      roomDirectory: { listRooms: () => Promise.reject(new Error("offline")) },
    });
    await user.dblClick(
      items().getByRole("option", { name: "Entire Network" }),
    );
    await user.dblClick(items().getByRole("option", { name: "Fuseball" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Could not list rooms: offline",
      ),
    );
    expect(items().getByRole("option", { name: "Join room..." })).toBeVisible();
  });

  it("switches to Details with the last-played column", async () => {
    const user = userEvent.setup();
    const recentRooms = new MemoryRecentRoomsStore();
    recentRooms.record({ gameId: "fuseball", code: "AB42" }, NOW - 60_000);
    const launcher = recordingLauncher();
    renderWithProviders(<NetworkWindow windowId="w1" />, {
      recentRooms,
      roomLauncher: launcher,
    });
    await user.click(screen.getByRole("menuitem", { name: "View" }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Details" }));
    const table = within(screen.getByRole("table", { name: "Network items" }));
    const row = table.getByRole("row", { name: "Fuseball room AB42" });
    expect(row).toHaveTextContent("Recent room");
    expect(row).toHaveTextContent(/Today \d\d:\d\d/);
    await user.click(row);
    expect(row).toHaveAttribute("aria-selected", "true");
    await user.dblClick(row);
    expect(launcher.joined).toEqual(["fuseball:AB42"]);
  });

  it("explains itself from Help and closes from File", async () => {
    const user = userEvent.setup();
    const { store } = renderWithProviders(<Desktop />, {
      initialState: {
        version: 1,
        windows: [
          {
            id: NETWORK_WINDOW_ID,
            kind: "network",
            minimized: false,
            maximized: false,
          },
        ],
      },
    });
    await user.click(screen.getByRole("menuitem", { name: "Help" }));
    await user.click(
      screen.getByRole("menuitemcheckbox", {
        name: "About Network Neighborhood",
      }),
    );
    expect(
      await screen.findByRole("dialog", { name: "About Network Neighborhood" }),
    ).toHaveTextContent("remembered in this browser only");
    await user.click(screen.getByRole("menuitem", { name: "File" }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Close" }));
    expect(
      store.load().windows.find((window) => window.id === NETWORK_WINDOW_ID),
    ).toBeUndefined();
  });

  it("refuses to open the dialog with no games installed", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />, {
      games: [],
      initialState: {
        version: 1,
        windows: [
          {
            id: NETWORK_WINDOW_ID,
            kind: "network",
            minimized: false,
            maximized: false,
          },
        ],
      },
    });
    await user.click(screen.getByRole("button", { name: "Join room..." }));
    const dialogs = await screen.findAllByRole("dialog", {
      name: "Network Neighborhood",
    });
    expect(dialogs).toHaveLength(2);
    expect(dialogs[1]).toHaveTextContent("No Fuse games are installed");
  });
});

describe("Network Neighborhood on the desktop", () => {
  it("opens once from its desktop icon and once from Start > Programs, then a room window from it", async () => {
    const user = userEvent.setup();
    const { store } = renderWithProviders(<Desktop />);
    const icon = screen.getByRole("button", { name: "Network Neighborhood" });
    await user.dblClick(icon);
    expect(
      await screen.findByRole("dialog", { name: "Network Neighborhood" }),
    ).toBeInTheDocument();
    await user.dblClick(icon);
    expect(
      screen.getAllByRole("dialog", { name: "Network Neighborhood" }),
    ).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Start" }));
    await user.click(screen.getByRole("menuitem", { name: "Programs" }));
    await user.click(
      screen.getByRole("menuitem", { name: "Network Neighborhood" }),
    );
    expect(
      screen.getAllByRole("dialog", { name: "Network Neighborhood" }),
    ).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Join room..." }));
    const dialog = within(screen.getByRole("dialog", { name: "Join room" }));
    await user.type(dialog.getByRole("textbox", { name: "Room code" }), "AB42");
    await user.click(dialog.getByRole("button", { name: "Join" }));
    expect(
      await screen.findByRole("dialog", { name: "Fuseball - Room AB42" }),
    ).toBeInTheDocument();
    expect(screen.getByTitle("Fuseball room AB42")).toHaveAttribute(
      "src",
      "/fuse-riders/fuseball/?room=AB42",
    );
    expect(
      store.load().windows.map((window) => [window.kind, window.id]),
    ).toEqual([
      ["network", NETWORK_WINDOW_ID],
      ["roomgame", "w1"],
    ]);
  });
});
