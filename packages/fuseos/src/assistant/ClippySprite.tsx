import { useContext, useEffect, useRef, useState } from 'react';

import { AssistantDepsContext } from './assistantDepsContext';
import type { AnimationRequest } from './assistantState';
import { WORKING_ANIMATIONS } from './assistantState';
import type { SpriteAgent } from './spritePlayer';
import { idleAnimations, nextFrameIndex, overlayPosition, pickRandom } from './spritePlayer';

export type ClippySpriteProps = {
  agent: SpriteAgent | undefined;
  sounds: Record<string, string> | undefined;
  /** The animation the last event asked for; a new `seq` interrupts whatever plays. */
  request: AnimationRequest | null;
  /** The assistant is working: loop the thinking animations until it is done. */
  busy: boolean;
  animate: boolean;
  playSounds: boolean;
  label: string;
};

type Playing = { name: string; index: number };

/** Time between idle animations, in ms: 6 to 14 seconds. */
export const IDLE_DELAY_MIN_MS = 6000;
export const IDLE_DELAY_SPREAD_MS = 8000;
/** Breathing room before the next thinking loop. */
export const BUSY_DELAY_MS = 250;

const REST_POSE = 'RestPose';

/**
 * Plays the Office Assistant frame table: the requested animation, then the
 * thinking loops while the assistant works, otherwise an idle animation now and then.
 * Frames are drawn by shifting the sprite sheet under one div per overlay.
 */
export function ClippySprite({ agent, sounds, request, busy, animate, playSounds, label }: ClippySpriteProps) {
  const deps = useContext(AssistantDepsContext);
  const [requested, setPlaying] = useState<Playing | null>(null);
  const exiting = useRef(false);
  const lastRequest = useRef<number | undefined>(undefined);
  // A frame the table does not have (an animation ended, or the table changed) means nothing plays.
  const playing = requested && agent?.animations[requested.name]?.frames[requested.index] ? requested : null;

  const start = (name: string) => {
    exiting.current = false;
    setPlaying(agent?.animations[name] ? { name, index: 0 } : null);
  };

  // A new request interrupts whatever plays.
  useEffect(() => {
    if (!agent || !animate || !request || request.seq === lastRequest.current) return;
    lastRequest.current = request.seq;
    start(request.name);
  }, [agent, animate, request]);

  // When the assistant starts or stops working, let the current loop find its exit.
  useEffect(() => {
    exiting.current = true;
  }, [busy]);

  // Step through the frames of the current animation.
  useEffect(() => {
    if (!agent || !animate || !playing) return undefined;
    const animation = agent.animations[playing.name];
    const frame = animation?.frames[playing.index];
    if (!animation || !frame) return undefined;
    const sound = frame.sound ? sounds?.[frame.sound] : undefined;
    if (sound && playSounds) deps.playSound(sound);
    const handle = deps.setTimeout(() => {
      const next = nextFrameIndex(animation, playing.index, exiting.current, deps.random);
      setPlaying(next === undefined ? null : { name: playing.name, index: next });
    }, frame.duration);
    return () => deps.clearTimeout(handle);
  }, [agent, animate, playing, playSounds, sounds, deps]);

  // Nothing playing: think while busy, otherwise fidget now and then.
  useEffect(() => {
    if (!agent || !animate || playing) return undefined;
    const name = busy ? pickRandom(WORKING_ANIMATIONS, deps.random) : pickRandom(idleAnimations(agent), deps.random);
    if (!name) return undefined;
    const delay = busy ? BUSY_DELAY_MS : IDLE_DELAY_MIN_MS + Math.floor(deps.random() * IDLE_DELAY_SPREAD_MS);
    const handle = deps.setTimeout(() => start(name), delay);
    return () => deps.clearTimeout(handle);
  }, [agent, animate, playing, busy, deps]);

  const [width, height] = agent?.framesize ?? [124, 93];
  const frame = playing ? agent?.animations[playing.name]?.frames[playing.index] : agent?.animations[REST_POSE]?.frames[0];
  const overlays = Array.from({ length: agent?.overlayCount ?? 1 }, (_, overlay) => overlayPosition(frame, overlay));
  return (
    <div role="img" aria-label={label} data-animation={playing?.name ?? 'RestPose'} data-frame={playing?.index ?? 0} style={{ width, height, position: 'relative' }}>
      {overlays.map((position, overlay) => (
        <div
          key={overlay}
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: `url(${deps.spriteUrl})`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: position ? `${position.x}px ${position.y}px` : undefined,
            display: position ? 'block' : 'none',
            imageRendering: 'pixelated',
          }}
        />
      ))}
    </div>
  );
}
