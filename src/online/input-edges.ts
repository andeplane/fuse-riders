import type { EntryBody } from '../shared/action-log.js';
import type { ControllerInputMessage } from '../client/controller-state.js';

/** Turns the controller's held-state samples into the log's edges: steer changes, aim changes and gestures with ids. */
export class InputEdges {
  private flags = 0;
  private aim?: { x: number; y: number };
  private gesture?: number;
  private counter = 0;
  edges(message: Omit<ControllerInputMessage, 'type' | 'seq'>): EntryBody[] {
    const out: EntryBody[] = [];
    const flags = Number(message.left) | Number(message.right) << 1;
    if (flags !== this.flags) { this.flags = flags; out.push([0, flags]); }
    const aim = message.aim && { x: message.aim.x || 0, y: message.aim.y || 0 };
    if (aim && (aim.x !== this.aim?.x || aim.y !== this.aim?.y)) { this.aim = aim; out.push([1, aim.x, aim.y]); }
    if (message.bombAction === 'press') { if (this.gesture === undefined) { this.gesture = ++this.counter; out.push([2, this.gesture]); } }
    else if (message.bombAction === 'release') { if (this.gesture !== undefined) { out.push([3, this.gesture, aim?.x ?? null, aim?.y ?? null]); this.gesture = undefined; } }
    else if (message.bombAction === 'cancel' || !message.bomb) { if (this.gesture !== undefined) { out.push([4, this.gesture]); this.gesture = undefined; } }
    return out;
  }
  /** A new room or a fresh stream starts from neutral without emitting anything. */
  reset(): void { this.flags = 0; this.aim = undefined; this.gesture = undefined; }
}
