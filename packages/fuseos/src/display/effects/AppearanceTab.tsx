import { useContext } from "react";

import type { ColorScheme } from "./colorSchemes";
import { COLOR_SCHEMES, colorScheme, isColorSchemeId } from "./colorSchemes";
import { DisplayEffectsContext } from "./displayEffectsContext";

function bevel(scheme: ColorScheme): string {
  return `inset -1px -1px ${scheme.darkShadow}, inset 1px 1px ${scheme.light}, inset -2px -2px ${scheme.shadow}, inset 2px 2px ${scheme.lightShadow}`;
}

/** The Display Properties preview: an inactive and an active window over the desktop, drawn from the scheme's own values. */
export function SchemePreview({ scheme }: { scheme: ColorScheme }) {
  return (
    <div
      data-testid="scheme-preview"
      data-scheme={scheme.id}
      aria-hidden="true"
      className="relative overflow-hidden"
      style={{ height: 150, backgroundColor: scheme.desktop }}
    >
      <div
        className="absolute"
        style={{
          left: 16,
          top: 12,
          width: 200,
          height: 90,
          backgroundColor: scheme.surface,
          boxShadow: bevel(scheme),
          padding: 3,
        }}
      >
        <div
          style={{
            background: `linear-gradient(90deg, ${scheme.titleInactiveStart}, ${scheme.titleInactiveEnd})`,
            color: scheme.titleInactiveText,
            fontWeight: 700,
            padding: "2px 4px",
          }}
        >
          Inactive Window
        </div>
      </div>
      <div
        className="absolute"
        style={{
          left: 56,
          top: 44,
          width: 220,
          height: 100,
          backgroundColor: scheme.surface,
          color: scheme.surfaceText,
          boxShadow: bevel(scheme),
          padding: 3,
        }}
      >
        <div
          style={{
            background: `linear-gradient(90deg, ${scheme.titleStart}, ${scheme.titleEnd})`,
            color: scheme.titleText,
            fontWeight: 700,
            padding: "2px 4px",
          }}
        >
          Active Window
        </div>
        <div className="flex gap-2" style={{ padding: "2px 4px" }}>
          <span>Normal</span>
          <span
            style={{
              backgroundColor: scheme.highlight,
              color: scheme.highlightText,
              padding: "0 3px",
            }}
          >
            Selected
          </span>
        </div>
        <div className="flex items-start gap-2" style={{ padding: "0 4px" }}>
          <div
            style={{
              flex: 1,
              height: 34,
              backgroundColor: scheme.field,
              color: scheme.fieldText,
              padding: 3,
            }}
          >
            Window Text
          </div>
          <div
            style={{
              backgroundColor: scheme.surface,
              color: scheme.surfaceText,
              boxShadow: bevel(scheme),
              padding: "3px 12px",
            }}
          >
            OK
          </div>
        </div>
      </div>
    </div>
  );
}

/** Display Properties, Appearance: pick a colour scheme and see it on a sample desktop first. */
export function AppearanceTab({ windowId }: { windowId: string }) {
  const { effects, setScheme } = useContext(DisplayEffectsContext);
  const scheme = colorScheme(effects.scheme);
  return (
    <div className="flex flex-col gap-3">
      <SchemePreview scheme={scheme} />
      <div className="field-row-stacked" style={{ maxWidth: 240 }}>
        <label htmlFor={`color-scheme-${windowId}`}>Scheme</label>
        <select
          id={`color-scheme-${windowId}`}
          value={effects.scheme}
          onChange={(event) => {
            if (isColorSchemeId(event.target.value))
              setScheme(event.target.value);
          }}
        >
          {COLOR_SCHEMES.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.label}
            </option>
          ))}
        </select>
      </div>
      <p>
        The scheme colours every window, menu and button. The desktop takes the
        scheme&apos;s colour too, unless a wallpaper is set.
      </p>
    </div>
  );
}
