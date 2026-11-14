import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WINZIP_FAKE_ENTRIES } from "../disk/floppy";

import { WinZipDialog } from "./WinZipDialog";

describe(WinZipDialog.name, () => {
  it("creeps up the bar, names files from 1997 and fails at 87%", async () => {
    vi.useFakeTimers();
    try {
      const onFail = vi.fn();
      const onCancel = vi.fn();
      render(<WinZipDialog stepMs={10} onFail={onFail} onCancel={onCancel} />);
      const bar = screen.getByRole("progressbar", { name: "Extracting" });
      expect(bar).toHaveAttribute("aria-valuenow", "0");
      expect(screen.getByText("0 of 10 files")).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10 * 15);
      });
      expect(bar).toHaveAttribute("aria-valuenow", "50");
      expect(
        screen.getByText(WINZIP_FAKE_ENTRIES[5] ?? ""),
      ).toBeInTheDocument();
      expect(onFail).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10 * 20);
      });
      expect(onFail).toHaveBeenCalledTimes(1);
      expect(Number(bar.getAttribute("aria-valuenow"))).toBeGreaterThanOrEqual(
        87,
      );
      expect(onCancel).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops when cancelled", async () => {
    const user = userEvent.setup();
    const onFail = vi.fn();
    const onCancel = vi.fn();
    render(
      <WinZipDialog stepMs={10_000} onFail={onFail} onCancel={onCancel} />,
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onFail).not.toHaveBeenCalled();
  });
});
