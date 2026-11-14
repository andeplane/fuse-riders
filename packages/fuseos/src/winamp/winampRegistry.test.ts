import type { WinampControls } from "./winampControls";
import { createWinampRegistry } from "./winampRegistry";

function controls(label: string): WinampControls & { label: string } {
  return {
    label,
    status: () => ({
      trackCount: 0,
      tracks: [],
      currentTrack: undefined,
      playing: false,
    }),
    play: () => undefined,
    pause: () => undefined,
    stop: () => undefined,
    next: () => undefined,
    previous: () => undefined,
    playFiles: () => undefined,
  };
}

describe(createWinampRegistry.name, () => {
  it("holds the transports by window id and hands out the first", () => {
    const registry = createWinampRegistry();
    expect(registry.first()).toBeUndefined();
    expect(registry.size()).toBe(0);
    const a = controls("a");
    registry.set("w1", a);
    registry.set("w2", controls("b"));
    expect(registry.first()).toBe(a);
    expect(registry.size()).toBe(2);
    registry.delete("w1");
    expect(registry.first()).toMatchObject({ label: "b" });
    registry.delete("w2");
    expect(registry.first()).toBeUndefined();
  });

  it("tells listeners about every registration until they unsubscribe, even one that unsubscribes itself", () => {
    const registry = createWinampRegistry();
    const seen: string[] = [];
    const once = registry.onRegister((entry) => {
      once();
      seen.push(`once:${(entry as { label?: string }).label}`);
    });
    const always = registry.onRegister((entry) =>
      seen.push(`always:${(entry as { label?: string }).label}`),
    );
    registry.set("w1", controls("a"));
    registry.set("w2", controls("b"));
    always();
    registry.set("w3", controls("c"));
    expect(seen).toEqual(["once:a", "always:a", "always:b"]);
  });
});
