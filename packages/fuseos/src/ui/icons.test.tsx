import { render } from "@testing-library/react";

import { Win98Icon } from "./icons";

describe(Win98Icon.name, () => {
  it("renders an svg with the requested size", () => {
    const { container } = render(<Win98Icon name="computer" size={32} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("width")).toBe("32");
    expect(svg?.getAttribute("data-icon")).toBe("computer");
  });

  it("defaults to 16px", () => {
    const { container } = render(<Win98Icon name="folder" />);
    expect(container.querySelector("svg")?.getAttribute("width")).toBe("16");
  });

  it("renders a distinct icon for audio files, at both sizes", () => {
    const small = render(
      <Win98Icon name="audio" size={16} />,
    ).container.querySelector("svg");
    const large = render(
      <Win98Icon name="audio" size={32} />,
    ).container.querySelector("svg");
    expect(small?.getAttribute("data-icon")).toBe("audio");
    expect(small?.getAttribute("width")).toBe("16");
    expect(large?.getAttribute("width")).toBe("32");
  });

  it("renders a non-empty wallpaper icon at both sizes", () => {
    // Some @react95/icons ship an empty SVG (e.g. Joy108); guard against picking one of those.
    for (const size of [16, 32] as const) {
      const svg = render(
        <Win98Icon name="wallpaper" size={size} />,
      ).container.querySelector("svg");
      expect(svg?.children.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("draws the Winamp bolt as an inline svg", () => {
    const { container } = render(<Win98Icon name="winamp" size={32} />);
    expect(container.querySelector("svg")?.getAttribute("data-icon")).toBe(
      "winamp",
    );
  });
});
