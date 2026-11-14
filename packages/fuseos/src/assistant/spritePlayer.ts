/**
 * The Office Assistant frame table, as clippyjs ships it (see docs/assistant):
 * every animation is a list of frames with a duration, the sprite sheet
 * offsets of the images to draw (one per overlay), an optional sound and
 * branching. Branching lets an idle animation loop and `exitBranch` says where
 * to jump when the animation is asked to end.
 */
export type SpriteFrame = {
  duration: number;
  /** Sprite sheet offsets, one per overlay; absent means draw nothing. */
  images?: [number, number][];
  sound?: string;
  /** Frame to jump to when an exit was requested. */
  exitBranch?: number;
  branching?: { branches: { frameIndex: number; weight: number }[] };
};

export type SpriteAnimation = { frames: SpriteFrame[] };

export type SpriteAgent = {
  overlayCount: number;
  sounds: string[];
  framesize: [number, number];
  animations: Record<string, SpriteAnimation>;
};

function isFrame(value: unknown): value is SpriteFrame {
  if (typeof value !== 'object' || value === null) return false;
  const frame: Record<string, unknown> = { ...value };
  return typeof frame.duration === 'number';
}

function isAnimation(value: unknown): value is SpriteAnimation {
  if (typeof value !== 'object' || value === null) return false;
  const animation: Record<string, unknown> = { ...value };
  return Array.isArray(animation.frames) && animation.frames.every(isFrame);
}

export function isSpriteAgent(value: unknown): value is SpriteAgent {
  if (typeof value !== 'object' || value === null) return false;
  const agent: Record<string, unknown> = { ...value };
  return (
    typeof agent.overlayCount === 'number' &&
    Array.isArray(agent.framesize) &&
    agent.framesize.length === 2 &&
    typeof agent.animations === 'object' &&
    agent.animations !== null &&
    Object.values(agent.animations).every(isAnimation)
  );
}

/**
 * The next frame to show, following the original animator: with branching, a
 * weighted random pick among the branches (the remaining weight stays on the
 * next frame); when exiting, the exit branch; at the end, undefined.
 */
export function nextFrameIndex(animation: SpriteAnimation, index: number, exiting: boolean, random: () => number): number | undefined {
  const frame = animation.frames[index];
  if (!frame) return undefined;
  if (exiting && frame.exitBranch !== undefined) return frame.exitBranch;
  if (frame.branching) {
    let roll = Math.floor(random() * 100);
    for (const branch of frame.branching.branches) {
      if (roll <= branch.weight) return branch.frameIndex;
      roll -= branch.weight;
    }
  }
  return index + 1 < animation.frames.length ? index + 1 : undefined;
}

/** The style for one overlay of a frame: where the sprite sheet is shifted to, or hidden. */
export function overlayPosition(frame: SpriteFrame | undefined, overlay: number): { x: number; y: number } | undefined {
  const image = frame?.images?.[overlay];
  // `|| 0` keeps -0 out of the style.
  return image ? { x: -image[0] || 0, y: -image[1] || 0 } : undefined;
}

/** The idle animations the clip plays on its own while nothing happens. */
export function idleAnimations(agent: Pick<SpriteAgent, 'animations'>): string[] {
  return Object.keys(agent.animations).filter((name) => name.startsWith('Idle'));
}

/** A random member of the list, or undefined for an empty one. */
export function pickRandom<T>(items: readonly T[], random: () => number): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))];
}
