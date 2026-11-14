import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../__mocks__/renderWithProviders";

import { Desktop } from "./Desktop";

describe("useDesktopKeyboard", () => {
  it("ignores Escape alone when no menu is open, and a plain Escape with Ctrl does not open an icon", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu", { name: "Start menu" })).toBeNull();
    screen.getByRole("button", { name: "Paint" }).focus();
    await user.keyboard("{Control>}{Escape}{/Control}");
    expect(
      screen.getByRole("menu", { name: "Start menu" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes the Start menu with Escape wherever the focus is", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />);
    await user.click(screen.getByRole("button", { name: /Start/ }));
    screen.getByRole("button", { name: "Winamp" }).focus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu", { name: "Start menu" })).toBeNull();
  });

  it("opens the Run dialog on Win+R, once, and closes the Start menu for it", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />);
    await user.click(screen.getByRole("button", { name: /Start/ }));
    await user.keyboard("{Meta>}r{/Meta}");
    expect(screen.queryByRole("menu", { name: "Start menu" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Run" })).toBeInTheDocument();
    await user.keyboard("{Meta>}R{/Meta}");
    expect(screen.getAllByRole("dialog", { name: "Run" })).toHaveLength(1);
  });

  it("leaves Cmd+R to the browser on an Apple device, and Ctrl+R everywhere", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />, {
      desktopDeps: { isApplePlatform: () => true },
    });
    await user.keyboard("{Meta>}r{/Meta}");
    await user.keyboard("{Control>}r{/Control}");
    expect(screen.queryByRole("dialog", { name: "Run" })).toBeNull();
  });
});
