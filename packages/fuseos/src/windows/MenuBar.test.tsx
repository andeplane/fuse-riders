import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { MenuBar } from './MenuBar';

describe(MenuBar.name, () => {
  it('opens a menu on click and runs the selected item', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <MenuBar
        menus={[
          { label: 'File', items: [{ label: 'Close', onSelect }] },
          { label: 'View', items: [{ label: 'Details', onSelect, checked: true }, { separator: true }, { label: 'Off', disabled: true }] },
        ]}
      />
    );
    expect(screen.queryByRole('menu')).toBeNull();
    await user.click(screen.getByRole('menuitem', { name: 'View' }));
    expect(screen.getByRole('menu', { name: 'View' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemcheckbox', { name: 'Off' })).toBeDisabled();
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Details' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('shows a shortcut hint next to a menu item label', async () => {
    const user = userEvent.setup();
    render(<MenuBar menus={[{ label: 'Edit', items: [{ label: 'Select All', shortcut: 'Ctrl+A' }, { label: 'Invert Selection' }] }]} />);
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }));
    expect(screen.getByRole('menuitemcheckbox', { name: 'Select All' })).toHaveTextContent('Ctrl+A');
    expect(screen.getByRole('menuitemcheckbox', { name: 'Invert Selection' })).not.toHaveTextContent('Ctrl');
  });

  it('switches menus on hover while open and closes on a second click', async () => {
    const user = userEvent.setup();
    render(
      <MenuBar
        menus={[
          { label: 'File', items: [{ label: 'Close' }] },
          { label: 'View', items: [{ label: 'Details' }] },
        ]}
      />
    );
    await user.click(screen.getByRole('menuitem', { name: 'File' }));
    await user.hover(screen.getByRole('menuitem', { name: 'View' }));
    expect(screen.getByRole('menu', { name: 'View' })).toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'View' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on outside click and on Escape', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <p>outside</p>
        <MenuBar menus={[{ label: 'File', items: [{ label: 'Close' }] }]} />
      </div>
    );
    await user.click(screen.getByRole('menuitem', { name: 'File' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.click(screen.getByText('outside'));
    expect(screen.queryByRole('menu')).toBeNull();
    await user.click(screen.getByRole('menuitem', { name: 'File' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
