import {
  isJointStyle,
  JOINT_STYLE_LABELS,
  JOINT_STYLES,
} from "../screensaver/pipes/pipesModel";
import {
  isScreenSaverKind,
  MAX_WAIT_MINUTES,
  MIN_WAIT_MINUTES,
} from "../screensaver/screenSaverStore";
import { useScreenSaverViewModel } from "../screensaver/useScreenSaverViewModel";

import type { DisplayTab } from "./displayTabs";

/** A few pipes on the preview monitor, so the tab shows what it is about without loading three.js. */
function MonitorPreview({ saver }: { saver: "none" | "pipes" }) {
  return (
    <div
      className="flex flex-col items-center"
      data-testid="screensaver-monitor"
      data-saver={saver}
    >
      <div
        className="rounded-sm p-2"
        style={{
          background: "#c0c0c0",
          boxShadow:
            "inset -1px -1px #000, inset 1px 1px #fff, inset -2px -2px grey, inset 2px 2px #dfdfdf",
        }}
      >
        <div
          className="flex items-center justify-center overflow-hidden"
          style={{ width: 160, height: 120, background: "#000" }}
          aria-label="Screen saver preview"
        >
          {saver === "pipes" ? (
            <svg
              viewBox="0 0 160 120"
              width={160}
              height={120}
              aria-hidden="true"
            >
              <g
                fill="none"
                strokeWidth={9}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline
                  points="10,100 10,60 50,60 50,20 90,20"
                  stroke="#3fa0ff"
                />
                <polyline
                  points="150,15 110,15 110,55 70,55 70,95 30,95"
                  stroke="#ff6a3d"
                />
                <polyline
                  points="150,110 130,110 130,75 95,75 95,40"
                  stroke="#7cff4a"
                />
              </g>
              <g>
                <circle cx={50} cy={60} r={8} fill="#3fa0ff" />
                <circle cx={110} cy={55} r={8} fill="#ff6a3d" />
                <circle cx={130} cy={75} r={8} fill="#7cff4a" />
                <circle cx={70} cy={95} r={8} fill="#ff6a3d" />
              </g>
            </svg>
          ) : null}
        </div>
      </div>
      <div
        style={{
          width: 40,
          height: 10,
          background: "#c0c0c0",
          borderLeft: "1px solid #fff",
          borderRight: "1px solid #000",
        }}
      />
      <div
        style={{
          width: 90,
          height: 6,
          background: "#c0c0c0",
          borderTop: "1px solid #fff",
          borderBottom: "1px solid #000",
        }}
      />
    </div>
  );
}

/** Display Properties, Screen Saver: pick (None) or 3D Pipes, how long to wait, the pipes' options, and Preview. */
export function ScreenSaverTab({ windowId }: { windowId: string }) {
  const vm = useScreenSaverViewModel();
  const id = (name: string) => `screensaver-${name}-${windowId}`;
  const pipesOn = vm.prefs.saver === "pipes";
  return (
    <div className="flex flex-col gap-3" data-testid="screensaver-tab">
      <MonitorPreview saver={vm.prefs.saver} />
      <fieldset className="flex flex-col gap-2">
        <legend>Screen Saver</legend>
        <div className="field-row">
          <label htmlFor={id("kind")}>Screen saver</label>
          <select
            id={id("kind")}
            value={vm.prefs.saver}
            onChange={(event) => {
              if (isScreenSaverKind(event.target.value))
                vm.setSaver(event.target.value);
            }}
          >
            <option value="none">(None)</option>
            <option value="pipes">3D Pipes</option>
          </select>
          <button
            type="button"
            className="ml-auto"
            disabled={!vm.canPreview}
            onClick={vm.preview}
          >
            Preview
          </button>
        </div>
        <div className="field-row">
          <label htmlFor={id("wait")}>Wait:</label>
          <input
            id={id("wait")}
            aria-label="Screen saver wait minutes"
            type="number"
            min={MIN_WAIT_MINUTES}
            max={MAX_WAIT_MINUTES}
            value={vm.prefs.waitMinutes}
            style={{ width: 60 }}
            disabled={!pipesOn}
            onChange={(event) => vm.setWait(event.target.valueAsNumber)}
          />
          <span>minutes</span>
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-2" disabled={!pipesOn}>
        <legend>Settings for 3D Pipes</legend>
        <div className="field-row">
          <label htmlFor={id("joints")}>Joint style</label>
          <select
            id={id("joints")}
            value={vm.prefs.pipes.joints}
            onChange={(event) => {
              if (isJointStyle(event.target.value))
                vm.setJoints(event.target.value);
            }}
          >
            {JOINT_STYLES.map((style) => (
              <option key={style} value={style}>
                {JOINT_STYLE_LABELS[style]}
              </option>
            ))}
          </select>
        </div>
        <div className="field-row">
          <input
            id={id("multiple")}
            type="checkbox"
            checked={vm.prefs.pipes.multiple}
            onChange={(event) => vm.setMultiple(event.target.checked)}
          />
          <label htmlFor={id("multiple")}>Multiple pipes</label>
        </div>
        <div className="field-row">
          <input
            id={id("teapots")}
            type="checkbox"
            checked={vm.prefs.pipes.teapots}
            onChange={(event) => vm.setTeapots(event.target.checked)}
          />
          <label htmlFor={id("teapots")}>Teapots now and then</label>
        </div>
      </fieldset>
      <p>
        After the wait with no mouse or keyboard, 3D Pipes fills the screen.
        Move the mouse or press any key to return; your windows stay as they
        were. It never starts over a game you are playing.
      </p>
      <p className="text-[grey]">
        3D Pipes is Isaiah Odhner&apos;s remake of the Windows 98 screen saver
        (MIT licence). These settings stay in this browser.
      </p>
    </div>
  );
}

/** The registration the tabbed Display applet mounts; `ScreenSaverApplet` is the same tab under its Control Panel name. */
export const SCREEN_SAVER_DISPLAY_TAB: DisplayTab = {
  id: "screensaver",
  label: "Screen Saver",
  component: ScreenSaverTab,
};

export const ScreenSaverApplet = ScreenSaverTab;
