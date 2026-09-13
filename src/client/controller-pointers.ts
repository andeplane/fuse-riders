import { ControllerInputState, type ControllerControl } from './controller-state.js';

export interface PointerButton extends EventTarget {
  disabled: boolean;
  classList: Pick<DOMTokenList, 'toggle'>;
  setPointerCapture(pointerId: number): void;
  releasePointerCapture(pointerId: number): void;
  hasPointerCapture(pointerId: number): boolean;
}

/** Browser events and capture ownership mapped into the typed input model. */
export class ControllerPointerBindings {
  private readonly owners = new Map<number, PointerButton>();
  private readonly interrupted = new Set<number>();

  constructor(
    private readonly state: ControllerInputState,
    private readonly buttons: ReadonlyArray<readonly [PointerButton, ControllerControl]>,
    terminalTarget: EventTarget,
    private readonly changed: () => void,
    private readonly buttonAtPoint?: (x: number, y: number) => PointerButton | undefined,
  ) {
    terminalTarget.addEventListener('pointerdown', event => this.interrupted.delete((event as PointerEvent).pointerId), { capture: true });
    for (const [button, control] of buttons) {
      button.addEventListener('contextmenu', event => event.preventDefault());
      button.addEventListener('pointerdown', event => {
        const pointer = event as PointerEvent;
        if (button.disabled || (pointer.pointerType === 'mouse' && pointer.button !== 0)) return;
        pointer.preventDefault();
        this.interrupted.delete(pointer.pointerId);
        // A new contact with a recycled ID terminates any stale capture first.
        this.finish(pointer.pointerId, true);
        this.owners.set(pointer.pointerId, button);
        this.state.pointerDown(pointer.pointerId, control, { x: pointer.clientX, y: pointer.clientY });
        try { button.setPointerCapture(pointer.pointerId); } catch { /* Window terminal events remain available. */ }
        this.sync();
      });
      button.addEventListener('lostpointercapture', event => {
        const pointer = event as PointerEvent;
        if (this.owners.get(pointer.pointerId) === button) { this.interrupted.add(pointer.pointerId); this.finish(pointer.pointerId, true); }
      });
    }
    terminalTarget.addEventListener('pointermove', event => {
      const pointer = event as PointerEvent;
      if (this.interrupted.has(pointer.pointerId)) return;
      if (this.buttonAtPoint && pointer.buttons === 1 && !this.state.isTargetAiming(pointer.pointerId)) {
        const candidate = this.buttonAtPoint(pointer.clientX, pointer.clientY);
        const target = candidate && !candidate.disabled ? candidate : undefined;
        if (target !== this.owners.get(pointer.pointerId)) {
          this.finish(pointer.pointerId, true);
          const binding = this.buttons.find(([button]) => button === target);
          if (binding) {
            const [button, control] = binding;
            this.owners.set(pointer.pointerId, button);
            this.state.pointerDown(pointer.pointerId, control, { x: pointer.clientX, y: pointer.clientY });
            try { button.setPointerCapture(pointer.pointerId); } catch { /* Global release still works. */ }
            this.sync();
          }
        }
      }
      if (!this.owners.has(pointer.pointerId)) return;
      this.state.pointerMove(pointer.pointerId, { x: pointer.clientX, y: pointer.clientY });
    }, { capture: true });
    for (const name of ['pointerup', 'pointercancel'] as const) {
      terminalTarget.addEventListener(name, event => {
        const pointer = event as PointerEvent;
        if (name === 'pointercancel') this.interrupted.add(pointer.pointerId);
        else this.interrupted.delete(pointer.pointerId);
        if (!this.owners.has(pointer.pointerId)) return;
        pointer.preventDefault();
        this.finish(pointer.pointerId, name === 'pointercancel', { x: pointer.clientX, y: pointer.clientY });
      }, { capture: true });
    }
  }

  clear(send = true, force = false): void {
    const captures = [...this.owners];
    for (const [id] of captures) this.interrupted.add(id);
    this.owners.clear();
    this.state.clear(send, force);
    for (const [id, button] of captures) this.releaseCapture(button, id);
    this.sync();
  }

  private finish(id: number, cancel: boolean, point?: { x: number; y: number }): void {
    const button = this.owners.get(id);
    if (!button) return;
    this.owners.delete(id);
    if (cancel) this.state.pointerCancel(id);
    else this.state.pointerRelease(id, point);
    this.releaseCapture(button, id);
    this.sync();
  }

  private releaseCapture(button: PointerButton, id: number): void {
    if (button.hasPointerCapture(id)) button.releasePointerCapture(id);
  }

  private sync(): void {
    for (const [button, control] of this.buttons) button.classList.toggle('active', this.state.isHeld(control));
    this.changed();
  }
}
