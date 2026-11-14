import { buildSystemPrompt, CLIPPY_PERSONA } from "./systemPrompt";
import type { AssistantTool } from "./tools";

const OPEN: AssistantTool = {
  name: "open",
  describe: () => "[open:<id>] opens a game or app. Ids: fuseball, paint.",
  sentence: () => "",
  run: () => ({ ok: true, sentence: "" }),
};

describe(buildSystemPrompt.name, () => {
  it("introduces Clippy, lists the games with taglines, the retro games, the apps and the tools", () => {
    const prompt = buildSystemPrompt(
      {
        games: [
          { name: "Fuseball", tagline: "Five-a-side with rockets" },
          { name: "Fuse Riders", tagline: "Light cycles for five" },
        ],
        retroGames: ["DOOM", "Solitaire"],
        apps: ["Paint (paint)", "Winamp (winamp)"],
      },
      [OPEN],
    );
    expect(prompt.startsWith(CLIPPY_PERSONA)).toBe(true);
    expect(prompt).toContain("- Fuseball: Five-a-side with rockets");
    expect(prompt).toContain("- Fuse Riders: Light cycles for five");
    expect(prompt).toContain(
      "Retro games (Start, Programs, Games): DOOM, Solitaire.",
    );
    expect(prompt).toContain("Apps: Paint (paint), Winamp (winamp).");
    expect(prompt).toContain(
      "- [open:<id>] opens a game or app. Ids: fuseball, paint.",
    );
    expect(prompt).toContain("at most one exclamation mark");
  });

  it("says so when nothing is installed and leaves out empty sections", () => {
    const prompt = buildSystemPrompt(
      { games: [], retroGames: [], apps: [] },
      [],
    );
    expect(prompt).toBe(`${CLIPPY_PERSONA}\n\nNo Fuse games are installed.`);
  });
});
