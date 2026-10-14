import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import test from "node:test";
import {
  createAppPortal,
  parsePortalEntry,
  PORTAL_GAMES,
  type PortalGame,
} from "fuse-ui";
import { HOSTILE, event, page } from "./dom-fixture.js";

const GAMES: PortalGame[] = [
  {
    id: "fuse-riders",
    path: "",
    name: "Fuse Riders",
    tagline: "Neon arena",
    mark: "FR",
    accent: "#16e7ff",
    order: 1,
  },
  {
    id: "hook-havok",
    path: "hook-havok/",
    name: HOSTILE,
    tagline: "Hooks",
    mark: "HH",
    accent: "#ff2e9d",
    order: 100,
  },
];

const links = (element: HTMLElement) => [
  ...element.querySelectorAll<HTMLAnchorElement>(".fui-portal-game"),
];

test("portal: one tile per game, linked under the base, the current game marked", () => {
  const { document } = page();
  const portal = createAppPortal({
    document,
    current: "hook-havok",
    base: "/fuse-riders/",
    games: GAMES,
  });
  const tiles = links(portal.element);
  assert.deepEqual(
    tiles.map((tile) => tile.getAttribute("href")),
    ["/fuse-riders/", "/fuse-riders/hook-havok/"],
  );
  assert.equal(tiles[0]!.getAttribute("aria-current"), null);
  assert.equal(tiles[1]!.getAttribute("aria-current"), "page");
  // A name renders as text, never markup.
  assert.equal(
    tiles[1]!.querySelector(".fui-portal-name")!.textContent,
    HOSTILE,
  );
  assert.equal(tiles[1]!.querySelector("img"), null);
});

test("portal: a muted page keeps the other games muted", () => {
  const { document } = page();
  const portal = createAppPortal({
    document,
    current: "fuse-riders",
    base: "/",
    search: "?room=ABC&mute",
    games: GAMES,
  });
  assert.deepEqual(
    links(portal.element).map((tile) => tile.getAttribute("href")),
    ["/?mute", "/hook-havok/?mute"],
  );
});

test("portal: the button opens the grid; Escape, an outside press or a pick closes it", () => {
  const { document, window } = page();
  const portal = createAppPortal({
    document,
    current: "fuse-riders",
    base: "/",
    games: GAMES,
  });
  document.body.append(portal.element);
  const toggle = portal.element.querySelector("button")!;
  const panel = portal.element.querySelector(".fui-portal-panel")!;
  assert.equal(panel.hasAttribute("hidden"), true);

  toggle.dispatchEvent(event(window, "click"));
  assert.equal(portal.isOpen, true);
  assert.equal(panel.hasAttribute("hidden"), false);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  // A press inside the panel keeps it open.
  panel.dispatchEvent(event(window, "pointerdown"));
  assert.equal(portal.isOpen, true);

  document.dispatchEvent(event(window, "keydown", { key: "Escape" }));
  assert.equal(portal.isOpen, false);
  assert.equal(toggle.getAttribute("aria-expanded"), "false");

  toggle.dispatchEvent(event(window, "click"));
  document.body.dispatchEvent(event(window, "pointerdown"));
  assert.equal(portal.isOpen, false);

  toggle.dispatchEvent(event(window, "click"));
  links(portal.element)[0]!.dispatchEvent(event(window, "click"));
  assert.equal(portal.isOpen, false);

  // Closed, it no longer listens: a stray Escape changes nothing.
  document.dispatchEvent(event(window, "keydown", { key: "Escape" }));
  assert.equal(panel.hasAttribute("hidden"), true);
});

test("portal: with no games it renders hidden and never opens", () => {
  const { document } = page();
  const portal = createAppPortal({
    document,
    current: "fuse-riders",
    base: "/",
    games: [],
  });
  assert.equal(portal.element.hasAttribute("hidden"), true);
  portal.open();
  assert.equal(portal.isOpen, false);
  // Outside a Vite build the list the build fills in is empty.
  assert.deepEqual(PORTAL_GAMES, []);
});

test("portal entry: required fields, a #rrggbb accent and a default order", () => {
  const good = {
    name: "Fuse Freight",
    tagline: "Collect, steal, deliver.",
    mark: "FF",
    accent: "#ffe46b",
  };
  assert.deepEqual(parsePortalEntry(good), { ...good, order: 100 });
  assert.equal(parsePortalEntry({ ...good, order: 2 })?.order, 2);
  for (const bad of [
    null,
    "Fuse Freight",
    { ...good, name: "" },
    { ...good, tagline: undefined },
    { ...good, mark: "FFFF" },
    { ...good, accent: "red" },
    { ...good, accent: "#fff" },
    { ...good, order: "1" },
  ])
    assert.equal(parsePortalEntry(bad), null, JSON.stringify(bad));
});

test("portal entry: every game's portal.json is valid, and the dice demo has none", () => {
  const root = new URL("../../../games/", import.meta.url);
  const listed = readdirSync(root).filter((id) =>
    existsSync(new URL(`${id}/portal.json`, root)),
  );
  for (const id of listed)
    assert.notEqual(
      parsePortalEntry(
        JSON.parse(readFileSync(new URL(`${id}/portal.json`, root), "utf8")),
      ),
      null,
      `games/${id}/portal.json`,
    );
  assert.ok(listed.includes("fuse-riders"));
  assert.ok(!listed.includes("dice"));
});
