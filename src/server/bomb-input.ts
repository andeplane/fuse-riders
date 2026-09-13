import type { BombAction } from '../shared/protocol.js';

export const MAX_PENDING_BOMB_ACTIONS = 8;

/** Preserves short taps while making input interruption discard pending launches. */
export class BombInputBuffer {
  private pending: BombAction[] = [];
  private held = false;
  private needsRelease = false;

  accept(held: boolean, action?: BombAction): void {
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
  }

  cancel(requireRelease = false): void {
    this.needsRelease ||= requireRelease || this.held;
    this.held = false;
    this.pending = ['cancel'];
  }

  drain(): BombAction[] {
    const actions = this.pending;
    this.pending = [];
    return actions;
  }

  private enqueue(action: BombAction): void {
    if (this.pending.length >= MAX_PENDING_BOMB_ACTIONS) this.cancel(true);
    else this.pending.push(action);
  }
}
