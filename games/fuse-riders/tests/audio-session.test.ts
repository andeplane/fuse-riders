import assert from "node:assert/strict";
import test from "node:test";
import {
  bindAudioSession,
  radioAudioSession,
  setAudioSessionType,
} from "../src/client/audio-session.ts";

// iOS mutes an ambient session with the silent switch and stops it when the screen locks; a playback session
// plays on behind the lock screen and ignores the switch. The page sets whichever the radio needs.
test("the audio session type is set where the API exists and ignored where it does not", () => {
  const session = { type: "auto" };
  assert.equal(setAudioSessionType("ambient", { audioSession: session }), true);
  assert.equal(session.type, "ambient");
  assert.equal(
    setAudioSessionType("playback", { audioSession: session }),
    true,
  );
  assert.equal(session.type, "playback");
  assert.equal(setAudioSessionType("playback", {}), false, "no API");
  assert.equal(
    setAudioSessionType("playback", { audioSession: null }),
    false,
    "a null session is not an API",
  );
  const readOnly = Object.freeze({ type: "auto" });
  assert.equal(
    setAudioSessionType("playback", { audioSession: readOnly }),
    false,
    "a session that rejects the type reports that instead of throwing",
  );
});

test("a radio that is on gets a playback session, and music off is ambient while the page is visible", () => {
  assert.equal(radioAudioSession(true, false, "ambient"), "playback");
  assert.equal(radioAudioSession(true, true, "ambient"), "playback");
  assert.equal(radioAudioSession(false, false, "playback"), "ambient");
  assert.equal(radioAudioSession(false, true, "playback"), "playback");
  assert.equal(radioAudioSession(false, true, "ambient"), "ambient");
});

/** A session that records every write, so a test sees both the type and that unchanged state writes nothing. */
function recordingHost() {
  const writes: string[] = [];
  let type = "auto";
  return {
    writes,
    audioSession: {
      get type() {
        return type;
      },
      set type(value: string) {
        type = value;
        writes.push(value);
      },
    },
  };
}

// Regression: the page used to ask for ambient once and keep it, so the radio stopped the moment an iPhone locked.
test("locking the phone with the radio on keeps a playback session, and a lock-screen pause can be resumed", () => {
  const host = recordingHost();
  const page = { musicOn: false, hidden: false };
  const refresh = bindAudioSession(
    { musicOn: () => page.musicOn, hidden: () => page.hidden },
    host,
  );
  assert.deepEqual(host.writes, ["ambient"], "music off: the switch mutes");

  page.musicOn = true; // The listener turns the radio on.
  refresh();
  assert.equal(host.audioSession.type, "playback");

  page.hidden = true; // Screen locks, or Safari goes to the background.
  refresh();
  assert.equal(host.audioSession.type, "playback");

  page.musicOn = false; // Paused from the lock screen.
  refresh();
  assert.equal(
    host.audioSession.type,
    "playback",
    "still playback, so the lock screen's play button can start it again",
  );
  page.musicOn = true;
  refresh();
  assert.deepEqual(host.writes, ["ambient", "playback"], "no repeat writes");

  page.musicOn = false; // Paused, then the listener comes back to the page.
  page.hidden = false;
  refresh();
  assert.equal(host.audioSession.type, "ambient");
});

test("without the Audio Session API the binding does nothing and does not throw", () => {
  const refresh = bindAudioSession(
    { musicOn: () => true, hidden: () => false },
    {},
  );
  refresh();
});
