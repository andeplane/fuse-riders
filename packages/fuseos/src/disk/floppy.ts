/**
 * The A: drive. A floppy from 1997 with one backup archive on it and a folder whose name promises
 * more than it delivers; everything here is a joke and strictly safe for work. Nothing is a real
 * file: the archive "extracts" to a Win98 error and the folder holds one deadpan text file.
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

/** The password A:\\porn asks for (any case). Strictly safe for work: all it guards is a rickroll. */
export const PORN_PASSWORD = "mender";
/** How the network password box names the folder: a UNC path, as Windows 98 showed shares. */
export const PORN_RESOURCE = "\\\\A:\\porn";
export const PASSWORD_PROMPT =
  "You must supply a password to make this connection:";
export const PASSWORD_DIALOG_TITLE = "Enter Network Password";
export const PASSWORD_INCORRECT_MESSAGE =
  "The password is incorrect. Access is denied.";
/** Wrong passwords before Clippy offers to help, and again after every this many more. */
export const PASSWORD_HINT_AFTER = 3;
export const CLIPPY_PORN_HELP =
  "It looks like you're trying to get into the porn folder. Would you like help?";

/** The one file behind the password; it opens in the Media Player under its real name. */
export const RICKROLL_NAME = "definitely_not_porn.avi";
export const RICKROLL_LOCATION = `${FLOPPY_JOKE_LOCATION}/${RICKROLL_NAME}`;
export const RICKROLL_TITLE = "Never Gonna Give You Up.avi";
/** Bytes: most of what is left on the floppy. */
export const RICKROLL_SIZE = 212_992;

/** Whether `text` is the folder's password; passwords ignore case, as Windows 98 share passwords did. */
export function isPornPassword(text: string): boolean {
  return text.toLowerCase() === PORN_PASSWORD;
}

/**
 * The password on A:\\porn. One gate per desktop, so a second Explorer window does not lock it again or
 * forget the wrong guesses; a reload does (nothing here is stored).
 */
export interface FloppyJokeGate {
  /** The right password has been given on this desktop. */
  isUnlocked(): boolean;
  /** Checks a password, unlocking on the right one and counting a wrong one. */
  tryPassword(password: string): "granted" | "denied";
  /** Wrong passwords so far. */
  failures(): number;
}

export class MemoryFloppyJokeGate implements FloppyJokeGate {
  private unlocked = false;
  private wrong = 0;

  isUnlocked(): boolean {
    return this.unlocked;
  }

  tryPassword(password: string): "granted" | "denied" {
    if (isPornPassword(password)) {
      this.unlocked = true;
      return "granted";
    }
    this.wrong += 1;
    return "denied";
  }

  failures(): number {
    return this.wrong;
  }
}
