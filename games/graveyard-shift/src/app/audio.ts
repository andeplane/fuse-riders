import type { Store } from "./session.js";
export interface Prefs {
  muted: { music: boolean; effects: boolean };
  volume: { music: number; effects: number };
}
export function readPrefs(store: Store): Prefs {
  const p: Prefs = {
    muted: { music: false, effects: false },
    volume: { music: 0.22, effects: 0.45 },
  };
  try {
    const v: unknown = JSON.parse(store.getItem("fuse-riders-audio") ?? "null");
    if (v && typeof v === "object") {
      for (const k of ["music", "effects"] as const) {
        if (
          "muted" in v &&
          v.muted &&
          typeof v.muted === "object" &&
          k in v.muted
        )
          p.muted[k] = (v.muted as Record<string, unknown>)[k] === true;
        if ("volume" in v && v.volume && typeof v.volume === "object") {
          const n = (v.volume as Record<string, unknown>)[k];
          if (typeof n === "number" && Number.isFinite(n))
            p.volume[k] = Math.max(0, Math.min(1, n));
        }
      }
    }
  } catch {
    /* Invalid stored preference uses defaults. */
  }
  return p;
}
/** Uses the portfolio audio preference and temporary mute query. Original synthesized minor-key ambience. */
export class NightAudio {
  private ctx: AudioContext | undefined;
  private next = 0;
  private note = 0;
  private hidden = false;
  readonly prefs: Prefs;
  readonly silent: boolean;
  constructor(
    private store: Store,
    search: string,
  ) {
    this.prefs = readPrefs(store);
    const m = new URLSearchParams(search).get("mute");
    this.silent = m !== null && m !== "0" && m !== "false";
  }
  resume(): void {
    if (this.silent) return;
    this.ctx ??= new AudioContext();
    void this.ctx.resume();
  }
  toggle(): void {
    if (this.silent) return;
    const muted = !(this.prefs.muted.music && this.prefs.muted.effects);
    this.prefs.muted = { music: muted, effects: muted };
    this.store.setItem("fuse-riders-audio", JSON.stringify(this.prefs));
    this.resume();
  }
  visibility(hidden: boolean): void {
    this.hidden = hidden;
    if (hidden) void this.ctx?.suspend();
    else if (this.ctx) void this.ctx.resume();
  }
  private tone(
    freq: number,
    length: number,
    volume: number,
    type: OscillatorType,
  ): void {
    const c = this.ctx;
    if (!c || this.silent || this.hidden || c.state !== "running") return;
    const o = c.createOscillator(),
      g = c.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, c.currentTime);
    g.gain.linearRampToValueAtTime(volume, c.currentTime + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + length);
    o.connect(g);
    g.connect(c.destination);
    o.start();
    o.stop(c.currentTime + length);
  }
  frame(): void {
    const c = this.ctx;
    if (
      !c ||
      this.prefs.muted.music ||
      this.hidden ||
      c.currentTime < this.next
    )
      return;
    this.next = c.currentTime + 0.7;
    const notes = [130.81, 155.56, 196, 233.08, 196, 155.56, 116.54, 146.83];
    this.tone(
      notes[this.note++ % notes.length]!,
      2.5,
      this.prefs.volume.music * 0.16,
      "sine",
    );
  }
  cue(kind: "capture" | "deposit" | "pulse" | "hit"): void {
    if (this.prefs.muted.effects) return;
    const f = { capture: 660, deposit: 880, pulse: 95, hit: 145 }[kind];
    this.tone(
      f,
      0.25,
      this.prefs.volume.effects * 0.18,
      kind === "pulse" ? "sawtooth" : "triangle",
    );
  }
  stop(): void {
    void this.ctx?.close();
    this.ctx = undefined;
  }
}
