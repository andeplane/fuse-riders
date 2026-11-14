import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHTML } from "linkedom";
import { updateContent } from "../src/app/dom-update.js";

test("room updates retain the stateful shared header while updating the room", () => {
  const { document } = parseHTML(
    '<html><body><div id="app"><header class="nd-header" data-fui-preserve="true"><button>Open game menu</button><dialog open>Friends</dialog></header><main>Before</main></div></body></html>',
  );
  const root = document.getElementById("app")!;
  const header = root.querySelector("header"),
    dialog = root.querySelector("dialog"),
    button = root.querySelector("button");
  updateContent(
    root,
    '<header class="nd-header">FUSE CRAFT</header><main>After</main>',
  );
  assert.equal(root.querySelector("header"), header);
  assert.equal(root.querySelector("dialog"), dialog);
  assert.equal(root.querySelector("button"), button);
  assert.ok(dialog!.hasAttribute("open"));
  assert.equal(root.querySelector("main")?.textContent, "After");
});
