import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ContextMenuItem } from "./ContextMenu";
import { ContextMenu } from "./ContextMenu";

describe(ContextMenu.name, () => {
  it("renders the items with the default one bold, separators and checks", () => {
    const items: ContextMenuItem[] = [
      { label: "Open", bold: true, onSelect: vi.fn() },
      { separator: true },
      { label: "Details", checked: true, onSelect: vi.fn() },
      { label: "Tree", checked: false, onSelect: vi.fn() },
      { label: "Delete", disabled: true },
    ];
    render(
      <ContextMenu
        label="Entry menu"
        position={{ x: 10, y: 20 }}
        items={items}
        onClose={vi.fn()}
      />,
    );
    const menu = screen.getByRole("menu", { name: "Entry menu" });
    expect(within(menu).getByRole("menuitem", { name: "Open" })).toHaveClass(
      "font-bold",
    );
    expect(within(menu).getByRole("separator")).toBeInTheDocument();
    expect(
      within(menu).getByRole("menuitemcheckbox", { name: "Details" }),
    ).toBeChecked();
    expect(
      within(menu).getByRole("menuitemcheckbox", { name: "Tree" }),
    ).not.toBeChecked();
    expect(
      within(menu).getByRole("menuitem", { name: "Delete" }),
    ).toBeDisabled();
    expect(menu).toHaveStyle({ left: "10px", top: "20px" });
    expect(within(menu).getByRole("menuitem", { name: "Open" })).toHaveFocus();
  });

  it("runs the item and closes when an item is chosen", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <ContextMenu
        label="Entry menu"
        position={{ x: 0, y: 0 }}
        items={[{ label: "Open", onSelect }]}
        onClose={onClose}
      />,
    );
    await user.click(screen.getByRole("menuitem", { name: "Open" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape and on a click outside, but not on a click inside", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <div>
        <p>outside</p>
        <ContextMenu
          label="Entry menu"
          position={{ x: 0, y: 0 }}
          items={[{ label: "Open" }, { separator: true }]}
          onClose={onClose}
        />
      </div>,
    );
    await user.click(screen.getByRole("separator"));
    expect(onClose).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.click(screen.getByText("outside"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("moves focus with the arrow keys, skipping disabled items and wrapping around", async () => {
    const user = userEvent.setup();
    const items: ContextMenuItem[] = [
      { label: "Open" },
      { label: "Gone", disabled: true },
      { label: "Properties" },
    ];
    render(
      <ContextMenu
        label="Entry menu"
        position={{ x: 0, y: 0 }}
        items={items}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("menuitem", { name: "Open" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Properties" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Open" })).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("menuitem", { name: "Properties" })).toHaveFocus();
  });

  it("keeps the menu inside the viewport", () => {
    render(
      <ContextMenu
        label="Entry menu"
        position={{ x: 5000, y: 5000 }}
        items={[{ label: "Open" }]}
        onClose={vi.fn()}
      />,
    );
    const menu = screen.getByRole("menu", { name: "Entry menu" });
    expect(menu).toHaveStyle({
      left: `${window.innerWidth}px`,
      top: `${window.innerHeight}px`,
    });
  });
});
