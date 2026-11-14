import { act, renderHook } from "@testing-library/react";

import { useBootHold } from "./useBootHold";

describe(useBootHold.name, () => {
  it("holds until the injected timer fires", () => {
    let fire: (() => void) | undefined;
    const deps = {
      setTimeout: vi.fn((callback: () => void) => {
        fire = callback;
        return globalThis.setTimeout(() => undefined, 0);
      }),
      clearTimeout: vi.fn(),
    };
    const { result, unmount } = renderHook(() => useBootHold(1500, deps));
    expect(result.current).toBe(true);
    expect(deps.setTimeout).toHaveBeenCalledWith(expect.any(Function), 1500);
    act(() => fire?.());
    expect(result.current).toBe(false);
    unmount();
    expect(deps.clearTimeout).toHaveBeenCalled();
  });

  it("does not hold when the minimum is zero", () => {
    const { result } = renderHook(() => useBootHold(0));
    expect(result.current).toBe(false);
  });
});
