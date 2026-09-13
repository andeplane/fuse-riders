import type { ClientMessage } from '../shared/protocol.js';

export type ControllerControl = 'left' | 'right' | 'bomb';
export type ControllerInputMessage = Extract<ClientMessage, { type: 'input' }>;

export interface InputTransport {
  send(message: ControllerInputMessage): boolean;
}

export class ControllerInputState {
  private readonly held = { left: false, right: false, bomb: false };
  private readonly pointers = new Map<number, ControllerControl>();
  private sequence = 0;

  constructor(private readonly transport: InputTransport) {}

  setNextSequence(next: number): void {
    this.sequence = next;
    this.clear(false);
  }

  pointerDown(pointerId: number, control: ControllerControl): boolean {
    this.pointers.set(pointerId, control);
    if (this.held[control]) return false;
    this.held[control] = true;
    return this.send();
  }

  pointerRelease(pointerId: number): boolean {
    const control = this.pointers.get(pointerId);
    if (!control) return false;
    this.pointers.delete(pointerId);
    if ([...this.pointers.values()].includes(control)) return false;
    this.held[control] = false;
    return this.send();
  }

  clear(send = true, force = false): boolean {
    const changed = this.hasHeld();
    this.held.left = false;
    this.held.right = false;
    this.held.bomb = false;
    this.pointers.clear();
    return (changed || force) && send ? this.send() : changed;
  }

  resend(): boolean { return this.hasHeld() ? this.send() : false; }
  hasHeld(): boolean { return this.held.left || this.held.right || this.held.bomb; }
  isHeld(control: ControllerControl): boolean { return this.held[control]; }

  private send(): boolean {
    return this.transport.send({ type: 'input', seq: this.sequence++, ...this.held });
  }
}
