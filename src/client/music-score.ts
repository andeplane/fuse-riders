import type { SynthNote } from './audio-director.js';

// Original compositions for Fuse Riders. Each 64-bar arrangement has eight
// sections; rests, answers, breakdowns and changing accompaniment prevent an
// eight-second motif from repeating unchanged throughout a race.
export interface ChiptuneTrack {
  readonly title: string;
  readonly stepMs: number;
  readonly roots: readonly number[];
  readonly hook: readonly number[];
  readonly answer: readonly number[];
}
export const MUSIC_STEPS = 512;
export const CHIPTUNES: readonly ChiptuneTrack[] = [
  { title: 'Fuse Riders', stepMs: 125, roots: [45, 43, 41, 40],
    hook: [76,0,79,81,83,81,79,76,74,0,76,79,81,79,76,74,72,76,79,0,84,83,79,76,74,77,81,0,83,81,77,74],
    answer: [76,79,81,84,83,0,81,79,76,74,72,0,74,76,79,83,84,83,81,79,76,79,74,77,76,0,71,74,76,0,0,0] },
  { title: 'Photon Sprint', stepMs: 112, roots: [40, 43, 45, 47],
    hook: [76,79,83,0,83,81,79,78,76,0,71,74,76,78,79,0,83,86,83,81,79,0,78,76,74,78,81,0,79,78,76,0],
    answer: [88,0,86,83,81,83,79,0,78,81,83,86,83,0,81,79,76,78,79,83,86,0,83,81,79,78,76,74,76,0,71,0] },
  { title: 'Bubble Circuit', stepMs: 136, roots: [48, 45, 41, 43],
    hook: [72,0,76,79,0,76,74,0,77,76,74,72,0,67,72,0,76,0,81,79,76,0,74,72,71,74,79,0,77,76,74,0],
    answer: [79,0,84,83,81,79,76,0,77,81,79,77,76,0,72,0,74,76,79,81,84,0,83,79,77,74,71,74,72,0,0,67] },
  { title: 'Midnight Tunnel', stepMs: 145, roots: [38, 41, 34, 36],
    hook: [74,0,0,77,81,0,79,77,76,0,74,0,69,72,74,0,77,0,81,84,81,0,79,77,76,72,74,0,69,0,72,0],
    answer: [81,0,84,86,84,81,77,0,79,0,81,79,76,0,74,0,77,79,81,0,84,81,79,77,76,0,72,69,74,0,0,0] },
  { title: 'Voltage Garden', stepMs: 120, roots: [43, 40, 36, 38],
    hook: [79,0,74,79,83,0,81,79,78,74,76,78,79,0,0,74,76,79,83,86,83,0,81,79,78,0,74,76,78,79,81,0],
    answer: [86,83,79,0,81,83,86,0,88,86,83,81,79,0,78,74,76,0,79,83,81,79,76,0,78,81,79,78,79,0,0,0] },
  { title: 'Comet Carousel', stepMs: 130, roots: [41, 44, 37, 39],
    hook: [77,80,84,0,80,77,75,0,73,77,80,82,80,0,77,75,72,75,79,0,82,79,75,72,73,77,80,0,79,77,75,0],
    answer: [89,0,87,84,82,80,77,0,80,84,87,0,84,82,80,77,79,82,84,87,84,0,82,79,80,77,75,72,77,0,0,0] },
];
const midi = (value: number): number => 440 * 2 ** ((value - 69) / 12);

/** Pure, bounded score rendering: at most four short voices per step. */
export function musicStep(track: ChiptuneTrack, position: number): SynthNote[] {
  const step = position % MUSIC_STEPS;
  const section = Math.floor(step / 64);
  const local = step % 64;
  const bar = Math.floor(local / 8);
  const root = track.roots[Math.floor(bar / 2)]!;
  const seconds = track.stepMs / 1000;
  const notes: SynthNote[] = [];
  const add = (pitch: number, wave: SynthNote['wave'], level: number, duration: number) => notes.push({ frequency: midi(pitch), wave, level, duration });
  const answer = section === 2 || section === 5 || section === 7;
  const phrase = answer ? track.answer : track.hook;
  let lead = phrase[local % phrase.length]!;
  // Sparse intro and breakdown, octave lift in climax, answering second phrases.
  if ((section === 0 && local % 2 === 1) || section === 3) lead = 0;
  if (lead && (section === 6 || (section === 5 && local >= 32))) lead += 12;
  if (section === 4 && local < 32 && local % 4 === 1) lead = 0;
  if (lead && local >= 32 && section !== 0 && section !== 6 && local % 8 >= 6) lead -= 12;
  if (lead) add(lead, section === 2 || section === 7 ? 'triangle' : 'square', .13, seconds * .74);
  if (local % 2 === 0) add(root + (local % 8 === 6 ? 12 : 0), 'triangle', .36, seconds * 1.4);
  // Arpeggiated counterline joins after the intro, carrying the breakdown solo.
  if (section !== 0 && local % 2 === 1) {
    const chord = [0, 7, 12, 7];
    add(root + 24 + chord[Math.floor(local / 2) % 4]!, 'square', section === 3 ? .075 : .035, seconds * .45);
  }
  if (section !== 3 && local % 4 === 0) notes.push({ frequency: 135, endFrequency: 42, duration: .075, wave: 'triangle', level: .5 });
  else if (section !== 0 && local % 2 === 1) notes.push({ frequency: local >= 60 ? 1900 : 1400, endFrequency: 500, duration: .025, wave: 'square', level: local >= 60 ? .055 : .035 });
  return notes;
}
