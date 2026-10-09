import { createBrowserInput } from "./browser.js";
import { deviceLabel } from "./hub.js";

const SLOTS = 6;

/**
 * `?inputdebug` (add `&touch` to force touch zones on a desktop): a corner readout proving the input layer works.
 * Pressing any device joins it to the next free slot, like a lobby would; after that its presses flash its slot.
 * Touch devices get one zone per joined touch player plus a JOIN zone.
 */
export function startInputDebug(win: Window = window): void {
  const params = new URLSearchParams(win.location.search);
  const input = createBrowserInput(win, { forceTouch: params.has("touch") });
  const { hub } = input;
  const flash = new Array<number>(SLOTS).fill(0);
  const log: string[] = [];

  const panel = win.document.createElement("pre");
  Object.assign(panel.style, {
    position: "fixed",
    top: "0",
    left: "0",
    margin: "0",
    padding: "var(--fui-space-2)",
    background: "var(--fui-panel)",
    color: "var(--fui-lime)",
    font: "0.5rem/1.6 var(--fui-font-pixel)",
    zIndex: "var(--fui-z-status)",
    pointerEvents: "none",
  });
  win.document.body.append(panel);

  const updateTouchZones = (): void => {
    const joined = hub
      .bindings()
      .filter(({ device }) => device.startsWith("touch:"));
    input.setTouchZones([
      ...joined.map(({ slot }) => ({ label: `P${slot + 1}` })),
      ...(hub.bindings().length < SLOTS
        ? [{ label: "JOIN", color: "var(--fui-yellow)" }]
        : []),
    ]);
  };

  hub.onPress((device) => {
    log.unshift(deviceLabel(device));
    log.length = Math.min(log.length, 6);
    if (hub.slotOf(device) !== undefined) return;
    const free = [...Array(SLOTS).keys()].find(
      (slot) => hub.deviceOf(slot) === undefined,
    );
    if (free === undefined) return;
    hub.bind(free, device);
    updateTouchZones();
  });
  updateTouchZones();

  const frame = (): void => {
    hub.poll();
    hub.takePresses(SLOTS).forEach((pressed, slot) => {
      flash[slot] = pressed ? 12 : Math.max(0, (flash[slot] ?? 0) - 1);
    });
    const rows = [...Array(SLOTS).keys()].map((slot) => {
      const device = hub.deviceOf(slot);
      const mark = (flash[slot] ?? 0) > 0 ? "*" : " ";
      return `P${slot + 1} ${mark} ${device ? deviceLabel(device) : "-"}`;
    });
    panel.textContent = `INPUT DEBUG\n${rows.join("\n")}\nlast: ${log.join(" ")}`;
    win.requestAnimationFrame(frame);
  };
  frame();
}
