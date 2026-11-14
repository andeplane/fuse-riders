import { render, screen } from "@testing-library/react";

import { RndWindowFrame } from "./RndWindowFrame";

const rect = { x: 10, y: 20, width: 300, height: 200 };

describe(RndWindowFrame.name, () => {
  it("renders a maximized frame as a plain full size box", () => {
    render(
      <RndWindowFrame
        id="w1"
        rect={rect}
        maximized
        active
        zIndex={5}
        onFocus={() => undefined}
        onRectChange={() => undefined}
      >
        <p>body</p>
      </RndWindowFrame>,
    );
    const frame = screen.getByText("body").closest('[data-window-id="w1"]');
    expect(frame).not.toBeNull();
    expect(frame).toHaveStyle({ zIndex: 5 });
  });

  it("renders a react-rnd frame when not maximized", () => {
    render(
      <RndWindowFrame
        id="w2"
        rect={rect}
        maximized={false}
        active
        zIndex={7}
        onFocus={() => undefined}
        onRectChange={() => undefined}
      >
        <p>body</p>
      </RndWindowFrame>,
    );
    expect(screen.getByText("body")).toBeInTheDocument();
    expect(document.querySelector('[data-window-id="w2"]')).not.toBeNull();
  });
});
