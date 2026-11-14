import {
  digitStart,
  MODEM_DURATION,
  MODEM_NUMBER,
  MODEM_TIMELINE,
} from "./modemTimeline";
import type { Random } from "./pcm";
import {
  applyEnvelope,
  at,
  biquad,
  normalize,
  PcmTrack,
  renderBandNoise,
  renderNoise,
  scale,
  seededRandom,
} from "./pcm";

/**
 * A V.34/V.90-style dial-up handshake, synthesised from the standards rather than recorded:
 *
 *  1. off-hook relay click and line hiss, then the North American dial tone (350 + 440 Hz);
 *  2. DTMF dialling of 555-FUSE;
 *  3. ringback (440 + 480 Hz) and the far end picking up;
 *  4. the answer tone, ANSam: 2100 Hz amplitude-modulated at 15 Hz with a phase reversal every
 *     450 ms (V.8), while the caller sends its V.8 call menu as 300 bps V.21 FSK over it;
 *  5. V.34 phase 1 and 2: INFO0 FSK bursts (V.21 channel 2, 1650/1850 Hz), tones A/B (2400 and
 *     1200 Hz with phase reversals) and the line-probing comb of 150 Hz-spaced tones from
 *     150 to 3750 Hz, the famous "pwaaaah";
 *  6. phase 3 and 4: the periodic PP sequence, then scrambled training data, the "kshhhh" that
 *     narrows and widens as the rate is negotiated, until the speaker cuts out on CONNECT.
 *
 * `MODEM_PHASES` names the moments the Dial-Up Networking dialog reports on.
 */

const {
  dialToneStart: DIAL_TONE_START,
  dialToneEnd: DIAL_TONE_END,
  digitOn: DIGIT_ON,
  ringbackStart: RINGBACK_START,
  ringbackEnd: RINGBACK_END,
  pickup: PICKUP,
  ansamStart: ANSAM_START,
  ansamEnd: ANSAM_END,
  callMenuStart: CALL_MENU_START,
  info0Start: INFO0_START,
  toneAbStart: TONE_AB_START,
  probeStart: PROBE_START,
  probeEnd: PROBE_END,
  info1Start: INFO1_START,
  ppStart: PP_START,
  trainStart: TRAIN_START,
  trainWide: TRAIN_WIDE,
  trainEnd: TRAIN_END,
  connected: CONNECTED,
} = MODEM_TIMELINE;

/** The two tones of each keypad digit (ITU-T Q.23). */
export const DTMF: Readonly<Record<string, readonly [number, number]>> = {
  "1": [697, 1209],
  "2": [697, 1336],
  "3": [697, 1477],
  "4": [770, 1209],
  "5": [770, 1336],
  "6": [770, 1477],
  "7": [852, 1209],
  "8": [852, 1336],
  "9": [852, 1477],
  "*": [941, 1209],
  "0": [941, 1336],
  "#": [941, 1477],
};

/** The ANSam answer tone: 2100 Hz, 15 Hz amplitude modulation, 180 degree phase flip every 450 ms. */
function renderAnsam(sampleRate: number, duration: number, amp: number) {
  const n = at(sampleRate, duration);
  const out = new Float32Array(n);
  const step = (2 * Math.PI * 2100) / sampleRate;
  const modStep = (2 * Math.PI * 15) / sampleRate;
  const flipEvery = at(sampleRate, 0.45);
  for (let i = 0; i < n; i++) {
    const flips = Math.floor(i / flipEvery);
    const sign = flips % 2 === 0 ? 1 : -1;
    const modulation = 1 + 0.2 * Math.sin(modStep * i);
    out[i] = sign * Math.sin(step * i) * amp * modulation;
  }
  applyEnvelope(out, sampleRate, 0.01, 0.02);
  return out;
}

/** Phase-continuous binary FSK of random bits, as V.21 and the V.34 INFO sequences sound. */
function renderFsk(
  sampleRate: number,
  duration: number,
  baud: number,
  mark: number,
  space: number,
  amp: number,
  random: Random,
) {
  const n = at(sampleRate, duration);
  const out = new Float32Array(n);
  const samplesPerBit = sampleRate / baud;
  let phase = 0;
  let bit = 1;
  for (let i = 0; i < n; i++) {
    if (i % Math.round(samplesPerBit) === 0) bit = random() < 0.5 ? 0 : 1;
    const freq = bit ? mark : space;
    phase += (2 * Math.PI * freq) / sampleRate;
    out[i] = Math.sin(phase) * amp;
  }
  applyEnvelope(out, sampleRate, 0.005, 0.005);
  return out;
}

/** The V.34 line-probing signal: every 150 Hz from 150 to 3750 Hz except 900, 1200 and 1800. */
function renderProbeComb(sampleRate: number, duration: number, amp: number) {
  const n = at(sampleRate, duration);
  const out = new Float32Array(n);
  const freqs: number[] = [];
  for (let f = 150; f <= 3750; f += 150)
    if (f !== 900 && f !== 1200 && f !== 1800) freqs.push(f);
  for (const freq of freqs) {
    const step = (2 * Math.PI * freq) / sampleRate;
    // A fixed pseudo-random phase per tone keeps the comb from piling into one huge peak.
    const phase = (freq * 0.37) % (2 * Math.PI);
    for (let i = 0; i < n; i++)
      out[i] = (out[i] ?? 0) + Math.sin(phase + step * i) * amp;
  }
  applyEnvelope(out, sampleRate, 0.01, 0.01);
  return out;
}

/** A tone whose phase flips at `reversalAt` seconds (tones A and B of V.34 phase 2). */
function renderReversingTone(
  sampleRate: number,
  freq: number,
  duration: number,
  reversalAt: number,
  amp: number,
) {
  const n = at(sampleRate, duration);
  const out = new Float32Array(n);
  const flip = at(sampleRate, reversalAt);
  const step = (2 * Math.PI * freq) / sampleRate;
  for (let i = 0; i < n; i++)
    out[i] = (i < flip ? 1 : -1) * Math.sin(step * i) * amp;
  applyEnvelope(out, sampleRate, 0.005, 0.005);
  return out;
}

/** A relay click: a short, low thump of noise. */
function renderClick(sampleRate: number, random: Random, amp: number) {
  const raw = renderNoise(at(sampleRate, 0.012), random, amp);
  applyEnvelope(raw, sampleRate, 0.001, 0.01);
  return biquad("lowpass", 2500, 0.8, sampleRate)(raw);
}

export function renderModem(
  sampleRate: number,
  random: Random = seededRandom(0x56_34),
): Float32Array {
  const track = new PcmTrack(sampleRate, MODEM_DURATION);

  // Off hook: relay, then the quiet hiss of an open line for the whole call.
  track.add(0.02, renderClick(sampleRate, random, 0.5));
  const hiss = renderBandNoise(
    sampleRate,
    at(sampleRate, CONNECTED - 0.05),
    random,
    300,
    3400,
    0.012,
  );
  track.add(0.05, hiss);

  track.tone({
    freq: 350,
    start: DIAL_TONE_START,
    duration: DIAL_TONE_END - DIAL_TONE_START,
    amp: 0.16,
  });
  track.tone({
    freq: 440,
    start: DIAL_TONE_START,
    duration: DIAL_TONE_END - DIAL_TONE_START,
    amp: 0.16,
  });

  for (let i = 0; i < MODEM_NUMBER.length; i++) {
    const pair = DTMF[MODEM_NUMBER[i] ?? "0"] ?? DTMF["0"];
    if (!pair) continue;
    const start = digitStart(i);
    track.tone({ freq: pair[0], start, duration: DIGIT_ON, amp: 0.18 });
    track.tone({ freq: pair[1], start, duration: DIGIT_ON, amp: 0.18 });
  }

  track.tone({
    freq: 440,
    start: RINGBACK_START,
    duration: RINGBACK_END - RINGBACK_START,
    amp: 0.13,
    attack: 0.02,
    release: 0.03,
  });
  track.tone({
    freq: 480,
    start: RINGBACK_START,
    duration: RINGBACK_END - RINGBACK_START,
    amp: 0.13,
    attack: 0.02,
    release: 0.03,
  });

  // The far end answers.
  track.add(PICKUP, renderClick(sampleRate, random, 0.4));
  track.add(ANSAM_START, renderAnsam(sampleRate, ANSAM_END - ANSAM_START, 0.3));
  // The caller's V.8 call menu, 300 bps V.21 channel 1, under the answer tone.
  track.add(
    CALL_MENU_START,
    renderFsk(
      sampleRate,
      ANSAM_END - CALL_MENU_START,
      300,
      980,
      1180,
      0.1,
      random,
    ),
  );

  // V.34 phase 1: INFO0 from both ends on V.21 channel 2.
  track.add(
    INFO0_START,
    renderFsk(sampleRate, 0.65, 300, 1650, 1850, 0.2, random),
  );

  // Phase 2: tone A (2400 Hz) and tone B (1200 Hz) with their phase reversals, then line probing.
  track.add(
    TONE_AB_START,
    renderReversingTone(sampleRate, 2400, 0.4, 0.2, 0.2),
  );
  track.add(
    TONE_AB_START + 0.05,
    renderReversingTone(sampleRate, 1200, 0.35, 0.18, 0.14),
  );
  track.add(
    PROBE_START,
    renderProbeComb(sampleRate, PROBE_END - PROBE_START, 0.035),
  );
  track.ramp(PROBE_START, PROBE_START + 0.16, 1.15, 1.15);
  track.add(
    PROBE_END + 0.05,
    renderReversingTone(sampleRate, 2400, 0.3, 0.15, 0.18),
  );
  track.add(
    INFO1_START,
    renderFsk(sampleRate, 0.7, 300, 1650, 1850, 0.2, random),
  );

  // Phase 3: PP, a periodic sequence that rings like a buzzy chord around the 1959 Hz carrier.
  const pp = new PcmTrack(sampleRate, TRAIN_START - PP_START);
  for (let k = -6; k <= 6; k++)
    pp.tone({
      freq: 1959 + k * 171.45,
      start: 0,
      duration: TRAIN_START - PP_START,
      amp: 0.05,
      attack: 0.01,
      release: 0.02,
    });
  track.add(PP_START, pp.samples);

  // Phase 4: scrambled training data. Narrow first, then the full 300-3400 Hz band as the rate climbs.
  const narrow = renderBandNoise(
    sampleRate,
    at(sampleRate, TRAIN_WIDE - TRAIN_START),
    random,
    1000,
    2800,
    0.28,
  );
  track.add(TRAIN_START, narrow);
  const wide = renderBandNoise(
    sampleRate,
    at(sampleRate, TRAIN_END - TRAIN_WIDE),
    random,
    300,
    3400,
    0.36,
  );
  track.add(TRAIN_WIDE, wide);
  // The data carrier pumps slightly as the equaliser trains.
  const pumpFrom = at(sampleRate, TRAIN_START);
  const pumpTo = at(sampleRate, TRAIN_END);
  for (let i = pumpFrom; i < pumpTo; i++) {
    const t = (i - pumpFrom) / sampleRate;
    const value = track.samples[i] ?? 0;
    track.samples[i] = value * (0.85 + 0.15 * Math.sin(2 * Math.PI * 2.3 * t));
  }
  track.ramp(TRAIN_END - 0.05, TRAIN_END, 1, 0);

  // CONNECT: the modem speaker switches off with a last relay click.
  track.add(CONNECTED - 0.02, scale(renderClick(sampleRate, random, 0.35), 1));

  return normalize(track.samples, 0.85);
}
