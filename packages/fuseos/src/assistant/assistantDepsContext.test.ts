import { useClippyChat } from "./clippyChat";
import { CLIPPY_ASSETS, defaultAssistantDeps } from "./assistantDepsContext";

describe("defaultAssistantDeps", () => {
  it("points at the Clippy assets under the site base and answers with the model chat", () => {
    expect(defaultAssistantDeps.spriteUrl).toMatch(
      new RegExp(`${CLIPPY_ASSETS}/map\\.png$`),
    );
    expect(defaultAssistantDeps.useChat).toBe(useClippyChat);
    expect(defaultAssistantDeps.chatAvailable).toBe(true);
    const value = defaultAssistantDeps.random();
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(1);
  });

  it("runs timers through the window and plays sounds without throwing where audio is missing", () => {
    vi.useFakeTimers();
    try {
      let fired = 0;
      const handle = defaultAssistantDeps.setTimeout(() => {
        fired += 1;
      }, 100);
      const cancelled = defaultAssistantDeps.setTimeout(() => {
        fired += 10;
      }, 100);
      defaultAssistantDeps.clearTimeout(cancelled);
      vi.advanceTimersByTime(100);
      expect(fired).toBe(1);
      defaultAssistantDeps.clearTimeout(handle);
    } finally {
      vi.useRealTimers();
    }
    expect(() =>
      defaultAssistantDeps.playSound("data:audio/mp3;base64,AAAA"),
    ).not.toThrow();
  });

  it("loads the frame table and the sounds from the assets, rejecting what is not a frame table", async () => {
    const calls: string[] = [];
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith("agent.json"))
          return new Response(JSON.stringify({ nope: true }), { status: 200 });
        if (url.endsWith("sounds.json"))
          return new Response(JSON.stringify({ ding: "data:audio/x;," }), {
            status: 200,
          });
        return new Response("", { status: 404 });
      });
    try {
      await expect(defaultAssistantDeps.loadAgent()).rejects.toThrow(
        "is not a Clippy frame table",
      );
      await expect(defaultAssistantDeps.loadSounds()).resolves.toEqual({
        ding: "data:audio/x;,",
      });
      fetchSpy.mockImplementation(
        async () => new Response("", { status: 500 }),
      );
      await expect(defaultAssistantDeps.loadSounds()).rejects.toThrow(
        "Could not load",
      );
      fetchSpy.mockImplementation(
        async () => new Response(JSON.stringify([1, 2]), { status: 200 }),
      );
      await expect(defaultAssistantDeps.loadSounds()).resolves.toEqual({});
      expect(calls[0]).toMatch(/fuseos\/clippy\/agent\.json$/);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
