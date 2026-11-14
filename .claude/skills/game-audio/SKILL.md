---
name: game-audio
description: Load when adding sound effects, music, ambience or 3D/spatial audio to a game (three.js, Phaser/Pixi, Godot, Unity), when audio does not play on first load or on iOS, when building adaptive or layered music, ducking or mixing, or when sourcing or generating audio (ElevenLabs SFX/music API and MCP, Suno, ZzFX/jsfxr, Kenney/Freesound CC0).
---

# Game audio: playback, mixing, adaptive music, sourcing

Audio is the cheapest polish. A game with good audio and simple art feels better than one with good art and silence. The agent can't hear, though. So every sound must also be **observable in text** (an event log and bus levels), or it isn't verifiable.

## 1. When to use what

| Problem | three.js / web | Phaser / Pixi | Godot 4 | Unity 6 | Why / when NOT |
|---|---|---|---|---|---|
| SFX + music playback with buses | **Own WebAudio `AudioManager`** (recipe A), ~120 lines | Phaser `this.sound` (WebAudio) / `@pixi/sound` 6 | `AudioStreamPlayer` + Audio Bus Layout | `AudioSource` + `AudioMixer` groups | Own manager gives you buses, ducking and voice caps. Don't mix three's audio, Howler and Tone with separate AudioContexts (share one) |
| Drop-in, battle-tested web playback | **Howler.js 2.2.4** (MIT, ~25k★) | same | n/a | n/a | Sprites, fades, codec fallback, auto-unlock. Last release 2023 (stable, not active). Not for sample-accurate music sync |
| 3D positional audio | **`THREE.PositionalAudio`** + one `AudioListener` on the camera | `Howl.pos()` / manual pan | `AudioStreamPlayer3D` | `AudioSource.spatialBlend = 1` | HRTF on dozens of sources costs CPU. Use `equalpower` for the crowd and HRTF for the hero sounds |
| Procedural retro SFX (zero assets, jams) | **ZzFX** (`zzfx`, MIT, 795★) / **jsfxr** (Unlicense) | same | sfxr-style addons or bake WAVs | bake WAVs | Instant placeholder SFX. Replace hero sounds later |
| Music written in code / synth | **Tone.js 15** (MIT, ~14.7k★), **plonkjs** (<4 kB, alpha), ZzFXM | same | bake | bake | Generative/reactive music, rhythm games. Tone adds ~150 kB+ |
| Adaptive music | Stems on one clock (recipe C) | same | **`AudioStreamInteractive`** (transitions), **`AudioStreamSynchronized`** (layers), `AudioStreamPlaylist` (4.3+) | FMOD Studio / Wwise (check current indie tiers) | Vertical layering for intensity, horizontal re-sequencing for state changes |
| Generate SFX/ambience | **ElevenLabs** `POST /v1/sound-generation` (0.5-30 s, `loop`) or hosted MCP | same | same files | same files | Fast and good for foley/UI/ambience. Weak at precise musical/tonal stingers |
| Generate music | **ElevenLabs Music** `POST /v1/music` (3 s-10 min, paid plans) or Suno (web app only) | same | same | same | Suno has **no public API** (partner program announced Jul 2026, curated access). Don't use unofficial Suno wrappers |
| Free assets | **Kenney** audio packs (CC0), **Freesound** filtered to CC0, Sonniss GDC bundles (royalty-free) | same | same | same | Freesound licences vary per sound. CC-BY needs credits, NC is unusable commercially |

## 2. Recipes

### A. One AudioContext, buses, gesture unlock, voice cap, ducking
```ts
// src/audio/AudioManager.ts
type PlayOpts = { bus?: GainNode; volume?: number; rate?: number; pan?: number; loop?: boolean };
export class AudioManager {
  readonly ctx = new AudioContext({ latencyHint: "interactive" });
  readonly master = this.ctx.createGain();
  readonly music = this.ctx.createGain();
  readonly sfx = this.ctx.createGain();
  readonly ui = this.ctx.createGain();
  readonly log: { t: number; name: string }[] = [];     // for agents: what played, when
  private buffers = new Map<string, AudioBuffer>();
  private voices = 0;
  musicLevel = 0.7; maxVoices = 32;

  constructor() {
    const comp = this.ctx.createDynamicsCompressor();    // soft safety limiter on master
    comp.threshold.value = -6; comp.ratio.value = 4;
    for (const b of [this.music, this.sfx, this.ui]) b.connect(this.master);
    this.master.connect(comp).connect(this.ctx.destination);
    this.music.gain.value = this.musicLevel;
    const unlock = () => {
      if (this.ctx.state === "running") return;
      this.ctx.resume();
      // iOS silent switch: Safari supports navigator.audioSession (check support)
      (navigator as any).audioSession && ((navigator as any).audioSession.type = "playback");
    };
    for (const ev of ["pointerdown", "keydown", "touchend"]) addEventListener(ev, unlock, { capture: true });
    document.addEventListener("visibilitychange", () =>
      document.hidden ? this.ctx.suspend() : this.ctx.resume());
  }

  async load(name: string, url: string) {
    const data = await (await fetch(url)).arrayBuffer();
    this.buffers.set(name, await this.ctx.decodeAudioData(data));  // decode ONCE, reuse
  }

  play(name: string, o: PlayOpts = {}) {
    const buf = this.buffers.get(name);
    if (!buf || this.voices >= this.maxVoices) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.loop = !!o.loop;
    src.playbackRate.value = o.rate ?? 1 + (Math.random() - 0.5) * 0.08;   // ±4% pitch variety
    const g = this.ctx.createGain(); g.gain.value = o.volume ?? 1;
    const p = this.ctx.createStereoPanner(); p.pan.value = o.pan ?? 0;
    src.connect(g).connect(p).connect(o.bus ?? this.sfx);
    this.voices++; src.onended = () => this.voices--;
    src.start();
    this.log.push({ t: this.ctx.currentTime, name }); if (this.log.length > 50) this.log.shift();
    return src;
  }

  /** Duck music under dialogue/big hits. Returns to musicLevel after hold+release. */
  duck(to = 0.25, attack = 0.04, hold = 0.6, release = 0.5) {
    const g = this.music.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(this.musicLevel * to, t + attack);
    g.setValueAtTime(this.musicLevel * to, t + attack + hold);
    g.linearRampToValueAtTime(this.musicLevel, t + attack + hold + release);
  }
}
export const audio = new AudioManager();
```
Share this context with other libraries: `THREE.AudioContext.setContext(audio.ctx)` (three.js), and `Tone.setContext(audio.ctx)` (Tone accepts a native context; check docs). Route their outputs into your buses.

### B. three.js positional audio (r18x)
```ts
import * as THREE from "three";
THREE.AudioContext.setContext(audio.ctx);
const listener = new THREE.AudioListener();
camera.add(listener);                                   // listener follows the camera
listener.gain.disconnect(); listener.gain.connect(audio.sfx);   // through our sfx bus (check docs for listener.getInput())

const buf = await new THREE.AudioLoader().loadAsync("/sfx/engine_loop.ogg");
const engine = new THREE.PositionalAudio(listener);
engine.setBuffer(buf); engine.setLoop(true);
engine.setRefDistance(4);          // full volume within 4 m
engine.setRolloffFactor(1.2); engine.setDistanceModel("inverse"); engine.setMaxDistance(80);
car.add(engine);                   // follows the object's world matrix
engine.play();                     // only audible once audio.ctx is running (gesture)
// many sources: engine.panner.panningModel = "equalpower";  (HRTF is costly)
// directional: engine.setDirectionalCone(180, 230, 0.1);
```
For hundreds of short one-shots (bullets, footsteps), don't create a `PositionalAudio` per shot. Keep a pool of ~16 and reuse the nearest-to-listener ones. Or compute pan and attenuation yourself and call `audio.play(name, { pan, volume })`.

### C. Adaptive music: vertical layers on one clock, bar-quantized stingers
```ts
export class LayeredMusic {
  private layers: GainNode[] = []; private t0 = 0;
  constructor(private bpm: number, private beatsPerBar = 4) {}
  start(stems: AudioBuffer[], levels: number[]) {          // stems: same length, same tempo, loop at bar edges
    const ctx = audio.ctx; this.t0 = ctx.currentTime + 0.1;
    this.layers = stems.map((buf, i) => {
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const g = ctx.createGain(); g.gain.value = levels[i] ?? 0;
      src.connect(g).connect(audio.music); src.start(this.t0);   // same start time = sample-locked
      return g;
    });
  }
  /** e.g. explore [1,0,0,0], combat [1,1,1,0.6]. Fade ~2s. */
  setLevels(levels: number[], fade = 2) {
    const t = audio.ctx.currentTime;
    levels.forEach((v, i) => { const g = this.layers[i].gain; g.cancelScheduledValues(t); g.setTargetAtTime(v, t, fade / 3); });
  }
  nextBar(): number {
    const bar = (60 / this.bpm) * this.beatsPerBar, el = audio.ctx.currentTime - this.t0;
    return this.t0 + Math.ceil(el / bar) * bar;
  }
  stinger(buf: AudioBuffer) {             // victory/hit stinger lands on the next downbeat
    const s = audio.ctx.createBufferSource(); s.buffer = buf; s.connect(audio.music); s.start(this.nextBar());
  }
}
```
- Drive levels from a smoothed game "intensity" value (enemies near, health low), with hysteresis. Don't drive them from per-frame raw values, or the music flutters.
- Horizontal changes (explore → boss) should switch at `nextBar()` with a 1-bar crossfade, or use a transition stinger.
- Godot equivalent: `AudioStreamSynchronized` (stems, per-stream volume) inside an `AudioStreamInteractive` (clips + transition table, with "on next bar" transitions).

### D. Howler quick path (Phaser-free 2D games, menus)
```ts
import { Howl, Howler } from "howler";
const sfx = new Howl({ src: ["/sfx/sprite.webm", "/sfx/sprite.mp3"], sprite: { jump: [0, 300], coin: [400, 250] } });
const id = sfx.play("coin"); sfx.rate(0.95 + Math.random() * 0.1, id);
const theme = new Howl({ src: ["/music/theme.webm", "/music/theme.m4a"], loop: true, volume: 0.6 });
theme.play(); theme.fade(0.6, 0.15, 300);       // duck
sfx.pos(x, y, z, id); Howler.pos(lx, ly, lz);   // spatial (full howler build, not howler.core)
```
`html5: true` streams long music without decoding the whole file, but bypasses WebAudio (no buses or effects, and loops have gaps).

### E. Placeholder SFX with zero assets
```ts
import { zzfx } from "zzfx";                         // npm i zzfx
zzfx(...[, , 925, .04, .3, .6, 1, .3, , 6.27, -184, .09, .17]);  // design at killedbyapixel.github.io/ZzFX
import { sfxr } from "jsfxr";                        // npm i jsfxr
sfxr.toAudio(sfxr.generate("pickupCoin")).play();   // presets: pickupCoin, laserShoot, explosion, powerUp, hitHurt, jump, blipSelect
```
Keep a `sfx.ts` map from game event to sound (`{ coin: () => zzfx(...) }`), so placeholders can be swapped for files without touching game code.

### F. Generate SFX and music with ElevenLabs (build-time script, never in the client)
```ts
// scripts/gen-audio.mts — ELEVENLABS_API_KEY in env. npm i -D @elevenlabs/elevenlabs-js
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import fs from "node:fs";
const el = new ElevenLabsClient();
const save = async (stream: AsyncIterable<Uint8Array>, path: string) => {
  const parts: Buffer[] = []; for await (const c of stream) parts.push(Buffer.from(c));
  fs.writeFileSync(path, Buffer.concat(parts));
};
// SFX: 0.5–30 s, promptInfluence 0–1 (default 0.3), loop for seamless ambience (check docs for exact field names)
await save(await el.textToSoundEffects.convert({ text: "retro coin pickup, bright, short", durationSeconds: 0.6, promptInfluence: 0.7 }), "assets/sfx/coin.mp3");
await save(await el.textToSoundEffects.convert({ text: "night forest ambience, crickets, light wind", durationSeconds: 20, loop: true }), "assets/amb/forest.mp3");
// Music: paid plans only; no artist/band names (bad_prompt error); 3,000–600,000 ms
await save(await el.music.compose({ prompt: "tense synthwave combat loop, 120 bpm, driving bass", musicLengthMs: 60000, forceInstrumental: true }), "assets/music/combat.mp3");
```
- **MCP:** ElevenLabs' local `elevenlabs-mcp` (uvx) is **deprecated**. Use the hosted server: `claude mcp add --transport http elevenlabs https://api.elevenlabs.io/v1/mcp` (OAuth).
- Generate 4-8 variations per SFX and pick by ear. Record the prompt and seed in `assets/AUDIO_SOURCES.md` (provenance and licence).
- **Suno:** generate in the web app, download stems (paid plans), and keep the plan and date as your licence evidence. There is no official API to automate this as of Oct 2026.

### G. Asset prep (ffmpeg)
```bash
# loudness-normalize (music ≈ -16 LUFS, SFX peak ≤ -1 dBTP), then encode Opus + AAC fallback
ffmpeg -i in.wav -af loudnorm=I=-16:TP=-1.5:LRA=11 -ar 48000 norm.wav
ffmpeg -i norm.wav -c:a libopus -b:a 96k out.webm && ffmpeg -i norm.wav -c:a aac -b:a 128k out.m4a
ffmpeg -i out.webm -af ebur128 -f null - 2>&1 | grep -E "I:|Peak"     # verify
```

## 3. Sourcing (CC0 first)

| Source | Licence | Notes |
|---|---|---|
| Kenney.nl audio packs (UI, Impact, RPG, Sci-fi, Music Jingles…) | CC0 | Consistent, game-ready. Best first stop |
| Freesound.org | per sound: CC0 / CC-BY / CC-BY-NC | API search with `filter=license:"Creative Commons 0"`. Previews need a token, originals need OAuth2. Store attribution for CC-BY |
| OpenGameArt.org | mixed (CC0, CC-BY, GPL…) | Check every file |
| Sonniss "GDC Game Audio Bundle" | royalty-free, commercial use | Big, pro-quality foley. Don't redistribute the raw files |
| ElevenLabs / Suno output | per your plan's terms | Keep receipts. Check terms when the plan changes |

Cross-reference: `game-asset-pipeline` (provenance file, licence tracking).

## 4. Pitfalls

- **Autoplay policy:** an `AudioContext` created before a user gesture starts `suspended`. Resume it in `pointerdown`/`keydown`. Show a "click to start" screen. Don't hope.
- **Several AudioContexts** (Howler + three + Tone each make one) break ducking, add latency, and hit iOS limits. Share one.
- **Decoding on every play** (`decodeAudioData` or `new Audio()` per shot) causes stutter and GC. Decode once and pool.
- **MP3/AAC loops click or gap** because of encoder padding. Loop WAV or Opus, or set `loopStart`/`loopEnd`. Export stems at exact bar lengths.
- **Stems drift** when started with separate `play()` calls. Start them all with the same `start(when)` time.
- **Volume as linear sliders** feel wrong. Map UI slider `v` to gain with `v*v` (or dB). Clamp the master and add the compressor/limiter.
- **Gain jumps click.** Never set `.value` while playing. Ramp (`setTargetAtTime`, `linearRampToValueAtTime`).
- **Tone.js 15:** use `Tone.getTransport()` / `Tone.getDestination()`. The global `Tone.Transport` is deprecated. `await Tone.start()` must run inside a gesture.
- **three.js:** a single `AudioListener` only. `PositionalAudio` needs the object in the scene graph (its world matrix updates on render). `setMediaElementSource` streams don't loop seamlessly.
- **Background tabs:** rAF stops but AudioContext keeps playing. Suspend on `visibilitychange`, or players hear a frozen game.
- **Godot web export:** 4.3+ web builds default to sample-based playback to avoid crackling. Some bus effects/positional features are limited there, so check the docs. Test audio in the actual web export.
- **Licensing:** "free" ≠ CC0. NC assets can't ship in a commercial game. Generated music can't name real artists.

## 5. Verification

1. **Event log:** expose `window.__game.audio = () => ({ state: audio.ctx.state, voices, musicGain: audio.music.gain.value, last: audio.log.slice(-10) })`. After scripted input (jump, collect coin), assert the expected names appear in `last`.
2. **Unlock test (Playwright):** load the page, assert `state === "suspended"`, click the canvas, then assert `"running"`. For headless CI audio, launch Chromium with `--autoplay-policy=no-user-gesture-required`.
3. **Adaptive music:** set intensity high, step 3 s, assert layer gains ≈ target (±0.05). Assert stinger start times are multiples of the bar length from `t0`.
4. **Assets:** a CI script runs `ebur128` on every music file (−18…−14 LUFS) and checks SFX true peak ≤ −1 dBTP. It fails on files missing from `AUDIO_SOURCES.md`.
5. **Loop seam:** render a loop twice in an `OfflineAudioContext`, then check |sample[end] − sample[0]| is small and the RMS doesn't dip at the boundary.
6. **Human pass:** ask the user to listen. List exactly which events should sound, so they can report what's missing.

## 6. Install instead of reinventing

- `npx skills add gamedev-skills/awesome-gamedev-agent-skills`: `audio-design` (buses, adaptive music, ducking), `godot-audio`, `game-feel`.
- `npx skills add playableintelligence/game-creator`: `game-audio` skill (web, Phaser/three). Note: its `@strudel/web` option is AGPL.
- `quodsoler/unreal-engine-skills` → `ue-audio-system` for Unreal (MetaSounds).
- ElevenLabs hosted MCP (above). The PixelLab/Retro Diffusion MCPs for art are in `game-2d`.
