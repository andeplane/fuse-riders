import type { BsodKeyEvent } from "./bsodKeys";
import { isBsodChord, isDismissKey } from "./bsodKeys";

function key(key: string, overrides: Partial<BsodKeyEvent> = {}): BsodKeyEvent {
  return { key, ctrlKey: false, altKey: false, repeat: false, ...overrides };
}

describe("isBsodChord", () => {
  it("accepts Ctrl+Alt+Delete and Ctrl+Alt+Backspace", () => {
    expect(isBsodChord(key("Delete", { ctrlKey: true, altKey: true }))).toBe(
      true,
    );
    expect(isBsodChord(key("Backspace", { ctrlKey: true, altKey: true }))).toBe(
      true,
    );
  });

  it("needs both modifiers", () => {
    expect(isBsodChord(key("Delete", { ctrlKey: true }))).toBe(false);
    expect(isBsodChord(key("Delete", { altKey: true }))).toBe(false);
    expect(isBsodChord(key("Delete"))).toBe(false);
  });

  it("ignores other keys and auto-repeat", () => {
    expect(isBsodChord(key("d", { ctrlKey: true, altKey: true }))).toBe(false);
    expect(
      isBsodChord(key("Delete", { ctrlKey: true, altKey: true, repeat: true })),
    ).toBe(false);
  });
});

describe("isDismissKey", () => {
  it("is any ordinary key", () => {
    expect(isDismissKey(key("a"))).toBe(true);
    expect(isDismissKey(key("Enter"))).toBe(true);
    expect(isDismissKey(key("Delete", { ctrlKey: true, altKey: true }))).toBe(
      true,
    );
  });

  it("is not a lone modifier or a held key repeating", () => {
    for (const modifier of ["Control", "Alt", "Shift", "Meta", "AltGraph"])
      expect(isDismissKey(key(modifier))).toBe(false);
    expect(isDismissKey(key("Delete", { repeat: true }))).toBe(false);
  });
});
