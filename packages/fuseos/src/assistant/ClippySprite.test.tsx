import { act, render, screen } from '@testing-library/react';

import { FAKE_SPRITE_AGENT, createTestAssistantDeps } from '../__mocks__/assistantDeps';

import { AssistantDepsContext } from './assistantDepsContext';
import type { ClippySpriteProps } from './ClippySprite';
import { BUSY_DELAY_MS, ClippySprite, IDLE_DELAY_MIN_MS } from './ClippySprite';

function renderSprite(props: Partial<ClippySpriteProps> = {}, deps = createTestAssistantDeps()) {
  const all: ClippySpriteProps = { agent: FAKE_SPRITE_AGENT, sounds: { '1': 'data:audio/mpeg;base64,AAAA' }, request: null, busy: false, animate: true, playSounds: false, label: 'Clippy', ...props };
  const result = render(
    <AssistantDepsContext.Provider value={deps}>
      <ClippySprite {...all} />
    </AssistantDepsContext.Provider>
  );
  const rerender = (next: Partial<ClippySpriteProps>) =>
    result.rerender(
      <AssistantDepsContext.Provider value={deps}>
        <ClippySprite {...all} {...next} />
      </AssistantDepsContext.Provider>
    );
  return { ...result, rerender, deps };
}

function sprite() {
  return screen.getByRole('img', { name: 'Clippy' });
}

describe(ClippySprite.name, () => {
  it('rests until an idle animation is due, then plays it frame by frame on the injected clock', () => {
    const { deps } = renderSprite();
    expect(sprite()).toHaveAttribute('data-animation', 'RestPose');
    expect(deps.timers.map((timer) => timer.ms)).toEqual([IDLE_DELAY_MIN_MS]);
    act(() => deps.flushTimers());
    expect(sprite()).toHaveAttribute('data-animation', 'Idle1_1');
    expect(sprite()).toHaveAttribute('data-frame', '0');
    act(() => deps.flushTimers());
    expect(sprite()).toHaveAttribute('data-frame', '1');
    act(() => deps.flushTimers());
    // The animation ended: back to rest, the next idle scheduled.
    expect(sprite()).toHaveAttribute('data-animation', 'RestPose');
    expect(deps.timers.map((timer) => timer.ms)).toEqual([IDLE_DELAY_MIN_MS]);
  });

  it('plays a request at once and a new seq restarts it', () => {
    const { rerender } = renderSprite({ request: { name: 'Greeting', seq: 1 } });
    expect(sprite()).toHaveAttribute('data-animation', 'Greeting');
    rerender({ request: { name: 'Wave', seq: 2 } });
    expect(sprite()).toHaveAttribute('data-animation', 'Wave');
    // An animation the table does not have shows the rest pose.
    rerender({ request: { name: 'Moonwalk', seq: 3 } });
    expect(sprite()).toHaveAttribute('data-animation', 'RestPose');
  });

  it('loops the thinking animations while busy and stops when done', () => {
    const { deps, rerender } = renderSprite({ busy: true });
    expect(deps.timers.map((timer) => timer.ms)).toEqual([BUSY_DELAY_MS]);
    act(() => deps.flushTimers());
    expect(sprite()).toHaveAttribute('data-animation', 'Thinking');
    act(() => deps.flushTimers());
    act(() => deps.flushTimers());
    expect(deps.timers.map((timer) => timer.ms)).toEqual([BUSY_DELAY_MS]);
    rerender({ busy: false });
    act(() => deps.flushTimers());
    expect(sprite()).toHaveAttribute('data-animation', 'Idle1_1');
  });

  it('draws the sprite sheet at the frame offset and plays sounds only when asked', () => {
    const { deps, rerender } = renderSprite({ request: { name: 'Wave', seq: 1 } });
    const layer = sprite().firstElementChild;
    expect(layer).toHaveStyle({ backgroundImage: `url(${deps.spriteUrl})`, backgroundPosition: '-744px 0px' });
    expect(deps.playSound).not.toHaveBeenCalled();
    rerender({ request: { name: 'Wave', seq: 2 }, playSounds: true, agent: { ...FAKE_SPRITE_AGENT, animations: { Wave: { frames: [{ duration: 10, images: [[0, 0]], sound: '1' }] } } } });
    expect(deps.playSound).toHaveBeenCalledWith('data:audio/mpeg;base64,AAAA');
  });

  it('stays still without animations or before the frame table loads', () => {
    const { deps, rerender } = renderSprite({ animate: false, request: { name: 'Greeting', seq: 1 } });
    expect(sprite()).toHaveAttribute('data-animation', 'RestPose');
    expect(deps.timers).toEqual([]);
    rerender({ agent: undefined, animate: true });
    expect(sprite()).toHaveAttribute('data-animation', 'RestPose');
    expect(deps.timers).toEqual([]);
  });
});
