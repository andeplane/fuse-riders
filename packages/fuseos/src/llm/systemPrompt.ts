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
