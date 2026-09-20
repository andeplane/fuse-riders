/**
 * The PRIVACY row of the per-device SETTINGS: a one-line notice and the analytics toggle. It belongs with MUSIC,
 * SOUND and VISUAL STYLE — this device's own choices — and never in ROOM SETTINGS, which the whole room shares.
 */
import {
  analyticsStatusNow,
  onAnalyticsChange,
  setAnalyticsOptOut,
  type AnalyticsStatus,
} from "./analytics.js";
import { ANALYTICS_NOTICE, consentView } from "./analytics-consent.js";

let rows = 0;

export interface AnalyticsSettingOptions {
  /**
   * A one-line disclosure that opens to the notice and the toggle. The landing page's SETTINGS dialog is a room
   * settings draft that owns its scrolling body, so the row sits under it, outside the scroll — where an open
   * section would take the body's room on a short phone.
   */
  collapsed?: boolean;
  status?: () => AnalyticsStatus;
  setOptOut?: (optedOut: boolean) => void;
  onChange?: (listener: () => void) => unknown;
}

export interface AnalyticsSetting {
  element: HTMLElement;
  /**
   * Re-reads the status. Call it whenever SETTINGS opens: the choice can change behind a built row's back — in
   * another tab, or in the landing page's row before a room is entered without a reload — and a stale label
   * makes the first click do the opposite of what it says. `onChange` covers both already; this covers a browser
   * that delivers no `storage` event.
   */
  render(): void;
}

export function createAnalyticsSetting({
  collapsed = false,
  status = analyticsStatusNow,
  setOptOut = setAnalyticsOptOut,
  onChange = onAnalyticsChange,
}: AnalyticsSettingOptions = {}): AnalyticsSetting {
  const element = document.createElement(collapsed ? "details" : "section");
  element.className = collapsed
    ? "settings-privacy dialog-foot"
    : "settings-privacy";
  const heading = document.createElement(collapsed ? "summary" : "h3");
  heading.className = "settings-group";
  const notice = document.createElement("p");
  notice.className = "settings-note";
  notice.textContent = ANALYTICS_NOTICE;
  const button = document.createElement("button");
  button.type = "button";
  // Always rendered, with its height reserved in CSS, so switching never moves the button under a thumb.
  const reason = document.createElement("p");
  reason.className = "settings-note settings-reason";
  reason.setAttribute("aria-live", "polite");
  notice.id = `analytics-notice-${++rows}`;
  reason.id = `analytics-reason-${rows}`;
  button.setAttribute("aria-describedby", `${notice.id} ${reason.id}`);
  const render = () => {
    const view = consentView(status());
    heading.textContent = collapsed ? `PRIVACY · ${view.label}` : "PRIVACY";
    button.textContent = view.label;
    // The same dimming MUSIC OFF and SOUND OFF get.
    button.dataset.muted = String(!view.on);
    button.disabled = view.locked;
    reason.textContent = view.reason;
  };
  button.onclick = () => {
    // What the label on screen says, not what storage says now: if the two disagree the click only catches up.
    const shownOn = button.dataset.muted === "false";
    if (shownOn === consentView(status()).on) setOptOut(shownOn);
    render();
  };
  if (collapsed) element.addEventListener("toggle", render);
  onChange(render);
  render();
  element.append(heading, notice, button, reason);
  return { element, render };
}
