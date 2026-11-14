import { SHORTCUTS, SHORTCUT_SCOPES } from "../lib/shortcuts";

/**
 * Control Panel, Keyboard: every shortcut the desktop understands, grouped by scope and read
 * straight from `SHORTCUTS` (`src/lib/shortcuts.ts`) — the same list the handlers themselves
 * consult through `matchShortcut`, so this sheet cannot list a key nothing does, or leave one out.
 * Purely local information, so unlike the configuration applets it needs no capability line and
 * no read only footer.
 */
export function KeyboardApplet() {
  return (
    <div className="flex flex-col gap-3">
      {SHORTCUT_SCOPES.map((scope) => {
        const shortcuts = SHORTCUTS.filter((entry) => entry.scope === scope);
        if (shortcuts.length === 0) return null;
        return (
          <fieldset key={scope}>
            <legend>{scope}</legend>
            <table className="w-full" aria-label={`${scope} shortcuts`}>
              <thead>
                <tr>
                  <th className="w-1/3 text-left">Key</th>
                  <th className="text-left">Action</th>
                </tr>
              </thead>
              <tbody>
                {shortcuts.map((shortcut) => (
                  <tr key={shortcut.id}>
                    <td className="font-mono whitespace-nowrap">
                      {shortcut.keys}
                    </td>
                    <td>{shortcut.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </fieldset>
        );
      })}
    </div>
  );
}
