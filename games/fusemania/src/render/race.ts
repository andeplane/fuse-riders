import type { WorldView } from "../engine/view.js";
import {
  FULL_RATING,
  HOLD_POINTS,
  MINE,
  POINTS,
  TAP,
  type Steps,
} from "../engine/view-kit.js";
import type { RiderFeedback } from "./feedback.js";
import type { Frame } from "./frame.js";
import type { Race } from "./layout.js";
import { GOLD, INK, LINE, TEXT, WHITE, hexA, slotColor } from "./palette.js";

/**
 * The race line under the lanes: a track from nothing to the chart's full score, with every rider on it at the share
 * of the full score it has so far, so who is ahead and by how much reads at a glance. The local rider's marker is the
 * biggest, with the others' drawn over it so that none hides behind it. The track fills up to the pace: the share a rider would have by now with every note so far
 * Marvelous and every hold kept, so the gap between a marker and the gold edge of the fill is what was dropped.
 *
 * Like the rest of the scene it is worked out from the view and the song time alone.
 */

interface Pace {
  /** When each step's points (and each hold's, at its tail) can first be had, in time order. */
  at: Float64Array;
  /** The share of the full score to be had by then. */
  share: Float64Array;
}
const paces = new WeakMap<Steps, Pace>();

function paceOf(steps: Steps): Pace {
  let pace = paces.get(steps);
  if (!pace) {
    const events: [number, number][] = [];
    for (const note of steps.notes) {
      if (note.kind === MINE) continue;
      events.push([note.ms, POINTS[0]]);
      if (note.kind !== TAP) events.push([note.endMs, HOLD_POINTS]);
    }
    events.sort((a, b) => a[0] - b[0]);
    const at = new Float64Array(events.length),
      share = new Float64Array(events.length);
    let sum = 0;
    for (const [i, [ms, points]] of events.entries()) {
      sum += points;
      at[i] = ms;
      share[i] = sum / steps.full;
    }
    paces.set(steps, (pace = { at, share }));
  }
  return pace;
}

/** The share of a chart's full score (0 to 1) that could be had by `songMs`. */
export function paceAt(steps: Steps, songMs: number): number {
  const { at, share } = paceOf(steps);
  // How many events are at or before `songMs`.
  let low = 0,
    high = at.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (at[mid]! <= songMs) low = mid + 1;
    else high = mid;
  }
  return low === 0 ? 0 : Math.min(1, share[low - 1]!);
}

/** A rider's place on the line (0 to 1) for the score it is shown with. */
export const raceShare = (shown: number): number =>
  Math.max(0, Math.min(1, shown / FULL_RATING));

/** Half the height of the local rider's marker and of the others', in CSS pixels. */
export const OWN_MARKER = 12,
  RIVAL_MARKER = 7;

/** Where the track runs in its band: clear of half the biggest marker at both ends. */
export function raceTrack(
  race: Race,
  unit: number,
  out: { left: number; width: number },
): { left: number; width: number } {
  const margin = Math.round(OWN_MARKER * unit);
  out.left = race.x + margin;
  out.width = Math.max(1, race.width - 2 * margin);
  return out;
}

const track = { left: 0, width: 0 };
const QUARTERS = [0.25, 0.5, 0.75] as const;

export function drawRace(
  frame: Frame,
  race: Race,
  view: WorldView,
  riders: readonly RiderFeedback[],
  steps: readonly (Steps | undefined)[],
  local: number,
): void {
  const g = frame.pen,
    unit = frame.unit;
  const { left, width } = raceTrack(race, unit, track);
  const y = Math.round(race.y + race.height / 2);
  const thick = Math.max(2, Math.round(4 * unit));

  // The pace: the furthest any rider could be by now, and never behind the one who is furthest.
  let pace = 0;
  for (let slot = 0; slot < view.players.length; slot++) {
    const chart = steps[slot],
      rider = riders[slot];
    if (view.phase === "over") pace = 1;
    else if (chart) pace = Math.max(pace, paceAt(chart, frame.songMs));
    if (rider) pace = Math.max(pace, raceShare(rider.score));
  }

  g.globalAlpha = 1;
  g.fillStyle = hexA(LINE, 0.5);
  g.fillRect(left, y - thick / 2, width, thick);
  g.fillStyle = hexA(TEXT, 0.4);
  g.fillRect(left, y - thick / 2, Math.round(width * pace), thick);
  // Quarter marks, and the finish: a little chequered flag.
  const tick = Math.round(5 * unit),
    hair = Math.max(1, Math.round(unit));
  g.fillStyle = LINE;
  for (const quarter of QUARTERS)
    g.fillRect(Math.round(left + width * quarter), y - tick, hair, tick * 2);
  const square = Math.max(2, Math.round(3 * unit));
  for (let row = 0; row < 4; row++)
    for (let column = 0; column < 2; column++) {
      g.fillStyle = (row + column) % 2 === 0 ? WHITE : hexA(TEXT, 0.25);
      g.fillRect(
        left + width + column * square,
        y - 2 * square + row * square,
        square,
        square,
      );
    }
  // The pace's edge.
  if (pace > 0 && pace < 1) {
    g.fillStyle = GOLD;
    g.fillRect(
      Math.round(left + width * pace) - hair,
      y - tick,
      hair * 2,
      tick * 2,
    );
  }

  // The riders: the local rider's big marker first, then the others' small ones over it from last place up, so a
  // rival level with the local rider still shows on its marker and the leader is on top.
  const own = riders[local];
  if (own) marker(frame, left + width * raceShare(own.score), y, local, true);
  for (let place = view.players.length; place >= 1; place--)
    for (let slot = 0; slot < view.players.length; slot++) {
      const rider = riders[slot];
      if (slot === local || !rider || view.players[slot]!.place !== place)
        continue;
      marker(frame, left + width * raceShare(rider.score), y, slot, false);
    }
  g.globalAlpha = 1;
  g.shadowBlur = 0;
}

/** One rider's marker: an arrowhead pointing down the track in the rider's colour, centred on (x, y). */
function marker(
  frame: Frame,
  x: number,
  y: number,
  slot: number,
  own: boolean,
): void {
  const g = frame.pen,
    unit = frame.unit;
  const half = (own ? OWN_MARKER : RIVAL_MARKER) * unit;
  const color = slotColor(slot);
  g.beginPath();
  g.moveTo(x + half, y);
  g.lineTo(x - half * 0.8, y - half);
  g.lineTo(x - half * 0.3, y);
  g.lineTo(x - half * 0.8, y + half);
  g.closePath();
  g.globalAlpha = own ? 1 : 0.9;
  g.shadowColor = color;
  g.shadowBlur = own ? 10 * unit : 0;
  g.fillStyle = color;
  g.fill();
  g.shadowBlur = 0;
  g.lineJoin = "round";
  g.lineWidth = Math.max(1, (own ? 2 : 1.5) * unit);
  g.strokeStyle = own ? WHITE : INK;
  g.stroke();
}
