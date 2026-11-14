import { render, screen } from "@testing-library/react";

import { BootScreen } from "./BootScreens";

describe(BootScreen.name, () => {
  it("shows the FuseOS name over blue with a progress bar", () => {
    render(<BootScreen />);
    const main = screen.getByRole("main", { name: "Starting FuseOS" });
    expect(main).toHaveStyle({ backgroundColor: "#000080" });
    expect(screen.getByRole("heading", { name: "FuseOS" })).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", { name: "Loading" }),
    ).toBeInTheDocument();
  });
});
