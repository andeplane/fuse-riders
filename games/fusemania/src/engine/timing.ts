import type { TimingData } from "./simfile.js";

/**
 * Beats to seconds and back for one simfile's tempo map: `#BPMS` changes and `#STOPS`. Times are seconds into the
 * music, so they are what the audio clock reads: beat 0 is at `-offset`. A stop holds the beat still after the row
 * it sits on, so a note on a stop's beat is hit before the pause.
 */
export interface Timing {
  /** Seconds into the music at which `beat` is heard. */
  timeAt(beat: number): number;
  /** The beat heard at `seconds` into the music. */
  beatAt(seconds: number): number;
  /** The tempo in force at `beat`, in beats per minute. */
  bpmAt(beat: number): number;
}

interface Piece {
  /** Seconds at which the piece starts, and the beat there. */
  time: number;
  beat: number;
  /** Beats per second; 0 while a stop holds the beat. */
  rate: number;
}

/**
 * The first index of `pieces` (sorted by `key`) whose key is at least `value`, or past it when `past` is set; the
 * length when there is none. A tempo map is searched once per note, so this is a bisection, not a walk.
 */
function firstAtLeast(
  pieces: readonly Piece[],
  value: number,
  key: (piece: Piece) => number,
  past = false,
): number {
  let low = 0,
    high = pieces.length;
  while (low < high) {
    const middle = (low + high) >> 1,
      at = key(pieces[middle]!);
    if (past ? at <= value : at < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function createTiming(data: TimingData): Timing {
  const bpms = data.bpms.length > 0 ? data.bpms : ([[0, 120]] as const);
  const marks = [
    ...bpms.map(([beat, bpm]) => ({ beat, bpm, stop: 0 })),
    ...data.stops.map(([beat, seconds]) => ({ beat, bpm: 0, stop: seconds })),
  ].sort((a, b) => a.beat - b.beat || a.stop - b.stop);
  const pieces: Piece[] = [];
  let time = -data.offset,
    beat = 0,
    rate = bpms[0]![1] / 60;
  pieces.push({ time, beat, rate });
  for (const mark of marks) {
    if (mark.beat > beat) {
      time += (mark.beat - beat) / rate;
      beat = mark.beat;
    }
    if (mark.stop > 0) {
      pieces.push({ time, beat, rate: 0 });
      time += mark.stop;
      pieces.push({ time, beat, rate });
    } else {
      rate = mark.bpm / 60;
      pieces.push({ time, beat, rate });
    }
  }
  const moving = pieces.filter((piece) => piece.rate > 0);
  return {
    timeAt(at) {
      // The first piece on this beat (before any stop that sits on it), else the last one before it.
      const first = firstAtLeast(pieces, at, (piece) => piece.beat);
      const found =
        pieces[first]?.beat === at
          ? pieces[first]
          : (pieces[first - 1] ?? pieces[0]!);
      if (found.rate === 0) return found.time;
      return found.time + (at - found.beat) / found.rate;
    },
    beatAt(seconds) {
      // The last piece that has begun.
      const after = firstAtLeast(pieces, seconds, (piece) => piece.time, true);
      const found = pieces[after - 1] ?? pieces[0]!;
      return found.beat + (seconds - found.time) * found.rate;
    },
    bpmAt(at) {
      const after = firstAtLeast(moving, at, (piece) => piece.beat, true);
      return (moving[after - 1] ?? moving[0]!).rate * 60;
    },
  };
}
