import type { ClientMessage } from '../shared/protocol.js';

export interface ControllerPoint { x: number; y: number }

export type ControllerControl = 'left' | 'right' | 'bomb';
export type ControllerInputMessage = Extract<ClientMessage, { type: 'input' }>;

export interface InputTransport {
  send(message: ControllerInputMessage): boolean;
}
/** Packets after a change restate it; a lost edge costs one resend interval, never the gesture. */
export const TRAILING_RESENDS = 3;

export class ControllerInputState {
  private readonly held = { left: false, right: false, bomb: false };
  private readonly pointers = new Map<number, ControllerControl>();
  private sequence = 0;
  private targetOrigin?: ControllerPoint;
  private aim?: ControllerPoint;
  private readonly positions = new Map<number, ControllerPoint>();
  private aimPointer?: number;
  private lastAimSentAt = -Infinity;
  private gestureCounter = 0;
  private gesture?: number;
  private finished?: { gesture: number; bombAction: 'release' | 'cancel'; aim?: ControllerPoint };
  private trailing = 0;

  constructor(private readonly transport: InputTransport, private readonly now: () => number = () => performance.now()) {}

  configureTargetAim(origin?: ControllerPoint): void {
    this.targetOrigin = origin;
    if (!origin) this.aim = undefined;
    else if (this.held.bomb && !this.aim) this.aim = { ...origin };
  }

  pointerMove(pointerId: number, point: ControllerPoint): boolean {
    const changed = this.moveAim(pointerId, point);
    return changed && this.now() - this.lastAimSentAt >= 16 ? this.send() : false;
  }

  private moveAim(pointerId: number, point?: ControllerPoint): boolean {
    if (!this.pointers.has(pointerId) || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
    const previous = this.positions.get(pointerId);
    this.positions.set(pointerId, point);
    if (pointerId !== this.aimPointer || !this.aim || !previous) return false;
    // 320 x 180 CSS pixels sweeps the full 16:9 arena like a trackpad.
    this.aim = { x: Math.max(0, Math.min(1, this.aim.x + (point.x - previous.x) / 320)),
      y: Math.max(0, Math.min(1, this.aim.y + (point.y - previous.y) / 180)) };
    return true;
  }

  setNextSequence(next: number): void {
    this.sequence = next;
    this.clear(false);
  }

  pointerDown(pointerId: number, control: ControllerControl, point?: ControllerPoint): boolean {
    if (this.pointers.get(pointerId) === control) return false;
    this.pointerCancel(pointerId);
    this.pointers.set(pointerId, control);
    if (point) this.positions.set(pointerId, point);
    if (this.held[control]) return false;
    this.held[control] = true;
    if (control === 'bomb') { this.aimPointer = pointerId; this.aim = this.targetOrigin ? { ...this.targetOrigin } : undefined; this.gesture = ++this.gestureCounter; this.finished = undefined; }
    return this.send(control === 'bomb' ? 'press' : undefined);
  }

  pointerRelease(pointerId: number, point?: ControllerPoint): boolean {
    this.moveAim(pointerId, point);
    const control = this.pointers.get(pointerId);
    if (!control) return false;
    this.pointers.delete(pointerId);
    this.positions.delete(pointerId);
    if (this.aimPointer === pointerId) this.aimPointer = [...this.pointers].find(([, heldControl]) => heldControl === 'bomb')?.[0];
    if ([...this.pointers.values()].includes(control)) return false;
    this.held[control] = false;
    if (control === 'bomb') this.finish('release');
    const sent = this.send();
    if (control === 'bomb') this.aim = undefined;
    return sent;
  }

  pointerCancel(pointerId: number): boolean {
    const control = this.pointers.get(pointerId);
    if (!control) return false;
    this.pointers.delete(pointerId);
    this.positions.delete(pointerId);
    if (this.aimPointer === pointerId) this.aimPointer = [...this.pointers].find(([, heldControl]) => heldControl === 'bomb')?.[0];
    if ([...this.pointers.values()].includes(control)) return false;
    this.held[control] = false;
    if (control === 'bomb') { this.finish('cancel'); this.aim = undefined; }
    return this.send();
  }

  clear(send = true, force = false): boolean {
    const changed = this.hasHeld();
    const cancelBomb = this.held.bomb;
    this.held.left = false;
    this.held.right = false;
    this.held.bomb = false;
    if (cancelBomb) this.finish('cancel');
    this.pointers.clear(); this.positions.clear(); this.aim = undefined; this.aimPointer = undefined;
    if (!send) { this.finished = undefined; this.trailing = 0; }
    return (changed || force) && send ? this.send() : changed;
  }
  /** A new host control scope has no memory of old gestures; repeating a finished one there would invent a shot. */
  forgetFinishedGesture(): void { this.finished = undefined; }

  resend(): boolean {
    if (this.hasHeld()) return this.send();
    if (this.trailing <= 0) return false;
    this.trailing -= 1;
    return this.emit();
  }
  isTargetAiming(pointerId: number): boolean { return this.aimPointer === pointerId && this.aim !== undefined; }
  hasHeld(): boolean { return this.held.left || this.held.right || this.held.bomb; }
  isHeld(control: ControllerControl): boolean { return this.held[control]; }

  private finish(bombAction: 'release' | 'cancel'): void {
    if (this.gesture === undefined) return;
    this.finished = { gesture: this.gesture, bombAction, ...(bombAction === 'release' && this.aim ? { aim: { ...this.aim } } : {}) };
    this.gesture = undefined;
  }

  private send(bombAction?: ControllerInputMessage['bombAction']): boolean {
    this.trailing = TRAILING_RESENDS;
    return this.emit(bombAction);
  }

  /** Full control state every time: the held gesture, or the last finished one until the next press. */
  private emit(bombAction?: ControllerInputMessage['bombAction']): boolean {
    if (this.aim) this.lastAimSentAt = this.now();
    const gesture = this.held.bomb && this.gesture !== undefined ? { gesture: this.gesture }
      : this.finished ? { gesture: this.finished.gesture, bombAction: this.finished.bombAction, ...(this.finished.aim ? { aim: { ...this.finished.aim } } : {}) } : {};
    return this.transport.send({ ...(this.aim ? { aim: { ...this.aim } } : {}), type: 'input', seq: this.sequence++, ...this.held, ...(bombAction ? { bombAction } : {}), ...gesture });
  }
}
