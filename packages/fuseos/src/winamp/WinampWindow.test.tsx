import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '../__mocks__/renderWithProviders';
import type { FakeWebampPlayer } from '../__mocks__/webampPlayer';
import { Desktop } from '../desktop/Desktop';

import type { MediaErrorInfo } from './mediaErrorReporting';

/** The nth Webamp player the window created; fails the test when there is none. */
function playerAt(players: readonly FakeWebampPlayer[], index: number): FakeWebampPlayer {
  const player = players[index];
  if (player === undefined) throw new Error(`No Webamp player at index ${index}`);
  return player;
}

function desktopIcon(label: string) {
  return within(screen.getByRole('list', { name: 'Desktop icons' })).getByRole('button', { name: label });
}

async function openWinamp(user: ReturnType<typeof userEvent.setup>) {
  await user.dblClick(desktopIcon('Winamp'));
  return screen.findByRole('dialog', { name: 'Winamp' });
}

/**
 * The message box among "Winamp"-named dialogs that is not the player window itself:
 * a playback error dialog is titled "Winamp" too, the way a real Windows message box
 * names the app, not the specific window it came from.
 */
async function findMessageBox(playerWindow: HTMLElement) {
  return waitFor(() => {
    const dialogs = screen.getAllByRole('dialog', { name: 'Winamp' });
    const messageBox = dialogs.find((element) => element !== playerWindow);
    if (!messageBox) throw new Error('No message box shown yet');
    return messageBox;
  });
}

describe('Winamp', () => {
  it('opens from the desktop icon, mounts the player and says local files stay on the device', async () => {
    const user = userEvent.setup();
    const { winampPlayers } = renderWithProviders(<Desktop />);
    const dialog = await openWinamp(user);
    expect(within(dialog).getByText('Local files never leave this device.')).toBeInTheDocument();
    await waitFor(() => expect(winampPlayers).toHaveLength(1));
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Open files...' })).toBeEnabled());
    expect(playerAt(winampPlayers, 0).renderedInto).toHaveLength(1);
  });

  it('mounts the player into a non-statically positioned node, which Webamp requires', async () => {
    // Webamp throws "The DOM node passed to renderInto must have a non-static position" and the
    // window shows nothing but that error, so the mount's position is part of the contract.
    const user = userEvent.setup();
    const { winampPlayers } = renderWithProviders(<Desktop />);
    await openWinamp(user);
    await waitFor(() => expect(winampPlayers).toHaveLength(1));
    const mount = playerAt(winampPlayers, 0).renderedInto[0];
    expect(mount).toBeDefined();
    // Asserted on the inline style, not a class: Tailwind's stylesheet is not loaded in tests, so a
    // `relative` class would leave position empty here and this test would pass without proving anything.
    expect(mount).toHaveStyle({ position: 'relative' });
  });

  it('gives the complete player stack its intrinsic height before Webamp centres it', async () => {
    const user = userEvent.setup();
    const { winampPlayers } = renderWithProviders(<Desktop />);
    const dialog = await openWinamp(user);
    await waitFor(() => expect(winampPlayers).toHaveLength(1));
    const mount = playerAt(winampPlayers, 0).renderedInto[0];
    // Webamp centres the entire 275x348 main/equalizer/playlist stack at render time.
    // A short flex mount gives the main transport a negative top that cannot be scrolled to.
    expect(mount).toHaveStyle({ width: '275px', height: '348px', flexShrink: '0' });
    expect(dialog.parentElement).toHaveStyle({ width: '320px', height: '440px' });
  });

  it('reuses the open window instead of stacking a duplicate', async () => {
    const user = userEvent.setup();
    const { winampPlayers } = renderWithProviders(<Desktop />);
    await openWinamp(user);
    await waitFor(() => expect(winampPlayers).toHaveLength(1));
    await user.dblClick(desktopIcon('Winamp'));
    expect(screen.getAllByRole('dialog', { name: 'Winamp' })).toHaveLength(1);
    expect(winampPlayers).toHaveLength(1);
  });

  it('also opens from Start > Programs > Accessories > Winamp', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />);
    await user.click(screen.getByRole('button', { name: /Start/ }));
    const menu = screen.getByRole('menu', { name: 'Start menu' });
    await user.click(within(menu).getByRole('menuitem', { name: 'Programs' }));
    await user.click(within(menu).getByRole('menuitem', { name: 'Accessories' }));
    await user.click(within(menu).getByRole('menuitem', { name: 'Winamp' }));
    expect(await screen.findByRole('dialog', { name: 'Winamp' })).toBeInTheDocument();
  });

  it('adds locally picked files as tracks and starts playing', async () => {
    const user = userEvent.setup();
    const { winampPlayers, winampDeps } = renderWithProviders(<Desktop />);
    const dialog = await openWinamp(user);
    await waitFor(() => expect(winampPlayers).toHaveLength(1));

    const file = new File(['data'], 'song.mp3', { type: 'audio/mpeg' });
    await user.upload(within(dialog).getByLabelText('Open audio files'), file);

    await waitFor(() => expect(playerAt(winampPlayers, 0).tracks).toEqual([{ url: 'blob:song.mp3', defaultName: 'song.mp3' }]));
    expect(winampDeps.createObjectURL).toHaveBeenCalledWith(file);
    expect(playerAt(winampPlayers, 0).getMediaStatus()).toBe('PLAYING');
  });

  it('disposes the player and revokes every object URL when the window closes, and starts fresh on reopen', async () => {
    const user = userEvent.setup();
    const { winampPlayers, winampDeps } = renderWithProviders(<Desktop />);
    const dialog = await openWinamp(user);
    await waitFor(() => expect(winampPlayers).toHaveLength(1));
    const file = new File(['data'], 'song.mp3', { type: 'audio/mpeg' });
    await user.upload(within(dialog).getByLabelText('Open audio files'), file);
    await waitFor(() => expect(playerAt(winampPlayers, 0).tracks).toHaveLength(1));

    await user.click(within(dialog).getByLabelText('Close'));
    expect(screen.queryByRole('dialog', { name: 'Winamp' })).toBeNull();
    expect(playerAt(winampPlayers, 0).disposed).toBe(true);
    expect(winampDeps.revokeObjectURL).toHaveBeenCalledWith('blob:song.mp3');

    // Reopening starts a fresh player; the old one is not reused.
    const again = await openWinamp(user);
    await waitFor(() => expect(winampPlayers).toHaveLength(2));
    expect(within(again).queryByText(/song.mp3/)).toBeNull();
    expect(playerAt(winampPlayers, 1)).not.toBe(playerAt(winampPlayers, 0));
  });

  it('says so when Winamp is not available in this preview', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />, { winampDeps: { createPlayer: undefined } });
    const dialog = await openWinamp(user);
    expect(within(dialog).getByRole('status')).toHaveTextContent('Winamp is not available in this preview.');
    expect(within(dialog).getByRole('button', { name: 'Open files...' })).toBeDisabled();
  });

  it('shows a Win98 message box naming the content security policy when a track is blocked from playing', async () => {
    const user = userEvent.setup();
    let reportError: ((info: MediaErrorInfo) => void) | undefined;
    const { winampPlayers } = renderWithProviders(<Desktop />, {
      winampDeps: {
        subscribeMediaErrors: (onError) => {
          reportError = onError;
          return () => {
            reportError = undefined;
          };
        },
      },
    });
    const playerWindow = await openWinamp(user);
    await waitFor(() => expect(winampPlayers).toHaveLength(1));
    const file = new File(['data'], 'song.mp3', { type: 'audio/mpeg' });
    await user.upload(within(playerWindow).getByLabelText('Open audio files'), file);
    await waitFor(() => expect(playerAt(winampPlayers, 0).getMediaStatus()).toBe('PLAYING'));

    reportError?.({ cause: 'csp', directive: 'media-src' });

    const messageBox = await findMessageBox(playerWindow);
    expect(messageBox).toHaveTextContent('song.mp3');
    expect(messageBox).toHaveTextContent('content security policy');
    expect(messageBox).toHaveTextContent('media-src');
    await user.click(within(messageBox).getByRole('button', { name: 'OK' }));
    expect(screen.queryByText(/content security policy/)).toBeNull();
    // The player window itself is untouched by the error dialog closing.
    expect(screen.getByRole('dialog', { name: 'Winamp' })).toBe(playerWindow);
  });

  it('shows a generic message box for a load failure that is not reported as a CSP violation', async () => {
    const user = userEvent.setup();
    let reportError: ((info: MediaErrorInfo) => void) | undefined;
    const { winampPlayers } = renderWithProviders(<Desktop />, {
      winampDeps: {
        subscribeMediaErrors: (onError) => {
          reportError = onError;
          return () => undefined;
        },
      },
    });
    const playerWindow = await openWinamp(user);
    await waitFor(() => expect(winampPlayers).toHaveLength(1));
    const file = new File(['data'], 'broken.mp3', { type: 'audio/mpeg' });
    await user.upload(within(playerWindow).getByLabelText('Open audio files'), file);
    await waitFor(() => expect(playerAt(winampPlayers, 0).getMediaStatus()).toBe('PLAYING'));

    reportError?.({ cause: 'unknown' });

    const messageBox = await findMessageBox(playerWindow);
    expect(messageBox).toHaveTextContent('broken.mp3');
    expect(messageBox).toHaveTextContent('blocked or failed to load');
  });

  it('shows only one message box for repeated failures of the same track', async () => {
    const user = userEvent.setup();
    let reportError: ((info: MediaErrorInfo) => void) | undefined;
    const { winampPlayers } = renderWithProviders(<Desktop />, {
      winampDeps: {
        subscribeMediaErrors: (onError) => {
          reportError = onError;
          return () => undefined;
        },
      },
    });
    const playerWindow = await openWinamp(user);
    await waitFor(() => expect(winampPlayers).toHaveLength(1));
    const file = new File(['data'], 'song.mp3', { type: 'audio/mpeg' });
    await user.upload(within(playerWindow).getByLabelText('Open audio files'), file);
    await waitFor(() => expect(playerAt(winampPlayers, 0).getMediaStatus()).toBe('PLAYING'));

    reportError?.({ cause: 'csp', directive: 'media-src' });
    await findMessageBox(playerWindow);
    // A second raw browser event for the same still-current track (e.g. both the CSP
    // report and the element's own error event firing for one failed load).
    reportError?.({ cause: 'unknown' });

    // The player window plus exactly one message box, never two.
    expect(screen.getAllByRole('dialog', { name: 'Winamp' })).toHaveLength(2);
  });
});
