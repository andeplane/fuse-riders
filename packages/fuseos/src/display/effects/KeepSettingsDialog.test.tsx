import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { KeepSettingsDialog } from "./KeepSettingsDialog";

describe("KeepSettingsDialog", () => {
  it("names the new resolution and the seconds left, Yes focused", () => {
    render(
      <KeepSettingsDialog
        resolution="640x480"
        secondsLeft={15}
        onKeep={() => undefined}
        onRevert={() => undefined}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "Monitor Settings" });
    expect(dialog).toHaveTextContent("resized your desktop to 640 by 480");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Reverting in 15 seconds",
    );
    expect(screen.getByRole("button", { name: "Yes" })).toHaveFocus();
  });

  it("says 'second' for the last one", () => {
    render(
      <KeepSettingsDialog
        resolution="800x600"
        secondsLeft={1}
        onKeep={() => undefined}
        onRevert={() => undefined}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Reverting in 1 second",
    );
  });

  it("keeps on Yes, reverts on No and on Escape", async () => {
    const user = userEvent.setup();
    const onKeep = vi.fn();
    const onRevert = vi.fn();
    render(
      <KeepSettingsDialog
        resolution="1024x768"
        secondsLeft={9}
        onKeep={onKeep}
        onRevert={onRevert}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Yes" }));
    expect(onKeep).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "No" }));
    expect(onRevert).toHaveBeenCalledTimes(1);
    await user.keyboard("{Escape}");
    expect(onRevert).toHaveBeenCalledTimes(2);
  });
});
