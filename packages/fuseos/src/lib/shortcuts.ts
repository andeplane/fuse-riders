/**
 * The single source of truth for every keyboard shortcut the desktop understands. Control
 * Panel, Keyboard renders this list grouped by scope, so the cheat sheet cannot drift from what
 * the handlers actually do — a handler wired through `matchShortcut` cannot bind a key that has
 * no entry here, and `keysFor` lets a menu's displayed accelerator (`MenuItemDef.shortcut`)
 * source its text from the same entry instead of repeating the string.
 *
 * Not every entry below is wired through `matchShortcut`: a few (the Explorer's arrow-key
 * variants, which share one branching handler for direction and modifiers; Paint's Text dialog
 * Enter, submitted by the browser's native form handling rather than a key check) are listed for
 * the cheat sheet but matched by their own code, documented at the call site. Everything else
 * binds through this file, so it cannot exist without an entry here.
 */

export const SHORTCUT_SCOPES = [
  "Desktop",
  "Explorer",
  "Notepad",
  "Paint",
  "Solitaire",
] as const;

export type ShortcutScope = (typeof SHORTCUT_SCOPES)[number];

export interface Shortcut {
  /** Stable id a handler binds to via `matchShortcut`, or a menu accelerator reads via `keysFor`. */
  id: string;
  /** Written the way Windows 98 writes it: "Ctrl+A", "Shift+F10", "Alt+Enter", "Backspace", "F2". */
  keys: string;
  /** One line, sentence case, no trailing period — shown as the sheet's action cell. */
  description: string;
  scope: ShortcutScope;
}

export const SHORTCUTS: readonly Shortcut[] = [
  // Desktop — the icons on the wallpaper and whatever menu is open, wherever one is.
  {
    id: "desktop.startMenu",
    keys: "Ctrl+Esc",
    description: "Open or close the Start menu",
    scope: "Desktop",
  },
  {
    id: "desktop.openIcon",
    keys: "Enter",
    description: "Open the selected desktop icon",
    scope: "Desktop",
  },
  {
    id: "desktop.contextMenu",
    keys: "Shift+F10",
    description: "Open the context menu for the current selection",
    scope: "Desktop",
  },
  {
    id: "desktop.closeMenu",
    keys: "Escape",
    description: "Close the open menu",
    scope: "Desktop",
  },
  {
    id: "desktop.navigateMenu",
    keys: "Up/Down",
    description: "Move through the open menu",
    scope: "Desktop",
  },
  {
    id: "desktop.openSubmenu",
    keys: "Right",
    description: "Open the highlighted Start menu folder",
    scope: "Desktop",
  },
  {
    id: "desktop.closeSubmenu",
    keys: "Left",
    description: "Close the open Start menu folder",
    scope: "Desktop",
  },
  {
    id: "desktop.chooseMenuItem",
    keys: "Enter",
    description: "Choose the highlighted menu item",
    scope: "Desktop",
  },
  {
    // Matched by `isRunChord` rather than `matchShortcut`: the Windows key is not one of its modifiers.
    id: "desktop.run",
    keys: "Win+R",
    description:
      "Open the Run dialog, where the browser passes the Windows key on",
    scope: "Desktop",
  },
  {
    id: "desktop.taskManager",
    keys: "Ctrl+Shift+Esc",
    description: "Open the Task Manager",
    scope: "Desktop",
  },

  // Explorer
  {
    id: "explorer.up",
    keys: "Backspace",
    description: "Go up one level",
    scope: "Explorer",
  },
  {
    id: "explorer.open",
    keys: "Enter",
    description: "Open the selected item",
    scope: "Explorer",
  },
  {
    id: "explorer.delete",
    keys: "Delete",
    description: "Delete the selected file or folder",
    scope: "Explorer",
  },
  {
    id: "explorer.properties",
    keys: "Alt+Enter",
    description: "Show Properties for the selected item",
    scope: "Explorer",
  },
  {
    id: "explorer.contextMenu",
    keys: "Shift+F10",
    description: "Open the context menu for the selection",
    scope: "Explorer",
  },
  {
    id: "explorer.selectAll",
    keys: "Ctrl+A",
    description: "Select every item in the current folder",
    scope: "Explorer",
  },
  {
    id: "explorer.clearSelection",
    keys: "Escape",
    description: "Clear the selection",
    scope: "Explorer",
  },
  {
    id: "explorer.toggleSelection",
    keys: "Ctrl+Space",
    description: "Toggle the focused item in or out of the selection",
    scope: "Explorer",
  },
  {
    id: "explorer.moveSelection",
    keys: "Up/Down/Left/Right",
    description: "Select the previous or next item",
    scope: "Explorer",
  },
  {
    id: "explorer.extendSelection",
    keys: "Shift+Arrow",
    description: "Extend the selection from the anchor to the focused item",
    scope: "Explorer",
  },
  {
    id: "explorer.moveFocus",
    keys: "Ctrl+Arrow",
    description: "Move the keyboard focus without changing the selection",
    scope: "Explorer",
  },

  // Notepad
  {
    id: "notepad.find",
    keys: "Ctrl+F",
    description: "Open Find",
    scope: "Notepad",
  },
  {
    id: "notepad.findNext",
    keys: "F3",
    description:
      "Find the next match (opens Find first if the search box is empty)",
    scope: "Notepad",
  },
  {
    id: "notepad.save",
    keys: "Ctrl+S",
    description: "Save the open file to this computer (Notepad++)",
    scope: "Notepad",
  },

  // Paint — the Text tool's dialog
  {
    id: "paint.textInsert",
    keys: "Enter",
    description: "Insert the typed text into the canvas",
    scope: "Paint",
  },
  {
    id: "paint.textCancel",
    keys: "Escape",
    description: "Cancel the Text dialog without drawing anything",
    scope: "Paint",
  },

  // Solitaire
  {
    id: "solitaire.newGame",
    keys: "F2",
    description: "Deal a new game",
    scope: "Solitaire",
  },
];

type ParsedShortcut = {
  key: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
};

/** Windows 98 spellings on the sheet to the `KeyboardEvent.key` values the browser reports. */
const KEY_ALIASES: Record<string, string> = {
  Space: " ",
  Esc: "Escape",
  Left: "ArrowLeft",
  Right: "ArrowRight",
  Up: "ArrowUp",
  Down: "ArrowDown",
};

function shortcutById(id: string): Shortcut {
  const shortcut = SHORTCUTS.find((entry) => entry.id === id);
  if (!shortcut)
    throw new Error(
      `No shortcut registered for id "${id}" — add it to src/lib/shortcuts.ts.`,
    );
  return shortcut;
}

/** Splits a "Ctrl+Shift+A" style label into its modifiers and the trailing key. Single-combo labels only — the Explorer's multi-direction arrow entries are documentation only and never parsed. */
function parseKeys(keys: string): ParsedShortcut {
  const parts = keys.split("+");
  const rawKey = parts[parts.length - 1] ?? keys;
  const modifiers = parts.slice(0, -1);
  return {
    key: KEY_ALIASES[rawKey] ?? rawKey,
    ctrl: modifiers.includes("Ctrl"),
    shift: modifiers.includes("Shift"),
    alt: modifiers.includes("Alt"),
  };
}

/** The keys text for a registered shortcut — what a menu accelerator (`MenuItemDef.shortcut`) should show, so the label cannot drift from the registry it is read from. Throws for an unknown id rather than silently showing nothing. */
export function keysFor(id: string): string {
  return shortcutById(id).keys;
}

/**
 * Whether a keyboard event is the shortcut registered under `id` — Ctrl and Cmd (`metaKey`)
 * count as the same modifier, matching the rest of the app, and a single letter matches case
 * insensitively. Throws for an unknown id, the same way `keysFor` does, so a typo cannot bind a
 * dead key silently.
 */
export function matchShortcut(
  event: {
    key: string;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
  },
  id: string,
): boolean {
  const parsed = parseKeys(shortcutById(id).keys);
  const keyMatches =
    parsed.key.length === 1
      ? event.key.length === 1 &&
        event.key.toLowerCase() === parsed.key.toLowerCase()
      : event.key === parsed.key;
  return (
    keyMatches &&
    (event.ctrlKey || event.metaKey) === parsed.ctrl &&
    event.shiftKey === parsed.shift &&
    event.altKey === parsed.alt
  );
}

/**
 * Win+R, the Run dialog's key (`desktop.run`). The Windows key reaches a page as `metaKey`, and only where the
 * operating system does not keep the chord for itself; on an Apple device the same key is Command, and
 * Cmd+R is the browser's Reload, so `apple` turns the chord off there.
 */
export function isRunChord(
  event: {
    key: string;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
  },
  apple: boolean,
): boolean {
  return (
    !apple &&
    event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey &&
    event.key.toLowerCase() === "r"
  );
}
