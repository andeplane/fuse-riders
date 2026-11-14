/**
 * The A: drive. A floppy from 1997 with one backup archive on it and a folder whose name promises
 * more than it delivers; everything here is a joke and strictly safe for work. Nothing is a real
 * file: the archive "extracts" to a Win95 error and the folder holds one deadpan text file.
 */

export const FLOPPY_ZIP_NAME = "slackbacup.zip";
/** Bytes; Explorer shows it as 1.35 MB-ish, a full high-density floppy minus the FAT. */
export const FLOPPY_ZIP_SIZE = 1_415_577;
export const FLOPPY_ZIP_MODIFIED = "1997-08-14T03:12:00Z";

export const FLOPPY_JOKE_FOLDER = "porn";
export const FLOPPY_JOKE_FOLDER_MODIFIED = "1997-11-02T23:41:00Z";
export const HOMEWORK_NAME = "homework.txt";
export const HOMEWORK_TEXT = "Nice try. Go play Fuseball.\n";

/** Locations on A: as Explorer and Notepad++ address them. */
export const FLOPPY_ZIP_LOCATION = `A:/${FLOPPY_ZIP_NAME}`;
export const FLOPPY_JOKE_LOCATION = `A:/${FLOPPY_JOKE_FOLDER}`;
export const HOMEWORK_LOCATION = `${FLOPPY_JOKE_LOCATION}/${HOMEWORK_NAME}`;

export const ACCESS_DENIED_MESSAGE =
  "A:\\porn is not accessible.\n\nAccess is denied.";

export const WINZIP_ERROR_MESSAGE =
  "Cannot open file: it does not appear to be a valid archive.\n\nslackbacup.zip is corrupt. Disk in drive A: may be a coaster.";

/** Files WinZip pretends to find in the archive before it gives up; a tour of a 1997 home directory. */
export const WINZIP_FAKE_ENTRIES = [
  "slackware/etc/lilo.conf",
  "slackware/etc/fstab",
  "slackware/home/anders/.bashrc",
  "slackware/home/anders/.xinitrc",
  "slackware/home/anders/doom/doom.wad",
  "slackware/home/anders/mp3/README",
  "slackware/home/anders/quake/id1/pak0.pak",
  "slackware/home/anders/resume.txt",
  "slackware/usr/local/bin/pine",
  "slackware/var/log/messages",
];

/** How far the fake extraction gets, as a fraction, before the archive turns out to be a coaster. */
export const WINZIP_FAILURE_PROGRESS = 0.87;

/**
 * "Access is denied." the first time anyone opens the joke folder; it gives in on the second try.
 * One gate per desktop, so a second Explorer window does not reset it.
 */
export interface FloppyJokeGate {
  /** Records an attempt and says whether this one gets in. */
  tryOpen(): "denied" | "open";
  attempts(): number;
}

export class MemoryFloppyJokeGate implements FloppyJokeGate {
  private count = 0;

  tryOpen(): "denied" | "open" {
    this.count += 1;
    return this.count === 1 ? "denied" : "open";
  }

  attempts(): number {
    return this.count;
  }
}
