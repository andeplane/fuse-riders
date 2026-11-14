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
      // The first piece on this beat: before any stop that sits on it.
      let found = pieces[0]!;
      for (const piece of pieces) {
        if (piece.beat > at) break;
        found = piece;
        if (piece.beat === at) break;
      }
      if (found.rate === 0) return found.time;
      return found.time + (at - found.beat) / found.rate;
    },
    beatAt(seconds) {
      let found = pieces[0]!;
      for (const piece of pieces) {
        if (piece.time > seconds) break;
        found = piece;
      }
      return found.beat + (seconds - found.time) * found.rate;
    },
    bpmAt(at) {
      let found = moving[0]!;
      for (const piece of moving) {
        if (piece.beat > at) break;
        found = piece;
      }
      return found.rate * 60;
    },
  };
}
