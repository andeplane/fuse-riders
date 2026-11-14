import type { ReactNode } from "react";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { DesktopUiContext } from "../../desktop/desktopUiContext";
import { DisplayViewportContext } from "../../desktop/displayViewportContext";
import { WindowsDepsContext } from "../../windows/windowsDepsContext";

import type { ColorSchemeId } from "./colorSchemes";
import { applyColorScheme, colorScheme } from "./colorSchemes";
import { CrtOverlay } from "./CrtOverlay";
import { DisplayEffectsContext } from "./displayEffectsContext";
import { DisplayEffectsDepsContext } from "./effectsDeps";
import type { CrtMode, DisplayEffects } from "./effectsStore";
import { DisplayEffectsStoreContext } from "./effectsStore";
import { KeepSettingsDialog } from "./KeepSettingsDialog";
import { emulatedGeometry } from "./resolutionEmulation";
import { useResolutionRevert } from "./useResolutionRevert";

import "./schemes.css";

/**
 * Display Properties' Appearance and Effects, in force: holds the persisted effects, paints the
 * colour scheme on <html>, re-provides the display geometry as an emulated resolution (filling
 * the browser window rather than fitting inside it), and puts the CRT sheet and the "Keep these
 * settings?" box over the page. Sits inside `DesktopUiProvider` (for the palette and resolution
 * it shares with the legacy display preferences) and outside the window manager.
 */
export function DisplayEffectsProvider({ children }: { children: ReactNode }) {
  const store = useContext(DisplayEffectsStoreContext);
  const deps = useContext(DisplayEffectsDepsContext);
  const { desktopArea, setDesktopArea, setBackgroundColor, wallpaper } =
    useContext(DesktopUiContext);
  const { getViewport, subscribeViewport } = useContext(WindowsDepsContext);

  const [effects, setEffectsState] = useState<DisplayEffects>(() =>
    store.get(),
  );
  const update = useCallback(
    (patch: Partial<DisplayEffects>) =>
      setEffectsState((current) => {
        const next = { ...current, ...patch };
        store.set(next);
        return next;
      }),
    [store],
  );
  const setCrt = useCallback((crt: CrtMode) => update({ crt }), [update]);
  const setCurvature = useCallback(
    (curvature: boolean) => update({ curvature }),
    [update],
  );
  const setScheme = useCallback(
    (scheme: ColorSchemeId) => {
      update({ scheme });
      // A scheme brings its desktop colour, as in Windows, but never over a wallpaper the user chose.
      if (!wallpaper) setBackgroundColor(colorScheme(scheme).desktop);
    },
    [update, wallpaper, setBackgroundColor],
  );

  const [available, setAvailable] = useState(getViewport);
  useEffect(
    () => subscribeViewport(() => setAvailable(getViewport())),
    [getViewport, subscribeViewport],
  );
  const geometry = useMemo(
    () => emulatedGeometry(desktopArea, available),
    [desktopArea, available],
  );

  const curved = effects.crt === "full" && effects.curvature;
  const curvatureMap = useMemo(
    () => (curved ? deps.createCurvatureMap() : undefined),
    [curved, deps],
  );

  useEffect(() => {
    applyColorScheme(document.documentElement, colorScheme(effects.scheme));
    return () =>
      applyColorScheme(
        document.documentElement,
        colorScheme("windows-standard"),
      );
  }, [effects.scheme]);

  useEffect(() => {
    const root = document.documentElement;
    if (curvatureMap) root.setAttribute("data-crt-curvature", "on");
    else root.removeAttribute("data-crt-curvature");
    return () => root.removeAttribute("data-crt-curvature");
  }, [curvatureMap]);

  useEffect(() => {
    const root = document.documentElement;
    if (desktopArea === "current")
      root.removeAttribute("data-resolution-emulation");
    else root.setAttribute("data-resolution-emulation", desktopArea);
    return () => root.removeAttribute("data-resolution-emulation");
  }, [desktopArea]);

  const revert = useResolutionRevert(desktopArea, setDesktopArea, deps);

  const value = useMemo(
    () => ({ effects, setCrt, setCurvature, setScheme }),
    [effects, setCrt, setCurvature, setScheme],
  );

  return (
    <DisplayEffectsContext.Provider value={value}>
      <DisplayViewportContext.Provider value={geometry}>
        {children}
      </DisplayViewportContext.Provider>
      {createPortal(
        <>
          <CrtOverlay mode={effects.crt} curvatureMap={curvatureMap} />
          {revert.pending ? (
            <KeepSettingsDialog
              resolution={desktopArea}
              secondsLeft={revert.pending.secondsLeft}
              onKeep={revert.keep}
              onRevert={revert.revert}
            />
          ) : null}
        </>,
        document.body,
      )}
    </DisplayEffectsContext.Provider>
  );
}
