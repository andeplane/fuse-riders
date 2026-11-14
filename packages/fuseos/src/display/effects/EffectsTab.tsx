import { useContext } from "react";

import { DisplayEffectsContext } from "./displayEffectsContext";
import { CRT_MODES, isCrtMode } from "./effectsStore";

/** Display Properties, Effects: the CRT monitor overlay and its curvature. */
export function EffectsTab({ windowId }: { windowId: string }) {
  const { effects, setCrt, setCurvature } = useContext(DisplayEffectsContext);
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
      <p>
        The scanlines lie over the games in their windows too. The colour
        palette and the screen resolution are on the Settings tab.
      </p>
    </div>
  );
}
