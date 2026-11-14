import { useContext, useMemo } from "react";

import type { AgentOs, OpenTarget } from "../agenttools/agentOs";
import type { AgentTool } from "../agenttools/agentTool";
import { toMarkerTool } from "../agenttools/agentTool";
import { resolveTarget } from "../agenttools/appTools";
import { createMusicTool as createAgentMusicTool } from "../agenttools/mediaTools";
import { desktopTargets } from "../agenttools/targets";
import { useAgentTools } from "../agenttools/useAgentTools";
import type { FuseGameRegistry } from "../fusegames/registry";
import { FuseGamesContext } from "../fusegames/registry";
import type { IntentCatalog } from "../llm/intent";
import type { PromptCatalog } from "../llm/systemPrompt";
import type { AssistantTool, ToolResult } from "../llm/tools";
import type { WinampRegistry } from "../winamp/winampRegistry";
import type { WindowCommands } from "../windows/useWindowCommands";
import { useWindowCommands } from "../windows/useWindowCommands";

export type { OpenTarget } from "../agenttools/agentOs";
export { resolveTarget } from "../agenttools/appTools";
export { desktopTargets } from "../agenttools/targets";

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

/**
 * `[music:<action>]` over the running Winamp's transport: the typed `music` tool (`agenttools/mediaTools.ts`) in
 * marker form. With no Winamp open, `play` opens one and presses Play the moment it has loaded, so the Fuse
 * soundtrack starts from the top; the other actions say so.
 */
export function createMusicTool(
  winamp: Pick<WinampRegistry, "first" | "onRegister">,
  commands: Pick<WindowCommands, "open">,
): AssistantTool {
  const music: AgentOs["music"] = {
    controls: () => winamp.first(),
    openAndPlay: () => {
      const unsubscribe = winamp.onRegister((loaded) => {
        unsubscribe();
        loaded.play();
      });
      commands.open({ kind: "winamp" });
    },
  };
  return musicMarkerTool(createAgentMusicTool({ music }));
}

/** The music tool's marker with the short line a small model reads; volume stays out of it. */
function musicMarkerTool(tool: AgentTool): AssistantTool {
  return {
    ...toMarkerTool(tool),
    describe: () =>
      "[music:<play|pause|stop|next|previous>] controls Winamp, the music player.",
  };
}

/** The marker tools a small model is told about; the rest of the typed tools still run when the rules write their markers. */
const PROMPT_TOOL_NAMES: readonly string[] = ["open", "music"];

/**
 * The desktop's own tools and the catalogues they share with the prompts and the rules: `agentTools` are the
 * typed tools of the agent loop; `tools` are the markers the single-shot pipeline runs (`[open:<id>]` plus every
 * typed tool in marker form); `promptTools` the few of those a small model is told about.
 */
export function useDesktopTools(): {
  tools: readonly AssistantTool[];
  promptTools: readonly AssistantTool[];
  agentTools: readonly AgentTool[];
  targets: readonly OpenTarget[];
  intents: IntentCatalog;
  prompt: PromptCatalog;
} {
  const games = useContext(FuseGamesContext);
  const commands = useWindowCommands();
  const agent = useAgentTools();
  return useMemo(() => {
    const targets = desktopTargets(games);
    const tools = [
      createOpenTool(targets, commands),
      ...agent.tools.map((tool) =>
        tool.name === "music" ? musicMarkerTool(tool) : toMarkerTool(tool),
      ),
    ];
    return {
      tools,
      promptTools: tools.filter((tool) =>
        PROMPT_TOOL_NAMES.includes(tool.name),
      ),
      agentTools: agent.tools,
      targets,
      intents: intentCatalog(targets),
      prompt: promptCatalog(games, targets),
    };
  }, [games, commands, agent.tools]);
}
