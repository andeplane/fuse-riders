import { sceneCandidates } from "./ddrPlayers";
import { nickMentioned, pickScene, sceneGapMs } from "./scene";

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

describe("model conversation", () => {
  it("waits between 10 and 120 seconds", () => {
    expect(sceneGapMs(() => 0)).toBe(10_000);
    expect(sceneGapMs(() => 0.999999)).toBe(120_000);
    expect(sceneGapMs(() => 1)).toBe(120_000);
  });

  it("draws 3 to 5 distinct players, weighted towards more tournaments", () => {
    const players = sceneCandidates();
    const random = rng(7);
    const counts = new Map<string, number>();
    for (let n = 0; n < 400; n += 1) {
      const group = pickScene(players, random);
      expect(group.length).toBeGreaterThanOrEqual(3);
      expect(group.length).toBeLessThanOrEqual(5);
      expect(new Set(group).size).toBe(group.length);
      for (const nick of group) counts.set(nick, (counts.get(nick) ?? 0) + 1);
    }
    expect(counts.get("Snute") ?? 0).toBeGreaterThan(
      (counts.get("Abra") ?? 0) * 2,
    );
  });

  it("matches a nick only as its own word", () => {
    expect(nickMentioned("Al, kommer du?", "Al")).toBe(true);
    expect(nickMentioned("skal vi ta butterfly", "Al")).toBe(false);
    expect(nickMentioned("hei Andeplane", "Al")).toBe(false);
    expect(nickMentioned("T|na?", "T|na")).toBe(true);
  });
});
