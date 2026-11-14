import { render, screen } from "@testing-library/react";

import { BootScreen } from "./BootScreens";

describe(BootScreen.name, () => {
  it("shows the FuseOS splash, a status line and the scrolling progress bar", () => {
    render(<BootScreen />);
    const main = screen.getByRole("main", { name: "Starting FuseOS" });
    expect(main).toHaveClass("fuseos-boot");
    expect(main).toHaveAttribute("aria-live", "polite");
    expect(screen.getByRole("img", { name: "FuseOS" })).toHaveAttribute(
      "data-splash",
      "fuseos",
    );
    expect(screen.getByText("Starting FuseOS...")).toBeInTheDocument();
    const bar = screen.getByRole("progressbar", { name: "Loading" });
    expect(bar.querySelector(".fuseos-boot-band")).not.toBeNull();
  });

  it("names FuseOS and nothing else: no Windows wordmark, no other brand", () => {
    const { container } = render(<BootScreen />);
    expect(container.textContent).toMatch(/FuseOS/);
    expect(container.textContent).not.toMatch(/Windows|Microsoft/);
  });
});
