import {
  isRunChord,
  keysFor,
  matchShortcut,
  SHORTCUTS,
  SHORTCUT_SCOPES,
} from "./shortcuts";

describe("SHORTCUTS", () => {
  it("has a unique, non-empty id, keys, description and a known scope for every entry", () => {
    const ids = SHORTCUTS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    SHORTCUTS.forEach((entry) => {
      expect(entry.id.length).toBeGreaterThan(0);
      expect(entry.keys.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
      expect(SHORTCUT_SCOPES).toContain(entry.scope);
    });
  });

  it("covers every scope named in the issue", () => {
    const scopes = new Set(SHORTCUTS.map((entry) => entry.scope));
    expect(scopes).toEqual(
      new Set(["Desktop", "Explorer", "Notepad", "Paint", "Solitaire"]),
    );
  });

  it("writes keys the way Windows 98 does: Ctrl+A, Shift+F10, Alt+Enter, Backspace, F2, Ctrl+Esc", () => {
    expect(keysFor("explorer.selectAll")).toBe("Ctrl+A");
    expect(keysFor("explorer.contextMenu")).toBe("Shift+F10");
    expect(keysFor("explorer.properties")).toBe("Alt+Enter");
    expect(keysFor("explorer.up")).toBe("Backspace");
    expect(keysFor("solitaire.newGame")).toBe("F2");
    expect(keysFor("desktop.startMenu")).toBe("Ctrl+Esc");
  });

  it("lists the Start menu keys under Desktop", () => {
    expect(
      SHORTCUTS.filter((entry) => entry.scope === "Desktop").map(
        (entry) => entry.id,
      ),
    ).toEqual([
      "desktop.startMenu",
      "desktop.openIcon",
      "desktop.contextMenu",
      "desktop.closeMenu",
      "desktop.navigateMenu",
      "desktop.openSubmenu",
      "desktop.closeSubmenu",
      "desktop.chooseMenuItem",
      "desktop.run",
    ]);
  });
});

describe(keysFor.name, () => {
  it("throws for an id nothing registers, so a typo cannot silently show no shortcut", () => {
    expect(() => keysFor("nope.nothing")).toThrow(/nope.nothing/);
  });
});

describe(matchShortcut.name, () => {
  it("matches a plain key with no modifiers held", () => {
    expect(
      matchShortcut(
        {
          key: "Backspace",
          ctrlKey: false,
          metaKey: false,
          shiftKey: false,
          altKey: false,
        },
        "explorer.up",
      ),
    ).toBe(true);
    expect(
      matchShortcut(
        {
          key: "Enter",
          ctrlKey: false,
          metaKey: false,
          shiftKey: false,
          altKey: false,
        },
        "explorer.up",
      ),
    ).toBe(false);
  });

  it("requires every modifier the shortcut names and none it does not", () => {
    expect(
      matchShortcut(
        {
          key: "Enter",
          ctrlKey: false,
          metaKey: false,
          shiftKey: false,
          altKey: true,
        },
        "explorer.properties",
      ),
    ).toBe(true);
    expect(
      matchShortcut(
        {
          key: "Enter",
          ctrlKey: false,
          metaKey: false,
          shiftKey: false,
          altKey: false,
        },
        "explorer.properties",
      ),
    ).toBe(false);
    expect(
      matchShortcut(
        {
          key: "Enter",
          ctrlKey: true,
          metaKey: false,
          shiftKey: false,
          altKey: true,
        },
        "explorer.properties",
      ),
    ).toBe(false);
  });

  it("treats Cmd (metaKey) as Ctrl, like the rest of the app", () => {
    expect(
      matchShortcut(
        {
          key: "a",
          ctrlKey: false,
          metaKey: true,
          shiftKey: false,
          altKey: false,
        },
        "explorer.selectAll",
      ),
    ).toBe(true);
    expect(
      matchShortcut(
        {
          key: "A",
          ctrlKey: true,
          metaKey: false,
          shiftKey: false,
          altKey: false,
        },
        "explorer.selectAll",
      ),
    ).toBe(true);
  });

  it("matches a single letter case insensitively", () => {
    expect(
      matchShortcut(
        {
          key: "f",
          ctrlKey: true,
          metaKey: false,
          shiftKey: false,
          altKey: false,
        },
        "notepad.find",
      ),
    ).toBe(true);
    expect(
      matchShortcut(
        {
          key: "F",
          ctrlKey: true,
          metaKey: false,
          shiftKey: false,
          altKey: false,
        },
        "notepad.find",
      ),
    ).toBe(true);
  });

  it("matches the space bar, whose event.key is a literal space", () => {
    expect(
      matchShortcut(
        {
          key: " ",
          ctrlKey: true,
          metaKey: false,
          shiftKey: false,
          altKey: false,
        },
        "explorer.toggleSelection",
      ),
    ).toBe(true);
    expect(
      matchShortcut(
        {
          key: " ",
          ctrlKey: false,
          metaKey: false,
          shiftKey: false,
          altKey: false,
        },
        "explorer.toggleSelection",
      ),
    ).toBe(false);
  });

  it("maps the sheet's Esc, Left and Right spellings to the browser's key names", () => {
    const plain = {
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
    };
    expect(
      matchShortcut(
        { ...plain, key: "Escape", ctrlKey: true },
        "desktop.startMenu",
      ),
    ).toBe(true);
    expect(
      matchShortcut(
        { ...plain, key: "Escape", metaKey: true },
        "desktop.startMenu",
      ),
    ).toBe(true);
    expect(
      matchShortcut({ ...plain, key: "Escape" }, "desktop.startMenu"),
    ).toBe(false);
    expect(
      matchShortcut({ ...plain, key: "ArrowRight" }, "desktop.openSubmenu"),
    ).toBe(true);
    expect(
      matchShortcut({ ...plain, key: "ArrowLeft" }, "desktop.closeSubmenu"),
    ).toBe(true);
    expect(
      matchShortcut({ ...plain, key: "ArrowLeft" }, "desktop.openSubmenu"),
    ).toBe(false);
  });

  it("matches a function key with no modifiers", () => {
    expect(
      matchShortcut(
        {
          key: "F2",
          ctrlKey: false,
          metaKey: false,
          shiftKey: false,
          altKey: false,
        },
        "solitaire.newGame",
      ),
    ).toBe(true);
    expect(
      matchShortcut(
        {
          key: "F3",
          ctrlKey: false,
          metaKey: false,
          shiftKey: false,
          altKey: false,
        },
        "solitaire.newGame",
      ),
    ).toBe(false);
  });

  it("throws for an id nothing registers", () => {
    expect(() =>
      matchShortcut(
        {
          key: "a",
          ctrlKey: false,
          metaKey: false,
          shiftKey: false,
          altKey: false,
        },
        "nope.nothing",
      ),
    ).toThrow(/nope.nothing/);
  });
});

describe(isRunChord.name, () => {
  const chord = {
    key: "r",
    ctrlKey: false,
    metaKey: true,
    shiftKey: false,
    altKey: false,
  };

  it("is the Windows key with R, in either case, and nothing else with it", () => {
    expect(isRunChord(chord, false)).toBe(true);
    expect(isRunChord({ ...chord, key: "R" }, false)).toBe(true);
    expect(isRunChord({ ...chord, key: "e" }, false)).toBe(false);
    expect(isRunChord({ ...chord, metaKey: false }, false)).toBe(false);
    expect(isRunChord({ ...chord, ctrlKey: true }, false)).toBe(false);
    expect(isRunChord({ ...chord, shiftKey: true }, false)).toBe(false);
    expect(isRunChord({ ...chord, altKey: true }, false)).toBe(false);
  });

  it("is never the chord on an Apple device, where Cmd+R reloads the page", () => {
    expect(isRunChord(chord, true)).toBe(false);
  });
});
