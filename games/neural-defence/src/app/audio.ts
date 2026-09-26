import type { World } from "../engine/types.js";
import type { PresentationPreferences } from "./contracts.js";

export type SoundCue =
  "select" | "build" | "research" | "attack" | "destroy" | "victory" | "defeat";
export interface PresentationAudio {
  configure(preferences: PresentationPreferences): void;
  unlock(): void;
  play(cue: SoundCue): void;
  present(world: Readonly<World>, localPlayerId: string): void;
  dispose(): void;
}

/** Bounded event cues; identical ticks and checkpoint rewinds never replay a burst. */
export function createCueTracker() {
  let match = "";
  let tick = -1;
  let ended = false;
  return (world: Readonly<World>, local: string): SoundCue[] => {
    if (world.matchId !== match || world.tick < tick) {
      match = world.matchId;
      tick = world.tick;
      ended = world.finished;
      return [];
    }
    if (world.tick === tick) return [];
    tick = world.tick;
    if (world.finished && !ended) {
      ended = true;
      return [world.winnerId === local ? "victory" : "defeat"];
    }
    const cues: SoundCue[] = [];
    if (world.outcomes.some((e) => e.type === "destroyed"))
      cues.push("destroy");
    else if (world.outcomes.some((e) => e.type === "damage"))
      cues.push("attack");
    if (
      world.outcomes.some(
        (e) => e.playerId === local && e.type === "researched",
      )
    )
      cues.push("research");
    else if (
      world.outcomes.some(
        (e) => e.playerId === local && e.type === "constructed",
      )
    )
      cues.push("build");
    return cues;
  };
}

/** Audio is presentation only; its clock never drives game simulation. */
export function createBrowserAudio(forceMute: boolean): PresentationAudio {
  let context: AudioContext | null = null;
  let settings: PresentationPreferences = {
    mute: true,
    volume: 0.5,
    reducedMotion: false,
  };
  let disposed = false;
  const voices = new Set<() => void>();
  const silence = () => {
    for (const stop of voices) stop();
  };
  const track = createCueTracker();
  const frequencies: Record<SoundCue, number[]> = {
    select: [480],
    build: [220, 330, 440],
    research: [440, 660, 880],
    attack: [130],
    destroy: [90, 55],
    victory: [330, 440, 550, 660],
    defeat: [220, 165, 110],
  };
  const play = (cue: SoundCue) => {
    if (
      !context ||
      context.state !== "running" ||
      settings.mute ||
      settings.volume <= 0 ||
      forceMute ||
      disposed ||
      voices.size >= 12
    )
      return;
    const duration = cue === "select" ? 0.055 : cue === "attack" ? 0.12 : 0.22;
    frequencies[cue].forEach((frequency, index) => {
      if (voices.size >= 12) return;
      const oscillator = context!.createOscillator();
      const envelope = context!.createGain();
      const start = context!.currentTime + index * 0.095;
      oscillator.type =
        cue === "attack" || cue === "destroy" ? "triangle" : "sine";
      oscillator.frequency.setValueAtTime(frequency, start);
      oscillator.frequency.exponentialRampToValueAtTime(
        frequency * (cue === "attack" ? 0.3 : 1.02),
        start + duration,
      );
      envelope.gain.setValueAtTime(0, start);
      envelope.gain.linearRampToValueAtTime(
        settings.volume * 0.13,
        start + 0.008,
      );
      envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(envelope).connect(context!.destination);
      const stop = () => {
        oscillator.onended = null;
        oscillator.stop();
        oscillator.disconnect();
        envelope.disconnect();
        voices.delete(stop);
      };
      voices.add(stop);
      oscillator.onended = stop;
      oscillator.start(start);
      oscillator.stop(start + duration + 0.02);
    });
  };
  return {
    configure(preferences) {
      settings = preferences;
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
    present(world, local) {
      track(world, local).forEach(play);
    },
    dispose() {
      disposed = true;
      silence();
      if (context) void context.close().catch(() => {});
      context = null;
    },
  };
}
