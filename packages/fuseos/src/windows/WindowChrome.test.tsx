import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WindowChrome } from "./WindowChrome";

describe(WindowChrome.name, () => {
  it("renders the title and wires the controls", async () => {
    const onMinimize = vi.fn();
    const onToggleMaximize = vi.fn();
    const onClose = vi.fn();
    render(
      <WindowChrome
        title="My Computer"
        icon="computer"
        active
        maximized={false}
        onMinimize={onMinimize}
        onToggleMaximize={onToggleMaximize}
        onClose={onClose}
        onActivate={() => undefined}
      >
        <p>body</p>
      </WindowChrome>,
    );
    expect(
      screen.getByRole("dialog", { name: "My Computer" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("Minimize"));
    await userEvent.click(screen.getByLabelText("Maximize"));
    await userEvent.click(screen.getByLabelText("Close"));
    expect(onMinimize).toHaveBeenCalled();
    expect(onToggleMaximize).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    expect(screen.getByText("body")).toBeInTheDocument();
  });

  it("shows Restore when maximized and marks inactive windows", () => {
    render(
      <WindowChrome
        title="t"
        icon="folder"
        active={false}
        maximized
        onMinimize={() => undefined}
        onToggleMaximize={() => undefined}
        onClose={() => undefined}
        onActivate={() => undefined}
      >
        x
      </WindowChrome>,
    );
    expect(screen.getByLabelText("Restore")).toBeInTheDocument();
    expect(screen.getByRole("dialog").querySelector(".title-bar")).toHaveClass(
      "inactive",
    );
  });

  it("hides the maximize button for fixed size windows", () => {
    render(
      <WindowChrome
        title="t"
        icon="folder"
        active
        maximized={false}
        resizable={false}
        onMinimize={() => undefined}
        onToggleMaximize={() => undefined}
        onClose={() => undefined}
        onActivate={() => undefined}
      >
        x
      </WindowChrome>,
    );
    expect(screen.queryByLabelText("Maximize")).toBeNull();
  });
});

it("does not maximize a fixed-size utility by double-clicking its title", async () => {
  const maximize = vi.fn();
  render(
    <WindowChrome
      title="Fixed utility"
      icon="winamp"
      active
      maximized={false}
      resizable={false}
      onMinimize={() => undefined}
      onToggleMaximize={maximize}
      onClose={() => undefined}
      onActivate={() => undefined}
    >
      Body
    </WindowChrome>,
  );
  await userEvent.dblClick(screen.getByText("Fixed utility"));
  expect(maximize).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("button", { name: "Maximize" }),
  ).not.toBeInTheDocument();
});

it("draws extra title-bar buttons before the controls, and none by default", () => {
  const { rerender } = render(
    <WindowChrome
      title="t"
      icon="computer"
      active
      maximized={false}
      onMinimize={() => undefined}
      onToggleMaximize={() => undefined}
      onClose={() => undefined}
      onActivate={() => undefined}
      extraTitleButtons={<button type="button" aria-label="Extra" />}
    >
      <p>x</p>
    </WindowChrome>,
  );
  const labels = () =>
    screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"));
  expect(labels()).toEqual(["Extra", "Minimize", "Maximize", "Close"]);
  rerender(
    <WindowChrome
      title="t"
      icon="computer"
      active
      maximized={false}
      onMinimize={() => undefined}
      onToggleMaximize={() => undefined}
      onClose={() => undefined}
      onActivate={() => undefined}
    >
      <p>x</p>
    </WindowChrome>,
  );
  expect(labels()).toEqual(["Minimize", "Maximize", "Close"]);
});
