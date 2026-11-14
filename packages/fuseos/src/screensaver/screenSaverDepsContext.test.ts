import { defaultScreenSaverDeps } from "./screenSaverDepsContext";

describe("default screen saver deps", () => {
  it("reports every kind of input as activity and stops reporting after unsubscribing", () => {
    const seen: string[] = [];
    const unsubscribe = defaultScreenSaverDeps.subscribeActivity((event) => {
      seen.push(event.type);
    });
    for (const type of [
      "pointermove",
      "pointerdown",
      "keydown",
      "wheel",
      "touchstart",
      "visibilitychange",
      "click",
    ])
      document.dispatchEvent(new Event(type, { bubbles: true }));
    expect(seen).toEqual([
      "pointermove",
      "pointerdown",
      "keydown",
      "wheel",
      "touchstart",
      "visibilitychange",
    ]);
    unsubscribe();
    document.dispatchEvent(new Event("keydown", { bubbles: true }));
    expect(seen).toHaveLength(6);
  });

  it("sees a focused game iframe, the visible tab and real timers", () => {
    expect(defaultScreenSaverDeps.isVisible()).toBe(true);
    expect(defaultScreenSaverDeps.isGameFocused()).toBe(false);
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    frame.focus();
    expect(document.activeElement).toBe(frame);
    expect(defaultScreenSaverDeps.isGameFocused()).toBe(true);
    frame.remove();
    expect(defaultScreenSaverDeps.isGameFocused()).toBe(false);
    const handle = defaultScreenSaverDeps.setTimeout(() => undefined, 10_000);
    expect(() => defaultScreenSaverDeps.clearTimeout(handle)).not.toThrow();
  });

  it("loads the pipes module (and three.js with it) on demand", async () => {
    const module = await defaultScreenSaverDeps.loadPipes();
    expect(typeof module.startPipes).toBe("function");
  });
});
