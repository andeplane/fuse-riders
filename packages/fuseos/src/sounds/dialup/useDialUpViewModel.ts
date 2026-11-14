import { useCallback, useContext, useEffect, useRef, useState } from "react";

import type { WindowContent } from "../../state/appState";
import { useWindowCommands } from "../../windows/useWindowCommands";
import type { SoundHandle } from "../soundService";
import type { ModemPhase } from "../synth/modemTimeline";
import { MODEM_PHASES, MODEM_PHONE_NUMBER } from "../synth/modemTimeline";
import { useSoundService } from "../useSystemSound";

import { DialUpDepsContext } from "./dialUpDepsContext";
import { DialUpSessionContext } from "./dialUpSession";

export type DialUpStage = "idle" | "dialing" | "connected";

export type DialUpViewModel = {
  stage: DialUpStage;
  /** The status line while dialing, e.g. "Ringing..."; empty before Connect. */
  status: string;
  /** How far through the handshake, 0..1, for the progress bar. */
  progress: number;
  phoneNumber: string;
  connect: () => void;
  /** Hangs up. The desktop still counts as online afterwards, so the gag never blocks anything. */
  cancel: () => void;
};

/** How long "Connected" shows before the dialog closes and opens what it was gating. */
export const CONNECTED_LINGER_MS = 1200;

/** With no sound to follow (muted or switched off), the status lines run through this fast. */
export const SILENT_PHASE_MS = 350;

/** The phases' moments in milliseconds, spaced for the sound when there is one. */
export function phaseSchedule(
  phases: readonly ModemPhase[],
  audible: boolean,
): { status: string; atMs: number }[] {
  return phases.map((phase, index) => ({
    status: phase.status,
    atMs: audible ? Math.round(phase.at * 1000) : index * SILENT_PHASE_MS,
  }));
}

export function useDialUpViewModel({
  windowId,
  then,
}: {
  windowId: string;
  then?: WindowContent;
}): DialUpViewModel {
  const sounds = useSoundService();
  const session = useContext(DialUpSessionContext);
  const deps = useContext(DialUpDepsContext);
  const commands = useWindowCommands();
  const [stage, setStage] = useState<DialUpStage>("idle");
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState(0);
  const cancels = useRef<(() => void)[]>([]);
  const sound = useRef<SoundHandle | undefined>(undefined);

  const clear = useCallback(() => {
    for (const cancel of cancels.current) cancel();
    cancels.current = [];
    sound.current?.stop();
    sound.current = undefined;
  }, []);

  const finish = useCallback(() => {
    clear();
    session.markConnected();
    commands.close(windowId);
    if (then) commands.open(then);
  }, [clear, commands, session, then, windowId]);

  const connect = useCallback(() => {
    if (stage !== "idle") return;
    setStage("dialing");
    const handle = sounds.play("modem");
    sound.current = handle;
    const schedule = phaseSchedule(MODEM_PHASES, handle.audible);
    for (const [index, phase] of schedule.entries()) {
      const last = index === schedule.length - 1;
      cancels.current.push(
        deps.schedule(() => {
          setStatus(phase.status);
          setProgress(index / Math.max(1, schedule.length - 1));
          if (last) {
            setStage("connected");
            cancels.current.push(deps.schedule(finish, CONNECTED_LINGER_MS));
          }
        }, phase.atMs),
      );
    }
  }, [deps, finish, sounds, stage]);

  // Closing the window from its title bar hangs up too.
  useEffect(() => clear, [clear]);

  return {
    stage,
    status,
    progress,
    phoneNumber: MODEM_PHONE_NUMBER,
    connect,
    cancel: finish,
  };
}
