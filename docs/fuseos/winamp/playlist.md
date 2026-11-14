# 90s Playlist

The playlist uses YouTube's official visible IFrame player. It does not copy
music, extract audio, or create a playlist in a user's YouTube account. The
artist/label uploads below were checked using YouTube's public oEmbed endpoint.
An oEmbed response confirms the video's identity and provides an embed; it does
not guarantee playback for every country, browser, account, or future date.

| Artist          | Song                  | Official upload                             |
| --------------- | --------------------- | ------------------------------------------- |
| Cher            | Believe               | https://www.youtube.com/watch?v=nZXRV4MezEw |
| Britney Spears  | ...Baby One More Time | https://www.youtube.com/watch?v=C-u5WLJ9Yk4 |
| Eiffel 65       | Blue (Da Ba Dee)      | https://www.youtube.com/watch?v=68ugkg9RePc |
| Backstreet Boys | I Want It That Way    | https://www.youtube.com/watch?v=4fndeDfaWCg |
| Aqua            | Barbie Girl           | https://www.youtube.com/watch?v=ZyhrYis509A |
| Daft Punk       | Around the World      | https://www.youtube.com/watch?v=K0HSD_i2DvA |

The visible player is 480×270, YouTube's recommended minimum 16:9 size. Its own
controls and branding remain available. Initial loading cues the playlist without
autoplay. The app's Play, Pause, Stop, Previous, Next, and song double-clicks use
the IFrame API; playback status comes from actual player events. A browser can
still require the person to press Play inside the video. The status bar explains
that blocked state without claiming audio is playing.

The loader and player each have a bounded readiness wait, and the window offers
Retry and Open on YouTube for blocked scripts, owner restrictions, unavailable
videos, and missing referrer identification. Closing/minimizing disposes the
player, and hiding the page pauses playback. No CDF token, project data, or file
download URL is sent to YouTube; the player's origin is the app origin only.

References:

- [YouTube IFrame API](https://developers.google.com/youtube/iframe_api_reference)
- [Player parameters](https://developers.google.com/youtube/player_parameters)
- [Developer policies, additional prohibitions](https://developers.google.com/youtube/terms/developer-policies#i-additional-prohibitions)

The policy excludes an intentionally hidden/background player and separating the
audio from the video. The UI therefore keeps the video unobscured inside Winamp’s
video mode rather than using YouTube as an audio-only source for Webamp.

## Native Winamp transport

Webamp is pinned to 2.3.1 because its typed `__customMediaClass` extension is marked private. The adapter implements its media contract and routes native playlist selection, Play/Pause/Stop, volume and seek to the official visible YouTube player. Static track metadata prevents Webamp from fetching YouTube watch pages as audio. EQ and spectrum cannot process cross-origin video audio and are explicitly unavailable. The paused local/CDF skin is detached from the DOM while the YouTube-backed skin is mounted, avoiding duplicate `#webamp` IDs; global hotkeys are disabled in both instances.
