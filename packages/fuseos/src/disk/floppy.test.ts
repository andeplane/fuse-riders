import {
  ACCESS_DENIED_MESSAGE,
  FLOPPY_ZIP_NAME,
  HOMEWORK_TEXT,
  MemoryFloppyJokeGate,
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
    expect(ACCESS_DENIED_MESSAGE).toContain("Access is denied.");
  });

  it("denies the joke folder once, then lets everyone in", () => {
    const gate = new MemoryFloppyJokeGate();
    expect(gate.attempts()).toBe(0);
    expect(gate.tryOpen()).toBe("denied");
    expect(gate.tryOpen()).toBe("open");
    expect(gate.tryOpen()).toBe("open");
    expect(gate.attempts()).toBe(3);
  });
});
