import type { AgentTool } from "../agenttools/agentTool";
import { ANSWER_TOOL, describeTool } from "../agenttools/agentTool";

import type { AssistantTool } from "./tools";
import { toolInstructions } from "./tools";

/** What the prompt lists: the Fuse games with their taglines, the retro games and the desktop apps. */
export type PromptCatalog = {
  games: readonly { name: string; tagline: string }[];
  retroGames: readonly string[];
  apps: readonly string[];
};

export const CLIPPY_PERSONA = [
  "You are Clippy, the Office Assistant of FuseOS: an upbeat, helpful paperclip on a Windows 98 desktop that fronts the Fuse games, a set of small multiplayer browser games for friends.",
  "Answer in one to three short sentences, cheerful and playful, with at most one exclamation mark. Never pretend to know things that are not in this prompt.",
].join(" ");

/** Clippy's standing instructions: who he is, what is on the desktop, which markers do things. */
export function buildSystemPrompt(
  catalog: PromptCatalog,
  tools: readonly AssistantTool[],
): string {
  const games =
    catalog.games.length === 0
      ? "No Fuse games are installed."
      : [
          "Fuse games on this desktop:",
          ...catalog.games.map((game) => `- ${game.name}: ${game.tagline}`),
        ].join("\n");
  const retro =
    catalog.retroGames.length === 0
      ? ""
      : `Retro games (Start, Programs, Games): ${catalog.retroGames.join(", ")}.`;
  const apps =
    catalog.apps.length === 0 ? "" : `Apps: ${catalog.apps.join(", ")}.`;
  return [CLIPPY_PERSONA, games, retro, apps, toolInstructions(tools)]
    .filter((section) => section !== "")
    .join("\n\n");
}

/**
 * Clippy's instructions for the agent loop: the persona, the games, and every typed tool with its call shape.
 * The same text serves both wire formats; the JSON one also needs the reply shape spelled out.
 */
export function buildAgentPrompt(
  catalog: PromptCatalog,
  tools: readonly AgentTool[],
  style: "json" | "native" = "json",
): string {
  const games =
    catalog.games.length === 0
      ? "No Fuse games are installed."
      : `Fuse games: ${catalog.games.map((game) => `${game.name} (${game.tagline})`).join("; ")}.`;
  const format =
    style === "json"
      ? [
          `You operate the desktop for the user by calling tools, one per reply. Every reply is exactly one JSON object and nothing else: {"tool":"<name>","args":{...}}.`,
          `After each call you are told the result. Then call the next tool, or finish with {"tool":"${ANSWER_TOOL}","args":{"text":"<what you say to the user>"}}.`,
          `Example. User: "open paint and play music". You: {"tool":"open_app","args":{"id":"paint"}} then {"tool":"music","args":{"action":"play"}} then {"tool":"${ANSWER_TOOL}","args":{"text":"Paint is open and the music is playing!"}}`,
        ]
      : [
          "You operate the desktop for the user by calling tools. After each call you are told the result; call the next tool, or answer the user in plain words when the request is done.",
        ];
  return [
    CLIPPY_PERSONA,
    ...format,
    `Do exactly what the user asked and nothing more. When the user asks for several things, call one tool for each of them before you answer, and never say you did something you did not call a tool for. A question or a chat needs no tool: ${style === "json" ? `use ${ANSWER_TOOL}` : "just answer"} straight away. Never invent ids, windows or paths; look first (get_desktop_state, list_games, list_dir) when unsure.`,
    "Tools:",
    ...tools.map(describeTool),
    games,
  ].join("\n");
}
