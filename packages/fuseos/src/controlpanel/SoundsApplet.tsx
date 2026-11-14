import { SOUND_EVENTS } from "../sounds/soundEvents";
import { soundEnabled } from "../sounds/soundPrefsStore";
import { useSoundPrefs, useSoundService } from "../sounds/useSystemSound";

/**
 * Control Panel, Sounds: the master switch, one toggle per event and a Play button to hear each,
 * persisted per browser (`sounds/soundPrefsStore.ts`). Opened with `?mute`, the desktop stays
 * silent whatever is set here, and the sheet says so.
 */
export function SoundsApplet() {
  const sounds = useSoundService();
  const prefs = useSoundPrefs();
  const locked = sounds.muted;
  return (
    <div className="flex flex-col gap-3">
      {locked ? (
        <p role="status" className="sunken-panel bg-white p-2">
          This desktop was opened with <code>?mute</code>: every sound is off
          until it is opened without it.
        </p>
      ) : null}
      <fieldset className="flex flex-col gap-2">
        <legend>Sound scheme</legend>
        <div className="field-row">
          <input
            id="sounds-master"
            type="checkbox"
            checked={prefs.master}
            disabled={locked}
            onChange={(event) => sounds.setMaster(event.target.checked)}
          />
          <label htmlFor="sounds-master">Play system sounds</label>
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend>Events</legend>
        <ul
          className="m-0 flex list-none flex-col gap-1 p-0"
          aria-label="Sound events"
        >
          {SOUND_EVENTS.map((info) => (
            <li key={info.event} className="flex items-center gap-2">
              <input
                id={`sound-${info.event}`}
                type="checkbox"
                checked={prefs.events[info.event] !== false}
                disabled={locked || !prefs.master}
                onChange={(event) =>
                  sounds.setEvent(info.event, event.target.checked)
                }
              />
              <label htmlFor={`sound-${info.event}`} className="flex-1">
                <span className="font-bold">{info.label}</span>
                <span className="ml-1 text-[grey]">— {info.description}</span>
              </label>
              <button
                type="button"
                aria-label={`Play ${info.label}`}
                disabled={locked || !prefs.master}
                title={
                  soundEnabled(prefs, info.event)
                    ? "Play this sound"
                    : "Play this sound (it is switched off for the desktop)"
                }
                onClick={() => sounds.play(info.event, { force: true })}
              >
                Play
              </button>
            </li>
          ))}
        </ul>
        <div className="flex justify-end">
          <button type="button" onClick={() => sounds.stopAll()}>
            Stop
          </button>
        </div>
      </fieldset>
      <p className="text-[grey]">
        Every sound is synthesised in the browser; nothing is downloaded or
        recorded.
      </p>
    </div>
  );
}
