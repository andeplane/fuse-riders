import type { ClientMessage } from "../shared/protocol.js";

export interface ControllerPoint {
  x: number;
  y: number;
}

export type ControllerControl = "left" | "right" | "bomb";
export type ControllerInputMessage = Extract<ClientMessage, { type: "input" }>;

export interface InputTransport {
  send(message: ControllerInputMessage): boolean;
}

export class ControllerInputState {
  private readonly held = { left: false, right: false, bomb: false };
  private readonly pointers = new Map<number, ControllerControl>();
  private sequence = 0;
  private targetOrigin?: ControllerPoint;
  private aim?: ControllerPoint;
  private readonly positions = new Map<number, ControllerPoint>();
  private aimPointer?: number;
  private lastAimSentAt = -Infinity;

  constructor(
    private readonly transport: InputTransport,
    private readonly now: () => number = () => performance.now(),
  ) {}

  configureTargetAim(origin?: ControllerPoint): void {
    this.targetOrigin = origin;
    if (!origin) this.aim = undefined;
    else if (this.held.bomb && !this.aim) this.aim = { ...origin };
  }

  pointerMove(pointerId: number, point: ControllerPoint): boolean {
    const changed = this.moveAim(pointerId, point);
    return changed && this.now() - this.lastAimSentAt >= 16
      ? this.send()
      : false;
  }

  private moveAim(pointerId: number, point?: ControllerPoint): boolean {
    if (
      !this.pointers.has(pointerId) ||
      !point ||
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y)
    )
      return false;
    const previous = this.positions.get(pointerId);
    this.positions.set(pointerId, point);
    if (pointerId !== this.aimPointer || !this.aim || !previous) return false;
    // 320 x 180 CSS pixels sweeps the full 16:9 arena like a trackpad.
    this.aim = {
      x: Math.max(0, Math.min(1, this.aim.x + (point.x - previous.x) / 320)),
      y: Math.max(0, Math.min(1, this.aim.y + (point.y - previous.y) / 180)),
    };
    return true;
  }

  setNextSequence(next: number): void {
    this.sequence = next;
    this.clear(false);
  }

  pointerDown(
    pointerId: number,
    control: ControllerControl,
    point?: ControllerPoint,
  ): boolean {
    if (this.pointers.get(pointerId) === control) return false;
    this.pointerCancel(pointerId);
    this.pointers.set(pointerId, control);
    if (point) this.positions.set(pointerId, point);
    if (this.held[control]) return false;
    this.held[control] = true;
    if (control === "bomb") {
      this.aimPointer = pointerId;
      this.aim = this.targetOrigin ? { ...this.targetOrigin } : undefined;
    }
    return this.send(control === "bomb" ? "press" : undefined);
  }

  pointerRelease(pointerId: number, point?: ControllerPoint): boolean {
    this.moveAim(pointerId, point);
    const control = this.pointers.get(pointerId);
    if (!control) return false;
    this.pointers.delete(pointerId);
    this.positions.delete(pointerId);
    if (this.aimPointer === pointerId)
      this.aimPointer = [...this.pointers].find(
        ([, heldControl]) => heldControl === "bomb",
      )?.[0];
    if ([...this.pointers.values()].includes(control)) return false;
    this.held[control] = false;
    const sent = this.send(control === "bomb" ? "release" : undefined);
    if (control === "bomb") this.aim = undefined;
    return sent;
  }

  pointerCancel(pointerId: number): boolean {
    const control = this.pointers.get(pointerId);
    if (!control) return false;
    this.pointers.delete(pointerId);
    this.positions.delete(pointerId);
    if (this.aimPointer === pointerId)
      this.aimPointer = [...this.pointers].find(
        ([, heldControl]) => heldControl === "bomb",
      )?.[0];
    if ([...this.pointers.values()].includes(control)) return false;
    this.held[control] = false;
    if (control === "bomb") this.aim = undefined;
    return this.send(control === "bomb" ? "cancel" : undefined);
  }

  clear(send = true, force = false): boolean {
    const changed = this.hasHeld();
    const cancelBomb = this.held.bomb;
    this.held.left = false;
    this.held.right = false;
    this.held.bomb = false;
    this.pointers.clear();
    this.positions.clear();
    this.aim = undefined;
    this.aimPointer = undefined;
    return (changed || force) && send
      ? this.send(cancelBomb ? "cancel" : undefined)
      : changed;
  }

  resend(): boolean {
    return this.hasHeld() ? this.send() : false;
  }
  isTargetAiming(pointerId: number): boolean {
    return this.aimPointer === pointerId && this.aim !== undefined;
  }
  hasHeld(): boolean {
    return this.held.left || this.held.right || this.held.bomb;
  }
  isHeld(control: ControllerControl): boolean {
    return this.held[control];
  }

  private send(bombAction?: ControllerInputMessage["bombAction"]): boolean {
    if (this.aim) this.lastAimSentAt = this.now();
    return this.transport.send({
      ...(this.aim ? { aim: { ...this.aim } } : {}),
      type: "input",
      seq: this.sequence++,
      ...this.held,
      ...(bombAction ? { bombAction } : {}),
    });
  }
}
