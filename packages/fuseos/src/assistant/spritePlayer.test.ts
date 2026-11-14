import type { SpriteAgent, SpriteAnimation } from "./spritePlayer";
import {
  idleAnimations,
  isSpriteAgent,
  nextFrameIndex,
  overlayPosition,
  pickRandom,
} from "./spritePlayer";

const LOOPING: SpriteAnimation = {
  frames: [
    { duration: 100, images: [[0, 0]] },
    {
      duration: 100,
      images: [[124, 0]],
      exitBranch: 3,
      branching: { branches: [{ frameIndex: 1, weight: 90 }] },
    },
    { duration: 100, images: [[248, 0]] },
    { duration: 100 },
  ],
};

describe(nextFrameIndex.name, () => {
  it("steps through the frames and ends after the last one", () => {
    const plain: SpriteAnimation = {
      frames: [{ duration: 1 }, { duration: 1 }],
    };
    expect(nextFrameIndex(plain, 0, false, () => 0)).toBe(1);
    expect(nextFrameIndex(plain, 1, false, () => 0)).toBeUndefined();
    expect(nextFrameIndex(plain, 5, false, () => 0)).toBeUndefined();
  });

  it("follows a branch when the roll lands inside its weight, else continues", () => {
    expect(nextFrameIndex(LOOPING, 1, false, () => 0.5)).toBe(1);
    expect(nextFrameIndex(LOOPING, 1, false, () => 0.95)).toBe(2);
  });

  it("takes the exit branch when asked to finish", () => {
    expect(nextFrameIndex(LOOPING, 1, true, () => 0)).toBe(3);
    expect(nextFrameIndex(LOOPING, 0, true, () => 0)).toBe(1);
  });
});

describe(overlayPosition.name, () => {
  it("shifts the sheet to the image, and hides overlays without one", () => {
    expect(overlayPosition(LOOPING.frames[1], 0)).toEqual({ x: -124, y: 0 });
    expect(overlayPosition(LOOPING.frames[1], 1)).toBeUndefined();
    expect(overlayPosition(LOOPING.frames[3], 0)).toBeUndefined();
    expect(overlayPosition(undefined, 0)).toBeUndefined();
  });
});

describe(isSpriteAgent.name, () => {
  it("accepts the clippyjs shape and rejects anything else", () => {
    const agent: SpriteAgent = {
      overlayCount: 1,
      sounds: ["1"],
      framesize: [124, 93],
      animations: { Wave: LOOPING },
    };
    expect(isSpriteAgent(agent)).toBe(true);
    expect(
      isSpriteAgent({ ...agent, animations: { Wave: { frames: [{}] } } }),
    ).toBe(false);
    expect(isSpriteAgent({ ...agent, framesize: [1] })).toBe(false);
    expect(isSpriteAgent(null)).toBe(false);
  });
});

describe(idleAnimations.name, () => {
  it("lists the Idle animations only", () => {
    expect(
      idleAnimations({
        animations: { Idle1_1: LOOPING, IdleSnooze: LOOPING, Wave: LOOPING },
      }),
    ).toEqual(["Idle1_1", "IdleSnooze"]);
  });
});

describe(pickRandom.name, () => {
  it("picks by the random number and copes with an empty list", () => {
    expect(pickRandom(["a", "b", "c"], () => 0.99)).toBe("c");
    expect(pickRandom(["a", "b", "c"], () => 0)).toBe("a");
    expect(pickRandom([], () => 0)).toBeUndefined();
  });
});
