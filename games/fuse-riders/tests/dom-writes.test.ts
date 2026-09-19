import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";
import {
  node,
  setAttributeIfChanged,
  setIfChanged,
} from "../src/online/dom.js";

test("setIfChanged assigns only a different value", () => {
  const writes: string[] = [];
  let hidden = false;
  const target = {
    get hidden() {
      return hidden;
    },
    set hidden(value: boolean) {
      writes.push(`hidden=${value}`);
      hidden = value;
    },
  };
  setIfChanged(target, "hidden", false);
  setIfChanged(target, "hidden", true);
  setIfChanged(target, "hidden", true);
  setIfChanged(target, "hidden", false);
  assert.deepEqual(writes, ["hidden=true", "hidden=false"]);
});

test("setAttributeIfChanged writes a new or different attribute only", () => {
  const writes: string[] = [];
  const attributes = new Map<string, string>();
  const element = {
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => {
      writes.push(`${name}=${value}`);
      attributes.set(name, value);
    },
  };
  setAttributeIfChanged(element, "aria-label", "Remove Bo");
  setAttributeIfChanged(element, "aria-label", "Remove Bo");
  setAttributeIfChanged(element, "aria-label", "Remove Cy");
  setAttributeIfChanged(element, "data-rank", "");
  assert.deepEqual(writes, [
    "aria-label=Remove Bo",
    "aria-label=Remove Cy",
    "data-rank=",
  ]);
});

test("node sets text and always a class attribute", () => {
  const { document } = parseHTML("<html><body></body></html>");
  const plain = node("strong", "<b>not markup</b>", "", document);
  assert.equal(plain.textContent, "<b>not markup</b>");
  assert.equal(plain.children.length, 0);
  assert.equal(
    node("p", "", "room-boot-note", document).className,
    "room-boot-note",
  );
  const text = node("span", "a", "", document);
  setIfChanged(text, "textContent", "a");
  setIfChanged(text, "textContent", "b");
  assert.equal(text.textContent, "b");
});
