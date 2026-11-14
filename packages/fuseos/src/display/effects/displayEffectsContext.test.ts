import { renderHook } from "@testing-library/react";
import { useContext } from "react";

import { DisplayEffectsContext } from "./displayEffectsContext";
import { DEFAULT_DISPLAY_EFFECTS } from "./effectsStore";

describe("DisplayEffectsContext", () => {
  it("defaults to the plain monitor with setters that do nothing, outside the provider", () => {
    const { result } = renderHook(() => useContext(DisplayEffectsContext));
    const value = result.current;
    expect(value.effects).toBe(DEFAULT_DISPLAY_EFFECTS);
    expect(value.setCrt("scanlines")).toBeUndefined();
    expect(value.setCurvature(true)).toBeUndefined();
    expect(value.setScheme("rose")).toBeUndefined();
  });
});
