import assert from "node:assert/strict";
import test from "node:test";
import { ridersPageUrl } from "../scripts/lib/riders-url.js";

test("Riders smoke URL resolves from the site root including a GitHub Pages base", () => {
  assert.equal(
    ridersPageUrl("http://localhost:8787/"),
    "http://localhost:8787/fuse-riders/",
  );
  assert.equal(
    ridersPageUrl("https://andeplane.github.io/fuse-riders/"),
    "https://andeplane.github.io/fuse-riders/fuse-riders/",
  );
});
