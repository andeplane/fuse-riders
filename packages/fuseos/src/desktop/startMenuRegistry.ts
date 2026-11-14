import { createContext } from "react";

import type { IconName } from "../ui/icons";
import type { WindowCommands } from "../windows/useWindowCommands";

/**
 * Where a registered entry lands in the Start menu:
 * - `accessories`: Programs > Accessories (Paint, Winamp, Notepad++, ...)
 * - `programs`: Programs, after Accessories and Games
 * - `games`: Programs > Games, after the Fuse games and before Retro Games
 * - `my-computer`: the top-level My Computer item itself (one registration fills it)
 * - `settings`: Settings, after Control Panel and its applets
 * - `help`: Help, after Help Topics and the Office Assistant
 */
export type StartMenuSlot =
  "accessories" | "programs" | "games" | "my-computer" | "settings" | "help";

export type StartMenuRegistration = {
  slot: StartMenuSlot;
  /** Unique within the menu; also the test id of the item. */
  id: string;
  label: string;
  icon: IconName;
  /**
   * What choosing the item does, given the window commands. Absent means the program is not
   * installed in this build: the item shows disabled so the menu's shape is complete.
   */
  open?: (commands: WindowCommands) => void;
  /** Lower first within a slot; registrations without one keep their list order after those with one. */
  order?: number;
};

/**
 * The programs other packages add to the Start menu. Appending an entry here is the whole
 * registration: `useStartMenuViewModel` reads this list, so nothing in `StartMenu.tsx` or the
 * view model needs editing. Placeholders for programs that are planned but not yet in this
 * build stay disabled until their package replaces the entry with one that has `open`.
 */
export const START_MENU_REGISTRATIONS: readonly StartMenuRegistration[] = [
  {
    slot: "accessories",
    id: "notepadpp",
    label: "Notepad++",
    icon: "file",
    order: 30,
  },
  {
    slot: "my-computer",
    id: "my-computer",
    label: "My Computer",
    icon: "computer",
  },
];

/** The registrations in force; tests hand in their own list. */
export const StartMenuRegistryContext = createContext<
  readonly StartMenuRegistration[]
>(START_MENU_REGISTRATIONS);

/** The registrations for one slot, stable-sorted by `order` (entries without one last, in list order). */
export function registrationsFor(
  registrations: readonly StartMenuRegistration[],
  slot: StartMenuSlot,
): StartMenuRegistration[] {
  return registrations
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.slot === slot)
    .sort((a, b) => {
      const left = a.entry.order ?? Number.POSITIVE_INFINITY;
      const right = b.entry.order ?? Number.POSITIVE_INFINITY;
      return left === right ? a.index - b.index : left - right;
    })
    .map(({ entry }) => entry);
}
