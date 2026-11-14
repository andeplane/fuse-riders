import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { freezePlaytestPage } from "../src/playtest-capture.js";

function fixture() {
  return new Window({ url: "https://example.test/fuse-riders/" })
    .document as unknown as Document;
}

test("the frozen frame omits hidden invitation assets without loading hidden canvases", () => {
  const document = fixture();
  document.head.innerHTML = "<style>.invite { display: none; }</style>";
  document.body.innerHTML = `
    <section class="invite"><img class="qr" src=""><canvas></canvas></section>
    <main>Visible game</main>
    <dialog data-fui-playtest>Private report</dialog>`;
  const clone = freezePlaytestPage(document, new Map());
  assert.equal(clone.querySelector(".invite"), null);
  assert.equal(clone.querySelector("[data-fui-playtest]"), null);
  assert.equal(clone.querySelector("main")?.textContent, "Visible game");
  assert.ok(document.querySelector(".invite .qr"), "live UI remains intact");
});

test("visible image and canvas resources survive while empty images cannot fetch the page", () => {
  const document = fixture();
  document.body.innerHTML = `
    <img id="scene" src="scene.png" width="640" height="360">
    <img id="empty" src="" width="24" height="24">
    <img id="missing" width="16" height="16">
    <canvas width="640" height="360"></canvas>`;
  const canvas = document.querySelector("canvas")!;
  const pixels = "data:image/png;base64,renderer-frame";
  const clone = freezePlaytestPage(document, new Map([[canvas, pixels]]));
  const scene = clone.querySelector<HTMLImageElement>("#scene")!;
  assert.equal(scene.src, "https://example.test/fuse-riders/scene.png");
  assert.equal(scene.width, 640);
  for (const id of ["empty", "missing"])
    assert.match(
      clone.querySelector<HTMLImageElement>(`#${id}`)!.src,
      /^data:image\//,
    );
  assert.equal(clone.querySelector("#empty")?.getAttribute("width"), "24");
  assert.equal(clone.querySelector("canvas"), null);
  assert.equal(
    clone.querySelector<HTMLImageElement>("img:last-child")?.src,
    pixels,
  );
  assert.equal(canvas.isConnected, true);
});

test("input values freeze the current frame and never retain a password property", () => {
  const document = fixture();
  document.body.innerHTML = `
    <input id="name" value="old">
    <input id="password" type="password" value="initial-secret">`;
  document.querySelector<HTMLInputElement>("#name")!.value = "Current name";
  document.querySelector<HTMLInputElement>("#password")!.value =
    "edited-secret";
  const clone = freezePlaytestPage(document, new Map());
  assert.equal(
    clone.querySelector<HTMLInputElement>("#name")!.value,
    "Current name",
  );
  const password = clone.querySelector<HTMLInputElement>("#password")!;
  assert.equal(password.value, "");
  assert.equal(password.getAttribute("value"), "");
  assert.doesNotMatch(clone.outerHTML, /initial-secret|edited-secret/);
  assert.equal(
    document.querySelector<HTMLInputElement>("#password")!.value,
    "edited-secret",
  );
});
