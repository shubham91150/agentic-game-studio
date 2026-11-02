#!/usr/bin/env python3
"""Real Meta AudioCraft / MusicGen ML Model (`facebook/musicgen-small`, 300M params).

Loads Meta's official `facebook/musicgen-small` model via `transformers`
(AutoProcessor + MusicgenForConditionalGeneration) and generates real AI
32kHz .wav audio from a text prompt.

Usage:
  python3 src/tools/meta_musicgen_audio.py --prompt "upbeat electronic racing synthwave loop" --seconds 4 --out public/assets/audio/musicgen_theme.wav
"""
import argparse
import json
import os
import time

import numpy as np
import scipy.io.wavfile as wavfile
import torch
from transformers import AutoProcessor, MusicgenForConditionalGeneration


def generate_musicgen(prompt: str, seconds: float, out_path: str, model_id: str = "facebook/musicgen-small") -> dict:
    t0 = time.time()
    device = "cuda" if torch.cuda.is_available() else "cpu"

    processor = AutoProcessor.from_pretrained(model_id)
    model = MusicgenForConditionalGeneration.from_pretrained(model_id)
    model.to(device)
    model.eval()

    # MusicGen frame rate is ~50 tokens per second of 32kHz audio
    max_new_tokens = max(16, int(round(seconds * 50)))

    inputs = processor(
        text=[prompt],
        padding=True,
        return_tensors="pt",
    ).to(device)

    with torch.no_grad():
        audio_values = model.generate(**inputs, max_new_tokens=max_new_tokens)

    sampling_rate = int(model.config.audio_encoder.sampling_rate)
    audio_np = audio_values[0, 0].detach().cpu().numpy().astype(np.float32)

    # Normalize safely and convert to 16-bit PCM for maximum browser compatibility
    peak = float(np.max(np.abs(audio_np))) if audio_np.size > 0 else 1.0
    if peak > 1e-6:
        audio_np = audio_np / peak * 0.92
    pcm16 = np.clip(audio_np * 32767.0, -32768, 32767).astype(np.int16)

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    wavfile.write(out_path, sampling_rate, pcm16)

    elapsed = round(time.time() - t0, 2)
    size_bytes = os.path.getsize(out_path)
    duration_s = round(len(pcm16) / float(sampling_rate), 2)

    return {
        "ok": True,
        "model": model_id,
        "device": device,
        "prompt": prompt,
        "sampling_rate_hz": sampling_rate,
        "max_new_tokens": max_new_tokens,
        "duration_sec": duration_s,
        "elapsed_sec": elapsed,
        "out": out_path,
        "bytes": size_bytes,
    }


def main():
    ap = argparse.ArgumentParser(description="Meta MusicGen (`facebook/musicgen-small`) AI Audio Generator")
    ap.add_argument("--prompt", required=True, help="Text description of the music/audio to generate")
    ap.add_argument("--seconds", type=float, default=4.0, help="Target duration in seconds (default 4.0)")
    ap.add_argument("--out", default="public/assets/audio/musicgen_theme.wav", help="Output .wav path")
    args = ap.parse_args()

    res = generate_musicgen(args.prompt, args.seconds, args.out)
    print(json.dumps(res, indent=2))


if __name__ == "__main__":
    main()
