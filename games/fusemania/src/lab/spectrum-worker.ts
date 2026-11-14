/** Computes the chart lab's spectra off the page's thread: a song takes a few seconds. */
import { computeSpectra } from "./spectrum.js";

export type SpectrumRequest = { samples: Float32Array; rate: number };
export type SpectrumReply =
  | { kind: "progress"; share: number }
  | {
      kind: "done";
      frames: number;
      detail: Float32Array;
      detailBins: number;
      model: Float32Array;
      onset: Float32Array;
    };

/** The worker's own global, typed narrowly: the program's lib is the DOM's, not the worker's. */
interface WorkerScope {
  onmessage: ((event: MessageEvent<SpectrumRequest>) => void) | null;
  postMessage(message: SpectrumReply, transfer?: Transferable[]): void;
}
const scope = self as unknown as WorkerScope;
scope.onmessage = (event: MessageEvent<SpectrumRequest>) => {
  const { samples, rate } = event.data;
  const spectra = computeSpectra(samples, rate, (share) =>
    scope.postMessage({ kind: "progress", share } satisfies SpectrumReply),
  );
  scope.postMessage({ kind: "done", ...spectra } satisfies SpectrumReply, [
    spectra.detail.buffer,
    spectra.model.buffer,
    spectra.onset.buffer,
  ]);
};
