/**
 * What the PRIVACY row in SETTINGS says for each analytics status. Pure, so the wording that makes a promise
 * ("Nothing is sent") is pinned by a test next to the behaviour that keeps it; `analytics-setting.ts` is the DOM.
 */
import type { AnalyticsStatus } from "./analytics.js";

/** One line, shown whatever the status. Every claim in it is kept by `analytics.ts`; see `docs/ANALYTICS.md`. */
export const ANALYTICS_NOTICE =
  "Anonymous play stats (matches, powerups) go to Mixpanel to help tune the game. No names, room codes or location.";

export interface ConsentView {
  /** The button's label carries the state, as MUSIC and SOUND do. */
  label: "ANALYTICS ON" | "ANALYTICS OFF";
  on: boolean;
  /** True where the choice is not this toggle's to make: the button is shown, disabled, with `reason` beside it. */
  locked: boolean;
  /** Why it is off, or empty while it is on. */
  reason: string;
}

const OFF_REASONS: Record<Exclude<AnalyticsStatus, "on">, string> = {
  optedOut: "Off on this device. Nothing is sent.",
  doNotTrack: "Off: this browser asks not to be tracked. Nothing is sent.",
  addressOff: "Off on a local or test address. Nothing is sent.",
  flagOff: "Off for this browser (?analytics=0). Nothing is sent.",
};

export function consentView(status: AnalyticsStatus): ConsentView {
  if (status === "on")
    return { label: "ANALYTICS ON", on: true, locked: false, reason: "" };
  return {
    label: "ANALYTICS OFF",
    on: false,
    locked: status !== "optedOut",
    reason: OFF_REASONS[status],
  };
}
