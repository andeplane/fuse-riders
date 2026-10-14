import type { TickEvent } from "../../engine/index.js";

/** A synthesized sound effect. Many engine events of one kind in a frame become one cue. */
export type CueKind =
  | "launch"
  | "split"
  | "explosion"
  | "hit"
  | "shield"
  | "shield-pop"
  | "crate"
  | "destroyed"
  | "ghost"
  | "drop"
  | "alarm"
  | "fanfare";

export interface Cue {
  readonly kind: CueKind;
  /** 0..1: how big it sounds (volley size, crater radius, how many merged). */
  readonly size: number;
  /** Kind-specific pitch hint: the gate multiplier for `split`, 1 for a win and 0 for a draw on `fanfare`. */
  readonly pitch: number;
}

export interface CueSpec {
  /** Seconds a voice of this kind lasts, for counting live voices. */
  readonly duration: number;
  /** Minimum seconds between two cues of this kind. */
  readonly minGap: number;
  /** Most live voices of this kind at once. */
  readonly maxVoices: number;
  /** Rare, important cues skip the global voice cap (never their own limits). */
  readonly important?: boolean;
}

export const CUE_SPECS: Readonly<Record<CueKind, CueSpec>> = {
  launch: { duration: 0.35, minGap: 0.07, maxVoices: 3 },
  split: { duration: 0.45, minGap: 0.06, maxVoices: 4 },
  explosion: { duration: 0.9, minGap: 0.05, maxVoices: 6 },
  hit: { duration: 0.2, minGap: 0.06, maxVoices: 3 },
  shield: { duration: 0.35, minGap: 0.08, maxVoices: 3 },
  "shield-pop": { duration: 0.6, minGap: 0.1, maxVoices: 2, important: true },
  crate: { duration: 0.4, minGap: 0.1, maxVoices: 2, important: true },
  destroyed: { duration: 1.6, minGap: 0.2, maxVoices: 2, important: true },
  ghost: { duration: 0.9, minGap: 0.3, maxVoices: 1, important: true },
  drop: { duration: 0.5, minGap: 0.08, maxVoices: 3 },
  alarm: { duration: 1.8, minGap: 1, maxVoices: 1, important: true },
  fanfare: { duration: 1.6, minGap: 1, maxVoices: 1, important: true },
};

/** Live effect voices across all kinds; the rest are dropped so hundreds of impacts never clip or stutter. */
export const MAX_VOICES = 16;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/** Merges a frame's events (possibly hundreds) into at most one cue per kind, keeping the biggest. */
export function planCues(events: readonly TickEvent[]): Cue[] {
  const cues = new Map<CueKind, { size: number; pitch: number; n: number }>();
  const add = (kind: CueKind, size: number, pitch = 0): void => {
    const cue = cues.get(kind);
    if (!cue) cues.set(kind, { size: clamp01(size), pitch, n: 1 });
    else {
      cue.size = Math.max(cue.size, clamp01(size));
      cue.pitch = Math.max(cue.pitch, pitch);
      cue.n++;
    }
  };
  for (const event of events) {
    switch (event.type) {
      case "fired":
        add("launch", event.mega ? 1 : 0.3 + event.units / 40);
        break;
      case "gate-split":
        add("split", 0.5, event.multiplier);
        break;
      case "crater":
        add("explosion", event.radius / 46); // 11 px rocket … 46 px castle wreck
        break;
      case "rocket-exploded":
        add("explosion", 0.15);
        break;
      case "hit":
        add(event.shielded ? "shield" : "hit", event.splash ? 0.4 : 0.7);
        break;
      case "shield-popped":
        add("shield-pop", 1);
        break;
      case "crate-taken":
        add("crate", 1);
        break;
      case "castle-destroyed":
        add("destroyed", 1);
        break;
      case "ghost-spawned":
        add("ghost", 1);
        break;
      case "ghost-bomb-dropped":
        add("drop", 0.6);
        break;
      case "sudden-death-started":
        add("alarm", 1);
        break;
      case "round-over":
        add("fanfare", 1, event.result.winner === null ? 0 : 1);
        break;
      default:
        break;
    }
  }
  // Many simultaneous impacts sound bigger, but only logarithmically.
  return [...cues].map(([kind, { size, pitch, n }]) => ({
    kind,
    size: clamp01(size + 0.08 * Math.log2(n)),
    pitch,
  }));
}

/** Decides which cues may sound now: per-kind gaps and voice counts, then a global voice cap. */
export class CueLimiter {
  private readonly last = new Map<CueKind, number>();
  private voices: { kind: CueKind; end: number }[] = [];

  constructor(
    private readonly specs: Readonly<Record<CueKind, CueSpec>> = CUE_SPECS,
    private readonly maxVoices = MAX_VOICES,
  ) {}

  /** Live voices at `now` (seconds). */
  live(now: number): number {
    this.voices = this.voices.filter((voice) => voice.end > now);
    return this.voices.length;
  }

  /** True (and the voice is counted) if a cue of `kind` may start at `now`. */
  allow(kind: CueKind, now: number): boolean {
    const spec = this.specs[kind];
    const total = this.live(now);
    const last = this.last.get(kind);
    if (last !== undefined && now - last < spec.minGap) return false;
    let same = 0;
    for (const voice of this.voices) if (voice.kind === kind) same++;
    if (same >= spec.maxVoices) return false;
    if (!spec.important && total >= this.maxVoices) return false;
    this.last.set(kind, now);
    this.voices.push({ kind, end: now + spec.duration });
    return true;
  }

  reset(): void {
    this.last.clear();
    this.voices = [];
  }
}
