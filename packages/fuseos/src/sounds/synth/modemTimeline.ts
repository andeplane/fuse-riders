/**
 * When each stage of the dial-up handshake happens, in seconds. Shared by the synthesiser
 * (`modem.ts`, loaded lazily) and the Dial-Up Networking dialog, whose status lines follow the
 * sound; this file carries no DSP so the dialog can import it statically.
 */
export const MODEM_TIMELINE = {
  dialToneStart: 0.15,
  dialToneEnd: 1.25,
  digitsStart: 1.4,
  digitOn: 0.09,
  digitOff: 0.07,
  ringbackStart: 2.85,
  ringbackEnd: 4.35,
  pickup: 5.1,
  ansamStart: 5.3,
  ansamEnd: 8.6,
  callMenuStart: 7.0,
  info0Start: 8.9,
  toneAbStart: 9.6,
  probeStart: 10.0,
  probeEnd: 10.75,
  info1Start: 11.2,
  ppStart: 12.0,
  trainStart: 12.45,
  trainWide: 13.4,
  trainEnd: 15.1,
  connected: 15.45,
} as const;

export const MODEM_DURATION = 15.6;

/** 555-FUSE on a telephone keypad. */
export const MODEM_NUMBER = "5553873";

export const MODEM_PHONE_NUMBER = "555-FUSE";

export type ModemPhase = {
  /** Seconds into the handshake. */
  at: number;
  /** What Dial-Up Networking says at that point. */
  status: string;
};

export const MODEM_PHASES: readonly ModemPhase[] = [
  { at: 0, status: `Dialing ${MODEM_PHONE_NUMBER}...` },
  { at: MODEM_TIMELINE.ringbackStart, status: "Ringing..." },
  {
    at: MODEM_TIMELINE.ansamStart,
    status: "Verifying user name and password...",
  },
  { at: MODEM_TIMELINE.probeStart, status: "Negotiating connection speed..." },
  { at: MODEM_TIMELINE.trainStart, status: "Logging on to network..." },
  { at: MODEM_TIMELINE.connected, status: "Connected at 56,000 bps" },
];

/** When digit `index` of `MODEM_NUMBER` starts sounding. */
export function digitStart(index: number): number {
  return (
    MODEM_TIMELINE.digitsStart +
    index * (MODEM_TIMELINE.digitOn + MODEM_TIMELINE.digitOff)
  );
}

/** Seconds at which the answer tone reverses phase (every 450 ms, per V.8). */
export function ansamReversals(): number[] {
  const times: number[] = [];
  for (
    let t = MODEM_TIMELINE.ansamStart + 0.45;
    t < MODEM_TIMELINE.ansamEnd - 0.05;
    t += 0.45
  )
    times.push(Number(t.toFixed(3)));
  return times;
}
