import {
  browserLaunchDevice,
  LaunchDeviceContext,
  readLaunchDevice,
} from "./launchDevice";

describe(readLaunchDevice.name, () => {
  it("reads a fine pointer and the viewport width from the window", () => {
    const queries: string[] = [];
    expect(
      readLaunchDevice({
        matchMedia: (query) => {
          queries.push(query);
          return { matches: true };
        },
        innerWidth: 1440,
      }),
    ).toEqual({ finePointer: true, viewportWidth: 1440 });
    expect(queries).toEqual(["(pointer: fine)"]);
    expect(
      readLaunchDevice({
        matchMedia: () => ({ matches: false }),
        innerWidth: 390,
      }),
    ).toEqual({ finePointer: false, viewportWidth: 390 });
  });

  it("treats a browser without matchMedia as coarse, so games open in a tab", () => {
    expect(readLaunchDevice({ innerWidth: 1440 }).finePointer).toBe(false);
  });

  it("reads the real window by default", () => {
    expect(browserLaunchDevice().viewportWidth).toBe(window.innerWidth);
    expect(LaunchDeviceContext).toBeDefined();
  });
});
