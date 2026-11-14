/**
 * Copies the js-dos player and the DOSBox emulator core from node_modules into
 * public/jsdos so the DOS games run from our own origin (the Flows CSP only
 * allows scripts, workers and frames from 'self').
 *
 * The copied files are committed; this script keeps them in sync with the
 * installed js-dos version and runs before every build.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'node_modules', 'js-dos');
const target = join(root, 'public', 'jsdos');

const PLAYER_FILES = ['js-dos.js', 'js-dos.css'];
const EMULATOR_FILES = ['emulators.js', 'wdosbox.js', 'wdosbox.wasm', 'wlibzip.js', 'wlibzip.wasm'];

/**
 * The Flows CSP is `script-src 'self' 'wasm-unsafe-eval'`: no eval, no blob: workers.
 * js-dos evaluates the emulator script with eval and starts DOSBox from a blob worker,
 * so both are rewritten to load the same files by URL from our origin instead.
 */
const EMULATOR_PATCHES = [
  {
    from: 'h=(0,s.httpRequest)(e,{progress:(e,t)=>{r("Resolving DosBox",e,t)}})',
    to: 'h=Promise.resolve("")',
  },
  {
    from: 'return eval.call(window,p),n.host.globals.exports[t]=n.host.globals.module.exports,new i(m,n.host.globals.exports[t],y)',
    to:
      'return await new Promise((ok,fail)=>{const sc=document.createElement("script");sc.src=e;sc.onload=ok;sc.onerror=()=>fail(new Error("Unable to load "+e));document.head.appendChild(sc)}),n.host.globals.exports[t]=n.host.globals.module.exports,new i(m,n.host.globals.exports[t],y)',
  },
  {
    from: 'const d=URL.createObjectURL(await u.blob()),h=new Worker(d);',
    to: 'const d=e,h=new Worker(e);',
  },
];

function patchEmulators(path) {
  let text = readFileSync(path, 'utf8');
  for (const { from, to } of EMULATOR_PATCHES) {
    if (!text.includes(from)) throw new Error(`copy-jsdos: pattern not found in emulators.js, js-dos changed: ${from.slice(0, 60)}`);
    text = text.replace(from, to);
  }
  writeFileSync(path, text);
}

if (!existsSync(join(source, 'dist', 'js-dos.js'))) {
  console.error('js-dos is not installed; run npm install first.');
  process.exit(1);
}

mkdirSync(join(target, 'emulators'), { recursive: true });
for (const file of PLAYER_FILES) copyFileSync(join(source, 'dist', file), join(target, file));
for (const file of EMULATOR_FILES) copyFileSync(join(source, 'dist', 'emulators', file), join(target, 'emulators', file));
patchEmulators(join(target, 'emulators', 'emulators.js'));

const { version, license } = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
writeFileSync(join(target, 'VERSION.txt'), `js-dos ${version} (${license})\nhttps://github.com/caiiiycuk/js-dos\n`);
console.log(`Copied js-dos ${version} to public/jsdos (emulator loader patched for the Flows CSP)`);
