import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import {
  createTestGames,
  renderWithProviders,
} from "../__mocks__/renderWithProviders";
import { Desktop } from "../desktop/Desktop";
import { FuseGamesContext } from "../fusegames/registry";

import { useBsod } from "./bsodContext";
import { BsodProvider } from "./BsodProvider";

/** Raises the screen and counts the times it has been dismissed since, as a caller waiting on it sees them. */
function RunBsod() {
  const { showBsod } = useBsod();
  const [dismissed, setDismissed] = useState(0);
  return (
    <>
      <button
        type="button"
        onClick={() =>
          void showBsod().then(() => setDismissed((count) => count + 1))
        }
      >
        Run bsod
      </button>
      <output aria-label="Dismissed">{dismissed}</output>
    </>
  );
}

/** The provider on its own, over the fixture games, with a fixed "random" pick. */
function renderBsod(
  random: () => number = () => 0,
  onDocumentKey?: () => void,
) {
  if (onDocumentKey) document.addEventListener("keydown", onDocumentKey);
  const view = render(
    <FuseGamesContext.Provider value={createTestGames()}>
      <BsodProvider random={random}>
        <RunBsod />
        <input aria-label="Somewhere to type" />
      </BsodProvider>
    </FuseGamesContext.Provider>,
  );
  return {
    ...view,
    cleanup: () => {
      if (onDocumentKey) document.removeEventListener("keydown", onDocumentKey);
    },
  };
}

const bsod = () => screen.queryByRole("alertdialog");

describe("BsodProvider", () => {
  it("shows nothing until asked", () => {
    renderBsod();
    expect(bsod()).toBeNull();
  });

  it("raises the blue screen on Ctrl+Alt+Delete, blaming a Fuse game", async () => {
    const user = userEvent.setup();
    renderBsod(() => 0);
    await user.keyboard("{Control>}{Alt>}{Delete}{/Alt}{/Control}");
    const screenEl = screen.getByRole("alertdialog", {
      name: "Windows fatal exception",
    });
    expect(screenEl).toHaveTextContent(
      "A fatal exception 0E has occurred at 0028:C0011E36 in VXD FUSE(01) + 00010E36, called from FUSEBALL.EXE.",
    );
    expect(screenEl).toHaveTextContent("Press any key to continue _");
    expect(screen.getByText("Windows")).toHaveClass("bsod__title");
  });

  it("raises it on Ctrl+Alt+Backspace too, with the game the random source picks", async () => {
    const user = userEvent.setup();
    renderBsod(() => 0.5);
    await user.keyboard("{Control>}{Alt>}{Backspace}{/Alt}{/Control}");
    expect(bsod()).toHaveTextContent("called from FUSERI~1.EXE");
  });

  it("does not react to Delete without both modifiers", async () => {
    const user = userEvent.setup();
    renderBsod();
    await user.keyboard("{Delete}{Control>}{Delete}{/Control}");
    await user.keyboard("{Alt>}{Backspace}{/Alt}");
    expect(bsod()).toBeNull();
  });

  it("is raised by showBsod() from the context, and keeps its culprit when raised again", async () => {
    const user = userEvent.setup();
    const picks = [0, 0.99];
    renderBsod(() => picks.shift() ?? 0);
    await user.click(screen.getByRole("button", { name: "Run bsod" }));
    expect(bsod()).toHaveTextContent("FUSEBALL.EXE");
    // The button sits under the screen; a programmatic second call must not reshuffle.
    fireEvent.click(screen.getByRole("button", { name: "Run bsod" }));
    expect(bsod()).toHaveTextContent("FUSEBALL.EXE");
  });

  it("takes the focus while up and hands it back afterwards", async () => {
    const user = userEvent.setup();
    renderBsod();
    const input = screen.getByRole("textbox", { name: "Somewhere to type" });
    input.focus();
    await user.keyboard("{Control>}{Alt>}{Delete}{/Alt}{/Control}");
    expect(bsod()).toHaveFocus();
    await user.keyboard("x");
    expect(bsod()).toBeNull();
    expect(input).toHaveFocus();
    // The dismissing key went nowhere else.
    expect(input).toHaveValue("");
  });

  it("returns on any key, without the key reaching the desktop's own handlers", async () => {
    const user = userEvent.setup();
    const onDocumentKey = vi.fn();
    const view = renderBsod(() => 0, onDocumentKey);
    await user.click(screen.getByRole("button", { name: "Run bsod" }));
    onDocumentKey.mockClear();
    await user.keyboard("{Escape}");
    expect(bsod()).toBeNull();
    expect(onDocumentKey).not.toHaveBeenCalled();
    view.cleanup();
  });

  it("stays up for a lone modifier or the chord still repeating", async () => {
    renderBsod();
    fireEvent.keyDown(document.body, {
      key: "Delete",
      ctrlKey: true,
      altKey: true,
    });
    expect(bsod()).not.toBeNull();
    fireEvent.keyDown(document.body, {
      key: "Delete",
      ctrlKey: true,
      altKey: true,
      repeat: true,
    });
    fireEvent.keyDown(document.body, { key: "Control", ctrlKey: true });
    fireEvent.keyDown(document.body, { key: "Shift" });
    expect(bsod()).not.toBeNull();
    fireEvent.keyDown(document.body, { key: " " });
    expect(bsod()).toBeNull();
  });

  it("returns on a click", async () => {
    const user = userEvent.setup();
    renderBsod();
    await user.click(screen.getByRole("button", { name: "Run bsod" }));
    await user.click(screen.getByRole("alertdialog"));
    expect(bsod()).toBeNull();
  });

  it("tells whoever raised it when it has gone, every caller of the same screen at once", async () => {
    const user = userEvent.setup();
    renderBsod();
    const dismissed = () => screen.getByLabelText("Dismissed").textContent;
    const run = screen.getByRole("button", { name: "Run bsod" });
    // Twice, as a click would: the screen is up once and both callers wait on it.
    fireEvent.click(run);
    fireEvent.click(run);
    expect(bsod()).not.toBeNull();
    expect(dismissed()).toBe("0");
    await user.keyboard("x");
    expect(bsod()).toBeNull();
    await screen.findByText("2");
    expect(dismissed()).toBe("2");
  });

  it("can be raised again after returning", async () => {
    const user = userEvent.setup();
    const picks = [0, 0.99];
    renderBsod(() => picks.shift() ?? 0);
    await user.keyboard("{Control>}{Alt>}{Delete}{/Alt}{/Control}");
    await user.keyboard("{Enter}");
    await user.keyboard("{Control>}{Alt>}{Delete}{/Alt}{/Control}");
    expect(bsod()).toHaveTextContent("FUSEBI~1.EXE");
  });

  it("blames Explorer when there are no games", async () => {
    const user = userEvent.setup();
    render(
      <BsodProvider>
        <RunBsod />
      </BsodProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Run bsod" }));
    expect(bsod()).toHaveTextContent("called from EXPLORER.EXE");
  });
});

describe("useBsod outside a provider", () => {
  it("does nothing", async () => {
    const user = userEvent.setup();
    render(<RunBsod />);
    await user.click(screen.getByRole("button", { name: "Run bsod" }));
    expect(bsod()).toBeNull();
  });
});

describe("the desktop", () => {
  it("blue-screens on Ctrl+Alt+Delete and comes back with the Start menu still closed", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />);
    await user.keyboard("{Control>}{Alt>}{Delete}{/Alt}{/Control}");
    expect(bsod()).toHaveTextContent("VXD FUSE(01)");
    // Ctrl+Esc would open the Start menu on the desktop; under the blue screen it only dismisses.
    await user.keyboard("{Control>}{Escape}{/Control}");
    expect(bsod()).toBeNull();
    expect(screen.queryByRole("menu", { name: "Start menu" })).toBeNull();
    expect(screen.getByRole("button", { name: /Start/ })).toBeInTheDocument();
  });
});
