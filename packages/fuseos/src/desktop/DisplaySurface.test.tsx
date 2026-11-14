import { render, screen } from '@testing-library/react';

import { DesktopUiContext } from './desktopUiContext';
import { DisplaySurface } from './DisplaySurface';
import { DisplayViewportContext } from './displayViewportContext';

it('keeps the simulated screen inside its fitted footprint and filters only the desktop composite', () => {
  render(
    <DesktopUiContext.Consumer>
      {(ui) => (
        <DesktopUiContext.Provider value={{ ...ui, colorMode: '256-colors', desktopArea: '1024x768' }}>
          <DisplayViewportContext.Provider value={{ viewport: { width: 1024, height: 768 }, scale: 0.5 }}>
            <DisplaySurface><p>desktop body</p></DisplaySurface>
          </DisplayViewportContext.Provider>
        </DesktopUiContext.Provider>
      )}
    </DesktopUiContext.Consumer>
  );
  expect(screen.getByTestId('display-footprint')).toHaveStyle({ width: '512px', height: '384px', filter: 'url(#display-256-colors)' });
  expect(screen.getByTestId('display-surface')).toHaveStyle({ width: '1024px', height: '768px', transform: 'scale(0.5)' });
  expect(screen.getByText('desktop body')).toBeInTheDocument();
  expect(document.querySelector('#display-256-colors feFuncB')).toHaveAttribute('type', 'discrete');
});
