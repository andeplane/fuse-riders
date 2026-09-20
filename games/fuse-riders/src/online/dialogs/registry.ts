/**
 * Which room dialog is open, kept as state (#255 P1).
 *
 * The room page used to have one `<dialog>` that every menu borrowed in turn, so which menu was up could only be
 * inferred from its title, its classes or whether its body contained a given node. Now every dialog is its own
 * element with a typed identity, and this registry is the one place that knows which of them is open. Opening one
 * while another is up swaps them, as replacing the shared dialog's contents used to: the page never sees "none open"
 * in between.
 */

/** Every dialog a room page has. */
export type RoomDialogId =
  | "shortcuts"
  | "settings"
  | "radio"
  | "voice"
  | "menu"
  | "avatar"
  | "riderColor"
  | "roomSettings"
  | "recap";

/** The part of `HTMLDialogElement` the registry drives; the unit tests pass a typed fake. */
export interface DialogSurface {
  readonly open: boolean;
  showModal(): void;
  close(): void;
  /** `close` fires from a queued task after `close()`, Escape, or the dialog's own CLOSE button. */
  addEventListener(type: "close", listener: () => void): void;
}

export type DialogChange<Id extends string> = (
  open: Id | undefined,
  previous: Id | undefined,
) => void;

export interface DialogRegistry<Id extends string> {
  /** Registers a dialog under its identity. Each identity is registered once. */
  add(id: Id, surface: DialogSurface): void;
  /** The dialog on screen, or `undefined`. It follows the element's `open` at once, even before `close` fires. */
  current(): Id | undefined;
  /** Shows `id` modally. Another open dialog is closed first; an already open `id` stays as it is. */
  open(id: Id): void;
  /** Closes the open dialog, or only `id` when given and open. */
  close(id?: Id): void;
  /**
   * Called when the open dialog changes: `open` is the new one, or `undefined` once the last one has closed (from its
   * `close` event, as a listener on the element would see it). A swap reports the new dialog, never `undefined`.
   */
  onChange(listener: DialogChange<Id>): void;
}

export function createDialogRegistry<Id extends string>(): DialogRegistry<Id> {
  const surfaces = new Map<Id, DialogSurface>();
  const listeners: DialogChange<Id>[] = [];
  let shown: Id | undefined;
  const emit = (open: Id | undefined, previous: Id | undefined) => {
    for (const listener of listeners) listener(open, previous);
  };
  const surface = (id: Id) => {
    const found = surfaces.get(id);
    if (!found) throw new Error(`Unknown dialog: ${id}`);
    return found;
  };
  return {
    add(id, dialog) {
      if (surfaces.has(id)) throw new Error(`Dialog registered twice: ${id}`);
      surfaces.set(id, dialog);
      dialog.addEventListener("close", () => {
        // A swap already moved on, and a dialog reopened before its old `close` arrived is still open.
        if (shown !== id || dialog.open) return;
        shown = undefined;
        emit(undefined, id);
      });
    },
    current: () =>
      shown !== undefined && surface(shown).open ? shown : undefined,
    open(id) {
      const next = surface(id);
      if (shown === id && next.open) return;
      const previous =
        shown !== undefined && surface(shown).open ? shown : undefined;
      shown = id;
      if (previous !== undefined) surface(previous).close();
      next.showModal();
      emit(id, previous);
    },
    close(id) {
      if (shown === undefined || (id !== undefined && shown !== id)) return;
      const open = surface(shown);
      if (open.open) open.close();
    },
    onChange(listener) {
      listeners.push(listener);
    },
  };
}
