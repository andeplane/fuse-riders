import { useContext, useMemo } from "react";

import type { FuseGameRegistry } from "../fusegames/registry";
import { FuseGamesContext } from "../fusegames/registry";
import type { IntentCatalog, IntentTarget, MusicAction } from "../llm/intent";
import type { PromptCatalog } from "../llm/systemPrompt";
import type { AssistantTool, ToolResult } from "../llm/tools";
import { GAMES } from "../retro/games";
import { GAME_IDS } from "../retro/gameIds";
import type { WindowContent } from "../state/appState";
import type { WinampRegistry } from "../winamp/winampRegistry";
import { WinampRegistryContext } from "../winamp/winampRegistryContext";
import type { WindowCommands } from "../windows/useWindowCommands";
import { useWindowCommands } from "../windows/useWindowCommands";

/** Something `[open:<id>]` opens: a Fuse game, a retro game or a desktop app. */
export type OpenTarget = IntentTarget & {
  kind: "game" | "retro" | "app";
  content: WindowContent;
};

const APPS: readonly OpenTarget[] = [
  {
    id: "paint",
    name: "Paint",
    kind: "app",
    content: { kind: "paint" },
    aliases: ["mspaint"],
  },
  {
    id: "winamp",
    name: "Winamp",
    kind: "app",
    content: { kind: "winamp" },
    aliases: ["music player"],
  },
  {
    id: "settings",
    name: "Control Panel",
    kind: "app",
    content: { kind: "controlpanel", applet: "home" },
    aliases: ["settings", "options", "preferences"],
  },
  {
    id: "display",
    name: "Display Properties",
    kind: "app",
    content: { kind: "controlpanel", applet: "display" },
    aliases: ["wallpaper", "background", "display settings"],
  },
  {
    id: "about",
    name: "About FuseOS",
    kind: "app",
    content: { kind: "about" },
    aliases: ["about", "credits", "version"],
  },
];

/** Every id Clippy can open, Fuse games first: the registry's games, the retro games, then the apps. */
export function desktopTargets(games: FuseGameRegistry): OpenTarget[] {
  return [
    ...games.games.map((game): OpenTarget => ({
      id: game.id,
      name: game.name,
      kind: "game",
      content: { kind: "fusegame", gameId: game.id },
    })),
    ...GAME_IDS.map((id): OpenTarget => {
      const game = GAMES[id];
      return {
        id,
        name: game.name,
        kind: "retro",
        content: { kind: "retro", game: id },
        // "Commander Keen 1: Marooned on Mars" is "Keen" to everyone.
        aliases: id === "keen1" ? ["keen", "commander keen"] : undefined,
      };
    }),
    ...APPS,
  ];
}

/** The rules' view of the targets. */
export function intentCatalog(targets: readonly OpenTarget[]): IntentCatalog {
  return {
    targets,
    gameNames: targets
      .filter((target) => target.kind === "game")
      .map((target) => target.name),
  };
}

/** The prompt's view of the desktop. */
export function promptCatalog(
  games: FuseGameRegistry,
  targets: readonly OpenTarget[],
): PromptCatalog {
  return {
    games: games.games.map((game) => ({
      name: game.name,
      tagline: game.tagline,
    })),
    retroGames: targets
      .filter((target) => target.kind === "retro")
      .map((target) => target.name),
    apps: targets
      .filter((target) => target.kind === "app")
      .map((target) => `${target.name} (${target.id})`),
  };
}

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

export function createOpenTool(
  targets: readonly OpenTarget[],
  commands: Pick<WindowCommands, "open">,
): AssistantTool {
  return {
    name: "open",
    describe: () =>
      `[open:<id>] opens a game or app. Ids: ${targets.map((target) => target.id).join(", ")}.`,
    sentence: ({ arg }) =>
      `Opening ${resolveTarget(arg, targets)?.name ?? arg.trim()}`,
    run: ({ arg }): ToolResult => {
      const target = resolveTarget(arg, targets);
      if (!target)
        return {
          ok: false,
          sentence: `There is nothing called "${arg.trim()}" on this desktop`,
        };
      commands.open(target.content);
      return { ok: true, sentence: `Opened ${target.name}` };
    },
  };
}

const MUSIC_ACTIONS: readonly MusicAction[] = [
  "play",
  "pause",
  "stop",
  "next",
  "previous",
];

function isMusicAction(value: string): value is MusicAction {
  return (MUSIC_ACTIONS as readonly string[]).includes(value);
}

const MUSIC_SENTENCES: Record<MusicAction, string> = {
  play: "Playing music in Winamp",
  pause: "Pausing Winamp",
  stop: "Stopping Winamp",
  next: "Skipping to the next track",
  previous: "Going back a track",
};

/**
 * `[music:<action>]` over the running Winamp's transport. With no Winamp open, `play` opens one and presses
 * Play the moment it has loaded, so the Fuse soundtrack starts from the top; the other actions say so.
 */
export function createMusicTool(
  winamp: Pick<WinampRegistry, "first" | "onRegister">,
  commands: Pick<WindowCommands, "open">,
): AssistantTool {
  return {
    name: "music",
    describe: () =>
      `[music:<${MUSIC_ACTIONS.join("|")}>] controls Winamp, the music player.`,
    sentence: ({ arg }) =>
      isMusicAction(normalizeId(arg))
        ? MUSIC_SENTENCES[normalizeId(arg) as MusicAction]
        : `Winamp cannot "${arg.trim()}"`,
    run: ({ arg }): ToolResult => {
      const action = normalizeId(arg);
      if (!isMusicAction(action))
        return {
          ok: false,
          sentence: `Winamp cannot "${arg.trim()}"; try ${MUSIC_ACTIONS.join(", ")}`,
        };
      const controls = winamp.first();
      if (!controls) {
        if (action !== "play")
          return { ok: false, sentence: "Winamp is not open" };
        const unsubscribe = winamp.onRegister((loaded) => {
          unsubscribe();
          loaded.play();
        });
        commands.open({ kind: "winamp" });
        return {
          ok: true,
          sentence: "Starting Winamp with the Fuse soundtrack",
        };
      }
      controls[action]();
      return { ok: true, sentence: MUSIC_SENTENCES[action] };
    },
  };
}

/** The desktop's own tools and the catalogues they share with the prompt and the rules. */
export function useDesktopTools(): {
  tools: readonly AssistantTool[];
  targets: readonly OpenTarget[];
  intents: IntentCatalog;
  prompt: PromptCatalog;
} {
  const games = useContext(FuseGamesContext);
  const winampRegistry = useContext(WinampRegistryContext);
  const commands = useWindowCommands();
  return useMemo(() => {
    const targets = desktopTargets(games);
    return {
      tools: [
        createOpenTool(targets, commands),
        createMusicTool(winampRegistry, commands),
      ],
      targets,
      intents: intentCatalog(targets),
      prompt: promptCatalog(games, targets),
    };
  }, [games, winampRegistry, commands]);
}
