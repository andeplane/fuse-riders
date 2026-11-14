import { act, render, screen } from "@testing-library/react";

import { createWrapper } from "./__mocks__/renderWithProviders";
import { App } from "./App";
import { MemoryStateStore } from "./state/stateStore";

describe(App.name, () => {
  it("boots: the boot screen for the hold, then the desktop with the deep link's window", async () => {
    vi.useFakeTimers();
    try {
      const { Wrapper } = createWrapper();
      render(
        <App
          store={new MemoryStateStore()}
          initialOpen={[{ kind: "fusegame", gameId: "fuseball" }]}
          bootHoldMs={100}
        />,
        { wrapper: Wrapper },
      );
      expect(
        screen.getByRole("main", { name: "Starting FuseOS" }),
      ).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(
        screen.queryByRole("main", { name: "Starting FuseOS" }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("dialog", { name: "Fuseball" }),
      ).toBeInTheDocument();
      expect(screen.getByTitle("Fuseball")).toHaveAttribute(
        "src",
        "/fuse-riders/fuseball/",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips the hold when it is zero", () => {
    const { Wrapper } = createWrapper();
    render(<App store={new MemoryStateStore()} bootHoldMs={0} />, {
      wrapper: Wrapper,
    });
    expect(
      screen.getByRole("toolbar", { name: "Taskbar" }),
    ).toBeInTheDocument();
  });
});
