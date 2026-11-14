import {
  FLOPPY_ZIP_NAME,
  HOMEWORK_TEXT,
  isPornPassword,
  MemoryFloppyJokeGate,
  PASSWORD_INCORRECT_MESSAGE,
  PORN_RESOURCE,
  RICKROLL_LOCATION,
  RICKROLL_TITLE,
  WINZIP_ERROR_MESSAGE,
  WINZIP_FAKE_ENTRIES,
  WINZIP_FAILURE_PROGRESS,
} from "./floppy";

describe("the floppy", () => {
  it("spells the archive exactly as the backup script did in 1997", () => {
    expect(FLOPPY_ZIP_NAME).toBe("slackbacup.zip");
    expect(WINZIP_ERROR_MESSAGE).toContain("may be a coaster");
    expect(WINZIP_FAILURE_PROGRESS).toBeGreaterThan(0.5);
    expect(WINZIP_FAILURE_PROGRESS).toBeLessThan(1);
    expect(WINZIP_FAKE_ENTRIES.length).toBeGreaterThan(3);
  });

  it("keeps the joke safe for work", () => {
    expect(HOMEWORK_TEXT).toBe("Nice try. Go play Fuseball.\n");
    expect(PASSWORD_INCORRECT_MESSAGE).toBe(
      "The password is incorrect. Access is denied.",
    );
    expect(PORN_RESOURCE).toBe("\\\\A:\\porn");
    expect(RICKROLL_LOCATION).toBe("A:/porn/definitely_not_porn.avi");
    expect(RICKROLL_TITLE).toBe("Never Gonna Give You Up.avi");
  });

  it("takes the password in any case, and nothing else", () => {
    expect(isPornPassword("mender")).toBe(true);
    expect(isPornPassword("MeNdEr")).toBe(true);
    expect(isPornPassword(" mender")).toBe(false);
    expect(isPornPassword("")).toBe(false);
  });

  it("counts wrong passwords and stays open once the right one is given", () => {
    const gate = new MemoryFloppyJokeGate();
    expect(gate.isUnlocked()).toBe(false);
    expect(gate.tryPassword("password")).toBe("denied");
    expect(gate.tryPassword("hunter2")).toBe("denied");
    expect(gate.failures()).toBe(2);
    expect(gate.isUnlocked()).toBe(false);
    expect(gate.tryPassword("MENDER")).toBe("granted");
    expect(gate.isUnlocked()).toBe(true);
    expect(gate.failures()).toBe(2);
  });
});
