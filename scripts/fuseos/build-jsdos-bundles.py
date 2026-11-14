#!/usr/bin/env python3
"""Builds the js-dos bundles for the shareware DOS games in Programs > Games.

A .jsdos bundle is a zip with the game files at the root plus
`.jsdos/dosbox.conf`, whose [autoexec] section starts the game
(https://js-dos.com/jsdos-bundle.html). The shareware archives are downloaded
from the Internet Archive into scripts/.shareware (git ignored) unless they
are already there; pass --source to use another folder.

The script is idempotent: the bundles are written with fixed timestamps so a
rerun produces byte-identical files. It also extracts each game's own licence
or vendor text into docs/games/licenses (App Hosting rejects .DOC/.DIZ uploads, so they stay out of public/).

Usage: python3 scripts/build-jsdos-bundles.py [--source DIR]
"""

from __future__ import annotations

import argparse
import io
import sys
import urllib.request
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GAMES_DIR = ROOT / 'public' / 'games'
LICENSES_DIR = GAMES_DIR.parent.parent / 'docs' / 'games' / 'licenses'
DEFAULT_SOURCE = ROOT / 'scripts' / '.shareware'

# Fixed so rebuilding never changes the committed bundles.
STAMP = (1998, 6, 25, 12, 34, 0)

DOSBOX_CONF = """[sdl]
autolock=true
fullscreen=false
output=surface
sensitivity=100
usescancodes=true

[dosbox]
machine=svga_s3
memsize=16

[cpu]
core=auto
cputype=auto
cycles=auto

[mixer]
nosound=false
rate=44100
blocksize=1024
prebuffer=20

[render]
frameskip=0
aspect=false
scaler=none

[midi]
mpu401=intelligent
mididevice=default

[sblaster]
sbtype=sb16
sbbase=220
irq=7
dma=1
hdma=5
sbmixer=true
oplmode=auto
oplemu=default
oplrate=44100

[dos]
xms=true
ems=true
umb=true

[autoexec]
@echo off
mount c .
c:
{command}
"""


@dataclass
class Game:
    bundle: str
    archive: str
    url: str
    command: str
    # Members of the archive that are not game files.
    skip: tuple[str, ...] = ()
    # A self extracting archive inside the archive whose contents are the game.
    inner_archive: str | None = None
    # (archive member, name in docs/games/licenses)
    licenses: list[tuple[str, str]] = field(default_factory=list)
    # Files generated into the bundle next to the game (name, content).
    extra: dict[str, str] = field(default_factory=dict)

# Duke Nukem 3D refuses to start without the file SETUP.EXE writes, so the bundle
# carries the v1.3d defaults: 320x200, Sound Blaster (DOSBox's BLASTER T6 at 220/7/1/5),
# Adlib music, the stock keyboard layout, keyboard and mouse.
DUKE3D_CFG = """[Setup]
SetupVersion = "1.3D"

[Screen Setup]
ScreenMode = 2
ScreenWidth = 320
ScreenHeight = 200
ScreenGamma = 0
Shadows = 1
Password = ""
Detail = 1
Tilt = 1
Messages = 1
Out = 0
Executions = 0
RunMode = 0
Crosshair = 1
FullScreen = 1

[Sound Setup]
FXDevice = 0
MusicDevice = 3
FXVolume = 220
MusicVolume = 200
NumVoices = 8
NumChannels = 2
NumBits = 16
MixRate = 22050
MidiPort = 0x330
BlasterAddress = 0x220
BlasterType = 6
BlasterInterrupt = 7
BlasterDma8 = 1
BlasterDma16 = 5
BlasterEmu = 0x620
ReverseStereo = 0
SoundToggle = 1
VoiceToggle = 1
AmbienceToggle = 1
MusicToggle = 1

[KeyDefinitions]
Move_Forward = "Up" "Kpad8"
Move_Backward = "Down" "Kpad2"
Turn_Left = "Left" "Kpad4"
Turn_Right = "Right" "KPad6"
Strafe = "LAlt" "RAlt"
Fire = "LCtrl" "RCtrl"
Open = "Space" ""
Run = "LShift" "RShift"
AutoRun = "CapLck" ""
Jump = "A" "/"
Crouch = "Z" ""
Look_Up = "PgUp" "Kpad9"
Look_Down = "PgDn" "Kpad3"
Look_Left = "Insert" "Kpad0"
Look_Right = "Delete" "Kpad."
Strafe_Left = "," ""
Strafe_Right = "." ""
Aim_Up = "Home" "KPad7"
Aim_Down = "End" "Kpad1"
Weapon_1 = "1" ""
Weapon_2 = "2" ""
Weapon_3 = "3" ""
Weapon_4 = "4" ""
Weapon_5 = "5" ""
Weapon_6 = "6" ""
Weapon_7 = "7" ""
Weapon_8 = "8" ""
Weapon_9 = "9" ""
Weapon_10 = "0" ""
Inventory = "Enter" "KpdEnt"
Inventory_Left = "[" ""
Inventory_Right = "]" ""
Holo_Duke = "H" ""
Jetpack = "J" ""
NightVision = "N" ""
MedKit = "M" ""
TurnAround = "BakSpc" ""
SendMessage = "T" ""
Map = "Tab" ""
Shrink_Screen = "-" "Kpad-"
Enlarge_Screen = "=" "Kpad+"
Center_View = "KPad5" ""
Holster_Weapon = "ScrLck" ""
Show_Opponents_Weapon = "W" ""
Map_Follow_Mode = "F" ""
See_Coop_View = "K" ""
Mouse_Aiming = "U" ""
Toggle_Crosshair = "I" ""
Steroids = "R" ""
Quick_Kick = "`" ""
Next_Weapon = "'" ""
Previous_Weapon = ";" ""

[Controls]
ControllerType = 1
MouseAimingFlipped = 0
MouseButton0 = "Fire"
MouseButtonClicked0 = ""
MouseButton1 = "Strafe"
MouseButtonClicked1 = "Open"
MouseButton2 = "Move_Forward"
MouseButtonClicked2 = ""
MouseAnalogAxes0 = "analog_turning"
MouseDigitalAxes0_0 = ""
MouseDigitalAxes0_1 = ""
MouseAnalogScale0 = 65536
MouseAnalogAxes1 = "analog_moving"
MouseDigitalAxes1_0 = ""
MouseDigitalAxes1_1 = ""
MouseAnalogScale1 = 65536

[Communication Setup]
ComPort = 2
IrqNumber = 0x0
UartAddress = 0x0
PortSpeed = 9600
ToneDial = 1
SocketNumber = 0x0
NumberPlayers = 2
ModemName = ""
InitString = "ATZ"
HangupString = "ATH0=0"
DialoutString = ""
PlayerName = "DUKE"
RTSName = "DUKE.RTS"
RTSPath = ".\\\\"
UserPath = ".\\\\"
PhoneNumber = ""
CommbatMacro#0 = "An inspiration for birth control."
CommbatMacro#1 = "You're gonna die for that!"
CommbatMacro#2 = "It hurts to be you."
CommbatMacro#3 = "Lucky Son of a Bitch."
CommbatMacro#4 = "Hmmm....Payback time."
CommbatMacro#5 = "You bottom dwelling scum sucker."
CommbatMacro#6 = "Damn, you're ugly."
CommbatMacro#7 = "Ha ha ha...Wasted!"
CommbatMacro#8 = "You suck!"
CommbatMacro#9 = "AARRRGHHHHH!!!"
PhoneName#0 = ""
PhoneNumber#0 = ""
"""


GAMES = [
    Game(
        bundle='doom',
        archive='DoomV1.9sw1995idSoftwareInc.action.zip',
        url='https://archive.org/download/DoomsharewareEpisode/DoomV1.9sw1995idSoftwareInc.action.zip',
        command='DOOM.EXE',
        licenses=[('README.TXT', 'DOOM-README.TXT')],
    ),
    Game(
        bundle='wolf3d',
        archive='Wolfenstein3dV14sw.ZIP',
        url='https://archive.org/download/Wolfenstein3d/Wolfenstein3dV14sw.ZIP',
        command='WOLF3D.EXE',
        licenses=[('file_id.diz', 'WOLF3D-FILE_ID.DIZ')],
    ),
    Game(
        bundle='keen1',
        archive='Commander_Keen_1_-_Marooned_on_Mars_1990.zip',
        url='https://archive.org/download/msdos_Commander_Keen_1_-_Marooned_on_Mars_1990/Commander_Keen_1_-_Marooned_on_Mars_1990.zip',
        command='KEEN1.EXE',
        skip=('Depot.jpg',),
        licenses=[('VENDOR.DOC', 'KEEN1-VENDOR.DOC')],
    ),
    Game(
        bundle='duke3d',
        archive='3dduke13SW.zip',
        url='https://archive.org/download/3dduke13SW/Files/v1.3d%20(1998%20Repack)/3dduke13SW.zip',
        command='DUKE3D.EXE',
        inner_archive='DN3DSW13.SHR',
        licenses=[('LICENSE.TXT', 'DUKE3D-LICENSE.TXT')],
        extra={'DUKE3D.CFG': DUKE3D_CFG},
    ),
]


def fetch(url: str, target: Path) -> None:
    print(f'Downloading {url}')
    target.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(url) as response:
        target.write_bytes(response.read())


def game_files(game: Game, archive: zipfile.ZipFile) -> dict[str, bytes]:
    """Game files keyed by their DOS name at the root of the bundle."""
    files: dict[str, bytes] = {}
    for info in archive.infolist():
        if info.is_dir():
            continue
        name = Path(info.filename).name
        if name in game.skip or name.endswith('.ba1') or name == game.inner_archive:
            continue
        files[name] = archive.read(info)
    if game.inner_archive:
        inner = zipfile.ZipFile(io.BytesIO(archive.read(game.inner_archive)))
        for info in inner.infolist():
            if not info.is_dir():
                files[Path(info.filename).name] = inner.read(info)
        files.pop('INSTALL.EXE', None)
    return files


def write_bundle(target: Path, files: dict[str, bytes], command: str) -> None:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as bundle:
        entries = dict(sorted(files.items()))
        entries['.jsdos/dosbox.conf'] = DOSBOX_CONF.format(command=command).encode('ascii')
        for name, data in entries.items():
            info = zipfile.ZipInfo(name, date_time=STAMP)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            bundle.writestr(info, data)
    target.write_bytes(buffer.getvalue())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--source', type=Path, default=DEFAULT_SOURCE, help='folder with the shareware archives')
    args = parser.parse_args()

    GAMES_DIR.mkdir(parents=True, exist_ok=True)
    LICENSES_DIR.mkdir(parents=True, exist_ok=True)
    for game in GAMES:
        archive_path = args.source / game.archive
        if not archive_path.exists():
            fetch(game.url, archive_path)
        with zipfile.ZipFile(archive_path) as archive:
            files = game_files(game, archive)
            if not any(name.upper() == game.command for name in files):
                print(f'{game.archive}: {game.command} not found', file=sys.stderr)
                return 1
            for member, target_name in game.licenses:
                text = next((data for name, data in files.items() if name.upper() == member.upper()), None)
                if text is None:
                    text = archive.read(member)
                (LICENSES_DIR / target_name).write_bytes(text)
        # Named .jsdos.wasm: App Hosting rejects .jsdos and .zip uploads but accepts .wasm,
        # and js-dos never looks at the extension, only at the bytes.
        target = GAMES_DIR / f'{game.bundle}.jsdos.wasm'
        for name, content in game.extra.items():
            files[name] = content.replace('\n', '\r\n').encode('ascii')
        write_bundle(target, files, game.command)
        print(f'{target.relative_to(ROOT)}: {len(files)} files, {target.stat().st_size // 1024} KB')
    return 0


if __name__ == '__main__':
    sys.exit(main())
