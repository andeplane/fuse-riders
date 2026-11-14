import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../__mocks__/renderWithProviders";
import { Desktop } from "../desktop/Desktop";

import { RECYCLE_BIN_ITEMS } from "./recycleBinItems";
import { MemoryRecycleBinStore } from "./recycleBinStore";

function renderDesktop(store = new MemoryRecycleBinStore()) {
  const user = userEvent.setup();
  const result = renderWithProviders(<Desktop />, { recycleBinStore: store });
  // Once the window is open its taskbar button is also called "Recycle Bin"; the icon has its own list.
  const icon = () =>
    within(screen.getByRole("list", { name: "Recycle Bin icon" })).getByRole(
      "button",
      { name: "Recycle Bin" },
    );
  return { ...result, user, icon };
}

describe("RecycleBinDesktopIcon", () => {
  it("sits apart from the icon grid, full while the bin holds anything and empty once it does not", () => {
    const store = new MemoryRecycleBinStore();
    const { icon } = renderDesktop(store);
    expect(
      within(screen.getByRole("list", { name: "Desktop icons" })).queryByRole(
        "button",
        { name: "Recycle Bin" },
      ),
    ).toBeNull();
    expect(icon().querySelector("svg[data-icon='recycleFull']")).not.toBeNull();
    act(() =>
      store.set({
        version: 1,
        removed: RECYCLE_BIN_ITEMS.map((item) => item.id),
      }),
    );
    expect(icon().querySelector("svg[data-icon='recycle']")).not.toBeNull();
  });

  it("selects on click, opens the one Recycle Bin window on double click and focuses it afterwards", async () => {
    const { user, icon, store } = renderDesktop();
    await user.click(icon());
    expect(icon()).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Paint" }));
    expect(icon()).toHaveAttribute("aria-pressed", "false");

    await user.dblClick(icon());
    expect(
      await screen.findByRole("dialog", { name: "Recycle Bin" }),
    ).toBeInTheDocument();
    await user.dblClick(screen.getByRole("button", { name: "Paint" }));
    expect(store.load().windows.map((window) => window.kind)).toEqual([
      "recyclebin",
      "paint",
    ]);
    await user.dblClick(icon());
    expect(store.load().windows.map((window) => window.kind)).toEqual([
      "paint",
      "recyclebin",
    ]);
  });

  it("offers Open and Empty Recycle Bin on its context menu, with the confirmation box", async () => {
    const store = new MemoryRecycleBinStore();
    const { user, icon, sounds } = renderDesktop(store);
    await user.pointer({ keys: "[MouseRight]", target: icon() });
    const menu = await screen.findByRole("menu", { name: "Recycle Bin menu" });
    await user.click(
      within(menu).getByRole("menuitem", { name: "Empty Recycle Bin" }),
    );
    const confirm = screen.getByRole("dialog", {
      name: "Confirm Multiple File Delete",
    });
    expect(confirm).toHaveTextContent(
      `Are you sure you want to delete these ${RECYCLE_BIN_ITEMS.length} items?`,
    );
    await user.click(within(confirm).getByRole("button", { name: "No" }));
    expect(store.get().removed).toEqual([]);

    await user.pointer({ keys: "[MouseRight]", target: icon() });
    await user.click(
      within(
        await screen.findByRole("menu", { name: "Recycle Bin menu" }),
      ).getByRole("menuitem", { name: "Empty Recycle Bin" }),
    );
    await user.click(
      within(
        screen.getByRole("dialog", { name: "Confirm Multiple File Delete" }),
      ).getByRole("button", { name: "Yes" }),
    );
    expect(store.get().removed).toEqual(
      RECYCLE_BIN_ITEMS.map((item) => item.id),
    );
    // The paper crumples once, when the bin really empties.
    expect(
      sounds.plays.filter((play) => play.event === "recycle"),
    ).toHaveLength(1);
    expect(icon().querySelector("svg[data-icon='recycle']")).not.toBeNull();

    await user.pointer({ keys: "[MouseRight]", target: icon() });
    const emptied = await screen.findByRole("menu", {
      name: "Recycle Bin menu",
    });
    expect(
      within(emptied).getByRole("menuitem", { name: "Empty Recycle Bin" }),
    ).toBeDisabled();
    await user.click(within(emptied).getByRole("menuitem", { name: "Open" }));
    expect(
      await screen.findByRole("dialog", { name: "Recycle Bin" }),
    ).toHaveTextContent("The Recycle Bin is empty");
  });

  it("asks about a single file by name when only one is left", async () => {
    const store = new MemoryRecycleBinStore({
      version: 1,
      removed: RECYCLE_BIN_ITEMS.slice(1).map((item) => item.id),
    });
    const { user, icon } = renderDesktop(store);
    await user.pointer({ keys: "[MouseRight]", target: icon() });
    await user.click(
      within(
        await screen.findByRole("menu", { name: "Recycle Bin menu" }),
      ).getByRole("menuitem", { name: "Empty Recycle Bin" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Confirm File Delete" }),
    ).toHaveTextContent(
      `Are you sure you want to delete '${RECYCLE_BIN_ITEMS[0]?.name}'?`,
    );
  });
});
