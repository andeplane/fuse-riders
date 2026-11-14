import { isGameLaunch } from "../settings/fuseosPrefsStore";

import type { AgentOs, OpenTarget } from "./agentOs";
import type { AgentTool, ToolArgs } from "./agentTool";
import { stringArg } from "./agentTool";
import { describeWindow } from "./windowTools";

function normalizeId(arg: string): string {
  return arg
    .trim()
    .toLowerCase()
    .replace(/^["'`]+|["'`]+$/g, "");
}

/** The target an argument names: by id first, then by name or alias, case-insensitively. */
export function resolveTarget(
  arg: string,
  targets: readonly OpenTarget[],
): OpenTarget | undefined {
  const wanted = normalizeId(arg);
  if (wanted === "") return undefined;
  return (
    targets.find((target) => target.id.toLowerCase() === wanted) ??
    targets.find(
      (target) =>
        target.name.toLowerCase() === wanted ||
        target.aliases?.some((alias) => alias.toLowerCase() === wanted),
    )
  );
}

/** Opens a program, a retro game or a Fuse game (the latter the way the Games applet says: window or tab). */
export function createOpenAppTool(
  os: Pick<AgentOs, "targets" | "windows" | "games">,
): AgentTool {
  const target = (args: ToolArgs) =>
    resolveTarget(stringArg(args, "id") ?? "", os.targets);
  return {
    name: "open_app",
    description:
      "Opens a program or a game, or brings it to the front. Music is the music tool, not a game.",
    parameters: [
      {
        name: "id",
        type: "string",
        description: "",
        required: true,
        options: os.targets.map((entry) => entry.id),
      },
    ],
    sentence: (args) =>
      `Opening ${target(args)?.name ?? stringArg(args, "id") ?? ""}`,
    run: (args) => {
      const found = target(args);
      // `coerceArgs` only lets catalogue ids through, so this guards a catalogue that changed mid-turn.
      if (!found)
        return {
          ok: false,
          sentence: `There is nothing called "${stringArg(args, "id") ?? ""}" on this desktop`,
        };
      if (found.kind === "game") {
        const mode = os.games.launch(found.id);
        return {
          ok: true,
          sentence:
            mode === "tab"
              ? `Opened ${found.name} in a new browser tab`
              : `Opened ${found.name}`,
        };
      }
      os.windows.open(found.content);
      return { ok: true, sentence: `Opened ${found.name}` };
    },
  };
}

/** Starts a Fuse game, optionally choosing where: a window on the desktop or a browser tab of its own. */
export function createLaunchGameTool(os: Pick<AgentOs, "games">): AgentTool {
  const game = (args: ToolArgs) => {
    const wanted = normalizeId(stringArg(args, "id") ?? "");
    return os.games
      .fuse()
      .find(
        (entry) =>
          entry.id.toLowerCase() === wanted ||
          entry.name.toLowerCase() === wanted,
      );
  };
  return {
    name: "launch_game",
    description:
      "Starts a Fuse game. Leave mode out unless the user asks for a browser tab or a window by name.",
    parameters: [
      {
        name: "id",
        type: "string",
        description: "",
        required: true,
        options: os.games.fuse().map((entry) => entry.id),
      },
      {
        name: "mode",
        type: "string",
        description: "",
        options: ["window", "tab"],
      },
    ],
    sentence: (args) =>
      `Starting ${game(args)?.name ?? stringArg(args, "id") ?? ""}`,
    run: (args) => {
      const found = game(args);
      if (!found)
        return {
          ok: false,
          sentence: `There is no Fuse game called "${stringArg(args, "id") ?? ""}"`,
        };
      const wanted = stringArg(args, "mode");
      const mode = os.games.launch(
        found.id,
        isGameLaunch(wanted) ? wanted : undefined,
      );
      return {
        ok: true,
        sentence:
          mode === "tab"
            ? `Started ${found.name} in a new browser tab`
            : `Started ${found.name} in a window`,
      };
    },
  };
}

/** The games on this desktop, taglines included, for "what can I play?". */
export function createListGamesTool(os: Pick<AgentOs, "games">): AgentTool {
  return {
    name: "list_games",
    description: "Lists the Fuse games (with taglines) and the retro games.",
    parameters: [],
    sentence: () => "Looking at the games",
    run: () => {
      const fuse = os.games.fuse();
      const retro = os.games.retro();
      return {
        ok: true,
        sentence: `Found ${fuse.length} Fuse games and ${retro.length} retro games`,
        observation: [
          fuse.length === 0
            ? "No Fuse games are installed."
            : `Fuse games: ${fuse.map((game) => `${game.name} [${game.id}]: ${game.tagline}`).join("; ")}.`,
          retro.length === 0
            ? ""
            : `Retro games: ${retro.map((game) => `${game.name} [${game.id}]`).join(", ")}.`,
        ]
          .filter((line) => line !== "")
          .join(" "),
      };
    },
  };
}

/** One line on what the desktop looks like right now: the windows, the Start menu, the display and the music. */
export function desktopSummary(
  os: Pick<AgentOs, "windows" | "startMenu" | "display" | "music" | "games">,
): string {
  const windows = os.windows.list();
  const display = os.display.get();
  const music = os.music.controls()?.status();
  return [
    windows.length === 0
      ? "No windows are open."
      : `Windows, back to front: ${windows.map(describeWindow).join("; ")}.`,
    `Start menu ${os.startMenu.isOpen() ? "open" : "closed"}.`,
    `Display: ${display.colorMode}, ${display.resolution === "current" ? "native resolution" : display.resolution}, scheme ${display.scheme}, CRT ${display.crt}.`,
    music === undefined
      ? "Winamp is not running."
      : `Winamp ${music.playing ? "playing" : "not playing"}${music.currentTrack ? ` "${music.currentTrack}"` : ""} (${music.trackCount} tracks).`,
    `Fuse games open in a ${os.games.launchMode() === "tab" ? "browser tab" : "window"}.`,
  ].join(" ");
}

/** What a user sees by looking at the screen. */
export function createDesktopStateTool(
  os: Pick<AgentOs, "windows" | "startMenu" | "display" | "music" | "games">,
): AgentTool {
  return {
    name: "get_desktop_state",
    description:
      "Tells which windows are open (ids, titles, state) and the display and music status.",
    parameters: [],
    sentence: () => "Looking at the desktop",
    run: () => {
      const titles = os.windows.list().map((window) => window.title);
      return {
        ok: true,
        // The step log is all a marker reply shows of this, so it names the windows.
        sentence:
          titles.length === 0
            ? "No windows are open"
            : `Open: ${titles.join(", ")}`,
        observation: desktopSummary(os),
      };
    },
  };
}
