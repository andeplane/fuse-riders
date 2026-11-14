import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '../__mocks__/renderWithProviders';
import { Desktop } from '../desktop/Desktop';
import type { AppState } from '../state/appState';
import { DEFAULT_STATE } from '../state/appState';
import { SHORTCUTS } from '../lib/shortcuts';

function renderApplet() {
  const state: AppState = { ...DEFAULT_STATE, windows: [{ id: 'w1', minimized: false, maximized: false, kind: 'controlpanel', applet: 'keyboard' }] };
  return renderWithProviders(<Desktop />, { initialState: state });
}

describe('KeyboardApplet', () => {
  it('lists every registered shortcut, grouped by scope, with its keys and description', async () => {
    renderApplet();
    const dialog = await screen.findByRole('dialog', { name: 'Control Panel' });

    // Sampling one shortcut from each scope named in the issue is enough to prove the grouping
    // and the exact wording works; the exhaustive-coverage test below guards every entry.
    const explorerTable = await within(dialog).findByRole('table', { name: 'Explorer shortcuts' });
    expect(within(explorerTable).getByText('Backspace')).toBeInTheDocument();
    expect(within(explorerTable).getByText('Go up one level')).toBeInTheDocument();
    expect(within(explorerTable).getByText('Shift+F10')).toBeInTheDocument();
    expect(within(explorerTable).getByText('Ctrl+A')).toBeInTheDocument();
    expect(within(explorerTable).getByText('Alt+Enter')).toBeInTheDocument();

    const solitaireTable = await within(dialog).findByRole('table', { name: 'Solitaire shortcuts' });
    expect(within(solitaireTable).getByText('F2')).toBeInTheDocument();
    expect(within(solitaireTable).getByText('Deal a new game')).toBeInTheDocument();

    const notepadTable = await within(dialog).findByRole('table', { name: 'Notepad shortcuts' });
    expect(within(notepadTable).getByText('Ctrl+F')).toBeInTheDocument();
    expect(within(notepadTable).getByText('F3')).toBeInTheDocument();
  });

  it('renders every entry in the registry, so the sheet cannot drift from it', async () => {
    renderApplet();
    const dialog = await screen.findByRole('dialog', { name: 'Control Panel' });
    for (const shortcut of SHORTCUTS) {
      const row = await within(dialog).findByText(shortcut.description);
      expect(within(row.closest('tr') ?? row).getByText(shortcut.keys)).toBeInTheDocument();
    }
  });

  it('has no capability line and no read only footer, since it only reads the local shortcut list', async () => {
    renderApplet();
    const dialog = await screen.findByRole('dialog', { name: 'Control Panel' });
    await within(dialog).findByRole('table', { name: 'Explorer shortcuts' });
    expect(within(dialog).queryByText(/Acl:/)).toBeNull();
    expect(within(dialog).queryByText('Read only. Read only.')).toBeNull();
  });

  it('is reachable from the Home grid and the tab strip like the other applets', async () => {
    const user = userEvent.setup();
    const state: AppState = { ...DEFAULT_STATE, windows: [{ id: 'w1', minimized: false, maximized: false, kind: 'controlpanel', applet: 'home' }] };
    renderWithProviders(<Desktop />, { initialState: state });
    const dialog = await screen.findByRole('dialog', { name: 'Control Panel' });

    await user.click(within(dialog).getByRole('button', { name: 'Keyboard' }));
    expect(await within(dialog).findByRole('table', { name: 'Explorer shortcuts' })).toBeInTheDocument();
    expect(within(dialog).getByRole('tab', { name: 'Keyboard' })).toHaveAttribute('aria-selected', 'true');
  });
});
