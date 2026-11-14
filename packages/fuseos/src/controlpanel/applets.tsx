import type { ComponentType } from "react";

import type { ControlPanelApplet } from "../state/appState";
import type { IconName } from "../ui/icons";

import { AssistantApplet } from "./AssistantApplet";
import { DisplayApplet } from "./DisplayApplet";
import { GamesApplet } from "./GamesApplet";
import { KeyboardApplet } from "./KeyboardApplet";
import { SoundsApplet } from "./SoundsApplet";
import { SystemApplet } from "./SystemApplet";

export type AppletDefinition = {
  applet: Exclude<ControlPanelApplet, "home">;
  /** Tab label and Home icon caption, e.g. "Display". */
  label: string;
  icon: IconName;
  /** Home icon tooltip, one line. */
  description: string;
  /** Rendered in the tab panel; reads its own view model from `windowId`. */
  Component: ComponentType<{ windowId: string }>;
};

/**
 * The Control Panel's applets beyond Home. Adding one is one entry here (plus its own `<Name>Applet.tsx`
 * file and its id in `ControlPanelApplet`): `ControlPanelWindow` and the Start menu derive from this list.
 */
export const APPLETS: readonly AppletDefinition[] = [
  {
    applet: "display",
    label: "Display",
    icon: "display",
    description:
      "Display Properties: background, colours, desktop area and font size",
    Component: DisplayApplet,
  },
  {
    applet: "games",
    label: "Games",
    icon: "games",
    description: "Where a Fuse game opens: in a window here or in a tab",
    Component: GamesApplet,
  },
  {
    applet: "system",
    label: "System",
    icon: "system",
    description: "This browser, the machine, its graphics and storage",
    Component: SystemApplet,
  },
  {
    applet: "assistant",
    label: "Assistant",
    icon: "assistant",
    description: "The Office Assistant and what it may do",
    Component: AssistantApplet,
  },
  {
    applet: "keyboard",
    label: "Keyboard",
    icon: "keyboard",
    description: "Every shortcut the desktop understands, by scope",
    Component: KeyboardApplet,
  },
  {
    applet: "sounds",
    label: "Sounds",
    icon: "sounds",
    description:
      "Which events make a sound: chimes, the floppy drive, the modem",
    Component: SoundsApplet,
  },
];

/** The applet a label names (a tab, or "Control Panel"/"Home" for the Home grid), case insensitive; undefined when nothing matches. */
export function appletFor(label: string): ControlPanelApplet | undefined {
  const wanted = label.trim().toLowerCase();
  if (wanted === "control panel" || wanted === "home") return "home";
  return APPLETS.find((entry) => entry.label.toLowerCase() === wanted)?.applet;
}
