// The input layer's public API. Most app code needs only `createBrowserInput` and the `InputHub` it returns.
export {
  InputHub,
  deviceLabel,
  type Command,
  type DeviceId,
  type InputSource,
  type PressListener,
} from "./hub.js";
export {
  createBrowserInput,
  type BrowserInput,
  type TouchZoneStyle,
} from "./browser.js";
export { KEY_BINDINGS } from "./keyboard.js";
