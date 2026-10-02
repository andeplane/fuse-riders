import type { StructureKind, World } from "../engine/types.js";
import type { PresentationPreferences } from "./contracts.js";

/** Interface feedback, played directly by the app as the player acts. */
export const UI_CUES = [
  "select",
  "panel",
  "back",
  "toggle",
  "cancel",
  "invalid",
] as const;
/** Match events, derived from each resolved tick's outcomes. */
export const EVENT_CUES = [
  "matchStart",
  "zap",
  "artillery",
  "spore",
  "attack",
  "shield",
  "alarm",
  "destroy",
  "lost",
  "eliminated",
  "place",
  "dispatch",
  "build",
  "stall",
  "researchStart",
  "research",
  "powerupSpawn",
  "powerup",
  "powerupRival",
  "dominating",
  "threat",
  "dominanceBroken",
  "victory",
  "defeat",
  "draw",
] as const;
export type SoundCue = (typeof UI_CUES)[number] | (typeof EVENT_CUES)[number];

/** One cue from a tick, with the board cells it happened at (if any). */
export interface CueEvent {
  cue: SoundCue;
  cells: number[];
}
/** Stereo position (-1 left to 1 right) and loudness (0..1) of a sound. */
export interface Spatial {
  pan: number;
  gain: number;
}
/** Places a board cell relative to the camera; omitted, cues play centred. */
export type Locate = (cell: number) => Spatial;

export interface PresentationAudio {
  configure(preferences: PresentationPreferences): void;
  unlock(): void;
  play(cue: SoundCue, spatial?: Spatial): void;
  present(world: Readonly<World>, localPlayerId: string, locate?: Locate): void;
  dispose(): void;
}

/** Most cells kept per cue and tick; the loudest of them is heard. */
const CELLS_PER_CUE = 8;
/** A local structure being hit sounds the alarm at most this often (8 s). */
export const ALARM_TICKS = 160;

const WEAPON_CUES: Partial<Record<StructureKind, SoundCue>> = {
  tower: "zap",
  siege: "artillery",
  spore: "spore",
};

/**
 * Bounded event cues: one entry per cue and tick, in a fixed order. Identical
 * ticks and checkpoint rewinds never replay a burst, and a match joined part
 * way through does not play its opening.
 */
export function createCueTracker() {
  let match = "";
  let tick = -1;
  let ended = false;
  let alarmAt = -Infinity;
  let powerupSerial = 0;
  // Owner and kind of every structure on the previous tick, so a destroyed
  // cell can still say whose it was and what fired from it.
  let previous = new Map<number, { ownerId: string; kind: StructureKind }>();
  const remember = (world: Readonly<World>) => {
    previous = new Map(
      world.structures.map((s) => [
        s.cell,
        { ownerId: s.ownerId, kind: s.kind },
      ]),
    );
    powerupSerial = world.powerupSerial;
  };
  return (world: Readonly<World>, local: string): CueEvent[] => {
    if (world.matchId !== match || world.tick < tick) {
      const fresh = world.matchId !== match;
      match = world.matchId;
      tick = world.tick;
      ended = world.finished;
      alarmAt = -Infinity;
      remember(world);
      // Only a match seen from its first seconds gets an opening sting.
      return fresh && !world.finished && world.tick < 40
        ? [{ cue: "matchStart", cells: [] }]
        : [];
    }
    if (world.tick === tick) return [];
    tick = world.tick;
    const cues = new Map<SoundCue, number[]>();
    const add = (cue: SoundCue, cell?: number) => {
      const cells = cues.get(cue) ?? [];
      if (cell !== undefined && cells.length < CELLS_PER_CUE) cells.push(cell);
      cues.set(cue, cells);
    };
    // Results a spectator also enjoys; personal feedback is only the player's.
    const mine = (playerId: string) => !local || playerId === local;
    const own = (playerId: string) => !!local && playerId === local;
    const ownerAt = (cell: number | undefined) =>
      cell === undefined
        ? undefined
        : (world.structures.find((s) => s.cell === cell)?.ownerId ??
          previous.get(cell)?.ownerId ??
          world.players.find((p) => p.queue.some((j) => j.cell === cell))?.id);

    for (const e of world.outcomes) {
      switch (e.type) {
        case "damage": {
          const shooter =
            e.fromCell === undefined
              ? undefined
              : (world.structures.find((s) => s.cell === e.fromCell)?.kind ??
                previous.get(e.fromCell)?.kind);
          add(
            (shooter && WEAPON_CUES[shooter]) || "attack",
            e.fromCell ?? e.cell,
          );
          if (
            local &&
            e.playerId !== local &&
            ownerAt(e.cell) === local &&
            world.tick - alarmAt >= ALARM_TICKS
          ) {
            alarmAt = world.tick;
            add("alarm", e.cell);
          }
          break;
        }
        case "shielded":
          add("shield", e.cell);
          break;
        case "destroyed":
          add(own(e.playerId) ? "lost" : "destroy", e.cell);
          break;
        case "eliminated":
          add("eliminated", e.cell);
          break;
        case "claimed":
          add(mine(e.playerId) ? "powerup" : "powerupRival", e.cell);
          break;
        case "dominating":
          add(mine(e.playerId) ? "dominating" : "threat");
          break;
        case "dominanceBroken":
          add("dominanceBroken");
          break;
        case "researched":
          if (mine(e.playerId)) add("research");
          break;
        case "researchStarted":
          if (own(e.playerId)) add("researchStart");
          break;
        case "constructed":
          add("build", e.cell);
          break;
        case "queued":
          if (own(e.playerId)) add("place", e.cell);
          break;
        case "dispatched":
          if (own(e.playerId)) add("dispatch", e.cell);
          break;
        case "rejected":
          if (own(e.playerId)) add("invalid");
          break;
        case "stalled":
        case "dropped":
          if (own(e.playerId)) add("stall", e.cell);
          break;
        case "income":
          break;
      }
    }
    const spawned = world.powerupSerial - powerupSerial;
    if (spawned > 0)
      for (const p of world.powerups.slice(-spawned))
        add("powerupSpawn", p.cell);
    remember(world);

    if (world.finished && !ended) {
      ended = true;
      // A draw is nobody's defeat: it gets its own neutral cue. Spectators
      // hear the last blows but no personal result.
      if (local)
        add(
          world.winnerId === null
            ? "draw"
            : world.winnerId === local
              ? "victory"
              : "defeat",
        );
    }
    // A rejected command reuses the interface's "invalid" cue.
    return [...EVENT_CUES, ...UI_CUES]
      .filter((cue) => cues.has(cue))
      .map((cue) => ({
        cue,
        cells: cues.get(cue)!,
      }));
  };
}

/**
 * Where a point sounds from, given the board area the camera shows: panned
 * by its horizontal offset and quieter the further it lies off screen.
 */
export function spatialize(
  view: { x: number; y: number; width: number; height: number },
  point: { x: number; y: number },
): Spatial {
  if (!(view.width > 0 && view.height > 0)) return { pan: 0, gain: 1 };
  const dx = (point.x - (view.x + view.width / 2)) / (view.width / 2);
  const dy = (point.y - (view.y + view.height / 2)) / (view.height / 2);
  const distance = Math.max(Math.abs(dx), Math.abs(dy));
  const gain = distance <= 1 ? 1 : Math.max(0.15, 1 / (1 + (distance - 1) * 2));
  return { pan: Math.max(-0.85, Math.min(0.85, dx * 0.6)), gain };
}

interface Envelope {
  /** Start, in seconds after the cue begins. */
  at?: number;
  /** Seconds from start to silence. */
  dur: number;
  /** Peak level, before volume and position. */
  gain: number;
  /** Seconds to reach the peak. */
  attack?: number;
}
interface Filter {
  type: BiquadFilterType;
  from: number;
  to?: number;
  q?: number;
}
export type Layer =
  | ({
      kind: "tone";
      wave: OscillatorType;
      from: number;
      to?: number;
      filter?: Filter;
    } & Envelope)
  | ({ kind: "noise"; filter: Filter } & Envelope);

const tone = (
  wave: OscillatorType,
  from: number,
  to: number | undefined,
  envelope: Envelope,
  filter?: Filter,
): Layer => ({ kind: "tone", wave, from, to, filter, ...envelope });
const noise = (filter: Filter, envelope: Envelope): Layer => ({
  kind: "noise",
  filter,
  ...envelope,
});
const arpeggio = (
  wave: OscillatorType,
  notes: number[],
  step: number,
  envelope: Envelope,
): Layer[] =>
  notes.map((n, i) =>
    tone(wave, n, undefined, {
      ...envelope,
      at: (envelope.at ?? 0) + i * step,
    }),
  );

// Note frequencies (Hz) used by the musical cues.
const C4 = 261.63,
  D4 = 293.66,
  Eb4 = 311.13,
  G4 = 392,
  B4 = 493.88,
  Bb4 = 466.16,
  C5 = 523.25,
  D5 = 587.33,
  E5 = 659.25,
  G5 = 783.99,
  C6 = 1046.5;

/** The synthesis recipe for one cue. `random` (0..1) only varies timbre. */
export function cueRecipe(cue: SoundCue, random: () => number): Layer[] {
  const vary = (spread: number) => 1 + (random() * 2 - 1) * spread;
  switch (cue) {
    case "select":
      return [
        tone("sine", 1150, 820, { dur: 0.05, gain: 0.3, attack: 0.002 }),
        noise({ type: "highpass", from: 3500 }, { dur: 0.015, gain: 0.1 }),
      ];
    case "panel":
      return arpeggio("triangle", [620, 930], 0.05, { dur: 0.08, gain: 0.25 });
    case "back":
      return arpeggio("triangle", [930, 620], 0.045, { dur: 0.08, gain: 0.22 });
    case "toggle":
      return [
        tone("triangle", 880, undefined, { dur: 0.04, gain: 0.22 }),
        tone("sine", 1320, undefined, { at: 0.035, dur: 0.07, gain: 0.18 }),
      ];
    case "cancel":
      return [
        tone("sine", 520, 230, { dur: 0.15, gain: 0.35 }),
        noise({ type: "lowpass", from: 900 }, { dur: 0.05, gain: 0.12 }),
      ];
    case "invalid":
      return [0, 0.12].map((at) =>
        tone(
          "square",
          150,
          undefined,
          { at, dur: 0.1, gain: 0.2 },
          { type: "lowpass", from: 900 },
        ),
      );
    case "matchStart":
      return [
        tone("sine", 55, 110, { dur: 1.3, gain: 0.45, attack: 0.35 }),
        // Two heartbeats, then the network wakes.
        tone("sine", 72, 44, { at: 0.5, dur: 0.14, gain: 0.7 }),
        tone("sine", 72, 44, { at: 0.72, dur: 0.16, gain: 0.6 }),
        ...arpeggio("triangle", [G4, D5], 0.12, {
          at: 0.95,
          dur: 0.45,
          gain: 0.14,
          attack: 0.02,
        }),
        noise(
          { type: "bandpass", from: 300, to: 2400, q: 2 },
          { dur: 1, gain: 0.08, attack: 0.6 },
        ),
      ];
    case "place":
      return [
        tone("sine", 260 * vary(0.05), 540, { dur: 0.12, gain: 0.45 }),
        noise(
          { type: "bandpass", from: 1200, q: 2 },
          { dur: 0.06, gain: 0.15 },
        ),
        tone("sine", 780, undefined, { at: 0.06, dur: 0.12, gain: 0.12 }),
      ];
    case "dispatch":
      return [
        noise(
          { type: "bandpass", from: 450, to: 2400, q: 3 },
          { dur: 0.3, gain: 0.3, attack: 0.09 },
        ),
        tone("sine", 330, 660, { dur: 0.22, gain: 0.08, attack: 0.05 }),
      ];
    case "build":
      return [
        ...arpeggio(
          "sine",
          [G4, C5, E5].map((f) => f * vary(0.01)),
          0.04,
          { dur: 0.6, gain: 0.18, attack: 0.02 },
        ),
        tone("triangle", C6, undefined, { at: 0.1, dur: 0.3, gain: 0.06 }),
        noise({ type: "highpass", from: 6000 }, { dur: 0.22, gain: 0.04 }),
      ];
    case "stall":
      return [
        tone("triangle", 440, 330, { dur: 0.15, gain: 0.22 }),
        tone("triangle", 330, 247, { at: 0.14, dur: 0.22, gain: 0.22 }),
      ];
    case "researchStart":
      return arpeggio("triangle", [440, 554, 659], 0.05, {
        dur: 0.12,
        gain: 0.16,
      });
    case "research":
      return [
        ...arpeggio("sine", [C5, E5, G5, C6], 0.07, { dur: 0.32, gain: 0.22 }),
        tone("sine", C6 * 2, undefined, { at: 0.28, dur: 0.55, gain: 0.07 }),
        noise(
          { type: "highpass", from: 7000 },
          { at: 0.2, dur: 0.4, gain: 0.04 },
        ),
      ];
    case "zap": {
      const pitch = vary(0.12);
      return [
        tone(
          "sawtooth",
          2200 * pitch,
          260 * pitch,
          { dur: 0.08, gain: 0.13 },
          { type: "lowpass", from: 4500, to: 700 },
        ),
        noise({ type: "highpass", from: 2500 }, { dur: 0.03, gain: 0.08 }),
      ];
    }
    case "artillery":
      return [
        tone("sine", 115 * vary(0.08), 36, { dur: 0.38, gain: 0.75 }),
        noise(
          { type: "lowpass", from: 1400, to: 140 },
          { dur: 0.32, gain: 0.45 },
        ),
        noise(
          { type: "bandpass", from: 2600, q: 1 },
          { dur: 0.025, gain: 0.2 },
        ),
      ];
    case "spore":
      return [
        ...[0, 0.045, 0.09].map((at) => {
          const f = 420 + random() * 480;
          return tone("sine", f, f * 1.6, { at, dur: 0.06, gain: 0.16 });
        }),
        noise({ type: "bandpass", from: 900, q: 6 }, { dur: 0.13, gain: 0.12 }),
      ];
    case "attack":
      return [tone("triangle", 240 * vary(0.1), 90, { dur: 0.1, gain: 0.25 })];
    case "shield":
      // Two close tones beat against each other: a shimmering membrane.
      return [
        tone("sine", 1400, 1250, { dur: 0.26, gain: 0.12 }),
        tone("sine", 1407, 1258, { dur: 0.26, gain: 0.12 }),
        noise(
          { type: "bandpass", from: 3000, q: 8 },
          { dur: 0.15, gain: 0.07 },
        ),
      ];
    case "alarm":
      return [880, 660, 880, 660].map((f, i) =>
        tone(
          "square",
          f,
          undefined,
          { at: i * 0.14, dur: 0.11, gain: 0.14 },
          { type: "lowpass", from: 2400 },
        ),
      );
    case "destroy":
      return [
        noise(
          { type: "lowpass", from: 4000 * vary(0.15), to: 180 },
          { dur: 0.5, gain: 0.5, attack: 0.003 },
        ),
        tone("sine", 90, 32, { dur: 0.45, gain: 0.5 }),
        noise(
          { type: "bandpass", from: 1800, q: 1 },
          { dur: 0.05, gain: 0.22 },
        ),
      ];
    case "lost":
      return [
        noise(
          { type: "lowpass", from: 3200, to: 160 },
          { dur: 0.55, gain: 0.5, attack: 0.003 },
        ),
        tone("sine", 85, 30, { dur: 0.5, gain: 0.5 }),
        tone("triangle", 330, 220, { at: 0.1, dur: 0.42, gain: 0.16 }),
      ];
    case "eliminated":
      return [
        noise(
          { type: "lowpass", from: 2600, to: 70 },
          { dur: 1.7, gain: 0.75, attack: 0.01 },
        ),
        tone("sine", 70, 22, { dur: 1.5, gain: 0.75 }),
        tone(
          "sawtooth",
          220,
          40,
          { dur: 1.3, gain: 0.18 },
          { type: "lowpass", from: 700 },
        ),
        noise(
          { type: "lowpass", from: 1600, to: 90 },
          { at: 0.28, dur: 0.9, gain: 0.45 },
        ),
      ];
    case "powerupSpawn":
      return arpeggio("sine", [1568, 2093, 2637], 0.05, {
        dur: 0.28,
        gain: 0.09,
      });
    case "powerup":
      return [
        ...arpeggio("triangle", [C5, E5, G5, C6], 0.06, {
          dur: 0.2,
          gain: 0.24,
        }),
        tone("sine", C6 * 2, undefined, { at: 0.25, dur: 0.45, gain: 0.08 }),
      ];
    case "powerupRival":
      return arpeggio("triangle", [Bb4, G4, Eb4], 0.08, {
        dur: 0.18,
        gain: 0.16,
      });
    case "dominating":
      return [
        tone(
          "sawtooth",
          220,
          440,
          { dur: 1, gain: 0.12, attack: 0.45 },
          { type: "lowpass", from: 400, to: 2200 },
        ),
        tone("sine", 440, 880, { dur: 1, gain: 0.12, attack: 0.45 }),
      ];
    case "threat":
      return [
        ...[0, 0.3, 0.6].map((at) =>
          tone(
            "square",
            220,
            200,
            { at, dur: 0.2, gain: 0.18 },
            { type: "lowpass", from: 700 },
          ),
        ),
        tone("sine", 55, undefined, { dur: 1.1, gain: 0.3, attack: 0.1 }),
      ];
    case "dominanceBroken":
      return [
        tone("sine", G4, C5, { dur: 0.42, gain: 0.18 }),
        tone("sine", B4, E5, { dur: 0.42, gain: 0.18 }),
      ];
    case "victory":
      return [
        ...arpeggio("triangle", [C5, E5, G5, C6], 0.12, {
          dur: 0.3,
          gain: 0.26,
        }),
        ...[C5, E5, G5, C6].map((f) =>
          tone("sine", f, undefined, {
            at: 0.5,
            dur: 1.5,
            gain: 0.14,
            attack: 0.05,
          }),
        ),
        noise(
          { type: "highpass", from: 6000 },
          { at: 0.5, dur: 1, gain: 0.04 },
        ),
      ];
    case "defeat":
      return [
        ...arpeggio("triangle", [G4, Eb4, C4], 0.25, {
          dur: 0.42,
          gain: 0.26,
        }),
        tone(
          "sawtooth",
          65,
          55,
          { at: 0.75, dur: 1.5, gain: 0.22, attack: 0.1 },
          { type: "lowpass", from: 320 },
        ),
      ];
    case "draw":
      return [
        tone("triangle", G4, undefined, { dur: 0.3, gain: 0.22 }),
        tone("triangle", G4, undefined, { at: 0.35, dur: 0.3, gain: 0.22 }),
        tone("sine", G4, undefined, { at: 0.7, dur: 0.9, gain: 0.14 }),
        tone("sine", D5, undefined, { at: 0.7, dur: 0.9, gain: 0.12 }),
      ];
  }
}

/** Seconds a cue must rest before it plays again; rapid fire thins out. */
const COOLDOWN: Partial<Record<SoundCue, number>> = {
  select: 0.03,
  zap: 0.06,
  attack: 0.08,
  spore: 0.1,
  artillery: 0.12,
  shield: 0.2,
  destroy: 0.07,
  lost: 0.1,
  dispatch: 0.15,
  build: 0.1,
  stall: 0.3,
  powerupSpawn: 0.2,
};
const DEFAULT_COOLDOWN = 0.04;
/** Most sources sounding at once; further layers are dropped. */
const MAX_VOICES = 48;

/** Audio is presentation only; its clock never drives game simulation. */
export function createBrowserAudio(
  forceMute: boolean,
  random: () => number = Math.random,
): PresentationAudio {
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let noiseBuffer: AudioBuffer | null = null;
  let settings: PresentationPreferences = {
    mute: true,
    volume: 0.5,
    reducedMotion: false,
    edgeScroll: true,
  };
  let disposed = false;
  const voices = new Set<() => void>();
  const lastPlayed = new Map<SoundCue, number>();
  const silence = () => {
    for (const stop of voices) stop();
  };
  const track = createCueTracker();

  const output = (audio: AudioContext) => {
    if (!master) {
      // A compressor keeps a big fight loud without clipping.
      const compressor = audio.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.ratio.value = 6;
      master = audio.createGain();
      master.connect(compressor).connect(audio.destination);
    }
    master.gain.value = settings.volume * 0.6;
    return master;
  };
  const noise = (audio: AudioContext) => {
    if (!noiseBuffer) {
      noiseBuffer = audio.createBuffer(1, audio.sampleRate, audio.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = random() * 2 - 1;
    }
    return noiseBuffer;
  };

  const play = (cue: SoundCue, spatial: Spatial = { pan: 0, gain: 1 }) => {
    if (
      !context ||
      context.state !== "running" ||
      settings.mute ||
      settings.volume <= 0 ||
      forceMute ||
      disposed ||
      voices.size >= MAX_VOICES
    )
      return;
    const audio = context;
    const now = audio.currentTime;
    if (
      now - (lastPlayed.get(cue) ?? -Infinity) <
      (COOLDOWN[cue] ?? DEFAULT_COOLDOWN)
    )
      return;
    lastPlayed.set(cue, now);
    const bus = audio.createGain();
    bus.gain.value = Math.max(0, Math.min(1, spatial.gain));
    const panner =
      typeof audio.createStereoPanner === "function"
        ? audio.createStereoPanner()
        : null;
    if (panner) {
      panner.pan.value = Math.max(-1, Math.min(1, spatial.pan));
      bus.connect(panner).connect(output(audio));
    } else bus.connect(output(audio));
    let live = 0;
    const release = () => {
      if (--live > 0) return;
      bus.disconnect();
      panner?.disconnect();
    };
    for (const layer of cueRecipe(cue, random)) {
      if (voices.size >= MAX_VOICES) break;
      const start = now + (layer.at ?? 0);
      const end = start + layer.dur;
      let source: AudioScheduledSourceNode;
      if (layer.kind === "tone") {
        const oscillator = audio.createOscillator();
        oscillator.type = layer.wave;
        oscillator.frequency.setValueAtTime(layer.from, start);
        if (layer.to !== undefined)
          oscillator.frequency.exponentialRampToValueAtTime(layer.to, end);
        source = oscillator;
      } else {
        const buffer = audio.createBufferSource();
        buffer.buffer = noise(audio);
        buffer.loop = true;
        source = buffer;
      }
      const nodes: AudioNode[] = [source];
      if (layer.filter) {
        const filter = audio.createBiquadFilter();
        filter.type = layer.filter.type;
        filter.Q.value = layer.filter.q ?? 0.7;
        filter.frequency.setValueAtTime(layer.filter.from, start);
        if (layer.filter.to !== undefined)
          filter.frequency.exponentialRampToValueAtTime(layer.filter.to, end);
        nodes.push(filter);
      }
      const envelope = audio.createGain();
      const attack = Math.min(layer.attack ?? 0.006, layer.dur / 2);
      envelope.gain.setValueAtTime(0, start);
      envelope.gain.linearRampToValueAtTime(layer.gain, start + attack);
      envelope.gain.exponentialRampToValueAtTime(0.0001, end);
      nodes.push(envelope);
      for (let i = 1; i < nodes.length; i++) nodes[i - 1]!.connect(nodes[i]!);
      envelope.connect(bus);
      live++;
      const stop = () => {
        source.onended = null;
        try {
          source.stop();
        } catch {
          /* Not started or already stopped. */
        }
        for (const node of nodes) node.disconnect();
        voices.delete(stop);
        release();
      };
      voices.add(stop);
      source.onended = stop;
      source.start(start);
      source.stop(end + 0.03);
    }
    if (!live) {
      bus.disconnect();
      panner?.disconnect();
    }
  };
  return {
    configure(preferences) {
      settings = preferences;
      if (master) master.gain.value = settings.volume * 0.6;
      if (settings.mute || settings.volume <= 0) {
        silence();
        if (context?.state === "running")
          void context.suspend().catch(() => {});
      }
    },
    unlock() {
      if (
        disposed ||
        forceMute ||
        settings.mute ||
        typeof AudioContext === "undefined"
      )
        return;
      context ??= new AudioContext();
      if (context.state === "suspended") void context.resume().catch(() => {});
    },
    play,
    present(world, local, locate) {
      for (const { cue, cells } of track(world, local)) {
        // The nearest of a tick's events decides where the cue sounds from.
        const heard = locate
          ? cells
              .map(locate)
              .reduce<Spatial | undefined>(
                (best, s) => (!best || s.gain > best.gain ? s : best),
                undefined,
              )
          : undefined;
        play(cue, heard);
      }
    },
    dispose() {
      disposed = true;
      silence();
      if (context) void context.close().catch(() => {});
      context = null;
      master = null;
      noiseBuffer = null;
    },
  };
}
