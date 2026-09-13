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

  constructor(
    private readonly state: ControllerInputState,
    private readonly buttons: ReadonlyArray<readonly [PointerButton, ControllerControl]>,
    terminalTarget: EventTarget,
    private readonly changed: () => void,
  ) {
    for (const [button, control] of buttons) {
      button.addEventListener('contextmenu', event => event.preventDefault());
      button.addEventListener('pointerdown', event => {
        const pointer = event as PointerEvent;
        if (button.disabled || (pointer.pointerType === 'mouse' && pointer.button !== 0)) return;
        pointer.preventDefault();
        // A new contact with a recycled ID terminates any stale capture first.
        this.finish(pointer.pointerId, true);
        this.owners.set(pointer.pointerId, button);
        this.state.pointerDown(pointer.pointerId, control);
        try { button.setPointerCapture(pointer.pointerId); } catch { /* Window terminal events remain available. */ }
        this.sync();
      });
      button.addEventListener('lostpointercapture', event => {
        const pointer = event as PointerEvent;
        if (this.owners.get(pointer.pointerId) === button) this.finish(pointer.pointerId, true);
      });
    }
    for (const name of ['pointerup', 'pointercancel'] as const) {
      terminalTarget.addEventListener(name, event => {
        const pointer = event as PointerEvent;
        if (!this.owners.has(pointer.pointerId)) return;
        pointer.preventDefault();
        this.finish(pointer.pointerId, name === 'pointercancel');
      }, { capture: true });
    }
  }

  clear(send = true, force = false): void {
    const captures = [...this.owners];
    this.owners.clear();
    this.state.clear(send, force);
    for (const [id, button] of captures) this.releaseCapture(button, id);
    this.sync();
  }

  private finish(id: number, cancel: boolean): void {
    const button = this.owners.get(id);
    if (!button) return;
    this.owners.delete(id);
    if (cancel) this.state.pointerCancel(id);
    else this.state.pointerRelease(id);
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
