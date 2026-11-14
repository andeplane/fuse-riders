import type { ReactNode } from 'react';
import { useContext, useEffect, useMemo, useState } from 'react';

import { WindowsDepsContext } from '../windows/windowsDepsContext';

import { DesktopUiContext } from './desktopUiContext';
import { displayGeometry } from './displayModes';
import { DisplayViewportContext } from './displayViewportContext';

/** Shares the selected logical viewport with window bounds and scaled pointer interaction. */
export function DisplayViewportProvider({ children }: { children: ReactNode }) {
  const { getViewport, subscribeViewport } = useContext(WindowsDepsContext);
  const { desktopArea } = useContext(DesktopUiContext);
  const [available, setAvailable] = useState(getViewport);
  useEffect(() => subscribeViewport(() => setAvailable(getViewport())), [getViewport, subscribeViewport]);
  const value = useMemo(() => displayGeometry(desktopArea, available), [desktopArea, available]);
  return <DisplayViewportContext.Provider value={value}>{children}</DisplayViewportContext.Provider>;
}
