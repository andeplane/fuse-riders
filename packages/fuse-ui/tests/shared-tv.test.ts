import assert from "node:assert/strict";
import { test } from "node:test";
import { createSharedTvOption } from "fuse-ui";
import { page } from "./dom-fixture.js";

function build(accept = true) {
  const { document } = page();
  let clock = 0;
  const sent: boolean[] = [];
  let opened = 0;
  const option = createSharedTvOption({
    onChange: (display) => {
      sent.push(display);
      return accept;
    },
    onOpenScreen: () => opened++,
    now: () => clock,
    document,
  });
  document.body.append(option.element);
  const box = option.element.querySelector("input")!,
    open = option.element.querySelector("button")!;
  const tick = (checked: boolean) => {
    box.checked = checked;
    box.dispatchEvent(new document.defaultView!.Event("change"));
  };
  return {
    option,
    box,
    open,
    sent,
    tick,
    opened: () => opened,
    advance: (ms: number) => (clock += ms),
  };
}

test("Shared TV is offered only to the one who chooses, and the screen's button shows while it is on", () => {
  const { option, box, open, opened } = build();
  assert.equal(option.element.className, "fui-room-extra");
  assert.equal(option.element.hidden, true);
  option.update(false, true);
  assert.equal(option.element.hidden, false);
  assert.equal(box.checked, false);
  assert.equal(open.hidden, true);
  option.update(true, true);
  assert.equal(box.checked, true);
  assert.equal(open.hidden, false);
  open.click();
  assert.equal(opened(), 1);
  option.update(true, false);
  assert.equal(option.element.hidden, true);
});

test("the box keeps the host's choice while the room still reports the old value, then follows the room", () => {
  const { option, box, sent, tick, advance } = build();
  option.update(false, true);
  tick(true);
  assert.deepEqual(sent, [true]);
  // The room has not folded the command yet: its frames still say off.
  option.update(false, true);
  option.update(false, true);
  assert.equal(box.checked, true);
  // The room agrees: from here the box is the room's again.
  option.update(true, true);
  assert.equal(box.checked, true);
  option.update(false, true);
  assert.equal(box.checked, false);
  // A command the room never applies: after a second the box goes back to what the room has.
  tick(true);
  advance(999);
  option.update(false, true);
  assert.equal(box.checked, true);
  advance(2);
  option.update(false, true);
  assert.equal(box.checked, false);
});

test("a choice taken back before the room answered holds through the first command's answer", () => {
  const { option, box, sent, tick } = build();
  option.update(false, true);
  tick(true);
  tick(false);
  assert.deepEqual(sent, [true, false]);
  // Still the old value, then the first command lands, then the second: the box says off throughout.
  for (const display of [false, true, true, false]) {
    option.update(display, true);
    assert.equal(box.checked, false);
  }
  // Settled: the room leads again.
  option.update(true, true);
  assert.equal(box.checked, true);
});

test("the box follows the room while it is not offered, and a pending choice does not outlive its second", () => {
  const { option, box, tick, advance } = build();
  option.update(false, true);
  tick(true);
  option.update(false, false);
  assert.equal(option.element.hidden, true);
  advance(1001);
  option.update(false, false);
  assert.equal(box.checked, false);
});

test("a refused choice puts the box back at once", () => {
  const { option, box, sent, tick } = build(false);
  option.update(false, true);
  tick(true);
  assert.deepEqual(sent, [true]);
  assert.equal(box.checked, false);
  option.update(true, true);
  tick(false);
  assert.equal(box.checked, true);
});
