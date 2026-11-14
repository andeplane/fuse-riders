import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { createTestGamesDeps } from '../../__mocks__/renderWithProviders';
import type { GamesDeps } from '../gamesDepsContext';
import { GamesDepsContext } from '../gamesDepsContext';

import { Minesweeper } from './Minesweeper';

function renderGame(overrides: Partial<GamesDeps> = {}) {
  const deps = createTestGamesDeps(overrides);
  const result = render(
    <GamesDepsContext.Provider value={deps}>
      <Minesweeper />
    </GamesDepsContext.Provider>
  );
  return { ...result, deps };
}

/** The cell at an index of the rendered minefield; fails the test when the index is out of range. */
function cellAt(index: number): HTMLElement {
  const cell = cells()[index];
  if (cell === undefined) throw new Error(`No cell at index ${index}`);
  return cell;
}

function cells() {
  return within(screen.getByRole('grid', { name: 'Minefield' })).getAllByRole('gridcell');
}

describe(Minesweeper.name, () => {
  it('starts as a beginner board with ten mines and a zero clock', () => {
    renderGame();
    expect(cells()).toHaveLength(81);
    expect(screen.getByLabelText('Mines left')).toHaveTextContent('010');
    expect(screen.getByLabelText('Time')).toHaveTextContent('000');
    expect(screen.getByRole('grid', { name: 'Minefield' })).toHaveAttribute('data-status', 'ready');
  });

  it('reveals on left click and never hits a mine first', () => {
    renderGame();
    fireEvent.mouseDown(cellAt(0), { button: 0 });
    expect(cellAt(0)).toHaveAttribute('data-state', 'revealed');
    expect(screen.getByRole('grid', { name: 'Minefield' })).toHaveAttribute('data-status', 'playing');
  });

  it('flags on right click and counts down the mines left', () => {
    renderGame();
    fireEvent.mouseDown(cellAt(5), { button: 2 });
    expect(cellAt(5)).toHaveAttribute('data-state', 'flagged');
    expect(screen.getByLabelText('Mines left')).toHaveTextContent('009');
    fireEvent.mouseDown(cellAt(5), { button: 2 });
    expect(cellAt(5)).toHaveAttribute('data-state', 'hidden');
  });

  it('ticks the timer through the injected clock while playing', () => {
    // Arrange: a clock that advances 5 seconds on the tick the subscription delivers.
    let now = Date.UTC(1998, 5, 25, 12, 0, 0);
    let tick: (() => void) | undefined;
    renderGame({
      now: () => now,
      subscribeSeconds: (onTick) => {
        tick = onTick;
        return () => undefined;
      },
    });
    // Act
    fireEvent.mouseDown(cellAt(0), { button: 0 });
    now += 5_000;
    expect(tick).toBeDefined();
    act(() => tick?.());
    // Assert
    expect(screen.getByLabelText('Time')).toHaveTextContent('005');
  });

  it('starts over from the smiley and picks a difficulty from the Game menu', async () => {
    const user = userEvent.setup();
    renderGame();
    fireEvent.mouseDown(cellAt(0), { button: 0 });
    await user.click(screen.getByRole('button', { name: 'New game' }));
    expect(screen.getByRole('grid', { name: 'Minefield' })).toHaveAttribute('data-status', 'ready');
    expect(cells().every((cell) => cell.getAttribute('data-state') === 'hidden')).toBe(true);

    await user.click(screen.getByRole('menuitem', { name: 'Game' }));
    await user.click(screen.getByRole('menuitemradio', { name: /Expert/ }));
    expect(cells()).toHaveLength(480);
    expect(screen.getByLabelText('Mines left')).toHaveTextContent('099');

    await user.click(screen.getByRole('menuitem', { name: 'Game' }));
    await user.click(screen.getByRole('menuitemradio', { name: /Intermediate/ }));
    expect(cells()).toHaveLength(256);
    expect(screen.getByLabelText('Mines left')).toHaveTextContent('040');
  });

  it('ends the game on a mine and disables the board', () => {
    // Arrange: reveal one cell, then find a mine by reading the revealed board after a loss.
    renderGame();
    fireEvent.mouseDown(cellAt(0), { button: 0 });
    // Act: click every hidden cell until one explodes.
    for (const cell of cells()) {
      if (cell.getAttribute('data-state') !== 'hidden') continue;
      fireEvent.mouseDown(cell, { button: 0 });
      if (screen.getByRole('grid', { name: 'Minefield' }).getAttribute('data-status') !== 'playing') break;
    }
    // Assert
    const status = screen.getByRole('grid', { name: 'Minefield' }).getAttribute('data-status');
    expect(['lost', 'won']).toContain(status);
    expect(cells().every((cell) => cell.hasAttribute('disabled'))).toBe(true);
  });
});

it('keeps minefield cells square instead of inheriting the Win98 button minimum height', () => {
  renderGame();
  expect(cellAt(0)).toHaveStyle({ width: '16px', height: '16px' });
  expect(cellAt(0).style.minHeight).toMatch(/^0(?:px)?$/);
});
