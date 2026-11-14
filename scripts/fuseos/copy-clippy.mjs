/**
 * Copies the Clippy Office Assistant from the clippyjs package into
 * public/assistant/clippy so the sprite sheet, the frame table and the sounds
 * are served from our own origin (the Flows CSP allows nothing else).
 *
 * clippyjs ships the agent as ES modules: the frame table as an object, the
 * sprite sheet and every sound as data URIs. They are written out as
 * agent.json, map.png and sounds.json, which the app's own sprite player reads;
 * the clippyjs runtime itself is not used.
 *
 * The copied files are committed; this script keeps them in sync with the
 * installed clippyjs version and runs before every build.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "node_modules", "clippyjs");
const target = join(root, "public", "assistant", "clippy");

function dataUriToBuffer(uri, expectedType) {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(uri);
  if (!match || match[1] !== expectedType)
    throw new Error(`copy-clippy: expected a ${expectedType} data URI`);
  return Buffer.from(match[2], "base64");
}

if (!existsSync(join(source, "dist", "agents", "clippy", "agent.mjs"))) {
  console.error("clippyjs is not installed; run npm install first.");
  process.exit(1);
}

const agentDir = join(source, "dist", "agents", "clippy");
const { default: agent } = await import(
  pathToFileURL(join(agentDir, "agent.mjs")).href
);
const { default: map } = await import(
  pathToFileURL(join(agentDir, "map.mjs")).href
);
const { default: sounds } = await import(
  pathToFileURL(join(agentDir, "sounds-mp3.mjs")).href
);

mkdirSync(target, { recursive: true });
writeFileSync(join(target, "agent.json"), JSON.stringify(agent));
writeFileSync(join(target, "map.png"), dataUriToBuffer(map, "image/png"));
writeFileSync(join(target, "sounds.json"), JSON.stringify(sounds));

const { version, license } = JSON.parse(
  readFileSync(join(source, "package.json"), "utf8"),
);
writeFileSync(
  join(target, "VERSION.txt"),
  `clippyjs ${version} (${license})\nhttps://github.com/pi0/clippyjs\nSprites and sounds: Microsoft Office Assistant "Clippit".\n`,
);
console.log(
  `Copied Clippy from clippyjs ${version} to public/assistant/clippy (${Object.keys(agent.animations).length} animations, ${Object.keys(sounds).length} sounds)`,
);
