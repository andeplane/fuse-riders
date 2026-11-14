import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DesktopIcon } from './DesktopIcon';
import { ShutdownScreen } from './ShutdownScreen';

describe(DesktopIcon.name, () => {
  it('selects on click and opens on double click or Enter', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onOpen = vi.fn();
    render(<DesktopIcon label="My Computer" icon="computer" selected={false} onSelect={onSelect} onOpen={onOpen} />);
    const button = screen.getByRole('button', { name: 'My Computer' });
    await user.click(button);
    expect(onSelect).toHaveBeenCalled();
    await user.dblClick(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
    button.focus();
    await user.keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalledTimes(2);
  });
});

describe(ShutdownScreen.name, () => {
  it('wakes up on click and on keyboard', async () => {
    const user = userEvent.setup();
    const onWakeUp = vi.fn();
    render(<ShutdownScreen onWakeUp={onWakeUp} />);
    const screenOff = screen.getByRole('button');
    await user.click(screenOff);
    screenOff.focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onWakeUp).toHaveBeenCalledTimes(3);
  });
});
