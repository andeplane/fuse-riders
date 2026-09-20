import { node } from "../dom.js";
import type { DialogRegistry, RoomDialogId } from "./registry.js";
import { createDialogShell } from "./shell.js";

export interface NameDialogOptions {
  /** The name this rider wears right now: what the field opens on. */
  current: () => string;
  /** A signed-in rider's name is its account's and is not changed here; the field is read-only and says so. */
  fixed: () => string | undefined;
  /** Send the rename. Any refusal reaches the player on the room's own status line, as every refused command does. */
  chosen: (name: string) => void;
  /** Builds the field (`createNameEntry` under fuse-ui); passed in so this module holds no page DOM of its own. */
  entry: (options: {
    initial: string;
    onSubmit: (name: string) => void;
    document: Document;
  }) => { form: HTMLElement; input: HTMLInputElement };
  document?: Document;
}

/**
 * NAME: the lobby's name field, the third of the room's identity dialogs beside AVATAR and COLOUR. It exists because
 * the room is the join screen now — nothing asks for a name before the seat, so this is where a rider settles it, and
 * it closes on a name the room accepted (`docs/design/room-is-the-join-screen.md`).
 *
 * The field opens with the current name selected, so the first keystroke replaces the `Rider 3` a new browser was
 * seated under without anyone having to clear it first.
 */
export function createNameDialog(
  dialogs: DialogRegistry<RoomDialogId>,
  options: NameDialogOptions,
) {
  const doc = options.document ?? document;
  const shell = createDialogShell({
    title: "NAME",
    label: "Name",
    document: doc,
  });
  dialogs.add("riderName", shell.dialog);
  return {
    element: shell.dialog,
    open() {
      const account = options.fixed();
      const notice = node("p", "", "name-account", doc);
      notice.hidden = true;
      const entry = options.entry({
        initial: account ?? options.current(),
        onSubmit: (name) => {
          options.chosen(name);
          dialogs.close("riderName");
        },
        document: doc,
      });
      if (account !== undefined) {
        entry.input.readOnly = true;
        notice.textContent =
          "Your account name. Change it under MY GAMES on the home page.";
        notice.hidden = false;
      }
      shell.body.replaceChildren(
        node("h2", "Your name", "", doc),
        entry.form,
        notice,
      );
      dialogs.open("riderName");
      // Selected rather than merely focused: the name a rider is changing is one it did not choose, so replacing it
      // should take one keystroke.
      if (account === undefined) entry.input.select();
    },
  };
}
