import { render, screen } from "@testing-library/react";

import { BOOT_SKY, BootScreen } from "./BootScreens";

describe(BootScreen.name, () => {
  it("shows the Windows 98 style FuseOS splash with a progress bar", () => {
    render(<BootScreen />);
    const main = screen.getByRole("main", { name: "Starting FuseOS" });
    expect(main).toHaveStyle({ backgroundColor: BOOT_SKY });
    const splash = screen.getByRole("img", { name: "FuseOS" });
    expect(splash.getAttribute("src")).toMatch(/boot-splash/);
    expect(
      screen.getByRole("progressbar", { name: "Loading" }),
    ).toBeInTheDocument();
  });
});
