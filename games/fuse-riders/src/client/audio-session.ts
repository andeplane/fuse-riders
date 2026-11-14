/**
 * The iOS audio session behind Fuse Riders Radio (WebKit's Audio Session API, Safari 17; other browsers have no
 * such API and no silent switch). The two types the page uses pull in opposite directions:
 *
 * - `ambient` is muted by the silent switch, and stops when the screen locks or Safari leaves the foreground.
 * - `playback` plays on behind the lock screen and in the background, and ignores the silent switch.
 *
 * A game that only bleeps should obey the switch; a radio the listener turned on should outlive the screen. So the
 * session follows the music: playback while the radio is on, ambient while it is off (music muted, at zero volume
 * or paused), which is how a phone starts.
 */
export type AudioSessionType = "ambient" | "playback";

/** Sets `navigator.audioSession.type`. Returns whether the host took it; a host without the API reports false. */
export function setAudioSessionType(
  type: AudioSessionType,
  host: object = navigator,
): boolean {
  if (!("audioSession" in host)) return false;
  const session = host.audioSession;
  if (typeof session !== "object" || session === null || !("type" in session))
    return false;
  try {
    (session as { type: string }).type = type;
    return true;
  } catch {
    return false;
  }
}

/**
 * The session the page should have. A hidden page keeps what it has when the music goes off: pausing from the
 * lock screen must leave the session able to play again from the lock screen, where an ambient one cannot.
 */
export const radioAudioSession = (
  musicOn: boolean,
  hidden: boolean,
  current: AudioSessionType,
): AudioSessionType => (musicOn ? "playback" : hidden ? current : "ambient");

export interface AudioSessionRadio {
  /** The listener wants music: not muted, not at zero volume, not paused. */
  musicOn(): boolean;
  hidden(): boolean;
}

/**
 * Starts ambient and returns a refresh to call whenever the music setting or the page's visibility changes. The
 * host is only written to when the type changes.
 */
export function bindAudioSession(
  radio: AudioSessionRadio,
  host?: object,
): () => void {
  let current: AudioSessionType | undefined;
  const refresh = () => {
    const next = radioAudioSession(
      radio.musicOn(),
      radio.hidden(),
      current ?? "ambient",
    );
    if (next === current) return;
    current = next;
    setAudioSessionType(next, host);
  };
  refresh();
  return refresh;
}
