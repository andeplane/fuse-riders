import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useContext } from 'react';

import { WindowManagerContext } from './windowManagerContext';
import { WindowManagerProvider } from './WindowManagerProvider';

describe(WindowManagerProvider.name, () => {
  it('forgets the rectangle of a closed window so a reused id opens at its preferred size again', () => {
    const wrapper = ({ children }: { children: ReactNode }) => <WindowManagerProvider>{children}</WindowManagerProvider>;
    const { result } = renderHook(() => useContext(WindowManagerContext), { wrapper });

    act(() => result.current.setRect('w1', { x: 10, y: 10, width: 300, height: 200 }));
    expect(result.current.rectFor('w1', 0, { width: 900, height: 600 })).toMatchObject({ width: 300, height: 200 });

    act(() => result.current.pruneRects(['w2']));
    expect(result.current.rects).toEqual({});
    expect(result.current.rectFor('w1', 0, { width: 900, height: 600 })).toMatchObject({ width: 900, height: 600 });
  });
});

it('honors the current fixed size after an old utility window was stretched', () => {
  const wrapper = ({ children }: { children: ReactNode }) => <WindowManagerProvider>{children}</WindowManagerProvider>;
  const { result } = renderHook(() => useContext(WindowManagerContext), { wrapper });
  act(() => result.current.setRect('winamp', { x: 12, y: 12, width: 800, height: 700 }));
  expect(result.current.rectFor('winamp', 0, { width: 320, height: 470 }, true)).toMatchObject({ width: 320, height: 470 });
  expect(result.current.rectFor('winamp', 0, { width: 520, height: 570 }, true)).toMatchObject({ width: 520, height: 570 });
});
