import type { PlaybackState } from "./playback";
import {
  advancePlayback,
  CODEC_CHECK_AT,
  codecErrorMessage,
  fakeDuration,
  INITIAL_PLAYBACK,
  playbackStatus,
  startBuffering,
  tickAdvance,
} from "./playback";

function run(launches: boolean): PlaybackState[] {
  const states: PlaybackState[] = [startBuffering()];
  for (let guard = 0; guard < 200; guard += 1) {
    const last = states[states.length - 1];
    if (!last || last.phase !== "buffering") break;
    states.push(advancePlayback(last, "clip.avi", launches));
  }
  return states;
}

describe(advancePlayback.name, () => {
  it("races, crawls around the codec check, then dies there for an ordinary file", () => {
    const states = run(false);
    const progress = states.flatMap((state) =>
      state.phase === "buffering" ? [state.progress] : [],
    );
    expect(progress).toEqual([0, 3, 6, 9, 12, 15, 18, 19, 20, 21, 22]);
    expect(states.at(-1)).toEqual({
      phase: "error",
      message: codecErrorMessage("clip.avi"),
    });
    expect(progress.every((value) => value < CODEC_CHECK_AT)).toBe(true);
  });

  it("buffers all the way and starts playing for the file that is really a game", () => {
    const states = run(true);
    const last = states.at(-1);
    expect(last).toEqual({ phase: "playing" });
    const beforeLast = states.at(-2);
    expect(beforeLast?.phase).toBe("buffering");
    expect(states.length).toBeGreaterThan(20);
  });

  it("leaves any other phase alone", () => {
    expect(advancePlayback(INITIAL_PLAYBACK, "x", false)).toBe(
      INITIAL_PLAYBACK,
    );
    const error: PlaybackState = { phase: "error", message: "m" };
    expect(advancePlayback(error, "x", true)).toBe(error);
  });

  it("steps quick, then slow, then quick", () => {
    expect(tickAdvance(0)).toBe(3);
    expect(tickAdvance(17)).toBe(3);
    expect(tickAdvance(18)).toBe(1);
    expect(tickAdvance(23)).toBe(1);
    expect(tickAdvance(24)).toBe(5);
    expect(tickAdvance(99)).toBe(5);
  });
});

describe(playbackStatus.name, () => {
  it("names every phase", () => {
    expect(playbackStatus(INITIAL_PLAYBACK)).toBe("Stopped");
    expect(playbackStatus({ phase: "buffering", progress: 7 })).toBe(
      "Buffering... 7%",
    );
    expect(playbackStatus({ phase: "error", message: "m" })).toBe(
      "Cannot play file",
    );
    expect(playbackStatus({ phase: "playing" })).toBe("Playing");
  });
});

describe(codecErrorMessage.name, () => {
  it("names the file and the error code", () => {
    const message = codecErrorMessage("Fifty_Shades_of_Teal.avi");
    expect(message).toContain('cannot play "Fifty_Shades_of_Teal.avi"');
    expect(message).toContain("Codec not found");
    expect(message).toContain("C00D11B1");
  });
});

describe(fakeDuration.name, () => {
  it("is deterministic per file, between half an hour and two hours", () => {
    const first = fakeDuration("Debbie_Does_Netcode.avi");
    expect(first).toBe(fakeDuration("Debbie_Does_Netcode.avi"));
    expect(first).toMatch(/^0[0-1]:[0-5]\d:[0-5]\d$/);
    expect(fakeDuration("Hot_Singles_In_Your_Lobby.mpg")).not.toBe(first);
  });
});
