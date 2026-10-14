import test from "node:test";
import assert from "node:assert/strict";
import { createModalInputGate } from "../src/modal-input.js";

test("opening a dialog cancels held gameplay once, blocks inputs, and allows fresh play after closing", () => {
  let open = false;
  let held = 7;
  let cancellations = 0;
  let notify: (() => void) | undefined;
  const gate = createModalInputGate({
    isOpen: () => open,
    observe(change) {
      notify = change;
      return () => {
        notify = undefined;
      };
    },
    cancel() {
      held = 0;
      cancellations++;
    },
  });
  assert.equal(gate.blocked(), false);
  assert.equal(held, 7);
  open = true;
  notify?.();
  assert.equal(gate.blocked(), true);
  assert.equal(held, 0);
  notify?.();
  assert.equal(cancellations, 1, "dialog redraws do not repeat cancellation");
  open = false;
  notify?.();
  assert.equal(gate.blocked(), false);
  held = 4;
  open = true;
  notify?.();
  assert.equal(held, 0, "the next dialog releases newly held controls");
  assert.equal(cancellations, 2);
  gate.dispose();
  assert.equal(notify, undefined);
});
