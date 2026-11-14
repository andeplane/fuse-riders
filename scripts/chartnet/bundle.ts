/**
 * ChartNet's charts into the game: each song's generated `.ssc` (written by `gen2.py fuse` to
 * `$CHARTNET_WORK/out_fuse2`) gets the song's own header and timing and replaces its charts in
 * `games/fusemania/charts/<id>.ssc`. `scripts/fusemania-charts.ts generate` leaves such a file alone (it carries
 * `#CREDIT:ChartNet;`), and its `bundle` puts it in the game.
 *
 *   pnpm exec tsx scripts/chartnet/bundle.ts <generated dir> [song id...]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SONGS } from "../lib/fusemania/songs.js";

const [generated, ...only] = process.argv.slice(2);
if (!generated)
  throw new Error("usage: bundle.ts <generated dir> [song id...]");
const dir = generated.startsWith("/")
  ? generated
  : join(process.cwd(), generated);
process.chdir(fileURLToPath(new URL("../..", import.meta.url)));
const CHARTS = "games/fusemania/charts";

let count = 0;
for (const song of SONGS) {
  if (only.length > 0 && !only.includes(song.id)) continue;
  const source = join(dir, `${song.id}.ssc`);
  if (!existsSync(source)) continue;
  const target = join(CHARTS, `${song.id}.ssc`);
  const own = readFileSync(target, "utf8");
  const head = own.slice(0, own.indexOf("\n#NOTEDATA:"));
  const charts = readFileSync(source, "utf8")
    .slice(readFileSync(source, "utf8").indexOf("\n#NOTEDATA:"))
    .trimEnd()
    // The game names a chart by its difficulty; ChartNet is credited instead.
    .replace(
      /#DESCRIPTION:[^;]*;\n#DIFFICULTY:([^;]*);/g,
      "#DESCRIPTION:$1;\n#DIFFICULTY:$1;",
    );
  writeFileSync(target, `${head}\n${charts}\n`);
  count++;
}
console.log(`wrote ChartNet charts for ${count} songs into ${CHARTS}`);
