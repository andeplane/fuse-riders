import { useCallback, useContext } from "react";

import type { GameLaunch } from "./fuseosPrefsStore";
import {
  defaultGameLaunch,
  effectiveGameLaunch,
  FuseOsPrefsStoreContext,
  useFuseOsPrefs,
} from "./fuseosPrefsStore";
import { LaunchDeviceContext } from "./launchDevice";

export type GameLaunchModel = {
  /** The mode in force: the stored choice, else the device default. */
  launch: GameLaunch;
  /** What this device would get without a choice. */
  deviceDefault: GameLaunch;
  /** True when the user chose rather than left it to the device. */
  chosen: boolean;
  setLaunch: (launch: GameLaunch) => void;
  /** Back to the device default. */
  useDeviceDefault: () => void;
};

/** The launch preference as the Games applet and the desktop see it; re-renders on every change. */
export function useGameLaunch(): GameLaunchModel {
  const store = useContext(FuseOsPrefsStoreContext);
  const readDevice = useContext(LaunchDeviceContext);
  const prefs = useFuseOsPrefs();
  const device = readDevice();
  const setLaunch = useCallback(
    (launch: GameLaunch) => store.set({ ...store.get(), gameLaunch: launch }),
    [store],
  );
  const useDeviceDefault = useCallback(() => {
    const { gameLaunch: _launch, ...rest } = store.get();
    store.set(rest);
  }, [store]);
  return {
    launch: effectiveGameLaunch(prefs, device),
    deviceDefault: defaultGameLaunch(device),
    chosen: prefs.gameLaunch !== undefined,
    setLaunch,
    useDeviceDefault,
  };
}
