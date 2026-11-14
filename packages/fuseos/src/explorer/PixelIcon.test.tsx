import { render, screen } from "@testing-library/react";

import { PixelIcon, Throbber } from "./PixelIcon";
import { colourLayers, PIXEL_ICONS } from "./pixelIcons";

describe(PixelIcon.name, () => {
  it("draws the picture in its colours at 20px", () => {
    const { container } = render(<PixelIcon name="up" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("width", "20");
    expect(svg).toHaveAttribute("data-pixel-icon", "up");
    expect(svg).not.toHaveAttribute("data-disabled");
    expect(
      [...container.querySelectorAll("path")].map((path) =>
        path.getAttribute("fill"),
      ),
    ).toEqual(colourLayers(PIXEL_ICONS.up).map((layer) => layer.colour));
  });

  it("embosses a disabled picture: its ink in grey over a white shadow one pixel down and right", () => {
    const { container } = render(<PixelIcon name="cut" disabled />);
    const [shadow, ink] = [...container.querySelectorAll("path")];
    expect(container.querySelector("svg")).toHaveAttribute(
      "data-disabled",
      "true",
    );
    expect(shadow).toHaveAttribute("fill", "#ffffff");
    expect(shadow).toHaveAttribute("transform", "translate(1 1)");
    expect(ink).toHaveAttribute("fill", "#808080");
    expect(ink?.getAttribute("d")).toBe(shadow?.getAttribute("d"));
  });
});

describe(Throbber.name, () => {
  it("is still until Explorer is busy", () => {
    const { rerender } = render(<Throbber busy={false} />);
    const still = screen.getByRole("img", { name: "FuseOS" });
    expect(still).not.toHaveClass("busy");
    expect(still.querySelectorAll("rect")).toHaveLength(4);
    rerender(<Throbber busy />);
    expect(screen.getByRole("img", { name: "Working" })).toHaveClass("busy");
  });
});
