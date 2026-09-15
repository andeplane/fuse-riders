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

  /** A rollback snapshot copies the latch state; the class has no other state. */
  clone(): BombInputBuffer {
    const copy = new BombInputBuffer();
    copy.pending = this.pending.map(command => ({ ...command, ...(command.aim ? { aim: { ...command.aim } } : {}) }));
    copy.held = this.held; copy.aim = this.aim ? { ...this.aim } : undefined; copy.needsRelease = this.needsRelease;
    return copy;
  }
  /** Rebuilds a buffer from its canonical form, refusing anything that is not exactly that shape. */
  static fromJSON(raw: unknown): BombInputBuffer | undefined {
    if (!raw || typeof raw !== 'object') return;
    const v = raw as { pending?: unknown; held?: unknown; aim?: unknown; needsRelease?: unknown };
    const aimOk = (a: unknown): a is AimPoint | undefined => a === undefined || !!a && typeof a === 'object' && [(a as AimPoint).x, (a as AimPoint).y].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1);
    if (!Array.isArray(v.pending) || v.pending.length > MAX_PENDING_BOMB_ACTIONS || typeof v.held !== 'boolean' || typeof v.needsRelease !== 'boolean' || !aimOk(v.aim)) return;
    const buffer = new BombInputBuffer();
    for (const c of v.pending as { action?: unknown; aim?: unknown }[]) { if (!c || !['press', 'release', 'cancel'].includes(c.action as string) || !aimOk(c.aim)) return; buffer.pending.push({ action: c.action as BombAction, ...(c.aim ? { aim: { ...(c.aim as AimPoint) } } : {}) }); }
    buffer.held = v.held; buffer.needsRelease = v.needsRelease; if (v.aim) buffer.aim = { ...(v.aim as AimPoint) };
    return buffer;
  }
  /** Canonical form for hashing and snapshots. */
  toJSON(): unknown { return { pending: this.pending, held: this.held, aim: this.aim, needsRelease: this.needsRelease }; }

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
