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
});
