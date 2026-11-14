import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Splitter } from "./Splitter";

function renderSplitter(value = 200) {
  const changes: number[] = [];
  render(
    <Splitter
      label="Folders width"
      value={value}
      min={100}
      max={400}
      onChange={(next) => changes.push(next)}
    />,
  );
  return { separator: screen.getByRole("separator"), changes };
}

describe(Splitter.name, () => {
  it("is a vertical separator with its value range for assistive tech", () => {
    const { separator } = renderSplitter();
    expect(separator).toHaveAttribute("aria-label", "Folders width");
    expect(separator).toHaveAttribute("aria-orientation", "vertical");
    expect(separator).toHaveAttribute("aria-valuenow", "200");
    expect(separator).toHaveAttribute("aria-valuemin", "100");
    expect(separator).toHaveAttribute("aria-valuemax", "400");
  });

  it("drags the pane edge with the pointer, clamped to the range, and ignores moves without a press", () => {
    const { separator, changes } = renderSplitter();
    fireEvent.pointerMove(separator, { clientX: 500, pointerId: 1 });
    expect(changes).toEqual([]);

    fireEvent.pointerDown(separator, { clientX: 300, pointerId: 1 });
    fireEvent.pointerMove(separator, { clientX: 340, pointerId: 1 });
    fireEvent.pointerMove(separator, { clientX: 900, pointerId: 1 });
    fireEvent.pointerMove(separator, { clientX: -900, pointerId: 1 });
    expect(changes).toEqual([240, 400, 100]);

    fireEvent.pointerUp(separator, { clientX: 340, pointerId: 1 });
    fireEvent.pointerMove(separator, { clientX: 360, pointerId: 1 });
    expect(changes).toEqual([240, 400, 100]);

    fireEvent.pointerDown(separator, { clientX: 0, pointerId: 2 });
    fireEvent.pointerCancel(separator, { clientX: 0, pointerId: 2 });
    fireEvent.pointerMove(separator, { clientX: 50, pointerId: 2 });
    expect(changes).toEqual([240, 400, 100]);
  });

  it("moves 16px per arrow key, clamped, and leaves other keys alone", async () => {
    const user = userEvent.setup();
    const { separator, changes } = renderSplitter(390);
    separator.focus();
    await user.keyboard("{ArrowRight}{ArrowLeft}{Enter}");
    expect(changes).toEqual([400, 374]);
  });
});
