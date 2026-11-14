import type { StartMenuRegistration } from "../desktop/startMenuRegistry";
import type { WindowCommands } from "../windows/useWindowCommands";

/** The one Task Manager window's id; `open` with a known id brings the existing window to the front. */
export const TASK_MANAGER_WINDOW_ID = "taskmanager";

/** Opens the Task Manager, or brings the open one to the front: there is never more than one. */
export function openTaskManager(commands: WindowCommands): void {
  commands.open({ kind: "taskmanager" }, TASK_MANAGER_WINDOW_ID);
}

/** Start > Programs > Accessories > Task Manager. */
export const TASK_MANAGER_REGISTRATION: StartMenuRegistration = {
  slot: "accessories",
  id: "taskmanager",
  label: "Task Manager",
  icon: "taskmanager",
  order: 40,
  open: openTaskManager,
};
