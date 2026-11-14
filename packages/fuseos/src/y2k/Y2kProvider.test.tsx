import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useContext } from "react";

import { renderWithProviders } from "../__mocks__/renderWithProviders";
import { Clock } from "../desktop/Clock";
import { Desktop } from "../desktop/Desktop";

import { Y2kContext } from "./y2kContext";
import { Y2kDepsContext } from "./y2kDeps";
import type { TestY2kDeps, TestY2kOptions } from "./y2kFakes";
import { createTestY2kDeps } from "./y2kFakes";
import { Y2kGlitchOverlay } from "./Y2kGlitchOverlay";
import { Y2kProvider } from "./Y2kProvider";
import {
  COUNTDOWN_MS,
  GLITCH_MS,
  ROLLOVER_MS,
  ROLLOVER_TEXT,
  STILL_GARBLE_TEXT,
  TOTAL_MS,
  Y2K_CLIPPY_LINE,
  Y2K_WARNING_TITLE,
} from "./y2kSequence";

const HOUR = 3_600_000;

/** Moves the fake clock and lets the one pending tick (or the midnight alarm) fire at the new time. */
function jump(deps: TestY2kDeps, ms: number): void {
  act(() => {
    deps.timers.sleep(ms);
    deps.timers.advance(0);
  });
}

function TriggerButton() {
  const { trigger, phase } = useContext(Y2kContext);
  return (
    <button type="button" onClick={trigger} data-phase={phase ?? "idle"}>
      Trigger Y2K
    </button>
  );
}

function renderHarness(options: TestY2kOptions = {}) {
  const deps = createTestY2kDeps(options);
  const result = renderWithProviders(
    <Y2kDepsContext.Provider value={deps}>
      <Y2kProvider>
        <Clock />
        <Y2kGlitchOverlay />
        <TriggerButton />
      </Y2kProvider>
    </Y2kDepsContext.Provider>,
  );
  return { ...result, deps };
}

function clockText(): string {
  return screen.getByRole("time").textContent ?? "";
}

describe(Y2kProvider.name, () => {
  it("keeps the real time and arms the clock for ten seconds before local midnight", () => {
    const { deps } = renderHarness();
    expect(clockText()).toMatch(/\d{1,2}:\d{2} [AP]M$/);
    expect(screen.getByRole("time")).not.toHaveAttribute("data-clock-override");
    expect(screen.queryByTestId("y2k-glitch")).toBeNull();
    expect(deps.timers.scheduled).toEqual([
      Date.UTC(1999, 11, 31, 23) - COUNTDOWN_MS,
    ]);
  });

  it("plays the whole sequence: countdown, 1900, a garbled glitch, the compliance warning and Clippy's line, then real time", async () => {
    const user = userEvent.setup();
    const { deps } = renderHarness({ random: () => 0.9 });
    await user.click(screen.getByRole("button", { name: "Trigger Y2K" }));
    expect(clockText()).toBe("11:59:50 PM 12/31/1999");
    expect(screen.getByRole("time")).toHaveClass("y2k-clock");

    jump(deps, 5_000);
    expect(clockText()).toBe("11:59:55 PM 12/31/1999");
    expect(screen.getByRole("button", { name: "Trigger Y2K" })).toHaveAttribute(
      "data-phase",
      "countdown",
    );

    jump(deps, COUNTDOWN_MS - 5_000);
    expect(clockText()).toBe(ROLLOVER_TEXT);
    expect(screen.queryByTestId("y2k-glitch")).toBeNull();

    jump(deps, ROLLOVER_MS);
    expect(screen.getByTestId("y2k-glitch")).toBeInTheDocument();
    expect(screen.getByRole("time")).toHaveClass("y2k-clock-garbled");
    expect(clockText()).not.toMatch(/[0-9]/);
    expect(clockText()).toHaveLength(ROLLOVER_TEXT.length);
    expect(screen.queryByText(Y2K_WARNING_TITLE)).toBeNull();

    jump(deps, GLITCH_MS);
    expect(screen.queryByTestId("y2k-glitch")).toBeNull();
    expect(clockText()).toBe(ROLLOVER_TEXT);
    expect(screen.getByRole("time")).not.toHaveClass("y2k-clock-garbled");
    expect(deps.notices).toEqual([Y2K_CLIPPY_LINE]);

    // The warning stays through the aftermath but is opened once.
    jump(deps, 1_000);
    jump(deps, 1_000);
    expect(deps.notices).toHaveLength(1);

    jump(deps, TOTAL_MS);
    expect(screen.getByRole("time")).not.toHaveAttribute("data-clock-override");
    expect(clockText()).toMatch(/\d{1,2}:\d{2} [AP]M$/);
    expect(screen.getByRole("button", { name: "Trigger Y2K" })).toHaveAttribute(
      "data-phase",
      "idle",
    );
    // A demo run is not the day's run: the bug still strikes at midnight.
    expect(deps.store.lastRun()).toBeNull();
    expect(deps.timers.scheduled).toEqual([
      Date.UTC(1999, 11, 31, 23) - COUNTDOWN_MS,
    ]);
  });

  it("opens the Year 2000 compliance warning as a message box on the desktop", () => {
    const deps = createTestY2kDeps({ demoOnBoot: true });
    renderWithProviders(
      <Y2kDepsContext.Provider value={deps}>
        <Desktop />
      </Y2kDepsContext.Provider>,
    );
    expect(screen.getByRole("toolbar", { name: "Taskbar" })).toHaveTextContent(
      "11:59:50 PM 12/31/1999",
    );
    jump(deps, COUNTDOWN_MS + ROLLOVER_MS);
    expect(screen.getByTestId("y2k-glitch")).toBeInTheDocument();
    jump(deps, GLITCH_MS);
    // The title shows twice: on the window and on its taskbar button.
    expect(screen.getAllByText(Y2K_WARNING_TITLE)).toHaveLength(2);
    expect(screen.getByText(/rolled over to 01\/01\/1900/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "OK" })).toBeInTheDocument();
    expect(deps.notices).toEqual([Y2K_CLIPPY_LINE]);
    jump(deps, TOTAL_MS);
    // The box is a window of its own and stays until OK; the clock is back.
    expect(screen.getAllByText(Y2K_WARNING_TITLE)).toHaveLength(2);
    expect(screen.getByRole("toolbar", { name: "Taskbar" })).toHaveTextContent(
      /\d{1,2}:\d{2} [AP]M/,
    );
  });

  it("under reduced motion never flickers and holds one still garbled frame", async () => {
    const user = userEvent.setup();
    const { deps } = renderHarness({ reducedMotion: true, random: () => 0.9 });
    await user.click(screen.getByRole("button", { name: "Trigger Y2K" }));
    jump(deps, COUNTDOWN_MS + ROLLOVER_MS);
    expect(screen.queryByTestId("y2k-glitch")).toBeNull();
    expect(clockText()).toBe(STILL_GARBLE_TEXT);
    expect(screen.getByRole("time")).not.toHaveClass("y2k-clock-garbled");
    jump(deps, GLITCH_MS);
    expect(deps.notices).toEqual([Y2K_CLIPPY_LINE]);
  });

  it("strikes at local midnight on its own, records the day, and arms the next one afterwards", () => {
    const { deps } = renderHarness();
    jump(deps, 11 * HOUR - COUNTDOWN_MS);
    expect(clockText()).toBe("11:59:50 PM 12/31/1999");
    expect(deps.store.lastRun()).toBe("2000-01-01");
    jump(deps, TOTAL_MS);
    expect(screen.getByRole("time")).not.toHaveAttribute("data-clock-override");
    expect(deps.timers.scheduled).toEqual([
      Date.UTC(2000, 0, 1, 23) - COUNTDOWN_MS,
    ]);
  });

  it("holds off while a game is fullscreen and strikes when the player leaves it", () => {
    const { deps } = renderHarness();
    deps.fullscreen.set(true);
    jump(deps, 11 * HOUR);
    expect(screen.getByRole("time")).not.toHaveAttribute("data-clock-override");
    act(() => deps.fullscreen.set(false));
    expect(clockText()).toBe("11:59:50 PM 12/31/1999");
  });

  it("stops its timers on unmount", () => {
    const { deps, unmount } = renderHarness({ demoOnBoot: true });
    expect(deps.timers.scheduled).toHaveLength(1);
    unmount();
    expect(deps.timers.scheduled).toEqual([]);
  });
});
