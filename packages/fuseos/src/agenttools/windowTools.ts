import type { AgentOs, WindowInfo, WindowsPort } from "./agentOs";
import type { AgentTool, AgentToolResult, ToolArgs } from "./agentTool";
import { booleanArg, stringArg } from "./agentTool";

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** "w3 Fuseball (maximized)": a window as the model reads it. */
export function describeWindow(window: WindowInfo): string {
  const flags = [
    window.focused ? "on top" : "",
    window.minimized ? "minimized" : "",
    window.maximized ? "maximized" : "",
  ].filter((flag) => flag !== "");
  return `${window.id} "${window.title}"${flags.length > 0 ? ` (${flags.join(", ")})` : ""}`;
}

/**
 * The window a reference names: its id ("w3"), its title, its kind ("paint"), or a part of the title
 * ("fuseball" for "Fuseball", "notepad" for "README.md - Notepad++"); the topmost match wins.
 */
export function findWindow(
  reference: string,
  windows: readonly WindowInfo[],
): WindowInfo | undefined {
  const wanted = normalize(reference);
  if (wanted === "") return undefined;
  const topFirst = [...windows].reverse();
  return (
    topFirst.find((window) => window.id.toLowerCase() === wanted) ??
    topFirst.find((window) => normalize(window.title) === wanted) ??
    topFirst.find((window) => window.kind.toLowerCase() === wanted) ??
    topFirst.find((window) => normalize(window.title).includes(wanted)) ??
    topFirst.find((window) => wanted.includes(normalize(window.title)))
  );
}

const WINDOW_PARAM = {
  name: "window",
  type: "string",
  description: "its title, or its id from get_desktop_state",
  required: true,
} as const;

function noSuchWindow(
  reference: string,
  windows: readonly WindowInfo[],
): AgentToolResult {
  return {
    ok: false,
    sentence: `There is no window called "${reference}"`,
    observation: `No window matches "${reference}". Open windows: ${windows.map(describeWindow).join("; ") || "none"}.`,
  };
}

function windowTool(
  port: WindowsPort,
  spec: {
    name: string;
    description: string;
    doing: string;
    act: (window: WindowInfo) => AgentToolResult;
  },
): AgentTool {
  const reference = (args: ToolArgs) => stringArg(args, "window") ?? "";
  return {
    name: spec.name,
    description: spec.description,
    parameters: [WINDOW_PARAM],
    sentence: (args) =>
      `${spec.doing} ${findWindow(reference(args), port.list())?.title ?? reference(args)}`,
    run: (args) => {
      const windows = port.list();
      const window = findWindow(reference(args), windows);
      return window ? spec.act(window) : noSuchWindow(reference(args), windows);
    },
  };
}

/** focus, close, minimize and maximize: the four things a title bar and the taskbar do to a window. */
export function createWindowTools(os: Pick<AgentOs, "windows">): AgentTool[] {
  const port = os.windows;
  return [
    windowTool(port, {
      name: "focus_window",
      description: "Brings a window to the front (restores it if minimized).",
      doing: "Bringing up",
      act: (window) => {
        port.focus(window.id);
        return { ok: true, sentence: `${window.title} is in front` };
      },
    }),
    windowTool(port, {
      name: "close_window",
      description: "Closes a window.",
      doing: "Closing",
      act: (window) => {
        port.close(window.id);
        return { ok: true, sentence: `Closed ${window.title}` };
      },
    }),
    windowTool(port, {
      name: "minimize_window",
      description: "Minimizes a window to the taskbar.",
      doing: "Minimizing",
      act: (window) => {
        if (window.minimized)
          return { ok: true, sentence: `${window.title} is already minimized` };
        port.minimize(window.id);
        return { ok: true, sentence: `Minimized ${window.title}` };
      },
    }),
    windowTool(port, {
      name: "maximize_window",
      description: "Maximizes a window to fill the desktop.",
      doing: "Maximizing",
      act: (window) => {
        if (window.maximized && !window.minimized)
          return { ok: true, sentence: `${window.title} is already maximized` };
        if (window.minimized) port.focus(window.id);
        if (!window.maximized) port.toggleMaximize(window.id);
        return { ok: true, sentence: `Maximized ${window.title}` };
      },
    }),
  ];
}

/** Presses Start (or closes the menu again). */
export function createStartMenuTool(os: Pick<AgentOs, "startMenu">): AgentTool {
  const wanted = (args: ToolArgs) => booleanArg(args, "open") ?? true;
  return {
    name: "open_start_menu",
    description: "Opens the Start menu; open=false closes it.",
    parameters: [{ name: "open", type: "boolean", description: "" }],
    sentence: (args) =>
      wanted(args) ? "Opening the Start menu" : "Closing the Start menu",
    run: (args) => {
      const open = wanted(args);
      os.startMenu.setOpen(open);
      return {
        ok: true,
        sentence: open ? "The Start menu is open" : "The Start menu is closed",
      };
    },
  };
}

/** A dialog box with a message, the way a program would show one. */
export function createShowMessageTool(os: Pick<AgentOs, "windows">): AgentTool {
  const title = (args: ToolArgs) => stringArg(args, "title") ?? "Clippy";
  return {
    name: "show_message",
    description: "Shows a message box on the desktop.",
    parameters: [
      {
        name: "text",
        type: "string",
        description: "the message",
        required: true,
      },
      { name: "title", type: "string", description: "the title bar text" },
    ],
    sentence: () => "Showing a message",
    run: (args) => {
      os.windows.showInfo(title(args), stringArg(args, "text") ?? "");
      return { ok: true, sentence: `Showed the message "${title(args)}"` };
    },
  };
}
