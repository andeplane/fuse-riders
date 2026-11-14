import { render, screen } from "@testing-library/react";

import { PerformanceGraph } from "./PerformanceGraph";

describe(PerformanceGraph.name, () => {
  it("draws the grid without a trace until there are two samples", () => {
    render(
      <PerformanceGraph label="Desktop" values={[60]} capacity={4} max={120} />,
    );
    const graph = screen.getByRole("img", { name: "Desktop" });
    expect(graph.querySelectorAll("line").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("trace")).toBeNull();
  });

  it("puts the newest sample at the right edge, scales to max and clips values above it", () => {
    render(
      <PerformanceGraph
        label="Heap"
        values={[0, 60, 240]}
        capacity={4}
        max={120}
        height={64}
      />,
    );
    const points = screen.getByTestId("trace").getAttribute("points");
    // Four columns over 240 units: the three samples fill columns 2 to 4.
    expect(points).toBe("60.0,63.0 120.0,32.0 180.0,1.0");
  });

  it("survives a zero max (an empty heap) and a zero capacity", () => {
    render(
      <PerformanceGraph label="Empty" values={[0, 1]} capacity={0} max={0} />,
    );
    expect(screen.getByTestId("trace")).toHaveAttribute(
      "points",
      "-240.0,63.0 0.0,1.0",
    );
  });
});
