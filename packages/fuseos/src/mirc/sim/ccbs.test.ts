import {
  describe as describeTournament,
  findTournament,
  latest,
  playerName,
  playerRecord,
  podium,
  ranked,
  seasons,
  TOURNAMENTS,
} from "./ccbs";
import type { Tournament } from "./ccbs";

describe("CCBS results", () => {
  it("bundles the Norwegian tournaments, oldest first, without test events", () => {
    expect(TOURNAMENTS.length).toBeGreaterThan(40);
    expect(TOURNAMENTS.some((t) => t.season === "Testturnering")).toBe(false);
    const dates = TOURNAMENTS.map((t) => t.date);
    expect([...dates].sort()).toEqual(dates);
    expect(ranked().every((t) => t.top.length > 0)).toBe(true);
  });

  it("finds the latest individual event and tournaments by id or words", () => {
    expect(latest()?.name).toBe("DDR Norway Reunion");
    expect(latest([])).toBeUndefined();
    expect(findTournament("9")?.name).toBe("Challenge Cup 1");
    expect(findTournament("cc 3 2004")?.date).toBe("2004-05-23");
    expect(findTournament("reunion")?.name).toMatch(/Reunion/);
    expect(findTournament("nm05 single gutter")?.name).toBe(
      "NM05 - Expert Single Gutter",
    );
    expect(findTournament("nothing like this")).toBeUndefined();
    expect(findTournament("  ")).toBeUndefined();
  });

  it("summarises a player across rankings, ignoring club tags and case", () => {
    expect(playerName("Snute (HDC)")).toBe("Snute");
    const record = playerRecord("andeplane");
    expect(record?.name).toBe("Andeplane");
    expect(record?.wins).toBeGreaterThanOrEqual(1);
    expect(record?.best?.rank).toBe(1);
    expect(playerRecord("nobody-at-all")).toBeUndefined();
    expect(playerRecord("")).toBeUndefined();
  });

  it("formats podiums and descriptions", () => {
    const sample: Tournament = {
      id: 1,
      name: "Test Cup",
      season: "S",
      place: "Hall",
      date: "2003-01-01",
      machine: "EuroMix 2",
      top: [
        ["A (X)", 100],
        ["B", 90],
        ["C", 81],
        ["D", 73],
      ],
    };
    expect(podium(sample)).toBe("1. A (X) (100)  2. B (90)  3. C (81)");
    expect(describeTournament(sample)).toBe(
      "Test Cup - 2003-01-01, Hall (EuroMix 2)",
    );
    expect(seasons([sample])).toEqual(["S"]);
    expect(seasons()).toContain("Challenge Cup 2003");
  });
});
