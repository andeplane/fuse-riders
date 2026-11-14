import { useContext } from "react";

import type { JointStyle } from "./pipes/pipesModel";
import { ScreenSaverContext } from "./screenSaverContext";
import type {
  PipesPrefs,
  ScreenSaverKind,
  ScreenSaverPrefs,
} from "./screenSaverStore";

export type ScreenSaverViewModel = {
  prefs: ScreenSaverPrefs;
  /** The saver is on screen right now (never true while the applet is usable, kept for completeness). */
  active: boolean;
  setSaver: (saver: ScreenSaverKind) => void;
  setWait: (waitMinutes: number) => void;
  setJoints: (joints: JointStyle) => void;
  setTeapots: (teapots: boolean) => void;
  setMultiple: (multiple: boolean) => void;
  /** False with "(None)" selected: there is nothing to preview. */
  canPreview: boolean;
  preview: () => void;
};

/** The Screen Saver tab's view over the shared preference state; it holds no state of its own. */
export function useScreenSaverViewModel(): ScreenSaverViewModel {
  const { snapshot, controls } = useContext(ScreenSaverContext);
  const setPipes = (patch: Partial<PipesPrefs>) =>
    controls.configure({ pipes: patch });
  return {
    prefs: snapshot.prefs,
    active: snapshot.active,
    setSaver: (saver) => controls.configure({ saver }),
    setWait: (waitMinutes) => {
      if (Number.isFinite(waitMinutes)) controls.configure({ waitMinutes });
    },
    setJoints: (joints) => setPipes({ joints }),
    setTeapots: (teapots) => setPipes({ teapots }),
    setMultiple: (multiple) => setPipes({ multiple }),
    canPreview: snapshot.prefs.saver !== "none",
    preview: controls.preview,
  };
}
