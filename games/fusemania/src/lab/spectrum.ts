/**
 * The chart lab's picture of the audio: pure DSP on mono samples, no browser APIs, so a worker and the tests share it.
 *
 * Two views, both at ChartNet's frame rate (100 frames a second, `features.py`):
 * - **detail**: a constant-Q (wavelet-like) spectrogram, 24 bins an octave from C1 to 11 kHz. Each bin is read from the
 *   shortest FFT window that still resolves it, so the bass gets long windows and the bright melody short, sharp ones,
 *   which is what a wavelet transform does.
 * - **model**: the 64 log-mel bands at a 2048 window that ChartNet's placement model reads (an approximation of
 *   librosa's Slaney mel; good for seeing what the model can and cannot tell apart).
 *
 * Plus the onset strength the model also sees, and band flux: the onsets inside one frequency band, the feature a
 * reviewer's band selection would add.
 */

export const LAB_RATE = 22050;
export const FRAMES_PER_SECOND = 100;
export const HOP = LAB_RATE / FRAMES_PER_SECOND;
export const DETAIL_MIN_HZ = 32.7;
export const DETAIL_MAX_HZ = 11000;
export const BINS_PER_OCTAVE = 24;
export const MEL_BANDS = 64;
export const MEL_MIN_HZ = 27.5;
export const MEL_MAX_HZ = 11000;
const WINDOWS = [512, 1024, 2048, 4096] as const;
const MODEL_WINDOW = 2048;

export interface Spectra {
  frames: number;
  /** `frames × detailBins` decibels, row-major by frame. */
  detail: Float32Array;
  detailBins: number;
  /** `frames × MEL_BANDS` natural-log mel power, as ChartNet's features. */
  model: Float32Array;
  /** Mean positive change of the mel bands in decibels, per frame. */
  onset: Float32Array;
}

/** Centre frequency of detail bin `bin`. */
export const detailHz = (bin: number): number =>
  DETAIL_MIN_HZ * 2 ** (bin / BINS_PER_OCTAVE);
/** The detail bin (fractional) at `hz`. */
export const detailBinAt = (hz: number): number =>
  Math.log2(hz / DETAIL_MIN_HZ) * BINS_PER_OCTAVE;
export const DETAIL_BINS = Math.floor(detailBinAt(DETAIL_MAX_HZ)) + 1;

const hzToMel = (hz: number): number => {
  // Slaney: linear below 1 kHz, logarithmic above.
  const f = hz / (200 / 3);
  return hz < 1000 ? f : 15 + Math.log(hz / 1000) / (Math.log(6.4) / 27);
};
const melToHz = (mel: number): number =>
  mel < 15
    ? mel * (200 / 3)
    : 1000 * Math.exp((Math.log(6.4) / 27) * (mel - 15));

/** The mel band (fractional; 0 is the lowest band's centre) at `hz`. */
export function melBandAt(hz: number): number {
  const low = hzToMel(MEL_MIN_HZ);
  const high = hzToMel(MEL_MAX_HZ);
  return (
    ((hzToMel(Math.max(1, hz)) - low) / (high - low)) * (MEL_BANDS + 1) - 1
  );
}
/** The frequency at fractional mel band `band`; the inverse of `melBandAt`. */
export function melBandHz(band: number): number {
  const low = hzToMel(MEL_MIN_HZ);
  const high = hzToMel(MEL_MAX_HZ);
  return melToHz(low + ((high - low) * (band + 1)) / (MEL_BANDS + 1));
}

/** Centre frequency of each mel band, low to high. */
export function melCentres(): number[] {
  const low = hzToMel(MEL_MIN_HZ);
  const high = hzToMel(MEL_MAX_HZ);
  return Array.from({ length: MEL_BANDS }, (_, band) =>
    melToHz(low + ((high - low) * (band + 1)) / (MEL_BANDS + 1)),
  );
}

/** An in-place radix-2 complex FFT of one size. */
export class Fft {
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;
  private readonly reversed: Uint32Array;
  constructor(readonly size: number) {
    if (size < 2 || (size & (size - 1)) !== 0)
      throw new Error(`FFT size must be a power of two, not ${size}`);
    this.cos = new Float64Array(size / 2);
    this.sin = new Float64Array(size / 2);
    for (let i = 0; i < size / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / size);
      this.sin[i] = -Math.sin((2 * Math.PI * i) / size);
    }
    this.reversed = new Uint32Array(size);
    const bits = Math.log2(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.reversed[i] = r;
    }
  }
  transform(re: Float64Array, im: Float64Array): void {
    const n = this.size;
    for (let i = 0; i < n; i++) {
      const j = this.reversed[i]!;
      if (j > i) {
        const tr = re[i]!;
        re[i] = re[j]!;
        re[j] = tr;
        const ti = im[i]!;
        im[i] = im[j]!;
        im[j] = ti;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const step = n / len;
      for (let start = 0; start < n; start += len) {
        for (let k = 0; k < half; k++) {
          const wr = this.cos[k * step]!;
          const wi = this.sin[k * step]!;
          const a = start + k;
          const b = a + half;
          const xr = re[b]! * wr - im[b]! * wi;
          const xi = re[b]! * wi + im[b]! * wr;
          re[b] = re[a]! - xr;
          im[b] = im[a]! - xi;
          re[a] = re[a]! + xr;
          im[a] = im[a]! + xi;
        }
      }
    }
  }
}

/** Power spectra of hann-windowed frames centred on every hop, for one window size. */
class Stft {
  private readonly fft: Fft;
  private readonly window: Float64Array;
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  readonly power: Float64Array;
  constructor(readonly size: number) {
    this.fft = new Fft(size);
    this.window = new Float64Array(size);
    for (let i = 0; i < size; i++)
      this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
    this.re = new Float64Array(size);
    this.im = new Float64Array(size);
    this.power = new Float64Array(size / 2 + 1);
  }
  /** Fills `power` for the frame centred on sample `centre` (zeros past either end). */
  frame(samples: Float32Array, centre: number): void {
    const start = centre - this.size / 2;
    for (let i = 0; i < this.size; i++) {
      const at = start + i;
      this.re[i] =
        at >= 0 && at < samples.length ? samples[at]! * this.window[i]! : 0;
      this.im[i] = 0;
    }
    this.fft.transform(this.re, this.im);
    for (let k = 0; k <= this.size / 2; k++)
      this.power[k] = this.re[k]! ** 2 + this.im[k]! ** 2;
  }
}

/** How each detail bin reads its power: from which window, over which FFT bins (or interpolated at one). */
interface BinPlan {
  window: number;
  low: number;
  high: number;
  /** When the bin is narrower than one FFT bin: interpolate at this fractional FFT bin. */
  at: number;
}

function detailPlan(rate: number): BinPlan[] {
  const width = 2 ** (1 / (2 * BINS_PER_OCTAVE));
  return Array.from({ length: DETAIL_BINS }, (_, bin) => {
    const hz = detailHz(bin);
    // The shortest window whose FFT bins are no wider than about one and a half detail bins.
    const need = rate / (hz * (width * width - 1) * 1.5);
    const window =
      WINDOWS.find((n) => n >= need) ?? WINDOWS[WINDOWS.length - 1]!;
    const perBin = rate / window;
    return {
      window,
      low: Math.ceil(hz / width / perBin),
      high: Math.floor((hz * width) / perBin),
      at: hz / perBin,
    };
  });
}

/** Triangular Slaney-normalised mel filters over a `size`-point FFT: `[band][fftBin]` weights, sparse by range. */
function melFilters(
  rate: number,
  size: number,
): { from: number; weights: Float64Array }[] {
  const low = hzToMel(MEL_MIN_HZ);
  const high = hzToMel(MEL_MAX_HZ);
  const edges = Array.from({ length: MEL_BANDS + 2 }, (_, i) =>
    melToHz(low + ((high - low) * i) / (MEL_BANDS + 1)),
  );
  const perBin = rate / size;
  return Array.from({ length: MEL_BANDS }, (_, band) => {
    const [left, centre, right] = [
      edges[band]!,
      edges[band + 1]!,
      edges[band + 2]!,
    ];
    const from = Math.ceil(left / perBin);
    const to = Math.min(size / 2, Math.floor(right / perBin));
    const norm = 2 / (right - left);
    const weights = new Float64Array(Math.max(0, to - from + 1));
    for (let k = from; k <= to; k++) {
      const hz = k * perBin;
      const w =
        hz <= centre
          ? (hz - left) / (centre - left)
          : (right - hz) / (right - centre);
      weights[k - from] = Math.max(0, w) * norm;
    }
    return { from, weights };
  });
}

/**
 * Both views of `samples` (mono at `rate`, normally `LAB_RATE`). `progress` hears the share done now and then, for a
 * long song in a worker.
 */
export function computeSpectra(
  samples: Float32Array,
  rate: number = LAB_RATE,
  progress?: (share: number) => void,
): Spectra {
  const hop = rate / FRAMES_PER_SECOND;
  const frames = Math.max(1, Math.floor(samples.length / hop) + 1);
  const stfts = new Map<number, Stft>(WINDOWS.map((n) => [n, new Stft(n)]));
  const plan = detailPlan(rate);
  const filters = melFilters(rate, MODEL_WINDOW);
  const detail = new Float32Array(frames * DETAIL_BINS);
  const model = new Float32Array(frames * MEL_BANDS);
  const onset = new Float32Array(frames);
  const melDb = new Float64Array(MEL_BANDS);
  const lastDb = new Float64Array(MEL_BANDS);
  for (let frame = 0; frame < frames; frame++) {
    const centre = Math.round(frame * hop);
    for (const stft of stfts.values()) stft.frame(samples, centre);
    for (let bin = 0; bin < DETAIL_BINS; bin++) {
      const { window, low, high, at } = plan[bin]!;
      const power = stfts.get(window)!.power;
      let value: number;
      if (high >= low) {
        let sum = 0;
        for (let k = low; k <= high; k++) sum += power[k]!;
        value = sum / (high - low + 1);
      } else {
        const k = Math.min(power.length - 2, Math.floor(at));
        const f = at - k;
        value = power[k]! * (1 - f) + power[k + 1]! * f;
      }
      detail[frame * DETAIL_BINS + bin] = 10 * Math.log10(value + 1e-10);
    }
    const power = stfts.get(MODEL_WINDOW)!.power;
    let flux = 0;
    for (let band = 0; band < MEL_BANDS; band++) {
      const { from, weights } = filters[band]!;
      let sum = 0;
      for (let i = 0; i < weights.length; i++)
        sum += weights[i]! * power[from + i]!;
      model[frame * MEL_BANDS + band] = Math.log(sum + 1e-6);
      melDb[band] = 10 * Math.log10(sum + 1e-10);
      if (frame > 0) flux += Math.max(0, melDb[band]! - lastDb[band]!);
    }
    onset[frame] = flux / MEL_BANDS;
    lastDb.set(melDb);
    if (progress && frame % 1000 === 999) progress(frame / frames);
  }
  return { frames, detail, detailBins: DETAIL_BINS, model, onset };
}

/** Band flux: per frame, the mean positive change in decibels of the detail bins between `lowHz` and `highHz`. */
export function bandFlux(
  spectra: Pick<Spectra, "frames" | "detail" | "detailBins">,
  lowHz: number,
  highHz: number,
): Float32Array {
  const { frames, detail, detailBins } = spectra;
  const from = Math.max(0, Math.ceil(detailBinAt(Math.min(lowHz, highHz))));
  const to = Math.min(
    detailBins - 1,
    Math.floor(detailBinAt(Math.max(lowHz, highHz))),
  );
  const out = new Float32Array(frames);
  if (to < from) return out;
  for (let frame = 1; frame < frames; frame++) {
    let sum = 0;
    for (let bin = from; bin <= to; bin++)
      sum += Math.max(
        0,
        detail[frame * detailBins + bin]! -
          detail[(frame - 1) * detailBins + bin]!,
      );
    out[frame] = sum / (to - from + 1);
  }
  return out;
}

/** The `share` quantile of `values` (sampled, for millions of values). */
export function quantile(values: Float32Array, share: number): number {
  const step = Math.max(1, Math.floor(values.length / 20000));
  const sample: number[] = [];
  for (let i = 0; i < values.length; i += step) sample.push(values[i]!);
  sample.sort((a, b) => a - b);
  return (
    sample[Math.min(sample.length - 1, Math.floor(share * sample.length))] ?? 0
  );
}
