# Floppy drive sound sources

Shipped as `packages/fuseos/src/sounds/recordings/floppy-open.mp3` ("floppy", opening A:) and
`floppy-seek.mp3` ("seek", every other Explorer navigation), played by `src/sounds/recordings.ts` through
the system sound service with the Web Audio synthesiser as fallback. Only the MP3 encodes below are committed
(every browser decodes MP3); the OGG commands are kept for reproducibility.

Both clips are cut from one real recording of a PC floppy drive, dedicated to the public domain (CC0 1.0).
Date accessed: 2026-11-14.

## Source recording (used for both clips)

| Field                                 | Value                                                                                                                                                                                              |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sound title                           | floppy drive on old pc                                                                                                                                                                             |
| Author / uploader                     | Verum384 (freesound.org user)                                                                                                                                                                      |
| Source page                           | https://freesound.org/people/Verum384/sounds/536950/                                                                                                                                               |
| Licence                               | Creative Commons 0 (CC0 1.0 Universal, public domain dedication)                                                                                                                                   |
| Licence URL (as linked from the page) | http://creativecommons.org/publicdomain/zero/1.0/                                                                                                                                                  |
| Uploaded                              | September 28th, 2020                                                                                                                                                                               |
| Uploader's description                | "Booting motherboard ASRock P4i45E and reading data from floppy disk"                                                                                                                              |
| Original file on the page             | Wave (.wav), 5:26.663, 96 kHz, 24 bit, stereo, 179.4 MB (download needs a freesound login, so it was not used)                                                                                     |
| File downloaded                       | https://cdn.freesound.org/previews/536/536950_2935955-hq.ogg (freesound's own high-quality preview transcode of the same sound: Ogg Vorbis, stereo, 96 kHz, ~191 kbps, 326.664 s, 7,811,727 bytes) |
| sha256 of download                    | `41fb89b3ee7604e5ad6fdc958fcf3a474007b6d0376334681eda64180adab9b7`                                                                                                                                 |

Licence line as it appears in the sound page's HTML (fetched 2026-11-14, no login):

```
<a title="Go to the full license text" href="http://creativecommons.org/publicdomain/zero/1.0/" target="_blank" ...>Creative Commons 0</a>
```

followed on the page by: "You can copy, modify, distribute and perform the sound, even for commercial purposes, a[ll without asking permission]".

Notes on verification:

- The page HTML lists the preview files `536950_2935955-hq.mp3`, `-lq.mp3` and `-lq.ogg`. The `-hq.ogg` variant that was downloaded is the same preview set on the same CDN path; it is not linked literally in the HTML.
- The page does not state the drive size. The recording shows index ticks every 0.2 s (300 rpm) and a 3 ms step buzz, and the machine is a Pentium 4 board, which is consistent with a 3.5" HD drive, but this is inferred, not stated by the uploader.
- CC0 needs no attribution; crediting "Verum384 (freesound.org)" is optional courtesy.

## Clip 1: floppy-open.ogg / floppy-open.mp3 ("opening drive A:")

Content: motor-on click and first spindle index ticks, then two head seeks and two step buzzes.
It is an edit of two parts of the same continuous take: the 1.9 s of idle spinning between the motor start and the seeks was removed with a 50 ms crossfade.

- Segment A: 137.183 s to 137.753 s (motor switches on at 137.195 s)
- Segment B: 139.670 s to 141.530 s (seeks at 139.727 s and 140.13 s, buzzes at 140.53 s and 140.94 s to 141.43 s)
- Result: 2.38 s, mono, 44.1 kHz, 10 ms fade-in, 100 ms fade-out, peak about -3 dBFS

## Clip 2: floppy-seek.ogg / floppy-seek.mp3 ("navigating a folder")

Content: one head-seek buzz burst.

- Segment: 142.131 s to 142.735 s (buzz starts at 142.143 s)
- Result: 0.60 s, mono, 44.1 kHz, 10 ms fade-in, 100 ms fade-out, peak about -3 dBFS

## Exact commands (ffmpeg 7.1.1)

`$SRC` is the downloaded `536950_2935955-hq.ogg`. All times are seconds from the start of that file.

Shared pre-processing (mono downmix, 44.1 kHz, 100 Hz high-pass against fan rumble, and a gentle downward expander that lowers the PC fan noise by up to 10 dB between drive sounds):

```
PRE="aformat=channel_layouts=mono,aresample=44100,highpass=f=100,agate=threshold=0.07:ratio=4:range=0.316:attack=1:release=150:knee=2:detection=peak"
```

Cut, splice and fade to intermediate WAV:

```
ffmpeg -v error -y -t 143 -i "$SRC" -filter_complex "[0:a]${PRE},asplit[a][b];[a]atrim=start=137.183:end=137.753,asetpts=PTS-STARTPTS[a1];[b]atrim=start=139.670:end=141.530,asetpts=PTS-STARTPTS[b1];[a1][b1]acrossfade=d=0.05:c1=qsin:c2=qsin,afade=t=in:st=0:d=0.010,afade=t=out:st=2.280:d=0.100[o]" -map "[o]" -c:a pcm_s24le open-pre.wav

ffmpeg -v error -y -t 143 -i "$SRC" -af "${PRE},atrim=start=142.131:end=142.735,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.010,afade=t=out:st=0.504:d=0.100" -c:a pcm_s24le seek-pre.wav
```

Peak measured with `ffmpeg -i X-pre.wav -af volumedetect -f null -`: open -11.3 dB, seek -12.4 dB, so the gains to reach -3 dBFS are +8.3 dB and +9.4 dB.

Encode:

```
ffmpeg -v error -y -i open-pre.wav -af "volume=8.3dB" -ac 1 -ar 44100 -map_metadata -1 -c:a libvorbis -q:a 4 floppy-open.ogg
ffmpeg -v error -y -i open-pre.wav -af "volume=8.3dB" -ac 1 -ar 44100 -map_metadata -1 -id3v2_version 0 -c:a libmp3lame -b:a 96k floppy-open.mp3
ffmpeg -v error -y -i seek-pre.wav -af "volume=9.4dB" -ac 1 -ar 44100 -map_metadata -1 -c:a libvorbis -q:a 4 floppy-seek.ogg
ffmpeg -v error -y -i seek-pre.wav -af "volume=9.4dB" -ac 1 -ar 44100 -map_metadata -1 -id3v2_version 0 -c:a libmp3lame -b:a 96k floppy-seek.mp3
```

## Output files (measured with ffprobe / volumedetect)

| File            | Codec       | Duration | Channels | Sample rate | Size         | Peak      |
| --------------- | ----------- | -------- | -------- | ----------- | ------------ | --------- |
| floppy-open.ogg | Vorbis q4   | 2.377 s  | 1        | 44100 Hz    | 26,083 bytes | -2.9 dBFS |
| floppy-open.mp3 | MP3 96 kbps | 2.403 s  | 1        | 44100 Hz    | 29,152 bytes | -3.5 dBFS |
| floppy-seek.ogg | Vorbis q4   | 0.608 s  | 1        | 44100 Hz    | 9,520 bytes  | -3.5 dBFS |
| floppy-seek.mp3 | MP3 96 kbps | 0.653 s  | 1        | 44100 Hz    | 8,150 bytes  | -3.3 dBFS |

The MP3 durations include the encoder's frame padding; players that ignore the LAME gapless header add about 25 to 50 ms of silence at the start, so prefer the OGG where it is supported.

## Other CC0 recordings checked and not used

All were verified the same way (licence line on the sound's own page) and are CC0 / public domain dedication.

| Recording                                              | Page                                                                                                                                                                                                               | Author       | Why not used                                                                                               | sha256 of download                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Floppy drive sounds.ogg (3.5" drive during a format)   | https://commons.wikimedia.org/wiki/File:Floppy_drive_sounds.ogg (file: https://upload.wikimedia.org/wikipedia/commons/d/db/Floppy_drive_sounds.ogg), "Creative Commons CC0 1.0 Universal Public Domain Dedication" | AlepouTheFox | Loud step buzzes, but the recording starts mid-sound with no motor start and has a high constant noise bed | `dd49266f86c0e7e5abf3e50f9847fc61964094ae5a3511c172ed9024d2822b76` |
| reading_floppy_disc_1.wav / _2 / _3                    | https://freesound.org/people/KRAFTWERK2K1/sounds/39699/ , /39700/ , /39701/                                                                                                                                        | KRAFTWERK2K1 | Only single head steps, no motor start or buzz; 15.7 kHz monitor whine                                     | `acd48396...` / `6fef36ab...` / `cd89c8e2...`                      |
| USB diskette drive                                     | https://freesound.org/people/607freesound/sounds/550461/                                                                                                                                                           | 607freesound | Constant loud motor noise, seeks barely stand out                                                          | `93864563...`                                                      |
| 20140407 kijjaz - Floppy Disk Read Write Eject 01.flac | https://freesound.org/people/kijjaz/sounds/232546/                                                                                                                                                                 | kijjaz       | Piezo contact pickup: clean motor start, but the hum dominates and seeks are faint                         | `1be21825...`                                                      |
