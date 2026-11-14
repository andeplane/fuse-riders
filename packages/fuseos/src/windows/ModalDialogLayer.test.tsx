import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  FLASH_INTERVAL_MS,
  FLASH_TOGGLES,
  ModalDialogLayer,
} from "./ModalDialogLayer";

function renderLayer(props: { active?: boolean; onClose?: () => void } = {}) {
  const onDesktopMouseDown = vi.fn();
  const onClose = props.onClose ?? vi.fn();
  const view = render(
    <div onMouseDown={onDesktopMouseDown}>
      <ModalDialogLayer
        title="Oops"
        icon="warning"
        zIndex={60}
        active={props.active ?? true}
        onClose={onClose}
      >
        <p>body</p>
      </ModalDialogLayer>
    </div>,
  );
  const layer = view.container.querySelector("[data-modal-layer]");
  if (!(layer instanceof HTMLElement)) throw new Error("no modal layer");
  return { layer, onClose, onDesktopMouseDown };
}

const titleBar = () => screen.getByRole("dialog").querySelector("header");

describe(ModalDialogLayer.name, () => {
  afterEach(() => vi.useRealTimers());

  it("has only a Close button in the title bar and closes from it", async () => {
    const { onClose } = renderLayer();
    expect(screen.queryByLabelText("Minimize")).toBeNull();
    expect(screen.queryByLabelText("Maximize")).toBeNull();
    await userEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("flashes the title bar when the user clicks outside the box, and swallows the click", () => {
    vi.useFakeTimers();
    const { layer, onDesktopMouseDown } = renderLayer();
    expect(titleBar()).not.toHaveClass("inactive");
    fireEvent.mouseDown(layer);
    expect(onDesktopMouseDown).not.toHaveBeenCalled();
    expect(titleBar()).toHaveClass("inactive");
    act(() => {
      vi.advanceTimersByTime(FLASH_INTERVAL_MS);
    });
    expect(titleBar()).not.toHaveClass("inactive");
    // Each tick schedules the next after a render, so the flash runs out one interval at a time.
    for (let tick = 1; tick < FLASH_TOGGLES; tick += 1) {
      act(() => {
        vi.advanceTimersByTime(FLASH_INTERVAL_MS);
      });
    }
    expect(titleBar()).not.toHaveClass("inactive");
  });

  it("does not flash for a click inside the box", () => {
    renderLayer();
    fireEvent.mouseDown(screen.getByText("body"));
    expect(titleBar()).not.toHaveClass("inactive");
  });

  it("draws an inactive title bar when another box is on top", () => {
    renderLayer({ active: false });
    expect(titleBar()).toHaveClass("inactive");
  });
});
