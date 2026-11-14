import { useContext } from "react";

import { DesktopUiContext } from "../../desktop/desktopUiContext";
import {
  COLOR_MODES,
  isColorMode,
  isDesktopArea,
} from "../../desktop/displayModes";

import { DisplayEffectsContext } from "./displayEffectsContext";
import { CRT_MODES, isCrtMode } from "./effectsStore";
import { KEEP_SETTINGS_SECONDS, RESOLUTIONS } from "./resolutionEmulation";

/** Display Properties, Effects: the CRT monitor, the colour palette and the emulated screen resolution. */
export function EffectsTab({ windowId }: { windowId: string }) {
  const { effects, setCrt, setCurvature } = useContext(DisplayEffectsContext);
  const { colorMode, setColorMode, desktopArea, setDesktopArea } =
    useContext(DesktopUiContext);
  const curvatureId = `crt-curvature-${windowId}`;
  return (
    <div className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-2">
        <legend>Monitor</legend>
        <div className="field-row-stacked" style={{ maxWidth: 280 }}>
          <label htmlFor={`crt-mode-${windowId}`}>CRT monitor</label>
          <select
            id={`crt-mode-${windowId}`}
            value={effects.crt}
            onChange={(event) => {
              if (isCrtMode(event.target.value)) setCrt(event.target.value);
            }}
          >
            {CRT_MODES.map((mode) => (
              <option key={mode.value} value={mode.value}>
                {mode.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field-row">
          <input
            id={curvatureId}
            type="checkbox"
            checked={effects.curvature}
            disabled={effects.crt !== "full"}
            onChange={(event) => setCurvature(event.target.checked)}
          />
          <label htmlFor={curvatureId}>Curved tube</label>
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend>Screen</legend>
        <div className="field-row-stacked" style={{ maxWidth: 240 }}>
          <label htmlFor={`palette-${windowId}`}>Palette</label>
          <select
            id={`palette-${windowId}`}
            value={colorMode}
            onChange={(event) => {
              if (isColorMode(event.target.value))
                setColorMode(event.target.value);
            }}
          >
            {COLOR_MODES.map((mode) => (
              <option key={mode.value} value={mode.value}>
                {mode.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field-row-stacked" style={{ maxWidth: 240 }}>
          <label htmlFor={`resolution-${windowId}`}>Screen resolution</label>
          <select
            id={`resolution-${windowId}`}
            value={desktopArea}
            onChange={(event) => {
              if (isDesktopArea(event.target.value))
                setDesktopArea(event.target.value);
            }}
          >
            {RESOLUTIONS.map((resolution) => (
              <option key={resolution.value} value={resolution.value}>
                {resolution.label}
              </option>
            ))}
          </select>
        </div>
        <p>
          The palette and the scanlines reach the games in their windows too. A
          new resolution stays only if you keep it within{" "}
          {KEEP_SETTINGS_SECONDS} seconds.
        </p>
      </fieldset>
    </div>
  );
}
