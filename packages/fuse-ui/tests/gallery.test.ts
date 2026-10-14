import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { createGameGallery } from "../src/gallery.js";
import { parsePortalEntry, type PortalGame } from "../src/portal.js";
import { legacyRidersLink } from "../../../site/routes.js";
import { createAppPortal } from "../src/portal.js";
import { HOSTILE, page } from "./dom-fixture.js";

const games: PortalGame[] = [
  {
    id: "fuse-riders",
    path: "fuse-riders/",
    name: HOSTILE,
    tagline: "Trail trouble",
    mark: "FR",
    accent: "#16e7ff",
    order: 1,
    screenshot: "gallery/fuse-riders.jpg",
  },
];

test("a relative-base game launcher links back one level to the gallery and sibling games", () => {
  const { document } = page();
  const portal = createAppPortal({
    document,
    current: "fuse-riders",
    base: "./",
    search: "?mute",
    games,
  });
  assert.equal(
    portal.element.querySelector(".fui-portal-heading")!.getAttribute("href"),
    "../?mute",
  );
  assert.equal(
    portal.element.querySelector(".fui-portal-game")!.getAttribute("href"),
    "../fuse-riders/?mute",
  );
});

test("gallery links each game and its screenshot under the deployment base, carrying only mute", () => {
  const { document } = page();
  const gallery = createGameGallery({
    document,
    base: "/arcade/",
    search: "?mute&room=ABCD&secret=no",
    games,
  });
  const link = gallery.querySelector(".arcade-game")!;
  assert.equal(link.getAttribute("href"), "/arcade/fuse-riders/?mute");
  assert.equal(
    link.querySelector("img")!.getAttribute("src"),
    "/arcade/gallery/fuse-riders.jpg",
  );
  assert.equal(link.querySelector("h3")!.textContent, HOSTILE);
  assert.equal(gallery.querySelectorAll("img").length, 1);
  assert.equal(
    gallery.querySelector(".arcade-count")!.textContent,
    "01 GAMES · FREE TO PLAY",
  );
});

test("new games without a screenshot still have a playable tile; empty catalog has a message", () => {
  const { document } = page();
  const gallery = createGameGallery({
    document,
    base: "/",
    games: [{ ...games[0]!, screenshot: undefined }],
  });
  assert.equal(gallery.querySelector(".arcade-placeholder")!.textContent, "FR");
  assert.equal(
    gallery.querySelector(".arcade-game")!.getAttribute("href"),
    "/fuse-riders/",
  );
  assert.match(
    createGameGallery({ document, base: "/", games: [] }).textContent!,
    /More games are on the way/,
  );
});

test("legacy Riders room, solo and display URLs remain game entries, while plain or muted root is the catalog", () => {
  for (const search of [
    "?room=ABCD&display=1&mute",
    "?solo=1",
    "?room=INVALID",
    "?display=1",
  ])
    assert.equal(legacyRidersLink(search), true);
  for (const search of ["", "?mute", "?analytics=0"])
    assert.equal(legacyRidersLink(search), false);
});

test("every catalog game has a dedicated page and its optional screenshot exists", () => {
  const root = new URL("../../../", import.meta.url);
  for (const id of readdirSync(new URL("games/", root))) {
    const manifest = new URL(`games/${id}/portal.json`, root);
    if (!existsSync(manifest)) continue;
    const entry = parsePortalEntry(JSON.parse(readFileSync(manifest, "utf8")));
    assert.ok(entry, `${id}: invalid manifest`);
    if (entry.screenshot)
      assert.ok(
        existsSync(new URL(`public/${entry.screenshot}`, root)),
        `${id}: missing screenshot file`,
      );
    assert.ok(
      existsSync(new URL(`games/${id}/index.html`, root)),
      `${id}: missing page`,
    );
  }
  const raw = JSON.parse(
    readFileSync(new URL("games/fuse-riders/portal.json", root), "utf8"),
  );
  for (const screenshot of [
    "https://example.com/a.jpg",
    "../a.png",
    "gallery/a.svg",
    "gallery/a.jpg?token=x",
  ])
    assert.equal(parsePortalEntry({ ...raw, screenshot }), null);
});
