import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";
import {
  createControllerLayoutSetting,
  CONTROLLER_SIDE_KEY,
} from "../src/client/controller-layout.js";
import {
  createMemoryStorage,
  safeStorage,
} from "../src/client/safe-storage.js";

function fixture(storage = createMemoryStorage()) {
  const { document, Event } = parseHTML(
    "<html><body><main></main></body></html>",
  );
  const app = document.querySelector("main")!;
  const cancelled: (string | undefined)[] = [];
  const setting = createControllerLayoutSetting(app, storage, () =>
    cancelled.push(app.dataset.bombSide),
  );
  const select = setting.querySelector("select")!;
  return {
    app,
    select,
    cancelled,
    choose(side: string) {
      for (const option of select.querySelectorAll("option"))
        option.selected = option.value === side;
      select.dispatchEvent(new Event("change"));
    },
  };
}

test("landscape side defaults safely; selection cancels before moving controls and survives remount", () => {
  const storage = createMemoryStorage();
  storage.setItem(CONTROLLER_SIDE_KEY, "corrupt");
  const f = fixture(storage);
  assert.equal(f.app.dataset.bombSide, "right");
  f.choose("left");
  assert.deepEqual(f.cancelled, ["right"]);
  assert.equal(f.app.dataset.bombSide, "left");
  assert.equal(storage.getItem(CONTROLLER_SIDE_KEY), "left");
  const next = fixture(storage);
  assert.equal(next.app.dataset.bombSide, "left");
  next.choose("right");
  assert.deepEqual(next.cancelled, ["left"]);
  assert.equal(fixture(storage).app.dataset.bombSide, "right");
});

test("blocked device storage still permits layout changes", () => {
  const storage = safeStorage(() => {
    throw new Error("blocked");
  });
  const f = fixture(storage);
  f.choose("left");
  assert.equal(f.app.dataset.bombSide, "left");
  assert.equal(fixture(storage).app.dataset.bombSide, "left");
});
