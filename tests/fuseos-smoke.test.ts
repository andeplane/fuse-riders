import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isGameEmbed, osUrl } from "../scripts/lib/fuseos-desktop.js";
import {
  parseScreenshotArgs,
  SHOT_NAMES,
} from "../scripts/fuseos-screenshots.js";
import { loadManifest } from "../scripts/lib/ci-manifest.js";

// The browser parts of scripts/fuseos-smoke.ts and scripts/fuseos-screenshots.ts run in CI's chrome-batch and by
// hand; what they decide without a browser (the URLs they open, what counts as a game embed, the command line
// and the set of shots) is pinned here, with the manifest entry that puts the smoke in the release suite.

test("osUrl opens the desktop muted, with the bare ?mute AGENTS.md shows", () => {
  assert.equal(osUrl("http://127.0.0.1:8787/"), "http://127.0.0.1:8787/?mute");
  assert.equal(
    osUrl("https://andeplane.github.io/fuse-riders/"),
    "https://andeplane.github.io/fuse-riders/?mute",
  );
  assert.equal(
    osUrl("http://127.0.0.1:8787/", { mute: false }),
    "http://127.0.0.1:8787/",
  );
});

test("osUrl adds the ?open= deep link before mute and keeps what the URL had", () => {
  assert.equal(
    osUrl("http://127.0.0.1:8787/", { open: ["paint"] }),
    "http://127.0.0.1:8787/?open=paint&mute",
  );
  assert.equal(
    osUrl("http://127.0.0.1:8787/?x=1", { open: ["fuseball", "winamp"] }),
    "http://127.0.0.1:8787/?x=1&open=fuseball%2Cwinamp&mute",
  );
  assert.equal(
    osUrl("http://127.0.0.1:8787/", { open: [] }),
    "http://127.0.0.1:8787/?mute",
  );
});

test("isGameEmbed accepts the game's own page under any base, muted exactly when the OS is", () => {
  assert.ok(isGameEmbed("/fuseball/?mute", "fuseball", true));
  assert.ok(isGameEmbed("/fuse-riders/fuseball/?mute", "fuseball", true));
  assert.ok(isGameEmbed("./fuseball/", "fuseball", false));
  assert.ok(!isGameEmbed("/fuseball/", "fuseball", true), "unmuted embed");
  assert.ok(!isGameEmbed("/fuseball/?mute", "fuseball", false), "muted embed");
  assert.ok(!isGameEmbed("/ball-bros/?mute", "fuseball", true), "other game");
  assert.ok(
    !isGameEmbed("/fuseball/index.html?mute", "fuseball", true),
    "not the directory URL the registry builds",
  );
});

test("the screenshot command line is a URL and an optional directory", () => {
  assert.deepEqual(parseScreenshotArgs(["http://127.0.0.1:8787/"]), {
    url: "http://127.0.0.1:8787/",
    directory: "artifacts/fuseos-shots",
  });
  assert.deepEqual(
    parseScreenshotArgs(["https://example.test/fuse-riders/", "shots"]),
    { url: "https://example.test/fuse-riders/", directory: "shots" },
  );
  assert.deepEqual(parseScreenshotArgs([]), {
    error: "usage: fuseos-screenshots.ts <url> [directory]",
  });
  assert.deepEqual(parseScreenshotArgs(["a", "b", "c"]), {
    error: "usage: fuseos-screenshots.ts <url> [directory]",
  });
  assert.deepEqual(parseScreenshotArgs(["not a url"]), {
    error: "not a URL: not a url",
  });
});

test("the PR screenshot set is the one the plan asks for, in capture order", () => {
  assert.deepEqual(
    [...SHOT_NAMES],
    [
      "boot",
      "desktop",
      "game-window",
      "winamp",
      "clippy-balloon",
      "control-panel-games",
      "doom",
      "explorer",
      "notepadpp",
      "pipes-preview",
      "mobile",
    ],
  );
  assert.equal(new Set(SHOT_NAMES).size, SHOT_NAMES.length, "unique names");
});

test("the FuseOS smoke is a chrome-batch release smoke against the served build, with its evidence uploaded", () => {
  const smoke = loadManifest().smokes.find((entry) => entry.id === "fuseos");
  assert.ok(smoke, "scripts/ci-manifest.json has no fuseos smoke");
  assert.equal(smoke.batch, "chrome-batch");
  assert.equal(smoke.command, "pnpm exec tsx scripts/fuseos-smoke.ts");
  assert.deepEqual(smoke.browsers, ["chrome"]);
  assert.equal(smoke.serviceUrlEnv, "HOME_URL");
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  assert.match(
    workflow,
    /^ {12}artifacts\/fuseos\/\*\.png$/m,
    "the smoke job's evidence upload must include artifacts/fuseos/*.png",
  );
});
