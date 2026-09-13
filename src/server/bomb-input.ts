import type { AimPoint, BombAction, BombActionCommand } from '../shared/protocol.js';

export const MAX_PENDING_BOMB_ACTIONS = 8;

/** Preserves short taps while making input interruption discard pending launches. */
export class BombInputBuffer {
  private pending: BombActionCommand[] = [];
  private held = false;
  private aim?: AimPoint;
  private needsRelease = false;

  accept(held: boolean, action?: BombAction, aim?: AimPoint): void {
    if (aim) this.aim = { ...aim };
    if (action === 'cancel') {
      this.cancel();
      this.needsRelease = false;
      return;
    }
    if (!held) {
      if (action === 'release' && this.held && !this.needsRelease) this.enqueue('release');
      else if (this.held && action === undefined) this.cancel();
      this.needsRelease = false;
    } else if (action === 'press' && !this.held && !this.needsRelease) {
      this.enqueue('press');
    }
    this.held = held;
    if (!held) this.aim = undefined;
  }

  cancel(requireRelease = false): void {
    this.needsRelease ||= requireRelease || this.held;
    this.held = false;
    this.pending = [{ action: 'cancel' }];
    this.aim = undefined;
  }

  drain(): BombAction[] { return this.drainCommands().map(command => command.action); }

  drainCommands(): BombActionCommand[] {
    const actions = this.pending;
    this.pending = [];
    return actions;
  }

  private enqueue(action: BombAction): void {
    if (this.pending.length >= MAX_PENDING_BOMB_ACTIONS) this.cancel(true);
    else this.pending.push({ action, ...(this.aim ? { aim: { ...this.aim } } : {}) });
  }
}
