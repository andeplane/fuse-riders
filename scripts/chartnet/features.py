"""Audio features in the Dance Dance Convolution style: log-mel at three window sizes, ~100 frames per second."""
from __future__ import annotations

import os
import subprocess
import tempfile

import librosa
import numpy as np
import soundfile as sf

SR = 22050
HOP = 220
FPS = SR / HOP
N_MELS = 64
WINDOWS = (512, 1024, 2048)


def load_audio(src, suffix: str = "") -> np.ndarray:
    try:
        y, sr = sf.read(src, dtype="float32", always_2d=True)
        y = y.mean(axis=1)
    except Exception:  # noqa: BLE001  — fall back to ffmpeg (m4a etc.)
        if hasattr(src, "seek"):
            src.seek(0)
        data = src.read() if hasattr(src, "read") else open(src, "rb").read()
        with tempfile.NamedTemporaryFile(suffix="." + (suffix or "bin"), delete=False) as f:
            f.write(data)
            tmp = f.name
        try:
            raw = subprocess.run(
                ["ffmpeg", "-v", "quiet", "-i", tmp, "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"],
                capture_output=True, check=True).stdout
        finally:
            os.unlink(tmp)
        return np.frombuffer(raw, dtype=np.float32).copy()
    return librosa.resample(y, orig_sr=sr, target_sr=SR) if sr != SR else y


def features_from_audio(src, suffix: str = "") -> tuple[np.ndarray, np.ndarray]:
    y = load_audio(src, suffix)
    mels = []
    for n_fft in WINDOWS:
        m = librosa.feature.melspectrogram(y=y, sr=SR, n_fft=n_fft, hop_length=HOP, n_mels=N_MELS, fmin=27.5, fmax=11000)
        mels.append(np.log(m + 1e-6))
    n = min(x.shape[1] for x in mels)
    feats = np.concatenate([x[:, :n] for x in mels], axis=0).T  # (frames, 3*N_MELS)
    onset = librosa.onset.onset_strength(y=y, sr=SR, hop_length=HOP)[:n]
    return feats, onset
