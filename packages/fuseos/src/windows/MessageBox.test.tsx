import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MessageBox } from "./MessageBox";

describe(MessageBox.name, () => {
  it("shows the message beside the icon and closes from OK", async () => {
    const onOk = vi.fn();
    render(<MessageBox message="Disk full." icon="warning" onOk={onOk} />);
    expect(screen.getByText("Disk full.")).toBeInTheDocument();
    const ok = screen.getByRole("button", { name: "OK" });
    expect(ok).toHaveFocus();
    await userEvent.click(ok);
    expect(onOk).toHaveBeenCalledTimes(1);
  });

  it("presses OK on Enter and Escape", async () => {
    const onOk = vi.fn();
    render(<MessageBox message="Hi" icon="info" onOk={onOk} />);
    await userEvent.keyboard("{Escape}");
    expect(onOk).toHaveBeenCalledTimes(1);
    await userEvent.keyboard("{Enter}");
    expect(onOk).toHaveBeenCalledTimes(2);
    await userEvent.keyboard("a");
    expect(onOk).toHaveBeenCalledTimes(2);
  });

  it("leaves the keys alone while another box has the keyboard", async () => {
    const onOk = vi.fn();
    render(<MessageBox message="Hi" icon="info" active={false} onOk={onOk} />);
    await userEvent.keyboard("{Escape}");
    expect(onOk).not.toHaveBeenCalled();
  });
});
