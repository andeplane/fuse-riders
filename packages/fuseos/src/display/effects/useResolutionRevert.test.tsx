import { act, renderHook } from "@testing-library/react";
import { useState } from "react";

import type { DesktopArea } from "../../desktop/displayModes";

import { createManualTimers } from "./effectsDeps";
import { KEEP_SETTINGS_SECONDS } from "./resolutionEmulation";
import { useResolutionRevert } from "./useResolutionRevert";

/** The hook over a resolution it can set itself, the way the provider wires it to the display preferences. */
function useHarness(timers: ReturnType<typeof createManualTimers>) {
  const [area, setArea] = useState<DesktopArea>("current");
  const revert = useResolutionRevert(area, setArea, timers);
  return { area, setArea, revert };
}

describe("useResolutionRevert", () => {
  it("does nothing on mount and starts the countdown on the first change", () => {
    const timers = createManualTimers();
    const { result } = renderHook(() => useHarness(timers));
    expect(result.current.revert.pending).toBeNull();
    expect(timers.pending()).toBe(0);
    act(() => result.current.setArea("640x480"));
    expect(result.current.area).toBe("640x480");
    expect(result.current.revert.pending).toEqual({
      previous: "current",
      secondsLeft: KEEP_SETTINGS_SECONDS,
    });
  });

  it("counts down once a second and puts the old resolution back at zero", () => {
    const timers = createManualTimers();
    const { result } = renderHook(() => useHarness(timers));
    act(() => result.current.setArea("800x600"));
    act(() => timers.advance(1000));
    expect(result.current.revert.pending?.secondsLeft).toBe(
      KEEP_SETTINGS_SECONDS - 1,
    );
    act(() => timers.advance((KEEP_SETTINGS_SECONDS - 2) * 1000));
    expect(result.current.revert.pending?.secondsLeft).toBe(1);
    expect(result.current.area).toBe("800x600");
    act(() => timers.advance(1000));
    expect(result.current.revert.pending).toBeNull();
    expect(result.current.area).toBe("current");
    // The revert itself is not a change to ask about.
    expect(timers.pending()).toBe(0);
  });

  it("keeps the new resolution on keep and cancels the clock", () => {
    const timers = createManualTimers();
    const { result } = renderHook(() => useHarness(timers));
    act(() => result.current.setArea("1024x768"));
    act(() => result.current.revert.keep());
    expect(result.current.revert.pending).toBeNull();
    expect(timers.pending()).toBe(0);
    act(() => timers.advance(60_000));
    expect(result.current.area).toBe("1024x768");
  });

  it("reverts to the resolution before the first change when several are tried", () => {
    const timers = createManualTimers();
    const { result } = renderHook(() => useHarness(timers));
    act(() => result.current.setArea("640x480"));
    act(() => timers.advance(5000));
    act(() => result.current.setArea("800x600"));
    expect(result.current.revert.pending).toEqual({
      previous: "current",
      secondsLeft: KEEP_SETTINGS_SECONDS,
    });
    act(() => result.current.revert.revert());
    expect(result.current.area).toBe("current");
    expect(result.current.revert.pending).toBeNull();
  });

  it("asks again after a revert, for the next change", () => {
    const timers = createManualTimers();
    const { result } = renderHook(() => useHarness(timers));
    act(() => result.current.setArea("640x480"));
    act(() => result.current.revert.revert());
    expect(result.current.area).toBe("current");
    act(() => result.current.setArea("800x600"));
    expect(result.current.revert.pending?.previous).toBe("current");
  });

  it("only closes the box when the user already went back by hand", () => {
    const timers = createManualTimers();
    const { result } = renderHook(() => useHarness(timers));
    act(() => result.current.setArea("640x480"));
    act(() => result.current.setArea("current"));
    expect(result.current.revert.pending?.previous).toBe("current");
    act(() => result.current.revert.revert());
    expect(result.current.revert.pending).toBeNull();
    expect(result.current.area).toBe("current");
    act(() => result.current.setArea("800x600"));
    expect(result.current.revert.pending?.previous).toBe("current");
  });

  it("ignores revert when nothing is pending", () => {
    const timers = createManualTimers();
    const { result } = renderHook(() => useHarness(timers));
    act(() => result.current.revert.revert());
    expect(result.current.area).toBe("current");
    expect(result.current.revert.pending).toBeNull();
  });
});
