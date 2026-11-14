import { formatLastSeen } from "./useFriendsViewModel";

const HOUR = 3_600_000;
const NOW = Date.UTC(1998, 5, 25, 12, 34);

describe(formatLastSeen.name, () => {
  it("says how long ago an offline buddy was last seen, in hours then days", () => {
    expect(formatLastSeen(NOW - 10 * 60_000, NOW)).toBe("within the hour");
    expect(formatLastSeen(NOW - HOUR, NOW)).toBe("an hour ago");
    expect(formatLastSeen(NOW - 5 * HOUR, NOW)).toBe("5 hours ago");
    expect(formatLastSeen(NOW - 30 * HOUR, NOW)).toBe("yesterday");
    expect(formatLastSeen(NOW - 80 * HOUR, NOW)).toBe("3 days ago");
  });
});
