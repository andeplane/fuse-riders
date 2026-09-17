/**
 * The PRIVACY row of the per-device SETTINGS: a one-line notice and the analytics toggle. It belongs with MUSIC,
 * SOUND and VISUAL STYLE — this device's own choices — and never in ROOM SETTINGS, which the whole room shares.
 */
import {
  analyticsStatusNow,
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
}

export function createAnalyticsSetting({
  collapsed = false,
  status = analyticsStatusNow,
  setOptOut = setAnalyticsOptOut,
}: AnalyticsSettingOptions = {}): { element: HTMLElement } {
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
    setOptOut(consentView(status()).on);
    render();
  };
  // The other copy of this row (landing page, then a room entered without a reload) may have changed the choice.
  if (collapsed) element.addEventListener("toggle", render);
  render();
  element.append(heading, notice, button, reason);
  return { element };
}
