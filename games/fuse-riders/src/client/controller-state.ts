import type { ClientMessage } from "../shared/protocol.js";

export type ControllerControl = "left" | "right" | "bomb";
export type ControllerInputMessage = Extract<ClientMessage, { type: "input" }>;

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
    if (this.pointers.get(pointerId) === control) return false;
    this.pointerCancel(pointerId);
    this.pointers.set(pointerId, control);
    if (this.held[control]) return false;
    this.held[control] = true;
    return this.send(control === "bomb" ? "press" : undefined);
  }

  pointerRelease(pointerId: number): boolean {
    const control = this.pointers.get(pointerId);
    if (!control) return false;
    this.pointers.delete(pointerId);
    if ([...this.pointers.values()].includes(control)) return false;
    this.held[control] = false;
    return this.send(control === "bomb" ? "release" : undefined);
  }

  pointerCancel(pointerId: number): boolean {
    const control = this.pointers.get(pointerId);
    if (!control) return false;
    this.pointers.delete(pointerId);
    if ([...this.pointers.values()].includes(control)) return false;
    this.held[control] = false;
    return this.send(control === "bomb" ? "cancel" : undefined);
  }

  clear(send = true, force = false): boolean {
    const changed = this.hasHeld();
    const cancelBomb = this.held.bomb;
    this.held.left = false;
    this.held.right = false;
    this.held.bomb = false;
    this.pointers.clear();
    return (changed || force) && send
      ? this.send(cancelBomb ? "cancel" : undefined)
      : changed;
  }

  resend(): boolean {
    return this.hasHeld() ? this.send() : false;
  }
  hasHeld(): boolean {
    return this.held.left || this.held.right || this.held.bomb;
  }
  isHeld(control: ControllerControl): boolean {
    return this.held[control];
  }

  private send(bombAction?: ControllerInputMessage["bombAction"]): boolean {
    return this.transport.send({
      type: "input",
      seq: this.sequence++,
      ...this.held,
      ...(bombAction ? { bombAction } : {}),
    });
  }
}
