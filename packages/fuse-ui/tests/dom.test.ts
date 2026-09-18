import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { button, copyText, el, elementsFor, partClass } from "fuse-ui";
import { HOSTILE, page } from "./dom-fixture.js";

test("el sets text as text and a class only when given", () => {
  const { document } = page();
  const name = el("strong", HOSTILE, "rider-name", document);
  assert.equal(name.tagName, "STRONG");
  assert.equal(name.textContent, HOSTILE);
  assert.equal(name.children.length, 0, "the name is text, not markup");
  assert.equal(name.className, "rider-name");
  const bare = el("div", "", "", document);
  assert.equal(bare.hasAttribute("class"), false);
  assert.equal(bare.textContent, "");
});

test("elementsFor binds the factory to one document", () => {
  const { document } = page();
  const make = elementsFor(document);
  const cell = make("td", "5", "score");
  assert.equal(cell.ownerDocument, document);
  assert.equal(cell.outerHTML, '<td class="score">5</td>');
});

test("button never submits the form it sits in", () => {
  const { document } = page();
  const plain = button("CLOSE", "", document);
  assert.equal(plain.type, "button");
  assert.equal(plain.textContent, "CLOSE");
});

test("partClass prefers the caller's class, and an empty override means no class", () => {
  const defaults = { root: "fui-x", body: "fui-x-body" };
  assert.equal(partClass(defaults, undefined, "root"), "fui-x");
  assert.equal(partClass(defaults, { root: "game-x" }, "root"), "game-x");
  assert.equal(partClass(defaults, { body: "" }, "body"), "");
});

test("copyText reports a clipboard write, and falls back to execCommand when there is none", async () => {
  const { document } = page();
  const written: string[] = [];
  assert.equal(
    await copyText("https://x/?room=AB42", {
      clipboard: {
        writeText: async (text) => {
          written.push(text);
        },
      },
      document,
    }),
    true,
  );
  assert.deepEqual(written, ["https://x/?room=AB42"]);

  // An insecure origin has no clipboard; a rejected write falls through too. The legacy path reports what it did.
  const commands: string[] = [];
  let selected = 0;
  // linkedom has neither execCommand nor textarea.select(): this document supplies both, on its own instances.
  const create = document.createElement.bind(document);
  const legacy = Object.assign(document, {
    execCommand: (command: string) => {
      commands.push(command);
      return true;
    },
    createElement: (tag: string) =>
      Object.assign(create(tag), {
        select: () => {
          selected++;
        },
      }),
  });
  assert.equal(
    await copyText("link", {
      clipboard: {
        writeText: async () => {
          throw new Error("denied");
        },
      },
      document: legacy,
    }),
    true,
  );
  assert.deepEqual(commands, ["copy"]);
  assert.equal(selected, 1);
  assert.equal(
    document.querySelector("textarea"),
    null,
    "the helper field is removed",
  );

  Object.assign(document, {
    execCommand: () => {
      throw new Error("unsupported");
    },
  });
  assert.equal(await copyText("link", { document }), false);
  assert.equal(document.querySelector("textarea"), null);
});

test("the package imports nothing outside itself", () => {
  const root = path.resolve("packages/fuse-ui/src");
  const files = readdirSync(root).filter((name) => name.endsWith(".ts"));
  assert.ok(files.length > 0);
  for (const name of files) {
    const text = readFileSync(path.join(root, name), "utf8");
    for (const [, specifier] of text.matchAll(
      /(?:\bfrom\s+|\bimport\s*\(?\s*)["']([^"']+)["']/g,
    ))
      assert.match(
        specifier!,
        /^\.\/[\w-]+\.js$/,
        `${name} imports ${specifier}`,
      );
  }
});
