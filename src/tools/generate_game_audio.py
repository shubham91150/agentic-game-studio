#!/usr/bin/env python3
"""
Procedural AudioCraft-Style Game Audio Stem & Ambient WAV Generator
(src/tools/generate_game_audio.py)

Chat requirement:
  "Sound — old Lucknow bazaar ambient sound, jalebi fry sizzle, footsteps, collect chime, engine loop"

Pure Python + NumPy/SciPy physical-modeling & spectral wave synthesis (zero paid API).
Generates high-quality 44.1 kHz 16-bit PCM `.wav` audio stems into `public/assets/audio/`:
  - `bazaar_ambience.wav` : warm layered market murmur + distant brass bell chimes + gentle breeze
  - `jalebi_sizzle.wav`   : band-filtered pink/white noise + random micro-crackle envelope (hot-oil frying sizzle)
  - `footstep_stone.wav`  : crisp transient cobblestone thud + granular gravel resonance
  - `collect_chime.wav`   : harmonic golden bell arpeggio with shimmer tail
  - `impact_crash.wav`    : low sub-bass punch + inharmonic metallic clatter

Usage:
  python3 src/tools/generate_game_audio.py --all
  python3 src/tools/generate_game_audio.py --stem jalebi_sizzle --out-dir public/assets/audio
"""

from __future__ import annotations

import argparse
import json
import wave
from pathlib import Path

import numpy as np
from scipy import signal

SAMPLE_RATE = 44100


def write_pcm16_wav(path: Path, samples: np.ndarray, sr: int = SAMPLE_RATE) -> dict:
    """Normalizes float samples to [-0.95, 0.95] and writes a 16-bit mono PCM WAV file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    peak = float(np.max(np.abs(samples)))
    if peak > 1e-6:
        samples = (samples / peak) * 0.92
    pcm = np.clip(np.rint(samples * 32767.0), -32768, 32767).astype("<i2")

    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(pcm.tobytes())

    return {
        "stem": path.stem,
        "file": str(path),
        "bytes": path.stat().st_size,
        "durationSec": round(len(pcm) / float(sr), 2),
        "sampleRate": sr,
    }


def synth_bazaar_ambience(rng: np.random.Generator, sr: int = SAMPLE_RATE) -> np.ndarray:
    """6.0s seamless-feeling old Lucknow bazaar ambience: warm crowd murmur + distant brass temple/vendor bells + breeze."""
    dur = 6.0
    n = int(dur * sr)
    t = np.linspace(0.0, dur, n, endpoint=False, dtype=np.float64)

    # 1. Warm crowd murmur (formant-filtered pink-ish noise modulated by slow syllabic envelopes)
    white = rng.standard_normal(n)
    b_low, a_low = signal.butter(3, [180.0 / (sr * 0.5), 950.0 / (sr * 0.5)], btype="band")
    murmur_base = signal.lfilter(b_low, a_low, white)
    syllable_mod = (
        0.55
        + 0.25 * np.sin(2.0 * np.pi * 1.7 * t)
        + 0.15 * np.sin(2.0 * np.pi * 3.1 * t + 0.8)
        + 0.12 * np.cos(2.0 * np.pi * 0.65 * t)
    )
    murmur = murmur_base * syllable_mod * 0.45

    # 2. Gentle warm courtyard breeze
    b_wind, a_wind = signal.butter(2, [90.0 / (sr * 0.5), 360.0 / (sr * 0.5)], btype="band")
    breeze = signal.lfilter(b_wind, a_wind, rng.standard_normal(n)) * (
        0.18 + 0.10 * np.sin(2.0 * np.pi * 0.28 * t)
    )

    # 3. Distant brass ghanti / vendor bell chimes at 0.9s, 2.7s, and 4.5s
    bells = np.zeros(n, dtype=np.float64)
    bell_events = [
        (0.85, 1180.0, 0.22),
        (2.65, 1485.0, 0.18),
        (4.45, 1320.0, 0.20),
    ]
    for t0, f0, amp in bell_events:
        idx0 = int(t0 * sr)
        span = int(1.35 * sr)
        idx1 = min(n, idx0 + span)
        dt = np.arange(idx1 - idx0, dtype=np.float64) / sr
        env = np.exp(-3.8 * dt) * (1.0 - np.exp(-180.0 * dt))
        tone = (
            np.sin(2.0 * np.pi * f0 * dt)
            + 0.45 * np.sin(2.0 * np.pi * (f0 * 2.02) * dt) * np.exp(-5.5 * dt)
            + 0.22 * np.sin(2.0 * np.pi * (f0 * 2.98) * dt) * np.exp(-8.0 * dt)
        )
        bells[idx0:idx1] += amp * env * tone

    # 4. Subtle distant tanpura/harmonium drone fifth (C3 + G3)
    drone = 0.05 * (
        np.sin(2.0 * np.pi * 130.81 * t) + 0.6 * np.sin(2.0 * np.pi * 196.0 * t)
    )

    mix = murmur + breeze + bells + drone
    # Smooth 80ms fade-in/out for clean looping
    fade = int(0.08 * sr)
    mix[:fade] *= np.linspace(0.0, 1.0, fade)
    mix[-fade:] *= np.linspace(1.0, 0.0, fade)
    return mix


def synth_jalebi_sizzle(rng: np.random.Generator, sr: int = SAMPLE_RATE) -> np.ndarray:
    """3.5s hot-ghee/oil frying sizzle: band-passed hiss + dense stochastic micro-bubble crackle transients."""
    dur = 3.5
    n = int(dur * sr)
    t = np.linspace(0.0, dur, n, endpoint=False, dtype=np.float64)

    # 1. High-frequency oil hiss (1.8 kHz - 9.5 kHz bandpass)
    noise = rng.standard_normal(n)
    b_hiss, a_hiss = signal.butter(3, [1800.0 / (sr * 0.5), 9500.0 / (sr * 0.5)], btype="band")
    hiss = signal.lfilter(b_hiss, a_hiss, noise) * (
        0.32 + 0.08 * np.sin(2.0 * np.pi * 2.4 * t)
    )

    # 2. Mid-band bubbling oil body (550 Hz - 1800 Hz)
    b_mid, a_mid = signal.butter(2, [550.0 / (sr * 0.5), 1800.0 / (sr * 0.5)], btype="band")
    bubble_body = signal.lfilter(b_mid, a_mid, rng.standard_normal(n)) * 0.22

    # 3. Stochastic micro-crackle pops (~220 pops/sec)
    crackle = np.zeros(n, dtype=np.float64)
    num_pops = int(dur * 220)
    pop_starts = rng.integers(0, n - int(0.012 * sr), size=num_pops)
    for p0 in pop_starts:
        plen = int(rng.uniform(0.0018, 0.0075) * sr)
        dt = np.arange(plen, dtype=np.float64) / sr
        freq = rng.uniform(2200.0, 6800.0)
        amp = rng.uniform(0.25, 0.95)
        pop_wave = (
            amp
            * np.exp(-dt * rng.uniform(450.0, 900.0))
            * np.sin(2.0 * np.pi * freq * dt)
        )
        crackle[p0 : p0 + plen] += pop_wave

    mix = hiss + bubble_body + crackle
    fade = int(0.05 * sr)
    mix[:fade] *= np.linspace(0.0, 1.0, fade)
    mix[-fade:] *= np.linspace(1.0, 0.0, fade)
    return mix


def synth_footstep_stone(rng: np.random.Generator, sr: int = SAMPLE_RATE) -> np.ndarray:
    """0.45s crisp cobblestone heel-toe footstep: low-end thud transient + gritty stone/gravel scrape."""
    dur = 0.45
    n = int(dur * sr)
    t = np.linspace(0.0, dur, n, endpoint=False, dtype=np.float64)

    # Heel strike at t=0.01s (pitch-dropping sub thud 155 Hz -> 52 Hz)
    t_heel = np.maximum(0.0, t - 0.01)
    heel_env = np.exp(-38.0 * t_heel) * (t >= 0.01)
    heel_phase = 2.0 * np.pi * (52.0 * t_heel + 103.0 * (1.0 - np.exp(-45.0 * t_heel)) / 45.0)
    heel_thud = 0.85 * heel_env * np.sin(heel_phase)

    # Toe tap at t=0.065s
    t_toe = np.maximum(0.0, t - 0.065)
    toe_env = np.exp(-52.0 * t_toe) * (t >= 0.065)
    toe_thud = 0.42 * toe_env * np.sin(2.0 * np.pi * 115.0 * t_toe)

    # Stone grit burst (800 Hz - 4800 Hz filtered noise burst)
    b_grit, a_grit = signal.butter(2, [800.0 / (sr * 0.5), 4800.0 / (sr * 0.5)], btype="band")
    grit_noise = signal.lfilter(b_grit, a_grit, rng.standard_normal(n))
    grit_env = 0.55 * np.exp(-32.0 * t_heel) * (t >= 0.01) + 0.35 * np.exp(-44.0 * t_toe) * (
        t >= 0.065
    )

    return heel_thud + toe_thud + grit_noise * grit_env


def synth_collect_chime(rng: np.random.Generator, sr: int = SAMPLE_RATE) -> np.ndarray:
    """1.2s bright rewarding pickup chime: C6 - E6 - G6 - C7 major arpeggio with harmonic shimmer."""
    dur = 1.2
    n = int(dur * sr)
    mix = np.zeros(n, dtype=np.float64)

    notes = [
        (0.00, 1046.50, 0.55),  # C6
        (0.08, 1318.51, 0.62),  # E6
        (0.16, 1567.98, 0.72),  # G6
        (0.25, 2093.00, 0.90),  # C7
    ]
    for start_s, freq, gain in notes:
        i0 = int(start_s * sr)
        dt = np.arange(n - i0, dtype=np.float64) / sr
        env = (1.0 - np.exp(-320.0 * dt)) * np.exp(-4.6 * dt)
        partials = (
            np.sin(2.0 * np.pi * freq * dt)
            + 0.38 * np.sin(2.0 * np.pi * (freq * 2.0) * dt) * np.exp(-6.5 * dt)
            + 0.18 * np.sin(2.0 * np.pi * (freq * 3.01) * dt) * np.exp(-9.0 * dt)
        )
        mix[i0:] += gain * env * partials

    return mix


def synth_impact_crash(rng: np.random.Generator, sr: int = SAMPLE_RATE) -> np.ndarray:
    """1.4s heavy collision crash: sub-bass punch + metallic inharmonic plate resonances + debris burst."""
    dur = 1.4
    n = int(dur * sr)
    t = np.linspace(0.0, dur, n, endpoint=False, dtype=np.float64)

    # 1. Sub-bass impact punch (140 Hz -> 36 Hz)
    punch_env = np.exp(-14.0 * t)
    punch_phase = 2.0 * np.pi * (36.0 * t + 104.0 * (1.0 - np.exp(-22.0 * t)) / 22.0)
    punch = 0.95 * punch_env * np.sin(punch_phase)

    # 2. Inharmonic metallic clatter modes
    metal_freqs = [312.0, 487.0, 738.0, 1124.0, 1690.0, 2410.0, 3380.0]
    metal = np.zeros(n, dtype=np.float64)
    for k, mf in enumerate(metal_freqs):
        decay = 4.5 + k * 1.4
        metal += (
            (0.28 / (1.0 + 0.25 * k))
            * np.exp(-decay * t)
            * np.sin(2.0 * np.pi * mf * t + rng.uniform(0, 2.0 * np.pi))
        )

    # 3. Broadband shatter/crunch burst
    b_shat, a_shat = signal.butter(2, [350.0 / (sr * 0.5), 7200.0 / (sr * 0.5)], btype="band")
    shatter = (
        signal.lfilter(b_shat, a_shat, rng.standard_normal(n))
        * np.exp(-9.5 * t)
        * 0.65
    )

    return punch + metal + shatter


STEM_BUILDERS = {
    "bazaar_ambience": synth_bazaar_ambience,
    "jalebi_sizzle": synth_jalebi_sizzle,
    "footstep_stone": synth_footstep_stone,
    "collect_chime": synth_collect_chime,
    "impact_crash": synth_impact_crash,
}


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate procedural 44.1kHz game audio WAV stems into public/assets/audio/."
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Generate all 5 standard game audio stems",
    )
    parser.add_argument(
        "--stem",
        choices=list(STEM_BUILDERS.keys()),
        default=None,
        help="Generate a specific stem if --all is not passed",
    )
    parser.add_argument(
        "--out-dir",
        default="public/assets/audio",
        help="Output directory for .wav files (default: public/assets/audio)",
    )
    args = parser.parse_args()

    out_dir = Path(args.out_dir).resolve()
    rng = np.random.default_rng(42)

    selected = (
        list(STEM_BUILDERS.keys())
        if args.all or not args.stem
        else [args.stem]
    )

    results = []
    for name in selected:
        samples = STEM_BUILDERS[name](rng, SAMPLE_RATE)
        info = write_pcm16_wav(out_dir / f"{name}.wav", samples, SAMPLE_RATE)
        results.append(info)

    print(
        json.dumps(
            {
                "outDir": str(out_dir),
                "generatedCount": len(results),
                "stems": results,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
