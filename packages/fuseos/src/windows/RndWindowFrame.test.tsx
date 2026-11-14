import { render, screen } from "@testing-library/react";

import { RndWindowFrame } from "./RndWindowFrame";

const rect = { x: 10, y: 20, width: 300, height: 200 };

describe(RndWindowFrame.name, () => {
  it("renders a maximized frame", () => {
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

  it("keeps what is inside mounted when the window is maximized and restored", () => {
    // A game is an iframe: one that is unmounted loads again from the game's menu, out of the room it had joined.
    const frame = (maximized: boolean) => (
      <RndWindowFrame
        id="w3"
        rect={rect}
        maximized={maximized}
        active
        zIndex={5}
        onFocus={() => undefined}
        onRectChange={() => undefined}
      >
        <iframe title="game" src="about:blank" />
      </RndWindowFrame>
    );
    const { rerender } = render(frame(false));
    const game = screen.getByTitle("game");
    rerender(frame(true));
    expect(screen.getByTitle("game")).toBe(game);
    expect(document.querySelector('[data-window-id="w3"]')).toHaveStyle({
      width: "100%",
      height: "100%",
    });
    rerender(frame(false));
    expect(screen.getByTitle("game")).toBe(game);
    expect(document.querySelector('[data-window-id="w3"]')).toHaveStyle({
      width: "300px",
      height: "200px",
    });
  });
});
