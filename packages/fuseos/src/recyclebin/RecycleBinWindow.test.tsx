import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../__mocks__/renderWithProviders";
import { Desktop } from "../desktop/Desktop";

import { RECYCLE_BIN_ITEMS } from "./recycleBinItems";
import { MemoryRecycleBinStore, withoutItems } from "./recycleBinStore";
import { formatTotalSize } from "./useRecycleBinViewModel";

function renderBin(store = new MemoryRecycleBinStore()) {
  const user = userEvent.setup();
  const result = renderWithProviders(<Desktop />, {
    initialOpen: [{ kind: "recyclebin" }],
    recycleBinStore: store,
  });
  const window = screen.getByRole("dialog", { name: "Recycle Bin" });
  const table = () =>
    within(window).getByRole("table", { name: "Deleted files" });
  const rows = () => within(table()).getAllByRole("row").slice(1);
  const rowNames = () =>
    rows().map((row) => within(row).getAllByRole("cell")[0]?.textContent);
  const row = (name: string) =>
    rows().find((entry) => entry.textContent?.includes(name));
  const choose = async (menu: string, item: string) => {
    await user.click(within(window).getByRole("menuitem", { name: menu }));
    await user.click(
      within(window).getByRole("menuitemcheckbox", { name: item }),
    );
  };
  return { ...result, user, window, table, rows, rowNames, row, choose };
}

describe("RecycleBinWindow", () => {
  it("lists every joke file with its five Explorer columns, sorted by name", () => {
    const { rowNames, window, table } = renderBin();
    expect(
      within(table())
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["Name", "Original Location", "Date Deleted", "Type", "Size"]);
    expect(rowNames()).toHaveLength(RECYCLE_BIN_ITEMS.length);
    expect(rowNames()[0]).toBe("bug_free_code.exe");
    const debbie = within(window).getByRole("row", {
      name: /Debbie_Does_Netcode\.avi/,
    });
    expect(
      within(debbie)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual([
      "Debbie_Does_Netcode.avi",
      "C:\\Windows\\Temp\\definitely_not_videos",
      "11/13/1998 11:45 PM",
      "Video Clip",
      "713,728KB",
    ]);
    expect(within(window).getByText("13 object(s)")).toBeInTheDocument();
    expect(
      within(window).getByText(
        formatTotalSize(
          RECYCLE_BIN_ITEMS.reduce((sum, item) => sum + item.size, 0),
        ),
      ),
    ).toBeInTheDocument();
  });

  it("sorts by a column on click and flips on a second click", async () => {
    const { user, rowNames, table } = renderBin();
    await user.click(within(table()).getByRole("button", { name: "Size" }));
    expect(rowNames()[0]).toBe("bug_free_code.exe");
    expect(rowNames().at(-1)).toBe("Fuse_Volley_Beach_Edition_UNCUT.avi");
    expect(
      within(table()).getByRole("columnheader", { name: "Size" }),
    ).toHaveAttribute("aria-sort", "ascending");
    await user.click(within(table()).getByRole("button", { name: "Size" }));
    expect(rowNames()[0]).toBe("Fuse_Volley_Beach_Edition_UNCUT.avi");
    expect(
      within(table()).getByRole("columnheader", { name: "Size" }),
    ).toHaveAttribute("aria-sort", "descending");
    await user.click(within(table()).getByRole("button", { name: "Name" }));
    expect(rowNames()[0]).toBe("bug_free_code.exe");
  });

  it("selects on click, extends with Ctrl, and shows the selection in the status bar", async () => {
    const { user, row, window } = renderBin();
    const todo = row("TODO_before_launch.txt");
    const netcode = row("old_netcode_v1.ts");
    if (!todo || !netcode) throw new Error("rows missing");
    await user.click(todo);
    expect(todo).toHaveAttribute("aria-selected", "true");
    expect(
      within(window).getByText("1 object(s) selected"),
    ).toBeInTheDocument();
    expect(within(window).getByText("48.0MB")).toBeInTheDocument();

    await user.keyboard("{Control>}");
    await user.click(netcode);
    await user.keyboard("{/Control}");
    expect(todo).toHaveAttribute("aria-selected", "true");
    expect(netcode).toHaveAttribute("aria-selected", "true");
    expect(
      within(window).getByText("2 object(s) selected"),
    ).toBeInTheDocument();

    await user.click(netcode);
    expect(todo).toHaveAttribute("aria-selected", "false");
    expect(netcode).toHaveAttribute("aria-selected", "true");

    netcode.focus();
    await user.keyboard(" ");
    expect(netcode).toHaveAttribute("aria-selected", "false");
    expect(within(window).getByText("13 object(s)")).toBeInTheDocument();
  });

  it("restores the selected files without asking: they simply leave the bin, and stay gone", async () => {
    const store = new MemoryRecycleBinStore();
    const { user, row, rowNames, choose, window } = renderBin(store);
    await user.click(within(window).getByRole("menuitem", { name: "File" }));
    expect(
      within(window).getByRole("menuitemcheckbox", { name: "Restore" }),
    ).toBeDisabled();
    await user.keyboard("{Escape}");

    const todo = row("TODO_before_launch.txt");
    if (!todo) throw new Error("row missing");
    await user.click(todo);
    await choose("File", "Restore");
    expect(rowNames()).not.toContain("TODO_before_launch.txt");
    expect(rowNames()).toHaveLength(RECYCLE_BIN_ITEMS.length - 1);
    expect(store.get().removed).toEqual(["todo"]);
    expect(screen.queryByRole("dialog", { name: /Confirm/ })).toBeNull();
  });

  it("deletes one selected file after 'Confirm File Delete', and No keeps it", async () => {
    const store = new MemoryRecycleBinStore();
    const { user, row, rowNames, choose } = renderBin(store);
    const exe = row("bug_free_code.exe");
    if (!exe) throw new Error("row missing");
    await user.click(exe);
    await choose("File", "Delete");
    const confirm = screen.getByRole("dialog", { name: "Confirm File Delete" });
    expect(confirm).toHaveTextContent(
      "Are you sure you want to delete 'bug_free_code.exe'?",
    );
    await user.click(within(confirm).getByRole("button", { name: "No" }));
    expect(
      screen.queryByRole("dialog", { name: "Confirm File Delete" }),
    ).toBeNull();
    expect(rowNames()).toContain("bug_free_code.exe");

    await choose("File", "Delete");
    await user.click(
      within(
        screen.getByRole("dialog", { name: "Confirm File Delete" }),
      ).getByRole("button", { name: "Yes" }),
    );
    expect(rowNames()).not.toContain("bug_free_code.exe");
    expect(store.get().removed).toEqual(["bug-free"]);
  });

  it("empties the bin after the classic 'Are you sure you want to delete these N items?'", async () => {
    const store = new MemoryRecycleBinStore();
    const { user, choose, window, rows } = renderBin(store);
    await choose("File", "Empty Recycle Bin");
    const confirm = screen.getByRole("dialog", {
      name: "Confirm Multiple File Delete",
    });
    expect(confirm).toHaveTextContent(
      `Are you sure you want to delete these ${RECYCLE_BIN_ITEMS.length} items?`,
    );
    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("dialog", { name: "Confirm Multiple File Delete" }),
    ).toBeNull();
    expect(rows()).toHaveLength(RECYCLE_BIN_ITEMS.length);

    await choose("File", "Empty Recycle Bin");
    await user.click(
      within(
        screen.getByRole("dialog", { name: "Confirm Multiple File Delete" }),
      ).getByRole("button", { name: "Yes" }),
    );
    expect(rows()).toHaveLength(0);
    expect(within(window).getByText("0 object(s)")).toBeInTheDocument();
    expect(
      within(window).getByText(/The Recycle Bin is empty/),
    ).toBeInTheDocument();
    expect(store.get().removed).toEqual(
      RECYCLE_BIN_ITEMS.map((item) => item.id),
    );

    await user.click(within(window).getByRole("menuitem", { name: "File" }));
    expect(
      within(window).getByRole("menuitemcheckbox", {
        name: "Empty Recycle Bin",
      }),
    ).toBeDisabled();
  });

  it("selects all with Ctrl+A or Edit > Select All, and inverts the selection", async () => {
    const { user, choose, rows, window, table } = renderBin(
      new MemoryRecycleBinStore(
        withoutItems({ version: 1, removed: [] }, ["todo"]),
      ),
    );
    await choose("Edit", "Select All");
    expect(
      rows().every((row) => row.getAttribute("aria-selected") === "true"),
    ).toBe(true);
    expect(
      within(window).getByText(
        `${RECYCLE_BIN_ITEMS.length - 1} object(s) selected`,
      ),
    ).toBeInTheDocument();
    await choose("Edit", "Invert Selection");
    expect(
      rows().every((row) => row.getAttribute("aria-selected") === "false"),
    ).toBe(true);

    const first = rows()[0];
    if (!first) throw new Error("row missing");
    await user.click(first);
    await user.keyboard("{Control>}a{/Control}");
    expect(
      rows().every((row) => row.getAttribute("aria-selected") === "true"),
    ).toBe(true);
    expect(table()).toBeInTheDocument();
  });

  it("cannot open an ordinary deleted file, and says so", async () => {
    const { user, row } = renderBin();
    const zip = row("LAN_server_RIP.zip");
    if (!zip) throw new Error("row missing");
    await user.dblClick(zip);
    const box = await screen.findByRole("dialog", { name: "Cannot open file" });
    expect(box).toHaveTextContent(
      "Cannot open 'LAN_server_RIP.zip': the file is in the Recycle Bin.",
    );
    expect(box.querySelector("svg[data-icon='warning']")).not.toBeNull();
  });

  it("opens a video in the media player, with Enter as well as a double click", async () => {
    const { user, row, store } = renderBin();
    const debbie = row("Debbie_Does_Netcode.avi");
    if (!debbie) throw new Error("row missing");
    await user.dblClick(debbie);
    expect(
      await screen.findByRole("dialog", {
        name: "Debbie_Does_Netcode.avi - Windows Media Player",
      }),
    ).toBeInTheDocument();
    expect(store.load().windows.at(-1)).toMatchObject({
      kind: "mediaplayer",
      file: "Debbie_Does_Netcode.avi",
    });

    const volley = row("Fuse_Volley_Beach_Edition_UNCUT.avi");
    if (!volley) throw new Error("row missing");
    volley.focus();
    await user.keyboard("{Enter}");
    expect(store.load().windows.at(-1)).toMatchObject({
      kind: "mediaplayer",
      file: "Fuse_Volley_Beach_Edition_UNCUT.avi",
      launches: "fuse-volley",
    });
  });

  it("closes from the File menu", async () => {
    const { choose, store } = renderBin();
    await choose("File", "Close");
    expect(screen.queryByRole("dialog", { name: "Recycle Bin" })).toBeNull();
    expect(store.load().windows).toEqual([]);
  });
});

describe(formatTotalSize.name, () => {
  it("picks the unit by magnitude", () => {
    expect(formatTotalSize(0)).toBe("0 bytes");
    expect(formatTotalSize(512)).toBe("512 bytes");
    expect(formatTotalSize(1536)).toBe("1.5KB");
    expect(formatTotalSize(48 * 1024 * 1024)).toBe("48.0MB");
    expect(formatTotalSize(1.5 * 1024 * 1024 * 1024)).toBe("1.50GB");
  });
});
