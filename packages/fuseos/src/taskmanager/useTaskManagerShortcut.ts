import { useEffect } from "react";

import { matchShortcut } from "../lib/shortcuts";
import { useWindowCommands } from "../windows/useWindowCommands";

import { openTaskManager } from "./taskManagerRegistration";

/**
 * Ctrl+Shift+Esc opens the Task Manager, where the browser lets a page see it (Windows itself
 * answers that chord before Chrome does, so there it stays a Start menu item). Listens on
 * `document`, like the Start menu's keys: a focused game iframe keeps its own keys.
 * Ctrl+Alt+Del belongs to the Blue Screen of Death, not to this hook.
 */
export function useTaskManagerShortcut(): void {
  const commands = useWindowCommands();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (matchShortcut(event, "desktop.taskManager")) {
        event.preventDefault();
        openTaskManager(commands);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [commands]);
}
