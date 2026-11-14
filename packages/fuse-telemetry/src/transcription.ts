export interface AudioTranscriber {
  transcribe(audio: Uint8Array): Promise<string>;
}
export class TranscriptionFailure extends Error {
  constructor(
    message: string,
    readonly permanent: boolean,
  ) {
    super(message);
  }
}
export interface TranscriptReady {
  recordingId: string;
  gameId: string;
  sequence: number;
  startMs: number;
  endMs: number;
  text: string;
}
export type TranscriptHook = (input: TranscriptReady) => Promise<void>;
export interface FinalizedAudio {
  bucket: string;
  name: string;
  generation: string;
}
