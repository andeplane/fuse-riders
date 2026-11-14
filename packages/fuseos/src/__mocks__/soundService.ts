import type { SystemSoundEvent } from "../sounds/soundEvents";
import type { SoundPrefsStore } from "../sounds/soundPrefsStore";
import { MemorySoundPrefsStore } from "../sounds/soundPrefsStore";
import type {
  SoundHandle,
  SoundPlayOptions,
  SoundService,
} from "../sounds/soundService";
import { SilentSoundService } from "../sounds/soundService";

export type RecordedPlay = {
  event: SystemSoundEvent;
  options: SoundPlayOptions;
  handle: FakeSoundHandle;
};

export class FakeSoundHandle implements SoundHandle {
  stopped = false;
  private end: () => void = () => undefined;
  readonly finished: Promise<void>;

  constructor(
    readonly event: SystemSoundEvent,
    readonly audible: boolean,
  ) {
    this.finished = new Promise<void>((resolve) => {
      this.end = resolve;
    });
  }

  stop(): void {
    this.stopped = true;
    this.end();
  }

  /** The sound ran to its end. */
  complete(): void {
    this.end();
  }
}

/**
 * A sound service that records what the desktop asks for instead of playing it. `audible`
 * decides what the handles report (the dial-up dialog paces itself by it).
 */
export class FakeSoundService
  extends SilentSoundService
  implements SoundService
{
  readonly plays: RecordedPlay[] = [];
  stopAllCalls = 0;
  /** Whether the browser would let a sound be heard (a gesture has unlocked audio). */
  private readonly audible: boolean;

  constructor(
    options: {
      muted?: boolean;
      audible?: boolean;
      prefs?: SoundPrefsStore;
    } = {},
  ) {
    super(options.muted ?? false, options.prefs ?? new MemorySoundPrefsStore());
    this.audible = options.audible ?? true;
  }

  override play(
    event: SystemSoundEvent,
    options: SoundPlayOptions = {},
  ): SoundHandle {
    const allowed =
      !this.muted &&
      this.prefs().master &&
      (options.force === true || this.isEnabled(event));
    const handle = new FakeSoundHandle(event, allowed && this.audible);
    if (!handle.audible) handle.complete();
    this.plays.push({ event, options, handle });
    return handle;
  }

  override stopAll(): void {
    this.stopAllCalls += 1;
    for (const play of this.plays) play.handle.stop();
  }

  /** The events played so far, in order. */
  get events(): SystemSoundEvent[] {
    return this.plays.map((play) => play.event);
  }
}
