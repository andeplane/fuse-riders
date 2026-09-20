# Online voice chat

Tracking: [#236](https://github.com/andeplane/fuse-riders/issues/236).

Voice is optional and per device. Open **VOICE** (or **SETTINGS → VOICE CHAT**) and choose **JOIN VOICE** to request the microphone or **LISTEN ONLY** to hear the room without capturing. Joining a room, refreshing, and opening a TV display never automatically enable voice. **MUTE MIC** silences transmission; **DEAFEN** silences playback and transmission while preserving the previous microphone mute choice. **LEAVE VOICE** releases the microphone. Microphone selection, voice volume and participant silence affect only this device. Game sound controls and Ctrl+M affect music/effects only; use voice mute/deafen separately. Muting retains microphone capture for fast unmute; leaving voice stops it.

On a shared screen use one device for voice, or headphones on the participating devices. Several nearby open microphones/speakers can echo. Browser echo cancellation and noise suppression are requested, but are not a substitute for physical-device testing. Microphone capture requires HTTPS or localhost; plain-HTTP LAN addresses are outside this version's scope.

## Design and tradeoffs

The existing full mesh carries one audio track per peer alongside gameplay's data channels. No media traverses the room service and no TURN/SFU or paid service is added. Upload bandwidth grows with the number of connected devices, including displays. Existing STUN-only connectivity limits still apply.

The networking package exposes an optional `PeerTransportExtension` for application-owned media. It calls connection lifecycle hooks and delivers validated connection-scoped envelopes to the extension before gameplay. `VoiceChat` stays in `games/fuse-riders/src/online` and owns microphone, playback and voice-status validation; `fuse-network-fe` never imports game code. This preserves the extracted network boundary while sharing the existing connection and bounded control channel.

The established offerer reserves one `sendrecv` audio transceiver before its initial offer. The answerer adopts that transceiver after applying the offer. Joining voice, microphone replacement and leaving use `replaceTrack`; mute/deafen use the capture track's `enabled` property. This avoids routine renegotiation racing gameplay's ICE recovery. Recreated links attach the current capture; stale capture requests and detached sender completions cannot resurrect a microphone after leave. Voice sender errors are shown in voice controls, separate from gameplay status.

The reliable `game` data channel carries a transport-only `{type:"voice",version:1,state:"off"|"muted"|"live"}` message within its existing member-connection-scoped envelope. It is sent when the channel opens and refreshed once per second while the page is visible. It is validated and consumed before the room runtime. Speaking indicators are local audio-level measurements, never game inputs. Muting takes effect immediately at the source; another device's status can lag by a second. Game logs, snapshots, rules version and service signalling payloads are unchanged. Older clients can continue playing, but voice requires updated clients on both ends; a connection initially offered by an older client has no audio slot.

Microphone permission denial leaves listen-only available. Playback rejection exposes **ENABLE VOICE AUDIO** for a fresh user gesture. Device removal marks the microphone muted and offers an explicit retry. Room termination, tab replacement and page exit stop capture and remove remote audio. Voice consent is never saved in local storage.

## Verification

- `node --import tsx --test games/fuse-riders/tests/voice-session.test.ts`: typed capture/sender fakes exercise opt-in, mute/deafen, late permissions, cancellation, out-of-order device selection, missing devices, reconnect attachment and safe sender failures.
- `ONLINE_URL=http://localhost:8787/ node --import tsx scripts/voice-smoke.ts`: Chromium synthetic microphone through real SDP/RTP; bidirectional received audio energy, speaking indicators, mute/deafen, local silence/volume, device switching (including back to System default), injected permission denial, listen-only display, phone panel fit, silence preserved across recreated links, gameplay and terminal microphone cleanup.
- Existing online-room smokes exercise gameplay with audio slots negotiated but voice off, including WebKit.

Synthetic browser audio does not establish physical-phone, Bluetooth routing, acoustic echo, background-call or iOS interruption behavior. Those require device testing before treating voice as fully qualified across mobile devices.
