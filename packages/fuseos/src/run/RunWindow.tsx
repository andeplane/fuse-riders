import { matchShortcut } from "../lib/shortcuts";
import { Win98Icon } from "../ui/icons";

import { useRunViewModel } from "./useRunViewModel";

export const RUN_PROMPT =
  "Type the name of a program, folder, document, or Internet resource, and FuseOS will open it for you.";

export type RunWindowProps = { windowId: string };

/**
 * Start > Run... (Win+R where the browser passes the key on): the Windows 98 Run box. It opens a program or a
 * game by its name ("doom", "fuseball", "winamp", "notepad"...), a drive by its address, a web address in a
 * tab, and `bsod` for the blue screen.
 */
export function RunWindow({ windowId }: RunWindowProps) {
  const vm = useRunViewModel(windowId);
  const listId = `run-suggestions-${windowId}`;
  return (
    <form
      className="window-body flex flex-col gap-3"
      aria-label="Run"
      onSubmit={(event) => {
        event.preventDefault();
        vm.run();
      }}
      onKeyDown={(event) => {
        if (matchShortcut(event, "desktop.closeMenu")) {
          event.preventDefault();
          event.stopPropagation();
          vm.cancel();
        }
      }}
    >
      <div className="flex items-start gap-3">
        <Win98Icon name="run" size={32} className="shrink-0" />
        <p className="m-0">{RUN_PROMPT}</p>
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor={`run-open-${windowId}`}>Open:</label>
        <input
          id={`run-open-${windowId}`}
          type="text"
          className="min-w-0 flex-1"
          list={listId}
          autoComplete="off"
          spellCheck={false}
          autoFocus
          value={vm.text}
          onChange={(event) => vm.setText(event.target.value)}
        />
        <datalist id={listId}>
          {vm.suggestions.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="submit"
          className="default"
          disabled={vm.text.trim() === ""}
        >
          OK
        </button>
        <button type="button" onClick={vm.cancel}>
          Cancel
        </button>
        <button type="button" onClick={vm.browse}>
          Browse...
        </button>
      </div>
    </form>
  );
}
