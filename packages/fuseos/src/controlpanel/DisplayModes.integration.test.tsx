import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '../__mocks__/renderWithProviders';
import { Desktop } from '../desktop/Desktop';
import { DEFAULT_STATE } from '../state/appState';

it('applies color depth and desktop area locally, keeping controls reachable and restoring full color', async () => {
  const user = userEvent.setup();
  const { displayPrefsStore } = renderWithProviders(<Desktop />, {
    initialState: { ...DEFAULT_STATE, windows: [{ id: 'display', kind: 'controlpanel', applet: 'display', minimized: false, maximized: false }] },
  });
  const dialog = await screen.findByRole('dialog', { name: 'Control Panel' });
  expect(dialog.querySelector('.window-body')).toHaveClass('min-h-0', 'flex-1');
  expect(dialog.querySelector('.window-body')).not.toHaveClass('h-full');
  await user.selectOptions(within(dialog).getByLabelText('Color palette'), '256-colors');
  expect(displayPrefsStore.get().colorMode).toBe('256-colors');
  expect(screen.getByTestId('display-footprint')).toHaveStyle({ filter: 'url(#display-256-colors)' });
  await user.pointer({ keys: '[MouseRight]', target: within(screen.getByRole('list', { name: 'Desktop icons' })).getByRole('button', { name: 'Fuseball' }) });
  expect(screen.getByRole('menu', { name: 'Context menu' })).toHaveStyle({ filter: 'url(#display-256-colors)' });
  await user.keyboard('{Escape}');
  await user.selectOptions(within(dialog).getByLabelText('Desktop area'), '640x480');
  expect(displayPrefsStore.get().desktopArea).toBe('640x480');
  expect(screen.getByTestId('display-surface')).toHaveStyle({ width: '640px', height: '480px' });
  const frame = dialog.closest('[data-window-id]');
  expect(frame).toBeDefined();
  expect(frame?.getAttribute('style')).not.toContain('NaN');
  expect(within(dialog).getAllByRole('button', { name: 'Close' })[0]).toBeEnabled();
  await user.selectOptions(within(dialog).getByLabelText('Color palette'), 'high-color');
  expect(screen.getByTestId('display-footprint')).toHaveStyle({ filter: 'url(#display-high-color)' });
  await user.selectOptions(within(dialog).getByLabelText('Color palette'), 'true-color');
  expect(screen.getByTestId('display-footprint').style.filter).toBe('');
  await user.selectOptions(within(dialog).getByLabelText('Desktop area'), 'current');
  expect(screen.getByTestId('display-surface')).toHaveStyle({ width: '1280px', height: '800px' });
});
