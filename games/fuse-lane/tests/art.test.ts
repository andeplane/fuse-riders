import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { ART_BY_ID } from "../art/assets.js";
import { createArt, roundRect, shade } from "../src/app/art.js";
import { FakeContext } from "./fixtures/canvas.js";
import { FakeImages, installDom } from "./fixtures/dom.js";

const dom = installDom();

test("a picture loads once, on first use, from the site base; until it has loaded, and after it failed, there is none", () => {
  const images = new FakeImages(),
    art = createArt("/base/", images.make);
  assert.equal(art.asset("no-such-art"), undefined);
  assert.equal(art.asset("ui-cash"), ART_BY_ID.get("ui-cash"));
  assert.equal(art.image("no-such-art"), undefined);
  assert.equal(images.made.length, 0, "nothing to load");

  assert.equal(art.image("ui-cash"), undefined, "loading");
  assert.equal(images.made.length, 1);
  assert.equal(images.made[0]!.src, "/base/fuse-lane/ui/cash.png");
  art.image("ui-cash");
  assert.equal(images.made.length, 1, "one load per picture");
  images.made[0]!.load();
  assert.equal(art.image("ui-cash"), images.made[0]);

  art.image("ui-week");
  images.made[1]!.complete = true; // a file that "loaded" with no pixels
  assert.equal(art.image("ui-week"), undefined);

  art.image("ui-bank");
  images.made[2]!.fail();
  assert.equal(art.image("ui-bank"), undefined);
  assert.equal(images.made.length, 3, "a missing file is not asked for again");
});

test("drawing: a loaded sprite's frame at its anchor; nothing for an unknown id", () => {
  const images = new FakeImages(),
    art = createArt("/", images.make),
    c = new FakeContext();
  art.draw(c.context, "no-such-art", 0, 0, 10);
  assert.deepEqual(c.calls, []);
  art.image("avatar-fox-walk");
  images.loadAll();
  art.draw(c.context, "avatar-fox-walk", 100, 200, 50, 3);
  // Two 256 px frames; anchored at (0.5, 0.94): 50 px wide and tall, its feet at (100, 200).
  assert.deepEqual(c.named("drawImage")[0]!.args, [
    images.made[0],
    256,
    0,
    256,
    256,
    75,
    153,
    50,
    50,
  ]);
  c.clear();
  art.image("ui-cash");
  images.loadAll();
  art.draw(c.context, "ui-cash", 10, 10, 20);
  assert.deepEqual(
    c.named("drawImage")[0]!.args.slice(1),
    [0, 0, 128, 128, 0, 0, 20, 20],
  );
});

test("a missing picture is drawn as its placeholder: a little house, a token, or a labelled block", () => {
  const art = createArt("/", new FakeImages().make);
  const draw = (id: string) => {
    const c = new FakeContext();
    art.draw(c.context, id, 100, 100, 80);
    assert.equal(c.named("save").length, c.named("restore").length);
    return c;
  };
  const house = draw("building-roomshare"),
    asset = ART_BY_ID.get("building-roomshare")!;
  const fills = house.named("fill").map((call) => call.style.fill);
  assert.deepEqual(fills, [
    "#0b1d3a33",
    asset.color,
    shade(asset.color, -0.25),
    "#16213e",
  ]);
  assert.equal(house.named("closePath").length, 3, "body, roof and door");
  assert.deepEqual(house.texts(), ["ROOM"]);
  assert.match(
    house.named("fillText")[0]!.style.font,
    /^700 13\.8\d*px system-ui/,
  );

  const token = draw("avatar-cat-idle");
  assert.equal(token.named("arc").length, 1);
  assert.deepEqual(token.texts(), ["C"]);
  assert.equal(
    token.named("fill")[1]!.style.fill,
    ART_BY_ID.get("avatar-cat-idle")!.color,
  );

  const block = draw("ui-bank");
  assert.deepEqual(block.texts(), ["BK"]);
  assert.match(block.named("fillText")[0]!.style.font, /^700 24px/);
  assert.deepEqual(draw("board-fusetown").texts(), [], "the map has no label");
});

test("an element shows the placeholder and swaps in the picture once it loads, unless the file is missing", () => {
  const images = new FakeImages(),
    art = createArt("/", images.make);
  const unknown = art.element("no-such-art", 40, "extra");
  assert.equal(unknown.className, "fl-art extra");
  assert.equal(unknown.style.getPropertyValue("--art-size"), "40px");
  assert.equal(unknown.dataset.label, undefined);

  const waiting = art.element("ui-cash", 20),
    twin = art.element("ui-cash", 30, "big");
  assert.equal(waiting.className, "fl-art");
  assert.equal(waiting.dataset.label, "$");
  assert.equal(waiting.getAttribute("aria-hidden"), "true");
  assert.equal(waiting.style.getPropertyValue("--art-color"), "#3ddc84");
  assert.equal(waiting.children.length, 0);
  images.find("cash.png")!.load();
  for (const box of [waiting, twin]) {
    assert.ok(box.classList.contains("loaded"));
    const img = box.querySelector("img")!;
    assert.equal(img.getAttribute("src"), "/fuse-lane/ui/cash.png");
    assert.equal(img.getAttribute("alt"), "");
  }
  const ready = art.element("ui-cash", 20);
  assert.ok(ready.querySelector("img"), "already loaded: the picture at once");

  const missing = art.element("ui-bank", 20);
  images.find("bank.png")!.fail();
  assert.equal(missing.querySelector("img"), null);
  const later = art.element("ui-bank", 20);
  assert.equal(later.children.length, 0, "nothing waits on a missing file");
  assert.equal(images.made.length, 2);
});

test("elements go into the document art was made for, else the page's", () => {
  const { document: other } = parseHTML("<html><body></body></html>");
  const own = createArt(
    "/",
    new FakeImages().make,
    other as unknown as Document,
  );
  assert.equal(own.element("ui-cash", 10).ownerDocument, other);
  const page = createArt("/", new FakeImages().make);
  assert.equal(page.element("ui-cash", 10).ownerDocument, dom.document);
});

test("rounded rectangles keep their radius inside the box; colours shade lighter or darker", () => {
  const c = new FakeContext();
  roundRect(c.context, 0, 0, 10, 4, 9);
  assert.ok(c.named("arcTo").every((call) => call.args[4] === 2));
  c.clear();
  roundRect(c.context, 0, 0, 10, 4, -3);
  assert.ok(c.named("arcTo").every((call) => call.args[4] === 0));
  assert.deepEqual(c.named("moveTo")[0]!.args, [0, 0]);
  assert.equal(shade("#ff0000", -0.5), "rgb(128, 0, 0)");
  assert.equal(shade("#000000", 0.5), "rgb(128, 128, 128)");
  assert.equal(shade("#204060", 0), "rgb(32, 64, 96)");
});

test("an element keeps its placeholder when the file loads with no pixels", () => {
  const images = new FakeImages(),
    art = createArt("/", images.make);
  const box = art.element("ui-week", 20);
  images.find("week.png")!.load(0);
  assert.equal(box.querySelector("img"), null);
  assert.ok(!box.classList.contains("loaded"));
});
