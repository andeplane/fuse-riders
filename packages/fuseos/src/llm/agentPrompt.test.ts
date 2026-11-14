import { createFakeAgentOs, FAKE_GAMES } from "../__mocks__/agentOs";
import { createAgentTools } from "../agenttools/createAgentTools";

import { buildAgentPrompt, CLIPPY_PERSONA } from "./systemPrompt";

describe(buildAgentPrompt.name, () => {
  const tools = createAgentTools(createFakeAgentOs(), { current: undefined });
  const catalog = { games: FAKE_GAMES, retroGames: ["DOOM"], apps: [] };

  it("gives the persona, the JSON reply shape with an example, every tool's call shape and the games", () => {
    const prompt = buildAgentPrompt(catalog, tools);
    expect(prompt.startsWith(CLIPPY_PERSONA)).toBe(true);
    expect(prompt).toContain('{"tool":"<name>","args":{...}}');
    expect(prompt).toContain(
      '{"tool":"answer","args":{"text":"<what you say to the user>"}}',
    );
    expect(prompt).toContain('{"tool":"music","args":{"action":"play"}}');
    expect(prompt).toContain("use answer straight away");
    expect(prompt).toContain(
      "- open_app(id) Opens a program or a game, or brings it to the front. Music is the music tool, not a game. id: fuseball|fuse-riders|fuse-birds|doom|minesweeper|paint|winamp|notepad|explorer|settings.",
    );
    expect(prompt).toContain("- list_games() Lists the Fuse games");
    expect(prompt).toContain(
      "crt: off|scanlines|full (full is the whole old-monitor effect)",
    );
    for (const tool of tools) expect(prompt).toContain(`- ${tool.name}(`);
    expect(prompt).toContain(
      "Fuse games: Fuseball (Five-a-side with rockets); Fuse Riders (Light cycles for five); Fuse Birds (Flap, dodge, survive).",
    );
    // A local model has a 4096-token window; the prompt has to leave most of it to the conversation.
    expect(prompt.length).toBeLessThan(5000);
  });

  it("leaves the JSON shape out for native function calling, and says so when no game is installed", () => {
    const prompt = buildAgentPrompt(
      { games: [], retroGames: [], apps: [] },
      tools,
      "native",
    );
    expect(prompt).not.toContain('{"tool"');
    expect(prompt).toContain("answer the user in plain words");
    expect(prompt).toContain("just answer straight away");
    expect(prompt).toContain("No Fuse games are installed.");
  });
});
