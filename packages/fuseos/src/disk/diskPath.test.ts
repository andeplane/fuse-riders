import {
  ancestorsOf,
  driveOf,
  formatAddress,
  joinLocation,
  MY_COMPUTER,
  nameOf,
  parentOf,
  parseAddress,
  pathWithin,
} from "./diskPath";

describe("disk locations", () => {
  it("knows the drive and the path within it", () => {
    expect(driveOf(MY_COMPUTER)).toBeUndefined();
    expect(driveOf("C:")).toBe("C");
    expect(driveOf("A:/porn")).toBe("A");
    expect(driveOf("D:/nope")).toBeUndefined();
    expect(pathWithin("C:/packages/fuseos")).toBe("packages/fuseos");
    expect(pathWithin("C:")).toBe("");
    expect(pathWithin(MY_COMPUTER)).toBe("");
  });

  it("joins and splits locations", () => {
    expect(joinLocation(MY_COMPUTER, "C")).toBe("C:");
    expect(joinLocation("C:", "packages")).toBe("C:/packages");
    expect(joinLocation("C:/packages", "fuseos")).toBe("C:/packages/fuseos");
    expect(parentOf("C:/packages/fuseos")).toBe("C:/packages");
    expect(parentOf("C:/packages")).toBe("C:");
    expect(parentOf("C:")).toBe(MY_COMPUTER);
    expect(parentOf(MY_COMPUTER)).toBeUndefined();
    expect(ancestorsOf("A:/porn")).toEqual([MY_COMPUTER, "A:", "A:/porn"]);
  });

  it("names a location the way Explorer's title and tree do", () => {
    expect(nameOf(MY_COMPUTER)).toBe("My Computer");
    expect(nameOf("C:")).toBe("Fuse Riders (C:)");
    expect(nameOf("A:")).toBe("3½ Floppy (A:)");
    expect(nameOf("C:/packages/fuseos/src/App.tsx")).toBe("App.tsx");
  });

  it("formats the address bar with backslashes", () => {
    expect(formatAddress(MY_COMPUTER)).toBe("My Computer");
    expect(formatAddress("C:")).toBe("C:\\");
    expect(formatAddress("C:/packages/fuseos")).toBe("C:\\packages\\fuseos");
  });

  it("parses what was typed into the address bar, either separator, any case", () => {
    expect(parseAddress("My Computer")).toBe(MY_COMPUTER);
    expect(parseAddress("  ")).toBe(MY_COMPUTER);
    expect(parseAddress("c:")).toBe("C:");
    expect(parseAddress("C:\\")).toBe("C:");
    expect(parseAddress("C:\\packages\\fuseos\\")).toBe("C:/packages/fuseos");
    expect(parseAddress("C:/packages//fuseos")).toBe("C:/packages/fuseos");
    expect(parseAddress("a:\\porn")).toBe("A:/porn");
    expect(parseAddress("C")).toBe("C:");
  });

  it("rejects unknown drives, escapes and nonsense", () => {
    expect(parseAddress("D:\\")).toBeUndefined();
    expect(parseAddress("C:\\..\\secret")).toBeUndefined();
    expect(parseAddress("packages/fuseos")).toBeUndefined();
    expect(parseAddress("http://example.com")).toBeUndefined();
  });
});
