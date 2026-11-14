/** Every sound the desktop can make. The Sounds applet lists these; `playSystemSound(event)` plays one. */
export type SystemSoundEvent =
  | "startup"
  | "shutdown"
  | "ding"
  | "error"
  | "recycle"
  | "floppy"
  | "seek"
  | "modem";

export type SoundEventInfo = {
  event: SystemSoundEvent;
  /** The applet's caption, e.g. "Start Windows". */
  label: string;
  /** One line under the caption. */
  description: string;
  /** Playback gain relative to the other sounds, 0..1. */
  gain: number;
  /**
   * Browsers refuse audio before the first click or key press. A sound marked here is held
   * until then (the start-up chime plays on the first gesture); any other is simply dropped.
   */
  deferUntilUnlocked?: boolean;
  /** Where the trigger lives or should live; the integrator's checklist (docs/fuseos/README-sounds.md). */
  trigger: string;
};

export const SOUND_EVENTS: readonly SoundEventInfo[] = [
  {
    event: "startup",
    label: "Start FuseOS",
    description: "The chime when the desktop appears",
    gain: 0.8,
    deferUntilUnlocked: true,
    trigger:
      "SystemSoundTriggers in Shell: desktop mount and wake-up after shut down",
  },
  {
    event: "shutdown",
    label: "Exit FuseOS",
    description: "The chime before it is safe to turn off your computer",
    gain: 0.8,
    trigger: "SystemSoundTriggers in Shell: Start > Shut Down",
  },
  {
    event: "ding",
    label: "Default sound",
    description: "Information message boxes",
    gain: 0.7,
    trigger: "windows/MessageBox.tsx on mount with the info icon",
  },
  {
    event: "error",
    label: "Critical stop",
    description: "Error message boxes",
    gain: 0.7,
    trigger: "windows/MessageBox.tsx on mount with the warning icon",
  },
  {
    event: "recycle",
    label: "Empty Recycle Bin",
    description: "Paper crumpling as the bin empties",
    gain: 0.8,
    trigger: "Recycle Bin (D2): Empty Recycle Bin and deleting a file",
  },
  {
    event: "floppy",
    label: "Floppy drive",
    description: 'The 3½" drive spinning up and seeking when Explorer opens A:',
    gain: 0.9,
    trigger:
      "explorer/useExplorerViewModel.ts: entering 3½ Floppy (A:), before its delay",
  },
  {
    event: "seek",
    label: "Open folder",
    description: "One short head seek when Explorer opens a folder or drive",
    gain: 0.7,
    trigger: "explorer/useExplorerViewModel.ts: every other navigation",
  },
  {
    event: "modem",
    label: "Dial-up modem",
    description:
      "The handshake, first time Network Neighborhood or Friends opens",
    gain: 0.75,
    trigger:
      "sounds/dialup withDialUp(): Network Neighborhood (D4) and Friends (D5) the first time per session; Start > Programs > Accessories > Dial-Up Networking",
  },
];

export const SYSTEM_SOUND_EVENTS: readonly SystemSoundEvent[] =
  SOUND_EVENTS.map((info) => info.event);

export function isSystemSoundEvent(value: unknown): value is SystemSoundEvent {
  return (
    typeof value === "string" &&
    SYSTEM_SOUND_EVENTS.includes(value as SystemSoundEvent)
  );
}

export function soundEventInfo(event: SystemSoundEvent): SoundEventInfo {
  const info = SOUND_EVENTS.find((entry) => entry.event === event);
  if (!info) throw new Error(`Unknown system sound: ${event}`);
  return info;
}
