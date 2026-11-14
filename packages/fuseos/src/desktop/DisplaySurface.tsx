import type { ReactNode } from 'react';
import { useContext } from 'react';

import { DesktopUiContext } from './desktopUiContext';
import type { ColorMode } from './displayModes';
import { colorFilterTables, displayColorFilter } from './displayModes';
import { DisplayViewportContext } from './displayViewportContext';

const FILTER_MODES: Exclude<ColorMode, 'true-color'>[] = ['256-colors', 'high-color'];

/** The retro monitor is a fitted desktop composite, never the operating system's display. */
export function DisplaySurface({ children }: { children: ReactNode }) {
  const { colorMode } = useContext(DesktopUiContext);
  const geometry = useContext(DisplayViewportContext);
  const viewport = geometry?.viewport;
  const scale = geometry?.scale ?? 1;
  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-black" data-display-simulation="true">
      <svg aria-hidden="true" width="0" height="0" className="absolute pointer-events-none">
        <defs>
          {FILTER_MODES.map((mode) => {
            const tables = colorFilterTables(mode);
            return (
              <filter key={mode} id={`display-${mode}`} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
                <feComponentTransfer>
                  <feFuncR type="discrete" tableValues={tables.red} />
                  <feFuncG type="discrete" tableValues={tables.green} />
                  <feFuncB type="discrete" tableValues={tables.blue} />
                </feComponentTransfer>
              </filter>
            );
          })}
        </defs>
      </svg>
      <div data-testid="display-footprint" className="relative shrink-0" style={{ width: viewport ? viewport.width * scale : '100%', height: viewport ? viewport.height * scale : '100%', filter: displayColorFilter(colorMode) }}>
        <div
          data-testid="display-surface"
          data-color-mode={colorMode}
          className="absolute left-0 top-0"
          style={{ width: viewport?.width ?? '100%', height: viewport?.height ?? '100%', transform: `scale(${scale})`, transformOrigin: 'top left' }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
