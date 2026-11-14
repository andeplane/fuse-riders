# Floppy drive recording

The two floppy sounds FuseOS plays (`packages/fuseos/src/assets/sounds/floppy-open.mp3` when Explorer opens
A:, `floppy-seek.mp3` when it opens any other folder) are cut from one recording of a real PC floppy drive that
its author dedicated to the public domain.

| Field                 | Value                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------- |
| Sound                 | "floppy drive on old pc"                                                               |
| Author                | Verum384 (freesound.org)                                                               |
| Source page           | https://freesound.org/people/Verum384/sounds/536950/                                   |
| Licence               | Creative Commons 0 (CC0 1.0 Universal, public domain dedication)                       |
| Licence text          | https://creativecommons.org/publicdomain/zero/1.0/                                     |
| Uploader's note       | "Booting motherboard ASRock P4i45E and reading data from floppy disk"                  |
| File used             | https://cdn.freesound.org/previews/536/536950_2935955-hq.ogg (freesound's HQ preview)  |
| sha256 of that file   | `41fb89b3ee7604e5ad6fdc958fcf3a474007b6d0376334681eda64180adab9b7`                     |
| Accessed and verified | 2026-11-14: the sound's page links one licence, "Creative Commons 0", to the URL above |

CC0 asks for no attribution; the credit here is a courtesy and a record of where the bytes came from. The
original upload is a 96 kHz WAV behind a freesound login, so the site's own preview transcode of the same sound
was used. The page does not state the drive's size; the 300 rpm index ticks and the 3 ms step buzz are those of
a 3½" drive. Nothing was taken from any video site.

## The two clips

Both are mono, 44.1 kHz, MP3 at 96 kbit/s, high-passed at 100 Hz with the PC's fan lowered between drive
sounds, faded in over 10 ms and out over 100 ms, and normalised to about -3 dBFS.

| File              | Length | Size     | sha256                                                             | Cut from the source (seconds)                                        |
| ----------------- | ------ | -------- | ------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `floppy-open.mp3` | 2.40 s | 29,152 B | `bc72926e207c7662324b101913b99a87f07cebdec7a1edb5ffd30b5abe299bb0` | 137.183–137.753 (motor on) joined to 139.670–141.530 (seeks, buzzes) |
| `floppy-seek.mp3` | 0.65 s | 8,150 B  | `585fe466d3c334e377dacc99c8ef6e8a7884d5ebcfc24041e8c3e942ecab6924` | 142.131–142.735 (one step buzz)                                      |

The open clip is an edit: 1.9 s of idle spinning between the motor starting and the first seek was removed with
a 50 ms crossfade. The commands, with ffmpeg 7.1.1 and `$SRC` the file above:

```sh
PRE="aformat=channel_layouts=mono,aresample=44100,highpass=f=100,agate=threshold=0.07:ratio=4:range=0.316:attack=1:release=150:knee=2:detection=peak"
ffmpeg -t 143 -i "$SRC" -filter_complex "[0:a]${PRE},asplit[a][b];[a]atrim=start=137.183:end=137.753,asetpts=PTS-STARTPTS[a1];[b]atrim=start=139.670:end=141.530,asetpts=PTS-STARTPTS[b1];[a1][b1]acrossfade=d=0.05:c1=qsin:c2=qsin,afade=t=in:st=0:d=0.010,afade=t=out:st=2.280:d=0.100[o]" -map "[o]" -c:a pcm_s24le open-pre.wav
ffmpeg -t 143 -i "$SRC" -af "${PRE},atrim=start=142.131:end=142.735,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.010,afade=t=out:st=0.504:d=0.100" -c:a pcm_s24le seek-pre.wav
ffmpeg -i open-pre.wav -af "volume=8.3dB" -ac 1 -ar 44100 -map_metadata -1 -id3v2_version 0 -c:a libmp3lame -b:a 96k floppy-open.mp3
ffmpeg -i seek-pre.wav -af "volume=9.4dB" -ac 1 -ar 44100 -map_metadata -1 -id3v2_version 0 -c:a libmp3lame -b:a 96k floppy-seek.mp3
```
