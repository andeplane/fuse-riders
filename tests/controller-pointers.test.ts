import test from 'node:test';
import assert from 'node:assert/strict';
import { ControllerInputState, type ControllerInputMessage } from '../src/client/controller-state.js';
import { ControllerPointerBindings, type PointerButton } from '../src/client/controller-pointers.js';

class Button extends EventTarget implements PointerButton {
  disabled = false;
  active = false;
  captureFails = false;
  captures = new Set<number>();
  classList = { toggle: (_name: string, value?: boolean) => this.active = Boolean(value) };
  setPointerCapture(id: number): void { if (this.captureFails) throw new Error('contact expired'); this.captures.add(id); }
  hasPointerCapture(id: number): boolean { return this.captures.has(id); }
  releasePointerCapture(id: number): void { this.captures.delete(id); fire(this, 'lostpointercapture', id); }
}
function fire(target: EventTarget, type: string, pointerId: number, pointerType = 'touch', button = 0, buttons = 1): void {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { pointerId, pointerType, button, buttons, clientX: 50, clientY: 50 }); target.dispatchEvent(event);
}
function fixture(slide = false) {
  const messages: ControllerInputMessage[] = [];
  const state = new ControllerInputState({ send: message => { messages.push(message); return true; } });
  const left = new Button(); const right = new Button(); const bomb = new Button(); const terminal = new EventTarget();
  let changes = 0; let hovered: PointerButton | undefined;
  const bindings = new ControllerPointerBindings(state, [[left, 'left'], [right, 'right'], [bomb, 'bomb']], terminal, () => { changes += 1; }, slide ? () => hovered : undefined);
  return { messages, state, left, right, bomb, terminal, bindings, hover: (button?: PointerButton) => { hovered = button; }, changes: () => changes };
}

test('recycled pointer ownership cancels old steering and makes both buttons reusable', () => {
  const f = fixture();
  fire(f.left, 'pointerdown', 1); fire(f.right, 'pointerdown', 1);
  assert.equal(f.left.active, false); assert.equal(f.right.active, true);
  assert.equal(f.left.captures.size, 0);
  fire(f.terminal, 'pointerup', 1);
  assert.equal(f.state.hasHeld(), false);
  fire(f.left, 'pointerdown', 1); fire(f.terminal, 'pointerup', 1);
  assert.equal(f.left.active, false);
  assert.ok(f.changes() > 0);
});

test('global release works if capture throws and leaves simultaneous touches intact', () => {
  const f = fixture(); f.left.captureFails = true;
  fire(f.left, 'pointerdown', 1); fire(f.left, 'pointerdown', 2); fire(f.bomb, 'pointerdown', 3);
  fire(f.terminal, 'pointercancel', 1);
  assert.equal(f.left.active, true); assert.equal(f.bomb.active, true);
  fire(f.terminal, 'pointerup', 2); fire(f.terminal, 'pointerup', 3);
  assert.equal(f.state.hasHeld(), false);
  assert.equal(f.messages.at(-1)!.bombAction, 'release');
});

test('lost capture and clear cancel charge without accidental release, then recover immediately', () => {
  const f = fixture();
  fire(f.bomb, 'pointerdown', 1); fire(f.bomb, 'lostpointercapture', 1);
  fire(f.terminal, 'pointerup', 1);
  assert.equal(f.messages.at(-1)!.bombAction, 'cancel');
  fire(f.left, 'pointerdown', 2); fire(f.bomb, 'pointerdown', 3); f.bindings.clear();
  assert.equal(f.left.captures.size, 0); assert.equal(f.bomb.captures.size, 0);
  assert.equal(f.left.active, false); assert.equal(f.bomb.active, false);
  assert.equal(f.messages.at(-1)!.bombAction, 'cancel');
  fire(f.bomb, 'pointerdown', 3); fire(f.terminal, 'pointerup', 3);
  assert.equal(f.messages.at(-1)!.bombAction, 'release');
  f.bindings.clear(false); f.bindings.clear(true, true);
  assert.equal(f.messages.at(-1)!.bomb, false);
});

test('disabled buttons, unrelated capture loss, right clicks and duplicate terminal events do nothing', () => {
  const f = fixture(); f.bomb.disabled = true;
  fire(f.bomb, 'pointerdown', 1); fire(f.left, 'pointerdown', 2, 'mouse', 2);
  assert.equal(f.messages.length, 0);
  fire(f.left, 'pointerdown', 3);
  fire(f.right, 'lostpointercapture', 3);
  assert.equal(f.left.active, true);
  fire(f.terminal, 'pointerup', 3); const count = f.messages.length;
  fire(f.terminal, 'pointercancel', 3);
  assert.equal(f.messages.length, count);
  fire(f.left, 'contextmenu', 4);
});

test('input model independently repairs pointer reassignment and preserves duplicate down', () => {
  const f = fixture(); f.state.pointerDown(1, 'left'); f.state.pointerDown(1, 'left');
  assert.equal(f.messages.length, 1);
  f.state.pointerDown(1, 'bomb');
  assert.equal(f.state.isHeld('left'), false);
  f.state.pointerDown(1, 'right');
  assert.equal(f.messages.at(-2)!.bombAction, 'cancel');
  f.state.pointerRelease(1); assert.equal(f.state.hasHeld(), false);
});

test('held drag enters, switches and exits buttons without tapping; hovering does not press', () => {
  const f = fixture(true); f.hover(f.left);
  fire(f.terminal, 'pointermove', 1, 'mouse', 0, 0); assert.equal(f.state.hasHeld(), false);
  fire(f.terminal, 'pointermove', 1); assert.equal(f.left.active, true);
  f.hover(f.right); fire(f.terminal, 'pointermove', 1);
  assert.equal(f.left.active, false); assert.equal(f.right.active, true);
  f.hover(); fire(f.terminal, 'pointermove', 1); assert.equal(f.state.hasHeld(), false);
  f.bomb.disabled = true; f.hover(f.bomb); fire(f.terminal, 'pointermove', 1); assert.equal(f.state.hasHeld(), false);
});
test('Target aim keeps its thumb while sliding across other controls', () => {
  const f = fixture(true); f.state.configureTargetAim({ x: .5, y: .5 });
  fire(f.bomb, 'pointerdown', 1); f.hover(f.left); fire(f.terminal, 'pointermove', 1);
  assert.equal(f.bomb.active, true); assert.equal(f.left.active, false);
  fire(f.terminal, 'pointerup', 1); assert.equal(f.messages.at(-1)!.bombAction, 'release');
});

test('cancelled or cleared contacts cannot slide-reactivate before lifting', () => {
  const f = fixture(true); f.hover(f.left); fire(f.left, 'pointerdown', 1);
  f.bindings.clear(); fire(f.terminal, 'pointermove', 1); assert.equal(f.state.hasHeld(), false);
  fire(f.terminal, 'pointerup', 1); fire(f.terminal, 'pointermove', 1); assert.equal(f.left.active, true);
  fire(f.terminal, 'pointercancel', 1); fire(f.terminal, 'pointermove', 1); assert.equal(f.state.hasHeld(), false);
  fire(f.left, 'pointerdown', 1); assert.equal(f.left.active, true);
});
