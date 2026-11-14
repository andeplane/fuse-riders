import { createContext } from "react";

/** What `defaultGameLaunch` decides from: a mouse-like pointer and the viewport width, read when a game launches. */
export type LaunchDevice = { finePointer: boolean; viewportWidth: number };

/** Reads the device fresh each time, so a window resized or a mouse plugged in since boot counts. */
export type LaunchDeviceReader = () => LaunchDevice;

/** The slice of `window` the reader needs; an old browser may lack `matchMedia`. */
export type LaunchDeviceView = {
  matchMedia?: (query: string) => { matches: boolean };
  innerWidth: number;
};

export function readLaunchDevice(view: LaunchDeviceView): LaunchDevice {
  return {
    finePointer:
      typeof view.matchMedia === "function" &&
      view.matchMedia("(pointer: fine)").matches,
    viewportWidth: view.innerWidth,
  };
}

export function browserLaunchDevice(): LaunchDevice {
  return readLaunchDevice(window);
}

export const LaunchDeviceContext =
  createContext<LaunchDeviceReader>(browserLaunchDevice);
