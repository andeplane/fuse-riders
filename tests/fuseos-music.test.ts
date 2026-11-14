import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  FUSE_MUSIC_GAMES,
  FUSE_TRACKS,
  fuseTrackArtist,
  fuseTrackUrl,
} from "../packages/fuseos/src/winamp/fuseTracks.js";

/**
 * FuseOS's Winamp queues every music file the games ship (`packages/fuseos/src/winamp/fuseTracks.ts`). The files
 * live in two places the site serves as-is: the root `public/` (`public/music/...` is `<base>music/...`) and each
 * game's own `games/<id>/public/` (`games/killer-fuse/public/killer-fuse/audio/music/x.mp3` is
 * `<base>killer-fuse/audio/music/x.mp3`, see `gamePublic` in vite.config.ts). A game that adds, renames or
 * removes a track fails here until the catalogue follows, so the playlist never names a file that is not there
 * and never misses one that is.
 */
const AUDIO = /\.(m4a|mp3|ogg|oga|opus|wav|flac|aac|webm)$/i;
const root = path.join(import.meta.dirname, "..");

/** Every file under `directory`, as paths relative to it with `/` separators. */
function filesUnder(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory())
      return filesUnder(file).map((child) => `${entry.name}/${child}`);
    return [entry.name];
  });
}

/** The site paths of every audio file the repo serves, from the root `public/` and every game's `public/`. */
function servedMusic(): string[] {
  const shared = filesUnder(path.join(root, "public")).filter(
    // `public/fuseos/` holds the retro games' own bundles, not Fuse music.
    (file) => AUDIO.test(file) && !file.startsWith("fuseos/"),
  );
  const perGame = readdirSync(path.join(root, "games"), {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) =>
      filesUnder(path.join(root, "games", entry.name, "public")).filter(
        (file) => AUDIO.test(file),
      ),
    );
  return [...shared, ...perGame].sort();
}

test("the catalogue lists every served music file exactly once", () => {
  const onDisk = servedMusic();
  const listed = FUSE_TRACKS.map((track) => track.path).sort();
  assert.ok(
    onDisk.length > 0,
    "no music files found: is the repo laid out as expected?",
  );
  assert.deepEqual(listed, [...new Set(listed)], "a file is listed twice");
  assert.deepEqual(listed, onDisk);
});

test("every track has a unique id, a title and a measured length", () => {
  const ids = FUSE_TRACKS.map((track) => track.id);
  assert.equal(new Set(ids).size, ids.length, "an id is used twice");
  for (const track of FUSE_TRACKS) {
    assert.match(track.id, /^[a-z0-9-]+$/, `${track.path}: id ${track.id}`);
    assert.ok(track.title.trim().length > 0, `${track.path} has no title`);
    assert.ok(track.games.length > 0, `${track.path} credits no game`);
    assert.ok(
      Number.isFinite(track.duration) && track.duration > 0,
      `${track.path} has no duration`,
    );
  }
});

test("every credited game is on the portal under the name the catalogue uses", () => {
  for (const [id, name] of Object.entries(FUSE_MUSIC_GAMES)) {
    const file = path.join(root, "games", id, "portal.json");
    assert.ok(existsSync(file), `${id} has no portal.json`);
    const portal: unknown = JSON.parse(readFileSync(file, "utf8"));
    assert.ok(typeof portal === "object" && portal !== null);
    assert.equal((portal as { name?: unknown }).name, name, `${id}'s name`);
  }
  const credited = new Set(FUSE_TRACKS.flatMap((track) => track.games));
  assert.deepEqual(
    [...credited].sort(),
    Object.keys(FUSE_MUSIC_GAMES).sort(),
    "a game is named but credits no track, or the reverse",
  );
  assert.equal(
    fuseTrackArtist({
      id: "x",
      title: "x",
      games: ["fuseball", "fuse-volley"],
      path: "x",
      duration: 1,
    }),
    "Fuseball, Fuse Volley",
  );
});

test("track urls follow the site base the OS is served from", () => {
  const track = FUSE_TRACKS.find((entry) => entry.id === "match-day");
  assert.ok(track);
  assert.equal(
    fuseTrackUrl(track, "/fuse-riders/"),
    "/fuse-riders/killer-fuse/audio/music/match-day.mp3",
  );
  assert.equal(
    fuseTrackUrl(track, "./"),
    "./killer-fuse/audio/music/match-day.mp3",
  );
  assert.equal(
    fuseTrackUrl(track, "/"),
    "/killer-fuse/audio/music/match-day.mp3",
  );
});

/** Where `path` is on disk: the root `public/` first, else the one game `public/` that serves it. */
function diskFile(served: string): string {
  const shared = path.join(root, "public", served);
  if (existsSync(shared)) return shared;
  const [game] = served.split("/");
  return path.join(root, "games", game ?? "", "public", served);
}

function ffprobeDuration(file: string): number | undefined {
  try {
    const out = execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "csv=p=0",
        file,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    const seconds = Number.parseFloat(out.trim());
    return Number.isFinite(seconds) ? seconds : undefined;
  } catch {
    return undefined;
  }
}

// Durations are what the playlist shows and what Webamp uses to skip fetching the file; they only need to be
// right to the second. Checked where ffprobe is installed (a developer's machine), skipped where it is not (CI).
test(
  "the catalogue's durations match the files",
  {
    skip:
      !ffprobeDuration(diskFile(FUSE_TRACKS[0]!.path)) &&
      "ffprobe is not installed",
  },
  () => {
    for (const track of FUSE_TRACKS) {
      const measured = ffprobeDuration(diskFile(track.path));
      assert.ok(measured !== undefined, `${track.path} could not be measured`);
      assert.ok(
        Math.abs(measured - track.duration) < 1,
        `${track.path}: catalogue says ${track.duration}s, file is ${measured}s`,
      );
    }
  },
);
