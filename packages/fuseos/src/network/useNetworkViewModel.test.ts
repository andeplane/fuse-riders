import { formatLastPlayed } from "./useNetworkViewModel";

describe(formatLastPlayed.name, () => {
  const noon = new Date(1998, 5, 25, 12, 34).getTime();

  it("says Today with the time for the same day", () => {
    expect(formatLastPlayed(noon - 60_000, noon)).toBe("Today 12:33");
  });

  it("says Yesterday for the day before", () => {
    expect(formatLastPlayed(noon - 24 * 60 * 60 * 1000, noon)).toBe(
      "Yesterday 12:34",
    );
  });

  it("gives the date further back", () => {
    expect(formatLastPlayed(new Date(1998, 0, 2, 9, 5).getTime(), noon)).toBe(
      "2 Jan 1998",
    );
  });
});
