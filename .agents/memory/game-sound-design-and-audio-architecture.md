---
name: Game Sound Design, Adaptive BGM, Spatial 3D SFX & Audio Architecture
description: Complete sound design rulebook for all games: Meta MusicGen AI stems, 4-bus mixer with ConvolverNode room reverb, adaptive state crossfading, 3-part transient+body+tail SFX synthesis, stereo-panned distance-attenuated 3D spatial audio, surface footsteps, and pause/tab-switch silence.
type: project
---

# Game Sound Design, Adaptive BGM, Spatial 3D SFX & Audio Architecture

> **Rule**: Sound is 50% of a game's emotional immersion. Never ship flat single-oscillator `440Hz` beeps or static unmixed loops. Every game MUST implement a cohesive, multi-bus, spatially-aware soundscape.

---

## 1. Studio Audio Generation Tools (When & How to Generate Assets)

1. **Meta MusicGen AI Music (`src/tools/meta_musicgen_audio.py`)**:
   - Run `python3 src/tools/meta_musicgen_audio.py --prompt "<genre/mood description>" --duration 8 --out public/live-preview/assets/audio/<stem>.wav` to generate real 32kHz AI music stems (`explore_calm.wav`, `tension_drone.wav`, `chase_action.wav`).
2. **Procedural Multi-Stem WAV Generator (`src/tools/generate_game_audio.py`)**:
   - Run `python3 src/tools/generate_game_audio.py --out-dir public/live-preview/assets/audio` for rich multi-layered ambient/music/SFX `.wav` stems.
3. **NPC Voice & Whisper Lines (`src/tools/npc_dialogue.js`)**:
   - Run `node src/tools/npc_dialogue.js --character "<name>" --world "<setting>" --lines 8 --out public/live-preview/assets/whispers.json` (Baseten `meta-models/muse-spark-open-1026`).

---

## 2. The 4-Bus WebAudio Architecture + Room Reverb (`audio.js`)

Every game's `audio.js` MUST route audio through a clean bus hierarchy:

```
[BGM Bus] ──────┐
[Ambient Bus] ──┼──> [ConvolverNode Wet/Dry Reverb + DynamicsCompressor] ──> [MasterGain] ──> ctx.destination
[3D SFX Bus] ───┤
[Voice Bus] ────┘
```

1. **Impulse-Response Room/Environment Reverb (`ConvolverNode`)**:
   - Generate a procedural stereo impulse response buffer (e.g., `1.6s` exponentially decaying stereo noise `Math.pow(1 - i/len, 2.6)` with early reflections) and route 20–35% wet send from SFX/Voice/Ambient through it so footsteps, doors, whispers, and engines sound like they exist inside a real physical space (cathedral, corridor, canyon, street).
2. **Adaptive Multi-Layer BGM Crossfading (Where & How BGM Plays)**:
   - **Menu**: Mysterious/thematic intro motif (low-pass filtered at `900Hz`).
   - **Exploration / Normal**: Subtle atmospheric drone + sparse melodic tension (`bgmCalmGain = 0.35`, `bgmChaseGain = 0.0`).
   - **Suspicion / Danger / High Speed**: Smoothly ramp up tension layers (`linearRampToValueAtTime`, `0.4s` time constant), adding rhythmic pulse / heartbeat (`55Hz` lub-dub scaling from `65 BPM` to `145 BPM` based on threat proximity `1 - dist/16`).
   - **Chase / Climax**: Full-intensity percussion + dissonant brass/string stinger (`bgmChaseGain = 0.75`).
   - **Victory / Game Over**: Immediate emotional resolution chord or jumpscare impact stinger, ducking background loops cleanly.
3. **3-Part Realistic SFX Synthesis (`Attack Transient + Body + Tail`)**:
   - **NEVER use a bare `osc.type = 'sine'` beep!** Every SFX must combine:
     - **Footsteps (Player & Enemy)**: Bandpass-filtered noise transient (`800–1800Hz`, `0.035s` heel/sole scuff) + low sub-thud (`110Hz -> 42Hz` pitch drop, `0.07s` floor resonance) + random pitch/gain jitter (`±12%` every step so it never sounds robotic). Scale volume & filter cutoff by stance (`crouch` = soft `450Hz` muffled, `walk` = natural `1100Hz`, `run` = sharp `1800Hz` heavy thud).
     - **Pickups / Keys / Relics**: 3–4 inharmonic metallic bell partials (`e.g. 1980Hz, 2740Hz, 3610Hz, 4820Hz`) with staggered micro-attacks (`0ms, 18ms, 35ms`) and shimmer decay (`0.6s`).
     - **Doors / Locks / Collisions**: Low wood/stone creak (FM-modulated low sawtooth `85Hz -> 62Hz` through resonant bandpass) + sharp metallic latch clunk (`320Hz + 1400Hz` noise burst).
     - **UI Hover / Click**: Subtle, tactile micro-tick (`12ms` filtered impulse) — never harsh arcade buzzers.
4. **3D Spatial Positioning (`StereoPannerNode` + Distance Falloff)**:
   - For any world sound (enemy footsteps, whispers, flickering lanterns, rival cars):
     - Compute relative angle to camera forward vector → set `StereoPannerNode.pan.value = Math.max(-0.95, Math.min(0.95, Math.sin(relAngle)))`.
     - Compute distance `d` → attenuate gain by `1 / (1 + d * 0.22)` and low-pass filter cutoff by `Math.max(350, 4500 - d * 220)` (distant sounds are both quieter AND more muffled through walls!).
5. **Voice Ducking & Pause/Tab-Switch Hygiene**:
   - When an NPC voice/whisper plays, duck `BGM` and `Ambient` buses by `40%` for the duration of the line, then restore.
   - Always implement `suspendAll()` / `resumeAll()` so pausing the game or switching tabs silences 100% of audio immediately.
