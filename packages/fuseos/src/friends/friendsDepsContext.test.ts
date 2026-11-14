import { defaultFriendsDeps } from "./friendsDepsContext";

describe("defaultFriendsDeps", () => {
  it("tells the time, schedules and cancels with the window's timers", async () => {
    expect(Math.abs(defaultFriendsDeps.now() - Date.now())).toBeLessThan(1000);
    const ran: string[] = [];
    const cancel = defaultFriendsDeps.schedule(() => ran.push("cancelled"), 1);
    defaultFriendsDeps.schedule(() => ran.push("kept"), 2);
    cancel();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(ran).toEqual(["kept"]);
  });

  it("plays no sound by default and copies without throwing where there is no clipboard", async () => {
    expect(defaultFriendsDeps.playAlert()).toBeUndefined();
    await expect(defaultFriendsDeps.copyText("abc")).resolves.toBeUndefined();
  });
});
