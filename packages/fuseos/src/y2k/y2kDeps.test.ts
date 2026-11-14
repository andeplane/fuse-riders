import { MemoryY2kRunStore } from "./y2kRunStore";
import {
  createBrowserY2kDeps,
  defaultY2kDeps,
  parseY2kParam,
  Y2K_PARAM,
} from "./y2kDeps";

describe(parseY2kParam.name, () => {
  it("recognises only ?y2k=now", () => {
    expect(Y2K_PARAM).toBe("y2k");
    expect(parseY2kParam("?y2k=now")).toBe("now");
    expect(parseY2kParam("?mute&y2k=now&open=paint")).toBe("now");
    expect(parseY2kParam("?y2k=later")).toBeNull();
    expect(parseY2kParam("?y2k")).toBeNull();
    expect(parseY2kParam("")).toBeNull();
  });
});

describe(createBrowserY2kDeps.name, () => {
  it("plays on boot only with the hidden trigger in the address", () => {
    expect(createBrowserY2kDeps({ search: "?y2k=now" }).demoOnBoot).toBe(true);
    expect(createBrowserY2kDeps({ search: "?open=paint" }).demoOnBoot).toBe(
      false,
    );
    expect(defaultY2kDeps.demoOnBoot).toBe(false);
  });

  it("reads the wall clock and the browser's timers", () => {
    const deps = createBrowserY2kDeps();
    const before = Date.now();
    expect(deps.now()).toBeGreaterThanOrEqual(before);
    expect(deps.random()).toBeGreaterThanOrEqual(0);
    expect(deps.random()).toBeLessThan(1);
    const handle = deps.setTimeout(() => undefined, 60_000);
    expect(() => deps.clearTimeout(handle)).not.toThrow();
    expect(() => deps.notify("anything")).not.toThrow();
  });

  it("takes an injected calendar and store", () => {
    const store = new MemoryY2kRunStore("2000-01-01");
    const calendar = {
      dayKey: () => "fixed",
      startOfDay: () => 0,
      nextMidnight: () => 1,
    };
    const deps = createBrowserY2kDeps({ store, calendar });
    expect(deps.store).toBe(store);
    expect(deps.calendar).toBe(calendar);
  });

  it("treats only a fullscreen iframe as a fullscreen game and listens for fullscreenchange", () => {
    const deps = createBrowserY2kDeps();
    expect(deps.isGameFullscreen()).toBe(false);
    const onChange = vi.fn();
    const unsubscribe = deps.subscribeFullscreen(onChange);
    document.dispatchEvent(new Event("fullscreenchange"));
    expect(onChange).toHaveBeenCalledTimes(1);
    unsubscribe();
    document.dispatchEvent(new Event("fullscreenchange"));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("asks the browser whether the user prefers reduced motion", () => {
    expect(typeof createBrowserY2kDeps().prefersReducedMotion()).toBe(
      "boolean",
    );
  });
});
